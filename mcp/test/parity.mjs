/* Parity check against the real browser engine. Not part of `npm test`: it
 * needs Chrome and puppeteer-core (the repo's tests/web already depends on it).
 *
 * For each fixture and destination it runs web/worker.js in Chrome as a Web
 * Worker and in Node through this server's pool, and compares the format and
 * quality the two pick.
 *
 *   node test/parity.mjs        CHROME_PATH and PUPPETEER_CORE can be set.
 */

import http from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Pool, WEB_DIR } from "../lib/pool.mjs";
import { settingsFor } from "../lib/core.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, "fixtures");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const candidates = [
  process.env.PUPPETEER_CORE,
  path.join(here, "..", "..", "tests", "web", "node_modules", "puppeteer-core", "lib", "puppeteer", "puppeteer-core.js"),
  "puppeteer-core",
].filter(Boolean);
let puppeteer;
for (const c of candidates) {
  try { puppeteer = (await import(c.includes(path.sep) || c.includes("/") ? pathToFileURL(c).href : c)).default; break; } catch { /* next */ }
}
if (!puppeteer) { console.error("puppeteer-core not found"); process.exit(2); }

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".css": "text/css" };
const server = http.createServer((req, res) => {
  const f = path.join(WEB_DIR, decodeURIComponent(req.url.split("?")[0]));
  try { res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }).end(readFileSync(f)); }
  catch { res.writeHead(404).end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const names = readdirSync(FIX).filter((n) => !n.endsWith(".gif"));
const targets = ["web", "email", "thumbnail"];
const mimeOf = (n) => ({ ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" })[path.extname(n)];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const pool = new Pool();
let bad = 0;
try {
  const page = await browser.newPage();
  await page.goto(`${origin}/404.html`);
  for (const name of names) {
    const bytes = readFileSync(path.join(FIX, name));
    for (const target of targets) {
      const settings = settingsFor({ preset: target }, bytes);
      const b64 = bytes.toString("base64");
      const web = await page.evaluate(async (b64, name, mime, settings) => {
        const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const w = new Worker("worker.js");
        return await new Promise((resolve) => {
          w.onmessage = (e) => {
            const m = e.data;
            if (m.type === "done") {
              const r = m.result;
              resolve({ fmt: r.fmt, level: r.level, score: r.score, bytes: r.newBytes, passthrough: r.passthrough,
                        candidates: r.candidates.map((c) => `${c.format}@${c.level}:${c.bytes}`) });
              w.terminate();
            } else if (m.type === "failed") { resolve({ error: m.error }); w.terminate(); }
          };
          w.postMessage({ type: "job", id: 1, rev: 0, protocol: 1, name, mime, buffer: bin.buffer, settings }, [bin.buffer]);
        });
      }, b64, name, mimeOf(name), settings);
      const m = await pool.run({ name, bytes, mime: mimeOf(name), settings });
      const r = m.result;
      const node = { fmt: r.fmt, level: r.level, score: r.score, bytes: r.newBytes, passthrough: r.passthrough,
                     candidates: r.candidates.map((c) => `${c.format}@${c.level}:${c.bytes}`) };
      const same = web.fmt === node.fmt && web.level === node.level;
      if (!same) bad++;
      console.log(`${same ? "SAME" : "DIFF"}  ${name.padEnd(11)} ${target.padEnd(9)} browser ${web.fmt}@${web.level} ${web.bytes}B   node ${node.fmt}@${node.level} ${node.bytes}B`);
      if (!same) console.log("      browser", web.candidates.join(" "), "\n      node   ", node.candidates.join(" "));
    }
  }
} finally {
  await pool.close();
  await browser.close();
  server.close();
}
console.log(bad ? `\n${bad} differ` : "\nall choices match");
process.exit(bad ? 1 : 0);
