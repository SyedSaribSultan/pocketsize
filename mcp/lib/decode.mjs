/* Decoding for Node. The browser engine decodes with createImageBitmap, which
 * Node does not have, so this file stands in for it.
 *
 *   PNG, JPEG, WebP, AVIF  Squoosh's own decoders, via the pinned @jsquash
 *                          packages (the same family as the encoders the app
 *                          vendors in web/vendor).
 *   GIF (first frame)      omggif.
 *   BMP                    a small reader below (uncompressed 24 and 32 bit).
 *
 * Output is always { width, height, data } with non-premultiplied RGBA, after
 * applying JPEG EXIF orientation, as createImageBitmap's "from-image" does.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { GifReader } from "omggif";
import * as jpeg from "@jsquash/jpeg/decode.js";
import * as png from "@jsquash/png/decode.js";
import * as webp from "@jsquash/webp/decode.js";
import * as avif from "@jsquash/avif/decode.js";

const require = createRequire(import.meta.url);
const wasmOf = (spec) => readFileSync(require.resolve(spec));

let ready = null;
function init() {
  if (!ready) {
    ready = (async () => {
      await Promise.all([
        jpeg.init(await WebAssembly.compile(wasmOf("@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm"))),
        png.init(await WebAssembly.compile(wasmOf("@jsquash/png/codec/pkg/squoosh_png_bg.wasm"))),
        webp.init(await WebAssembly.compile(wasmOf("@jsquash/webp/codec/dec/webp_dec.wasm"))),
        avif.init(await WebAssembly.compile(wasmOf("@jsquash/avif/codec/dec/avif_dec.wasm"))),
      ]);
    })();
  }
  return ready;
}

export function sniff(b) {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0xff && b[1] === 0xd8) return "jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "gif";
  if (b[0] === 0x42 && b[1] === 0x4d) return "bmp";
  const s = (i, t) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]) === t;
  if (s(0, "RIFF") && s(8, "WEBP")) return "webp";
  if (s(4, "ftyp")) return "avif";
  return null;
}

/** EXIF orientation 1..8 from a JPEG, or 1. */
export function jpegOrientation(b) {
  let i = 2;
  while (i + 4 < b.length && b[i] === 0xff) {
    const m = b[i + 1];
    if (m === 0xda || m === 0xd9) break;
    const len = (b[i + 2] << 8) | b[i + 3];
    if (m === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
      const t = i + 10;
      const le = b[t] === 0x49;
      const u16 = (o) => (le ? b[t + o] | (b[t + o + 1] << 8) : (b[t + o] << 8) | b[t + o + 1]);
      const u32 = (o) => (le
        ? (b[t + o] | (b[t + o + 1] << 8) | (b[t + o + 2] << 16) | (b[t + o + 3] << 24)) >>> 0
        : ((b[t + o] << 24) | (b[t + o + 1] << 16) | (b[t + o + 2] << 8) | b[t + o + 3]) >>> 0);
      const ifd = u32(4);
      const n = u16(ifd);
      for (let k = 0; k < n; k++) {
        const e = ifd + 2 + k * 12;
        if (u16(e) === 0x0112) {
          const v = u16(e + 8);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      return 1;
    }
    i += 2 + len;
  }
  return 1;
}

/** Apply an EXIF orientation (2..8) to RGBA pixels. */
export function orient({ width: w, height: h, data }, o) {
  if (o === 1) return { width: w, height: h, data };
  const swap = o >= 5;
  const W = swap ? h : w, H = swap ? w : h;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx, ny;
      switch (o) {
        case 2: nx = w - 1 - x; ny = y; break;
        case 3: nx = w - 1 - x; ny = h - 1 - y; break;
        case 4: nx = x; ny = h - 1 - y; break;
        case 5: nx = y; ny = x; break;
        case 6: nx = h - 1 - y; ny = x; break;
        case 7: nx = h - 1 - y; ny = w - 1 - x; break;
        default: nx = y; ny = w - 1 - x; break;   // 8
      }
      const s = (y * w + x) * 4, d = (ny * W + nx) * 4;
      out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2]; out[d + 3] = data[s + 3];
    }
  }
  return { width: W, height: H, data: out };
}

function decodeBmp(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const off = dv.getUint32(10, true);
  const w = dv.getInt32(18, true);
  let h = dv.getInt32(22, true);
  const bpp = dv.getUint16(28, true);
  const comp = dv.getUint32(30, true);
  if ((comp !== 0 && comp !== 3) || (bpp !== 24 && bpp !== 32)) throw new Error("unsupported BMP");
  const topDown = h < 0;
  h = Math.abs(h);
  const stride = Math.floor((bpp * w + 31) / 32) * 4;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = off + (topDown ? y : h - 1 - y) * stride;
    for (let x = 0; x < w; x++) {
      const s = row + x * (bpp / 8), d = (y * w + x) * 4;
      data[d] = b[s + 2]; data[d + 1] = b[s + 1]; data[d + 2] = b[s];
      data[d + 3] = bpp === 32 ? b[s + 3] : 255;
    }
  }
  return { width: w, height: h, data };
}

function toClamped(img) {
  const d = img.data;
  return {
    width: img.width, height: img.height,
    data: d instanceof Uint8ClampedArray ? d : new Uint8ClampedArray(d.buffer, d.byteOffset, d.byteLength),
  };
}

/** Decode any supported image to RGBA. Throws if it cannot be read. */
export async function decodeImage(input, { orientation = true } = {}) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const kind = sniff(b);
  if (!kind) throw new Error("unrecognised image format");
  await init();
  const ab = () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  let img;
  switch (kind) {
    case "png": img = toClamped(await png.decode(ab())); break;
    case "jpeg": {
      img = toClamped(await jpeg.default(ab()));
      if (orientation) img = orient(img, jpegOrientation(b));
      break;
    }
    case "webp": img = toClamped(await webp.default(ab())); break;
    case "avif": img = toClamped(await avif.default(ab())); break;
    case "gif": {
      const r = new GifReader(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
      const data = new Uint8ClampedArray(r.width * r.height * 4);
      r.decodeAndBlitFrameRGBA(0, data);
      img = { width: r.width, height: r.height, data };
      break;
    }
    case "bmp": img = decodeBmp(b); break;
  }
  if (!img || !img.width || !img.height) throw new Error("empty image");
  return img;
}
