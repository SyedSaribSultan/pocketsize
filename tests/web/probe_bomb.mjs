/* A picture that declares more pixels than a tab can hold is refused before
 * anything decodes it - and the size it declares is read correctly in every
 * format the app takes.
 *
 * Two halves. The first runs web/js/imagedims.js on its own against files a
 * real encoder wrote (fixtures/dims/<w>x<h>.*, from make_web_fixtures.py), so
 * the parser is held to the encoder rather than to a hand-built header. The
 * second drops fixtures/bomb.png - 49 KB on disk, 20,000 x 20,000 declared,
 * 1.6 GB once decoded - next to an ordinary picture in real Chrome under the
 * real CSP, and asserts the bomb fails with its size in the message, the
 * ordinary picture still finishes, and the tab is still alive to say so.
 *
 * Watched failing: with tooManyPixels() made to return null, four checks go
 * red - the bomb is decoded in full for its thumbnail, its original and its
 * encode, and "finishes". On a desktop with memory to spare that is merely
 * gigabytes of allocation; on a phone it is the tab.
 *
 *   python tests/web/make_web_fixtures.py && node tests/web/probe_bomb.mjs
 */
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import puppeteer, { CHROME } from "./resolve_puppeteer.mjs";
import { uploadAndFinish } from "./drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, "fixtures");
const DIMS = path.join(FIX, "dims");
const WEB = path.resolve(here, "..", "..", "web");
const PORT = 8331;

let bad = 0;
const ok = (c, n) => { if (c) console.log("  ok  " + n); else { console.error("  FAIL " + n); bad++; } };

// ---- the parser, on its own ------------------------------------------------
const sandbox = { self: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(path.join(WEB, "js", "imagedims.js"), "utf8"), sandbox);
const { imageDims, tooManyPixels } = sandbox.self;

const kinds = new Set();
for (const name of readdirSync(DIMS)) {
  const [w, h] = name.split(".")[0].split("x").map(Number);
  // The page reads only the first megabyte; hold the parser to the same.
  const got = imageDims(readFileSync(path.join(DIMS, name)).subarray(0, 1 << 20));
  ok(got && got.width === w && got.height === h,
     `${name}: header says ${got ? `${got.width}x${got.height}` : "nothing"}`);
  kinds.add(path.extname(name));
}
/* The gate is only worth having if it read something - an empty folder would
   otherwise print OK having checked nothing. */
ok(["png", "jpg", "webp", "gif", "bmp"].every((k) => kinds.has(`.${k}`)),
   `every format the fixtures should cover was read (${[...kinds].join(" ")})`);

ok(tooManyPixels(readFileSync(path.join(FIX, "bomb.png"))) !== null, "bomb.png is too many pixels");
ok(tooManyPixels(readFileSync(path.join(FIX, "photo5mp.png"))) === null, "a 5 MP photo is not");
ok(imageDims(new Uint8Array([1, 2, 3])) === null, "an unknown header is not guessed at");

// ---- the app, in real Chrome ----------------------------------------------
const server = spawn("node", [path.join(here, "serve.mjs"), String(PORT)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 900));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 900_000 });
try {
  const pg = await browser.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  let crashed = false;
  pg.on("error", () => { crashed = true; });
  await pg.setViewport({ width: 1440, height: 940 });
  await pg.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle0" });

  await uploadAndFinish(pg, [path.join(FIX, "bomb.png"), path.join(FIX, "small.jpg")], 600_000);
  const items = await pg.evaluate(() => state.items.map((i) => ({
    name: i.name, status: i.status, error: i.error || "", thumb: !!i.thumbURL,
    before: i.beforeURL,
  })));
  const bomb = items.find((i) => i.name === "bomb.png");
  const fine = items.find((i) => i.name === "small.jpg");
  ok(!crashed, "the tab survived");
  ok(bomb && bomb.status === "failed", `the bomb failed (${bomb && bomb.status})`);
  ok(bomb && /too big/.test(bomb.error) && /20[,.\s  ]?000/.test(bomb.error)
     && /100 megapixels/.test(bomb.error),
     `and says why, with its size: "${bomb && bomb.error}"`);
  ok(bomb && !bomb.thumb && !bomb.before, "nothing on the page decoded it (no thumbnail, no original)");
  ok(fine && fine.status === "done", `the ordinary picture beside it still finished (${fine && fine.status})`);
  ok(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} finally {
  await browser.close();
  server.kill();
}

console.log(bad === 0 ? "\nOK" : `\n${bad} problem(s)`);
process.exit(bad ? 1 : 0);
