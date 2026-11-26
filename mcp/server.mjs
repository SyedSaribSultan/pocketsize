#!/usr/bin/env node
/* Pocketsize MCP server (stdio). Runs Pocketsize's own compression engine, the
 * same web/worker.js the browser app uses, on this computer. Files are read and
 * written locally; nothing is sent anywhere. See README.md. */

import path from "node:path";
import os from "node:os";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Pool } from "./lib/pool.mjs";
import {
  MAX_FILES, FORMATS, collect, plan, analyse, outputPath, writeAtomic,
  presetList, isPreset, DEFAULT_PRESET, formatLabel, settingsFor,
} from "./lib/core.mjs";

// stdout is the protocol. Anything that prints must go to stderr.
console.log = console.info = console.warn = (...a) => console.error(...a);

const pool = new Pool();
const server = new McpServer({ name: "pocketsize", version: "0.1.0" });

/* ------------------------------- shared inputs ----------------------------- */

const presetNames = presetList().map((p) => p.id);
const common = {
  paths: z.array(z.string()).min(1).describe(
    "Absolute paths of image files and/or folders. Supported: JPEG, PNG, WebP, GIF, AVIF, BMP."),
  recursive: z.boolean().optional().describe("Also look inside subfolders of any folder given. Default false."),
  glob: z.string().optional().describe(
    'Only files whose name matches, e.g. "*.png" or "photos/**/*.jpg". Matched against the file name, or the path inside the folder if the pattern has a slash.'),
  start: z.number().int().min(0).optional().describe(
    `Continue a large set: the index (from 0) of the first file to handle. At most ${MAX_FILES} files are handled per call.`),
  destination: z.enum(presetNames).optional().describe(
    `Where the pictures are going; sets size limit, quality target and allowed formats. Default "${DEFAULT_PRESET}". Use the presets tool for details.`),
  maxWidth: z.number().int().min(1).max(20000).optional().describe("Shrink so the width is at most this many pixels. Never enlarges."),
  maxHeight: z.number().int().min(1).max(20000).optional().describe("Shrink so the height is at most this many pixels. Never enlarges. With maxWidth, the picture fits inside both."),
  quality: z.number().min(50).max(99).optional().describe(
    "Minimum visual match to the original, 0 to 100 on the SSIMULACRA 2 scale. Overrides the destination's target (web 90, email 88, thumbnail 80)."),
  format: z.enum(FORMATS).optional().describe("Always use this format instead of letting Pocketsize choose the smallest that passes."),
  lossless: z.boolean().optional().describe("Identical: keep every pixel (no quality loss, no resizing). Only pixel-exact formats compete."),
  maxSizeKB: z.number().min(1).optional().describe("Aim for a file no bigger than this many KB, at the best quality that fits."),
  flattenTransparency: z.boolean().optional().describe("When a chosen format cannot hold transparency (JPEG), flatten onto white instead of keeping PNG. Default false."),
};

const kb = (n) => (n == null ? "" : n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`);
const pct = (a, b) => (a > 0 ? `${Math.round((1 - b / a) * 100)}%` : "0%");
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|");
const rel = (f) => (f.rel && !f.rel.startsWith("..") ? f.rel : f.abs);

function qualityText(r) {
  if (r.lossless) return "lossless";
  if (r.level == null) return "";
  return r.format === "png8" ? `${r.level} colours` : `${r.level}`;
}

function reply(text, structured, isError = false) {
  return { content: [{ type: "text", text }], structuredContent: structured, ...(isError ? { isError: true } : {}) };
}

function select(args) {
  const { files, skipped } = collect({
    paths: args.paths, recursive: args.recursive, glob: args.glob,
    skipSuffix: args.outputDir || args.overwrite ? null : (args.suffix ?? "-min"),
  });
  const start = args.start ?? 0;
  if (!files.length) {
    return { error: `No supported images found.${skipped.length ? " " + skipped.slice(0, 5).map((s) => `${s.path}: ${s.reason}`).join("; ") : ""}`
      + " Give image files, or a folder (add recursive: true to include subfolders)." };
  }
  if (files.length > MAX_FILES && args.start === undefined) {
    return { error: `Found ${files.length} images, which is more than the ${MAX_FILES} allowed in one call. Nothing was changed. `
      + `To continue: call again with start: 0 (handles files 0-${MAX_FILES - 1}), then start: ${MAX_FILES} (next ${MAX_FILES}), and so on until start reaches ${files.length}. `
      + `Or narrow it with a subfolder, recursive: false, or a glob such as "*.png".` };
  }
  const batch = files.slice(start, start + MAX_FILES);
  if (!batch.length) return { error: `start ${start} is past the end: only ${files.length} images were found.` };
  return { files: batch, skipped, total: files.length, start, nextStart: start + batch.length < files.length ? start + batch.length : null };
}

/* ------------------------------- presets tool ------------------------------ */

server.registerTool("presets", {
  title: "Pocketsize destinations",
  description: "List the destination presets (website, email, chat, ...) and what each one targets: quality, size limit and the formats it may write. Use one as the `destination` of compress or inspect.",
  inputSchema: {},
  annotations: { readOnlyHint: true, openWorldHint: false },
}, async () => {
  const presets = presetList();
  const lines = ["| id | name | min quality | longest side | formats | what it is for |", "|---|---|---|---|---|---|"];
  for (const p of presets) {
    lines.push(`| ${p.id} | ${cell(p.label)} | ${p.qualityTarget} | ${p.maxDimension ? p.maxDimension + " px" : "unchanged"} | ${p.formats.map(formatLabel).join(", ")} | ${cell(p.help)} |`);
  }
  lines.push("", `Default: ${DEFAULT_PRESET}. Quality is a SSIMULACRA 2 score (0 to 100) against your original; Pocketsize tries every allowed format, searches each for the lowest quality that still clears the target, and keeps the smallest.`,
    "The documents preset also never writes a long side above 4096 px.");
  return reply(lines.join("\n"), { defaultDestination: DEFAULT_PRESET, presets });
});

/* ------------------------------- inspect tool ------------------------------ */

server.registerTool("inspect", {
  title: "Inspect images",
  description: "Show what compress would do with these files, without writing anything. By default this reads only file headers (fast): size, pixels, whether it would be resized, the quality target and the formats that would compete. Set analyze: true to run the real search and predict the exact format, quality and output size (slow, uses all CPU cores).",
  inputSchema: { ...common, analyze: z.boolean().optional().describe("Run the full compression search in memory and report the result, still without writing. Default false.") },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, async (args, extra) => {
  const sel = select(args);
  if (sel.error) return reply(sel.error, { error: sel.error }, true);
  const o = { ...args, preset: args.destination };
  const rows = [];
  if (!args.analyze) {
    for (const f of sel.files) rows.push(plan(f, o));
    const lines = ["| file | size | pixels | after | target | formats that compete | note |", "|---|---|---|---|---|---|---|"];
    for (const r of rows) {
      lines.push(`| ${cell(rel(r.file))} | ${kb(r.inputBytes)} | ${r.width ? `${r.width}x${r.height}` : "?"} | ${r.outWidth ? `${r.outWidth}x${r.outHeight}${r.resized ? " (resized)" : ""}` : ""} | ${r.qualityTarget ?? ""} | ${(r.formats || []).map(formatLabel).join(", ")} | ${cell(r.reason || "")} |`);
    }
    return reply(summaryHead(sel) + lines.join("\n"), { files: rows.map(plain), skipped: sel.skipped, total: sel.total });
  }
  const results = await runAll(sel.files, o, extra, null);
  return reply(summaryHead(sel) + resultTable(results, false).text, { files: results.map(plain), skipped: sel.skipped, total: sel.total, written: false });
});

/* ------------------------------- compress tool ----------------------------- */

server.registerTool("compress", {
  title: "Compress images",
  description: "Compress images in bulk on this computer with Pocketsize's own engine. For each picture it tries JPEG, palette PNG, lossless PNG, WebP, lossless WebP and AVIF (as the destination allows), finds the lowest quality that still looks the same (SSIMULACRA 2), and keeps the smallest. Originals are never overwritten unless overwrite is true. A picture that cannot be made smaller is left alone and reported. Animated GIFs are left exactly as they are. Files never leave this computer.",
  inputSchema: {
    ...common,
    outputDir: z.string().optional().describe("Write results into this folder (created if needed), keeping subfolder structure. If omitted, results sit next to the originals with a suffix."),
    suffix: z.string().regex(/^[\w.\- ]*$/).optional().describe('Added to the file name when writing next to the originals. Default "-min".'),
    overwrite: z.boolean().optional().describe("Replace the original file in place when the new file has the same extension. Default false. Different extensions are written beside the original, which is never deleted."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async (args, extra) => {
  const sel = select(args);
  if (sel.error) return reply(sel.error, { error: sel.error }, true);
  const o = { ...args, preset: args.destination };
  const results = await runAll(sel.files, o, extra, args);
  const t = resultTable(results, true);
  let head = summaryHead(sel);
  if (sel.nextStart !== null) head += `More files remain: call again with start: ${sel.nextStart} to continue.\n\n`;
  return reply(head + t.text, {
    files: results.map(plain), skipped: sel.skipped, total: sel.total, totals: t.totals, nextStart: sel.nextStart,
  });
});

/* ---------------------------------- helpers -------------------------------- */

function summaryHead(sel) {
  let s = `${sel.files.length} image${sel.files.length === 1 ? "" : "s"}`;
  if (sel.total > sel.files.length) s += ` (files ${sel.start}-${sel.start + sel.files.length - 1} of ${sel.total})`;
  s += ".\n";
  if (sel.skipped.length) {
    s += `Skipped ${sel.skipped.length}: ` + sel.skipped.slice(0, 10).map((k) => `${path.basename(k.path)} (${k.reason})`).join("; ")
      + (sel.skipped.length > 10 ? `; and ${sel.skipped.length - 10} more` : "") + ".\n";
  }
  return s + "\n";
}

async function runAll(files, o, extra, writeOpts) {
  const results = new Array(files.length);
  let next = 0, done = 0;
  const token = extra?._meta?.progressToken;
  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      let r;
      try {
        r = await analyse(pool, files[i], o);
        if (writeOpts && r.status === "ok") {
          const dest = outputPath(files[i], r, writeOpts);
          r.outputPath = writeAtomic(dest.path, r.data, { allowExisting: dest.replaced || !!writeOpts.overwrite });
        }
      } catch (e) {
        r = { file: files[i], status: "failed", reason: String(e && e.message || e) };
      }
      delete r.data;
      results[i] = r;
      done++;
      if (token !== undefined) {
        extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: done, total: files.length, message: path.basename(files[i].abs) } }).catch(() => {});
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(pool.size, files.length) }, worker));
  return results;
}

function resultTable(results, wrote) {
  const lines = [`| file | before | after | format | quality | score | saved | ${wrote ? "written to" : "note"} |`, "|---|---|---|---|---|---|---|---|"];
  const totals = { files: results.length, compressed: 0, kept: 0, skipped: 0, failed: 0, bytesBefore: 0, bytesAfter: 0, bytesSaved: 0 };
  for (const r of results) {
    if (r.status === "ok") {
      totals.compressed++;
      totals.bytesBefore += r.inputBytes; totals.bytesAfter += r.outputBytes;
      const notes = [...(r.note ? [r.note] : []), ...(r.warnings || [])];
      if (r.outWidth && (r.outWidth !== r.width || r.outHeight !== r.height)) notes.unshift(`resized ${r.width}x${r.height} to ${r.outWidth}x${r.outHeight}`);
      lines.push(`| ${cell(rel(r.file))} | ${kb(r.inputBytes)} | ${kb(r.outputBytes)} | ${formatLabel(r.format)} | ${qualityText(r)} | ${r.score ?? ""} | ${kb(r.inputBytes - r.outputBytes)} (${pct(r.inputBytes, r.outputBytes)}) | ${cell(wrote ? r.outputPath : notes.join("; "))}${wrote && notes.length ? cell(" (" + notes.join("; ") + ")") : ""} |`);
    } else if (r.status === "kept") {
      totals.kept++;
      totals.bytesBefore += r.inputBytes; totals.bytesAfter += r.inputBytes;
      lines.push(`| ${cell(rel(r.file))} | ${kb(r.inputBytes)} | ${kb(r.inputBytes)} | | | | 0 | not worth it: ${cell(r.reason)}${r.warnings?.length ? cell(" (" + r.warnings.join("; ") + ")") : ""} |`);
    } else {
      r.status === "failed" ? totals.failed++ : totals.skipped++;
      lines.push(`| ${cell(rel(r.file))} | ${kb(r.inputBytes)} | | | | | | ${r.status}: ${cell(r.reason)} |`);
    }
  }
  totals.bytesSaved = totals.bytesBefore - totals.bytesAfter;
  lines.push("", `Totals: ${totals.compressed} compressed, ${totals.kept} left as they are, ${totals.skipped + totals.failed} skipped or failed. `
    + `${kb(totals.bytesBefore)} to ${kb(totals.bytesAfter)}, saved ${kb(totals.bytesSaved)} (${pct(totals.bytesBefore, totals.bytesAfter)}).`);
  return { text: lines.join("\n"), totals };
}

const plain = (r) => {
  const { file, candidates, settings, ...rest } = r;
  return { path: file.abs, ...rest, ...(candidates ? { candidates } : {}) };
};

/* ------------------------------------ run ---------------------------------- */

const transport = new StdioServerTransport();
const shutdown = async () => { await pool.close(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.stdin.on("end", shutdown);
await server.connect(transport);
console.error(`pocketsize MCP server ready (${pool.size} engine threads, ${os.platform()})`);
