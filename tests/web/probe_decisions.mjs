/* The owner's decisions of 2026-11-12, held in real Chrome.
 *
 *   node tests/web/probe_decisions.mjs
 *
 *   1. A plan edited on a use-case page carries to the home page and to the
 *      other pages; a carried pin the destination refuses is dropped, and the
 *      page says why.
 *   2. A file the page cannot compress is a row with a short reason, Remove
 *      its only action, and it never holds up the files beside it.
 *   3. An updated service worker waits, and the tab says "A new version is
 *      ready" with Reload; Reload brings the new one in. A compression worker
 *      from another deploy is refused safely: its pictures fail with a reload
 *      reason (none left "working") and the same notice appears.
 *
 * Its own server (production headers, as serve.mjs) so the probe can ship a
 * "new deploy" mid-test: a changed sw.js, or a worker.js on another PROTOCOL.
 */

import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer, { CHROME } from "./resolve_puppeteer.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..", "..", "web");
const FIX = path.join(here, "fixtures");
const PORT = 8437;
const BASE = `http://127.0.0.1:${PORT}/`;

const VERCEL = JSON.parse(await readFile(path.join(ROOT, "vercel.json"), "utf8"));
const GLOBAL = VERCEL.headers.find((h) => h.source === "/(.*)").headers;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/vnd.microsoft.icon", ".wasm": "application/wasm",
  ".woff2": "font/woff2",
};
/* The "deploy" the server is on: a suffix appended to sw.js (a new service
   worker), and the PROTOCOL worker.js claims. */
const deploy = { swSuffix: "", workerProtocol: null };

const server = createServer(async (req, res) => {
  let rel = decodeURIComponent(req.url.split("?")[0]);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    let body = await readFile(file);
    if (rel === "/sw.js" && deploy.swSuffix) body = Buffer.concat([body, Buffer.from(deploy.swSuffix)]);
    if (rel === "/worker.js" && deploy.workerProtocol != null) {
      body = Buffer.from(String(body).replace(/^const PROTOCOL = \d+;/m,
        `const PROTOCOL = ${deploy.workerProtocol};`));
    }
    const headers = { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store" };
    for (const h of GLOBAL) headers[h.key] = h.value;
    res.writeHead(200, headers).end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
  }
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

let bad = 0;
const ok = (c, n) => { if (c) console.log("  ok  " + n); else { console.error("  FAIL " + n); bad++; } };
const DASHES = /[–—]/;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 900_000 });
const fresh = async () => {
  const ctx = await browser.createBrowserContext();
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  await pg.setViewport({ width: 1440, height: 940 });
  return { ctx, pg, errors };
};
const toastText = (pg) => pg.$eval("#toast", (t) => t.textContent.trim());
const waitToast = (pg, re, timeout = 20_000) => pg.waitForFunction(
  (src) => new RegExp(src).test(document.getElementById("toast").textContent),
  { timeout, polling: 100 }, re.source);
const stored = (pg) => pg.evaluate(() => JSON.parse(localStorage.getItem("imgc-settings") || "{}"));

try {
  /* ------------------------- 1. settings carry over ------------------------ */
  console.log("1. settings carry over");
  {
    const { ctx, pg, errors } = await fresh();
    await pg.goto(`${BASE}compress-to-50kb.html`, { waitUntil: "networkidle0" });
    await pg.select("#quality-preset", "80");
    await pg.waitForFunction(() => JSON.parse(localStorage.getItem("imgc-settings") || "{}").qualityTarget === 80,
      { timeout: 10_000 });
    await pg.goto(`${BASE}index.html`, { waitUntil: "networkidle0" });
    let s = await pg.evaluate(() => ({ ...window.state.settings,
      cap: document.getElementById("plan-cap").value, q: document.getElementById("quality-preset").value }));
    ok(s.sizeTarget === 51200 && /50/.test(s.cap), `the 50 KB limit set on /compress-to-50kb is on the home page (${s.sizeTarget}, "${s.cap}")`);
    ok(s.qualityTarget === 80 && s.q === "80", `and so is the quality edited there (${s.qualityTarget}, "${s.q}")`);

    await pg.goto(`${BASE}compress-to-1mb.html`, { waitUntil: "networkidle0" });
    s = await pg.evaluate(() => window.state.settings);
    ok(s.qualityTarget === 80 && s.sizeTarget === 1048576,
      `another use-case page keeps the carried quality and its own promise (${s.qualityTarget}, ${s.sizeTarget})`);

    // A WebP pin made on /compress-webp, carried to email, which refuses WebP.
    await pg.goto(`${BASE}compress-webp.html`, { waitUntil: "networkidle0" });
    await pg.select("#quality-preset", "85");
    await pg.waitForFunction(() => {
      const v = JSON.parse(localStorage.getItem("imgc-settings") || "{}");
      return v.qualityTarget === 85 && v.formats?.[0] === "webp";
    }, { timeout: 10_000 });
    await pg.goto(`${BASE}compress-for-email.html`, { waitUntil: "networkidle0" });
    s = await pg.evaluate(() => ({ formats: window.state.settings.formats, pin: document.getElementById("plan-format").value }));
    ok(!s.formats && s.pin === "", `the refused WebP pin is dropped on the email page (${JSON.stringify(s.formats)}, "${s.pin}")`);
    await waitToast(pg, /can't take WebP/).catch(() => {});
    const said = await toastText(pg);
    ok(/Email can't take WebP, so the file type is back to automatic/.test(said), `and the page says why ("${said}")`);
    ok(!DASHES.test(said), "with no dash characters");
    s = await stored(pg);
    ok(s.formats?.[0] === "webp", "visiting a page without editing writes nothing back");
    ok(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
    await ctx.close();
  }

  /* ----------------------- 2. rejected files in the queue ------------------ */
  console.log("2. rejected files show in the queue");
  {
    const dir = await mkdtemp(path.join(tmpdir(), "pocketsize-probe-"));
    const notes = path.join(dir, "notes.txt");
    await writeFile(notes, "not a picture");
    const { ctx, pg, errors } = await fresh();
    await pg.goto(`${BASE}index.html`, { waitUntil: "networkidle0" });
    const input = await pg.$("#file-input");
    await input.uploadFile(notes, path.join(FIX, "small.jpg"));
    await pg.waitForFunction(() => state.items.length === 2
      && state.items.every((i) => ["done", "failed", "rejected"].includes(i.status)),
      { timeout: 300_000, polling: 200 });
    const rows = await pg.evaluate(() => [...document.querySelectorAll("#queue-list [role=option]")].map((r) => ({
      name: r.title, status: r.dataset.status, sub: r.querySelector(".s-row__sub").textContent,
      retry: !r.querySelector(".retry").hidden, rm: !r.querySelector(".rm").hidden,
    })));
    const txt = rows.find((r) => r.name === "notes.txt");
    const jpg = rows.find((r) => r.name === "small.jpg");
    ok(txt && txt.status === "rejected", `the text file is a row of its own, refused (${txt && txt.status})`);
    ok(txt && txt.sub === "Can't compress this file type", `its row says why ("${txt && txt.sub}")`);
    ok(txt && txt.rm && !txt.retry, "Remove is its only action");
    ok(jpg && jpg.status === "done", `the picture beside it still finished (${jpg && jpg.status})`);
    const foot = await pg.$eval("#t-count", (e) => e.textContent);
    ok(foot === "1 ready", `the footer counts the picture only ("${foot}")`);
    await pg.evaluate(() => {
      const id = state.items.find((i) => i.status === "rejected").id;
      document.querySelector(`#queue-list [data-id="${id}"] .rm`).click();
    });
    const left = await pg.evaluate(() => state.items.map((i) => i.name));
    ok(left.length === 1 && left[0] === "small.jpg", `Remove takes the refused row away (${left.join(", ")})`);

    // Only refused files: a row, no stuck run, nothing on its way.
    await pg.evaluate(() => document.getElementById("clear-btn").click());
    await input.uploadFile(notes);
    await pg.waitForFunction(() => state.items.length === 1, { timeout: 10_000 });
    const only = await pg.evaluate(() => ({
      status: state.items[0].status, stage: document.getElementById("stage-empty").textContent,
      busy: state.items.some((i) => i.status === "queued" || i.status === "working"),
    }));
    ok(only.status === "rejected" && !only.busy, `a lone refused file is a row and nothing waits (${only.status})`);
    ok(/Can't compress this file type\. Pocketsize takes PNG/.test(only.stage), `the stage says the longer reason ("${only.stage}")`);
    ok(!DASHES.test(only.stage), "with no dash characters");
    await pg.evaluate(() => document.querySelector("#queue-list [role=option]").click());
    await pg.evaluate(() => window.imgc && document.getElementById("target").dispatchEvent(new Event("change")));
    await new Promise((r) => setTimeout(r, 600));
    const after = await pg.evaluate(() => state.items[0].status);
    ok(after === "rejected", `a plan change does not re-queue it (${after})`);
    ok(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
    await ctx.close();
  }

  /* ------------------------- 3a. the update notice ------------------------- */
  console.log("3. update notice");
  {
    const { ctx, pg, errors } = await fresh();
    await pg.goto(`${BASE}index.html`, { waitUntil: "networkidle0" });
    await pg.waitForFunction(() => navigator.serviceWorker.controller, { timeout: 60_000 });
    let t = await toastText(pg);
    ok(!/new version/.test(t), "a first install offers nothing");

    deploy.swSuffix = "\n// probe: a new deploy\n";
    await pg.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
    await waitToast(pg, /A new version is ready/, 60_000).catch(() => {});
    t = await toastText(pg);
    ok(/A new version is ready/.test(t), `the tab says so ("${t}")`);
    const btn = await pg.$eval("#toast-action", (b) => b.textContent.trim()).catch(() => "");
    ok(btn === "Reload", `with a Reload button ("${btn}")`);
    const waiting = await pg.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => !!r.waiting));
    ok(waiting, "the new service worker waits instead of taking over the tab");
    await new Promise((r) => setTimeout(r, 10_000));
    t = await toastText(pg);
    ok(/A new version is ready/.test(t), "the notice stays until it is answered");

    await Promise.all([
      pg.waitForNavigation({ waitUntil: "networkidle0", timeout: 60_000 }),
      pg.click("#toast-action"),
    ]);
    const now = await pg.evaluate(() => navigator.serviceWorker.getRegistration()
      .then((r) => ({ waiting: !!r.waiting, controlled: !!navigator.serviceWorker.controller })));
    ok(!now.waiting && now.controlled, `Reload brings the new version in (${JSON.stringify(now)})`);
    await new Promise((r) => setTimeout(r, 1500));
    t = await toastText(pg);
    ok(!/new version/.test(t), "and the notice does not come back");
    ok(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
    await ctx.close();
    deploy.swSuffix = "";
  }

  /* ----------------------- 3b. a worker from another deploy ---------------- */
  {
    deploy.workerProtocol = 999;
    const { ctx, pg, errors } = await fresh();
    await pg.goto(`${BASE}index.html`, { waitUntil: "networkidle0" });
    const input = await pg.$("#file-input");
    await input.uploadFile(path.join(FIX, "small.jpg"), path.join(FIX, "logo.png"), path.join(FIX, "ui.png"));
    await pg.waitForFunction(() => state.items.length === 3
      && state.items.every((i) => !["queued", "working"].includes(i.status)),
      { timeout: 60_000, polling: 100 }).catch(() => {});
    const items = await pg.evaluate(() => state.items.map((i) => ({ s: i.status, e: i.error })));
    ok(items.every((i) => i.s === "failed"), `every picture fails, none left working (${items.map((i) => i.s).join(", ")})`);
    ok(items.every((i) => /Reload the page/.test(i.e)), `and says to reload ("${items[0] && items[0].e}")`);
    await waitToast(pg, /A new version is ready/).catch(() => {});
    const t = await toastText(pg);
    ok(/A new version is ready/.test(t), `the update notice is shown ("${t}")`);
    ok(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
    await ctx.close();
    deploy.workerProtocol = null;
  }
} finally {
  await browser.close();
  server.close();
}

console.log(bad === 0 ? "\nOK" : `\n${bad} problem(s)`);
process.exit(bad ? 1 : 0);
