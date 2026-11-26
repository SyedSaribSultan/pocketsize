/* Regenerates the tiny fixtures in test/fixtures. Deterministic: run it again
 * and the same bytes come out. Not part of the test run.  node test/make-fixtures.mjs */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as jpeg from "@jsquash/jpeg/encode.js";
import * as png from "@jsquash/png/encode.js";
import * as webp from "@jsquash/webp/encode.js";

const require = createRequire(import.meta.url);
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
mkdirSync(out, { recursive: true });
const wasm = (s) => WebAssembly.compile(readFileSync(require.resolve(s)));

await jpeg.init(await wasm("@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm"));
await png.init(await wasm("@jsquash/png/codec/pkg/squoosh_png_bg.wasm"));
await webp.init(await wasm("@jsquash/webp/codec/enc/webp_enc.wasm"));

// A small seeded generator, so the "noise" never changes between runs.
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

function scene(w, h, noise) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const n = (rnd() - 0.5) * noise;
      d[i] = 40 + (x / w) * 180 + Math.sin(y / 9) * 20 + n;
      d[i + 1] = 60 + (y / h) * 150 + Math.cos(x / 11) * 20 + n;
      d[i + 2] = 130 + Math.sin((x + y) / 14) * 60 + n;
      d[i + 3] = 255;
    }
  }
  return { data: d, width: w, height: h };
}

const photo = scene(80, 60, 14);
writeFileSync(path.join(out, "photo.png"), Buffer.from(await png.default(photo)));
writeFileSync(path.join(out, "photo.jpg"), Buffer.from(await jpeg.default(photo, { quality: 97 })));
writeFileSync(path.join(out, "photo.webp"), Buffer.from(await webp.default(photo, { quality: 97 })));

// Transparent: a soft-edged disc with a gradient, alpha from 0 to 255.
{
  const w = 96, h = 96, d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = Math.hypot(x - 48, y - 48);
      d[i] = 230 - r * 2; d[i + 1] = 90 + x; d[i + 2] = 60 + y;
      d[i + 3] = r < 36 ? 255 : r < 44 ? Math.round(255 * (44 - r) / 8) : 0;
    }
  }
  writeFileSync(path.join(out, "alpha.png"), Buffer.from(await png.default({ data: d, width: w, height: h })));
}

// Flat artwork: few colours, hard edges. The palette formats should win here.
{
  const w = 128, h = 96, d = new Uint8ClampedArray(w * h * 4);
  const colours = [[250, 250, 250], [30, 90, 200], [240, 120, 20], [20, 20, 20]];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const c = colours[(x < 20 || y < 12) ? 3 : (x + y) % 64 < 32 ? 1 : (x > 90 ? 2 : 0)];
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
  }
  writeFileSync(path.join(out, "flat.png"), Buffer.from(await png.default({ data: d, width: w, height: h })));
}

// A two-frame animated GIF, written by hand (2x1 pixels, 2-colour global palette).
{
  const lzw = (idx) => {                     // 3-bit codes: clear, idx, idx, end
    const codes = [4, idx, idx, 5];
    let bits = 0, n = 0;
    codes.forEach((c, i) => { bits |= c << (i * 3); n += 3; });
    return Buffer.from([bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff]);
  };
  const frame = (idx) => Buffer.concat([
    Buffer.from([0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00]),      // 100 ms
    Buffer.from([0x2c, 0, 0, 0, 0, 2, 0, 1, 0, 0x00]),                  // 2x1 at 0,0
    Buffer.from([0x02, 0x03]), lzw(idx), Buffer.from([0x00]),
  ]);
  const gif = Buffer.concat([
    Buffer.from("GIF89a", "latin1"),
    Buffer.from([2, 0, 1, 0, 0x80, 0, 0]),
    Buffer.from([255, 0, 0, 0, 0, 255]),
    Buffer.from([0x21, 0xff, 0x0b]), Buffer.from("NETSCAPE2.0", "latin1"),
    Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00]),
    frame(0), frame(1),
    Buffer.from([0x3b]),
  ]);
  writeFileSync(path.join(out, "anim.gif"), gif);
}
console.log("fixtures written to", out);
