/* What the three tools do, apart from the MCP plumbing: reading the app's own
 * destination table, finding files, building the engine's settings the way
 * web/js/settings.js does, running the pool, and writing results. */

import { readFileSync, statSync, readdirSync, mkdirSync, writeFileSync, renameSync, existsSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { GifReader } from "omggif";
import { WEB_DIR } from "./pool.mjs";
import { sniff } from "./decode.mjs";

/* The app's own files, evaluated as data. Nothing about destinations or the
 * header-size check is restated here. */
const D = vm.runInNewContext(
  `${readFileSync(path.join(WEB_DIR, "destinations.js"), "utf8")}
   ({ DESTINATION_ORDER, DESTINATION_NUMBERS, DESTINATION_FORMATS, DOCUMENTS_MAX_DIMENSION,
      DEFAULT_DESTINATION, destinationOf })`, {});
const dimsSandbox = {};
vm.runInNewContext(readFileSync(path.join(WEB_DIR, "js", "imagedims.js"), "utf8"), dimsSandbox);
const { imageDims, tooManyPixels } = dimsSandbox;

export const MAX_FILES = 500;
export const SUPPORTED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp"]);
export const FORMATS = ["jpeg", "png8", "png", "webp", "webp-lossless", "avif"];

const FORMAT_LABEL = {
  jpeg: "JPEG", png8: "PNG-8 (palette)", png: "PNG (lossless)", webp: "WebP",
  "webp-lossless": "WebP (lossless)", avif: "AVIF",
};
export const formatLabel = (f) => FORMAT_LABEL[f] || f;

export function presetList() {
  return D.DESTINATION_ORDER.map((id) => {
    const n = D.DESTINATION_NUMBERS[id];
    return {
      id, label: n.label, help: n.help,
      qualityTarget: n.qualityTarget,
      maxDimension: n.maxDimension || null,
      formats: D.DESTINATION_FORMATS[id],
      ...(id === "documents" ? { hardMaxDimension: D.DOCUMENTS_MAX_DIMENSION } : {}),
    };
  });
}
export const isPreset = (id) => D.DESTINATION_ORDER.includes(id);
export const DEFAULT_PRESET = D.DEFAULT_DESTINATION;

/* ------------------------------- finding files ---------------------------- */

function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") { re += ".*"; i++; if (glob[i + 1] === "/") i++; } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "{") re += "(?:";
    else if (c === "}") re += ")";
    else if (c === ",") re += "|";
    else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i");
}

/** Expand paths into image files. Returns { files:[{abs, root, rel}], skipped:[{path, reason}] }. */
export function collect({ paths, recursive = false, glob, skipSuffix }) {
  const files = [], skipped = [];
  const seen = new Set();
  const match = glob ? globToRegExp(glob) : null;
  const wanted = (rel) => !match || match.test(glob.includes("/") ? rel : path.posix.basename(rel));
  const add = (abs, root) => {
    const key = abs.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const rel = path.relative(root, abs).split(path.sep).join("/");
    const ext = path.extname(abs).toLowerCase();
    if (!SUPPORTED_EXT.has(ext)) {
      // Only worth a line for explicit files; folders are full of non-images.
      if (root === path.dirname(abs) && !explicitDirs.has(root)) skipped.push({ path: abs, reason: `not a supported image type (${ext || "no extension"})` });
      return;
    }
    if (!wanted(rel)) return;
    if (skipSuffix && path.basename(abs, ext).endsWith(skipSuffix)) {
      skipped.push({ path: abs, reason: `looks like Pocketsize output already (name ends with "${skipSuffix}")` });
      return;
    }
    files.push({ abs, root, rel });
  };
  const explicitDirs = new Set();
  const walk = (dir, root, depth) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) {
      skipped.push({ path: dir, reason: `cannot read folder (${e.code || e.message})` });
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (recursive) walk(p, root, depth + 1); }
      else if (e.isFile()) add(p, root);
    }
  };
  for (const raw of paths) {
    const abs = path.resolve(raw);
    let st;
    try { st = statSync(abs); } catch {
      skipped.push({ path: raw, reason: "does not exist or cannot be read" });
      continue;
    }
    if (st.isDirectory()) { explicitDirs.add(abs); walk(abs, abs, 0); }
    else if (st.isFile()) add(abs, path.dirname(abs));
  }
  files.sort((a, b) => a.abs.localeCompare(b.abs));
  return { files, skipped };
}

/* -------------------------------- settings -------------------------------- */

/** The engine's settings for one file, built the way web/js/settings.js builds them. */
export function settingsFor(o, bytes) {
  const preset = isPreset(o.preset) ? o.preset : D.DEFAULT_DESTINATION;
  const n = D.DESTINATION_NUMBERS[preset];
  const lossless = !!o.lossless;
  let maxDimension = lossless ? 0 : n.maxDimension || 0;
  let dimensionMode = "longest";
  if (!lossless && (o.maxWidth || o.maxHeight)) {
    const dims = imageDims(bytes);
    if (o.maxWidth && o.maxHeight && dims) {
      // The engine pins one edge. Choose the edge that makes the picture fit inside both limits.
      const scale = Math.min(o.maxWidth / dims.width, o.maxHeight / dims.height);
      dimensionMode = "width";
      maxDimension = scale < 1 ? Math.max(1, Math.round(dims.width * scale)) : dims.width;
    } else if (o.maxWidth && !o.maxHeight) { dimensionMode = "width"; maxDimension = o.maxWidth; }
    else if (o.maxHeight && !o.maxWidth) { dimensionMode = "height"; maxDimension = o.maxHeight; }
    else { maxDimension = Math.max(o.maxWidth, o.maxHeight); }
  }
  return {
    target: preset,
    formats: o.format ? [o.format] : null,
    lossless,
    metric: "ss2",
    qualityTarget: o.quality ?? n.qualityTarget,
    maxDimension,
    dimensionMode,
    sizeTarget: o.maxSizeKB ? Math.round(o.maxSizeKB * 1024) : 0,
    alphaPolicy: o.flattenTransparency ? "flatten" : "png",
  };
}

const MIME = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif", bmp: "image/bmp" };

function readInput(abs) {
  const bytes = readFileSync(abs);
  const kind = sniff(bytes);
  if (!kind) return { error: "not a readable image (unrecognised file contents)" };
  return { bytes, mime: MIME[kind], kind };
}

/* --------------------------------- plan only ------------------------------ */

/** What would happen, from the header alone. Nothing is decoded or encoded. */
export function plan(file, o) {
  let input;
  try { input = readInput(file.abs); } catch (e) { return { file, status: "skipped", reason: `cannot read (${e.code || e.message})` }; }
  if (input.error) return { file, status: "skipped", reason: input.error };
  const { bytes, kind } = input;
  const s = settingsFor(o, bytes);
  const dims = imageDims(bytes);
  const row = { file, status: "planned", inputBytes: bytes.length, kind, preset: s.target };
  if (dims) {
    Object.assign(row, { width: dims.width, height: dims.height });
    const big = tooManyPixels(bytes);
    if (big) return { ...row, status: "skipped", reason: big };
  }
  if (kind === "gif" && gifFrames(bytes) > 1) return { ...row, status: "passthrough", reason: "animated GIF, left exactly as it is" };
  const hard = s.target === "documents" ? D.DOCUMENTS_MAX_DIMENSION : 0;
  if (dims) {
    const f = frame(dims.width, dims.height, s.dimensionMode, s.maxDimension, hard);
    row.outWidth = f ? f[0] : dims.width;
    row.outHeight = f ? f[1] : dims.height;
    row.resized = !!f;
  }
  row.qualityTarget = s.qualityTarget;
  row.lossless = s.lossless;
  row.sizeTarget = s.sizeTarget || null;
  row.formats = s.lossless
    ? D.DESTINATION_FORMATS.lossless.filter((n) => D.DESTINATION_FORMATS[s.target].includes(n) || n === "png8x")
    : (s.formats || D.DESTINATION_FORMATS[s.target]);
  return row;
}

// Same arithmetic as frameFor() in web/worker.js, for the dry-run description only.
function frame(w, h, mode, limit, hardCap) {
  let scale = 1;
  if (limit && mode !== "none") {
    const edge = mode === "width" ? w : mode === "height" ? h : Math.max(w, h);
    if (edge > limit) scale = limit / edge;
  }
  if (hardCap && Math.max(w, h) * scale > hardCap) scale = hardCap / Math.max(w, h);
  if (scale >= 1) return null;
  return [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))];
}

function gifFrames(b) {
  try { return new GifReader(Buffer.from(b.buffer, b.byteOffset, b.byteLength)).numFrames(); } catch { return 1; }
}

/* --------------------------------- running -------------------------------- */

/** Compress one file through the pool. Does not write anything. */
export async function analyse(pool, file, o) {
  let input;
  try { input = readInput(file.abs); } catch (e) { return { file, status: "skipped", reason: `cannot read (${e.code || e.message})` }; }
  if (input.error) return { file, status: "skipped", reason: input.error };
  const { bytes, mime } = input;
  const settings = settingsFor(o, bytes);
  const t0 = Date.now();
  const msg = await pool.run({ name: path.basename(file.abs), bytes, mime, settings });
  const ms = Date.now() - t0;
  if (msg.type !== "done") return { file, status: "failed", reason: msg.error || msg.type, inputBytes: bytes.length, ms };
  const r = msg.result;
  const base = {
    file, ms, inputBytes: bytes.length, warnings: r.warnings || [],
    width: r.width, height: r.height, outWidth: r.outW, outHeight: r.outH,
    candidates: (r.candidates || []).map((c) => ({
      format: c.format, bytes: c.bytes, level: c.level ?? null,
      score: c.score == null || c.lossless ? null : Math.round(c.score * 10) / 10, lossless: !!c.lossless,
    })),
    settings,
  };
  if (r.passthrough) {
    return { ...base, status: "kept", reason: r.note || "not made smaller", outputBytes: bytes.length, format: r.fmt, data: null };
  }
  return {
    ...base, status: "ok", format: r.fmt, ext: r.ext, level: r.level ?? null,
    score: r.score == null ? null : Math.round(r.score * 10) / 10, lossless: !!r.lossless,
    outputBytes: r.newBytes, data: Buffer.from(r.bytes), note: r.note || "",
  };
}

/** Where a result goes, or an error if that would overwrite something it must not. */
export function outputPath(file, result, o) {
  const ext = result.ext;
  const stem = path.basename(file.abs, path.extname(file.abs));
  const sameExt = ext === path.extname(file.abs).toLowerCase() ||
    (ext === ".jpg" && path.extname(file.abs).toLowerCase() === ".jpeg");
  let dir, name;
  if (o.outputDir) {
    dir = path.join(path.resolve(o.outputDir), path.dirname(file.rel) === "." ? "" : path.dirname(file.rel));
    name = stem + ext;
  } else if (o.overwrite && sameExt) {
    return { path: file.abs, replaced: true };
  } else {
    dir = path.dirname(file.abs);
    name = stem + (o.suffix ?? "-min") + ext;
  }
  let target = path.join(dir, name);
  const key = (p) => p.toLowerCase();
  const original = key(file.abs);
  if (key(target) === original) {
    // Output folder equals the source folder and the name is unchanged: never clobber silently.
    target = path.join(dir, stem + (o.suffix ?? "-min") + ext);
  }
  return { path: target, replaced: false };
}

export function writeAtomic(target, data, { allowExisting }) {
  mkdirSync(path.dirname(target), { recursive: true });
  let final = target;
  if (!allowExisting && existsSync(final)) {
    const dir = path.dirname(target), ext = path.extname(target), stem = path.basename(target, ext);
    let n = 1;
    do { final = path.join(dir, `${stem}-${n++}${ext}`); } while (existsSync(final));
  }
  const tmp = `${final}.pocketsize-${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, final);
  return final;
}
