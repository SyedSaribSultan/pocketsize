/* Every way an item, a worker slot or a run can leave its state, held to one
 * rule: whatever the app shows is what is actually true.
 *
 * Each case below was a real defect, watched failing before its fix:
 *
 *   stop mid-walk     Stop pressed while the dispatcher waited on a file read
 *                     let the rest of the walk set stopped items back to work.
 *   zip               an item re-queued while the zip was being built came out
 *                     of it marked "saved", and a render during the zip
 *                     re-enabled the button and erased "Zipping...".
 *   silent worker     a worker that died without an error event kept its slot
 *                     busy and its item working forever.
 *   remove            removing an item mid-run left its worker grinding
 *                     through the whole bake-off, and a worker could be handed
 *                     a second job while still running the first.
 *   run end           a run whose last item failed before any worker replied
 *                     never ended: no completion event, and the next run's
 *                     duration was measured from the dead one's start.
 *   retry analytics   an item that failed, was retried and failed again was
 *                     only ever reported once.
 *   clear and undo    Undo after the toast outlived 12 s restored revoked
 *                     previews; a later toast dropped the Undo for good; and
 *                     restored items stayed stopped.
 *   caps              a format pin cleared by a capability report changed the
 *                     plan without re-running anything.
 *
 *   node tests/web/probe_lifecycle.mjs
 *   CASE=undo node tests/web/probe_lifecycle.mjs    # the cases whose name has "undo"
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer, { CHROME } from "./resolve_puppeteer.mjs";
import { uploadAndStart, uploadAndFinish } from "./drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, "fixtures");
const PORT = 8411;
const BASE = `http://127.0.0.1:${PORT}/`;
const fx = (...names) => names.map((n) => path.join(FIX, n));

let bad = 0;
const ok = (c, n) => { if (c) console.log("  ok  " + n); else { console.error("  FAIL " + n); bad++; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* Installed before the app loads. Counts what the engine says to its workers,
   so "one job per worker at a time" and "remove sends abort" are measurements
   rather than inferences, and records analytics the way e2e.mjs does. */
function instrument() {
  window.__overlap = 0;
  window.__aborts = 0;
  const Real = Worker;
  window.Worker = class extends Real {
    constructor(...a) {
      super(...a);
      this.__open = null;
      this.addEventListener("message", (e) => {
        const m = e.data || {};
        if (["done", "failed", "aborted"].includes(m.type) && m.id === this.__open) this.__open = null;
      });
    }
    postMessage(m, t) {
      if (m && m.type === "job") {
        if (this.__open) window.__overlap++;
        this.__open = m.id;
      }
      if (m && m.type === "abort") window.__aborts++;
      return super.postMessage(m, t);
    }
    terminate() { this.__open = null; return super.terminate(); }
  };
  window.__tracked = [];
  Object.defineProperty(window, "pocketsizeTrack", {
    configurable: true,
    get: () => (event, props) => window.__tracked.push({ event, props }),
    set: () => {},
  });
}

const server = spawn("node", [path.join(here, "serve.mjs"), String(PORT)], { stdio: "ignore" });
await wait(900);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 1_800_000 });

async function fresh() {
  const pg = await browser.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  await pg.setViewport({ width: 1440, height: 940 });
  await pg.evaluateOnNewDocument(instrument);
  await pg.goto(BASE, { waitUntil: "networkidle0" });
  pg.__errors = errors;
  return pg;
}
const statuses = (pg) => pg.evaluate(() => state.items.map((i) => i.status));
const completions = (pg) => pg.evaluate(() =>
  window.__tracked.filter((t) => t.event === "compression_completed").map((t) => t.props));

/* A case that throws is counted and the rest still run: one stuck item must
   not hide every other finding. */
const ONLY = process.env.CASE || "";
async function guard(name, fn) {
  if (!name.includes(ONLY)) return;
  console.log(`
=== ${name} ===`);
  try { await fn(); } catch (e) { console.error("  FAIL " + (e && e.message || e)); bad++; }
}

try {
  /* ---- stop mid-walk ---------------------------------------------------- */
  await guard("stop while the dispatcher is mid-walk", async () => {
    const pg = await fresh();
    await pg.evaluate(() => imgc.holdWork(true));
    await uploadAndStart(pg, fx("photo.png", "logo.png", "ui.png", "small.jpg"));
    await pg.evaluate(() => {
      imgc.holdWork(false);
      document.getElementById("stop-btn").click();
    });
    await wait(4000);
    const s = await statuses(pg);
    ok(s.every((x) => x === "cancelled"), `every stopped item stays stopped (${s.join(",")})`);
    ok(await pg.evaluate(() => imgc.pool.every((p) => !p.busy)), "and no worker is left busy");
    await pg.close();
  });

  /* ---- zip -------------------------------------------------------------- */
  await guard("zip while something is re-queued", async () => {
    const pg = await fresh();
    await uploadAndFinish(pg, fx("logo.png", "ui.png", "small.jpg"), 600_000);
    const mid = await pg.evaluate(() => {
      document.getElementById("save-btn").click();
      imgc.renderNow();
      const btn = document.getElementById("save-btn");
      const out = { disabled: btn.disabled, label: document.getElementById("save-label").textContent };
      // What requeue writes when the plan moves under a finished item.
      state.items[0].status = "queued";
      return out;
    });
    ok(mid.disabled && /Zipping/.test(mid.label),
       `a render during the zip keeps the button busy (${JSON.stringify(mid)})`);
    await wait(1500);
    const s = await statuses(pg);
    ok(s[0] === "queued", `an item re-queued during the zip is not marked saved (${s[0]})`);
    ok(s.slice(1).every((x) => x === "saved"), `the others are saved (${s.slice(1).join(",")})`);
    await pg.close();
  });

  /* ---- silent worker death ---------------------------------------------- */
  await guard("a worker that dies without an error event", async () => {
    const pg = await fresh();
    await uploadAndStart(pg, fx("photo5mp.png"));
    await pg.waitForFunction(() => state.items[0].status === "working", { timeout: 60_000, polling: 50 });
    await pg.evaluate(() => {
      const slot = imgc.pool.find((p) => p.busy);
      slot.w.terminate();          // no onerror fires for this
      const real = performance.now.bind(performance);
      performance.now = () => real() + 3_600_000;
    });
    let item = null;
    for (let i = 0; i < 60 && !(item && item.status === "failed"); i++) {
      await wait(1000);
      item = await pg.evaluate(() => ({ status: state.items[0].status, error: state.items[0].error }));
    }
    ok(item.status === "failed", `the item is failed rather than working forever (${JSON.stringify(item)})`);
    ok(await pg.evaluate(() => imgc.pool.every((p) => !p.busy)), "and its slot is free again");
    if (item.status !== "failed") throw new Error("stuck item: the rest of this case cannot run");
    const retried = await pg.evaluate(() => {
      document.querySelector("#queue-list .row-act.retry").click();
      return state.items[0].status;
    });
    ok(retried === "queued" || retried === "working", `Retry puts it back to work (${retried})`);
    await pg.waitForFunction(() => state.items[0].status === "done", { timeout: 600_000, polling: 300 });
    ok(true, "and the retried item finishes on a fresh worker");
    await pg.close();
  });

  /* ---- remove ----------------------------------------------------------- */
  await guard("remove an item mid-run", async () => {
    const pg = await fresh();
    await uploadAndStart(pg, fx("photo5mp.png", "small.jpg"));
    await pg.waitForFunction(() => state.items[0].status === "working" && state.items[0].frac > 0,
      { timeout: 120_000, polling: 50 });
    await pg.evaluate(() => {
      document.querySelector(`#queue-list [data-id="${state.items[0].id}"] .row-act.rm`).click();
    });
    ok(await pg.evaluate(() => window.__aborts) >= 1, "removing a working item tells its worker to stop");
    await pg.waitForFunction(() => state.items.every((i) => i.status === "done"),
      { timeout: 600_000, polling: 300 });
    await pg.waitForFunction(() => imgc.pool.every((p) => !p.busy), { timeout: 120_000, polling: 300 });
    ok(await pg.evaluate(() => window.__overlap) === 0, "no worker was ever handed two jobs at once");
    await pg.close();
  });

  /* ---- run end, and analytics ------------------------------------------- */
  await guard("a run that ends without a worker reply", async () => {
    const pg = await fresh();
    /* Held, so the page's own header check is what fails it - no worker ever
       gets the file, so no worker reply can end the run. */
    await pg.evaluate(() => imgc.holdWork(true));
    await uploadAndStart(pg, fx("bomb.png"));
    /* Since 2026-11-12 the guard refuses the file (a "rejected" row, owner
       decision) rather than failing it: the run still has to end, and a
       refused file is not a compression to report. */
    await pg.waitForFunction(() => state.items[0].status === "rejected", { timeout: 60_000, polling: 50 });
    await pg.evaluate(() => imgc.holdWork(false));
    await wait(500);
    let runs = await completions(pg);
    ok(runs.length === 0,
       `a run whose only file was refused reports no compression (${runs.length})`);
    await wait(3000);
    const t0 = Date.now();
    await uploadAndFinish(pg, fx("small.jpg"), 600_000);
    await wait(500);
    const took = Date.now() - t0;
    runs = await completions(pg);
    const last = runs[runs.length - 1];
    ok(runs.length === 1 && last.file_count === 1, `the next run is reported on its own (${runs.length})`);
    ok(last && last.duration_ms <= took + 500,
       `and its duration is its own (${last && last.duration_ms} ms <= ${took} ms)`);

    console.log("\n=== retry that fails again ===");
    await uploadAndFinish(pg, fx("corrupt.jpg"), 600_000);
    await wait(500);
    const before = (await completions(pg)).length;
    await pg.evaluate(() => {
      const it = state.items.find((i) => i.name === "corrupt.jpg");
      document.querySelector(`#queue-list [data-id="${it.id}"] .row-act.retry`).click();
    });
    await pg.waitForFunction(() => state.items.every((i) => ["done", "failed", "saved", "rejected"].includes(i.status)),
      { timeout: 600_000, polling: 300 });
    await wait(500);
    runs = await completions(pg);
    ok(runs.length === before + 1 && runs[runs.length - 1].failed_count === 1,
       `the second failure is reported too (${runs.length - before} new, failed ${runs[runs.length - 1].failed_count})`);
    await pg.close();
  });

  /* ---- clear and undo --------------------------------------------------- */
  await guard("clear, a held toast, a preempting toast, undo", async () => {
    const pg = await fresh();
    await uploadAndFinish(pg, fx("logo.png", "small.jpg"), 600_000);
    await pg.evaluate(() => document.getElementById("clear-btn").click());
    await pg.waitForSelector("#toast-action", { timeout: 5000 });
    // A receipt for something else preempts the Undo; the Undo must come back.
    await pg.evaluate(() => imgc.toast("Something else happened"));
    await wait(400);
    const back = await pg.waitForFunction(() => {
      const b = document.getElementById("toast-action");
      return b && /Undo/.test(b.textContent);
    }, { timeout: 15_000, polling: 200 }).then(() => true, () => false);
    ok(back, "a toast that preempts the Undo does not drop it");
    // Reading the toast holds it - past the old fixed 12 s window.
    await pg.evaluate(() => document.getElementById("toast-action").focus());
    await wait(13_000);
    await pg.evaluate(() => document.getElementById("toast-action").click());
    const urls = await pg.evaluate(async () => {
      // Decoded, not fetched: the production CSP allows blob: images only.
      const live = async (u) => {
        try { const im = new Image(); im.src = u; await im.decode(); return true; } catch { return false; }
      };
      return Promise.all(state.items.map(async (i) => ({
        before: await live(i.beforeURL), after: await live(i.afterURL),
      })));
    });
    ok(urls.length === 2 && urls.every((u) => u.before && u.after),
       `Undo after a held toast restores live previews (${JSON.stringify(urls)})`);

    // Clear during a run, then Undo: the stopped work resumes.
    await pg.evaluate(() => imgc.holdWork(true));
    await uploadAndStart(pg, fx("photo.png"));
    await pg.evaluate(() => {
      document.getElementById("clear-btn").click();
      imgc.holdWork(false);
    });
    await pg.waitForSelector("#toast-action", { timeout: 5000 });
    await pg.evaluate(() => document.getElementById("toast-action").click());
    await pg.waitForFunction(() => state.items.length === 3 &&
      state.items.every((i) => ["done", "failed", "saved", "rejected"].includes(i.status)),
      { timeout: 180_000, polling: 300 }).catch(() => {});
    const s = await statuses(pg);
    ok(s.length === 3 && s.every((x) => x === "done"), `undone items that were stopped run again (${s.join(",")})`);
    await pg.close();
  });

  /* ---- caps ------------------------------------------------------------- */
  await guard("a capability report that clears a pin", async () => {
    const pg = await fresh();
    await pg.evaluate(() => {
      const sel = document.getElementById("plan-format");
      sel.value = "webp";
      sel.dispatchEvent(new Event("change"));
    });
    await wait(700);
    const was = await pg.evaluate(() => ({ rev: state.settingsRev, formats: state.settings.formats }));
    await pg.evaluate(() => imgc.pool[0].w.dispatchEvent(
      new MessageEvent("message", { data: { type: "caps", caps: { webp: false } } })));
    await wait(700);
    const now = await pg.evaluate(() => ({
      rev: state.settingsRev, formats: state.settings.formats,
      shown: document.getElementById("plan-format").value,
    }));
    ok(was.formats?.[0] === "webp" && now.shown === "" && now.formats === null && now.rev > was.rev,
       `the cleared pin is a real plan change (${JSON.stringify({ was, now })})`);
    await pg.close();
  });
} finally {
  await browser.close();
  server.kill();
}
console.log(bad === 0 ? "\nOK" : `\n${bad} problem(s)`);
process.exit(bad ? 1 : 0);
