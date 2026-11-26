/* The small slice of OffscreenCanvas / createImageBitmap that web/worker.js
 * uses, implemented over plain RGBA arrays so the browser engine runs in Node
 * unmodified. Only what the engine calls exists here.
 *
 *   drawImage      area-average downscale (what the engine's stepped halving
 *                  feeds), source-over compositing
 *   getImageData   non-premultiplied RGBA; RGB is zeroed where alpha is 0,
 *                  which is what a browser canvas hands back too
 *   convertToBlob  image/png (lossless writer below) and image/webp (the
 *                  vendored libwebp build, through the engine's own loader)
 */

import zlib from "node:zlib";
import vm from "node:vm";
import { decodeImage } from "./decode.mjs";

/* ---------------------------------- PNG ---------------------------------- */

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Lossless RGBA PNG with per-row adaptive filtering. oxipng shrinks it after. */
export function encodePng(rgba, w, h) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  const cand = [0, 1, 2, 3, 4].map(() => new Uint8Array(stride));
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const out = cand[f];
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const x = rgba[row + i];
        const a = i >= 4 ? rgba[row + i - 4] : 0;
        const b = y ? rgba[row - stride + i] : 0;
        const c = y && i >= 4 ? rgba[row - stride + i - 4] : 0;
        const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
        const v = (x - pred) & 0xff;
        out[i] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    raw[y * (stride + 1)] = best;
    raw.set(cand[best], y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]));
}

/* -------------------------------- resample ------------------------------- */

/** For each output index, the source indices it covers and their overlap. */
function axis(srcN, dstN) {
  const scale = srcN / dstN;
  const first = new Int32Array(dstN), count = new Int32Array(dstN);
  const idx = [], wts = [];
  for (let o = 0; o < dstN; o++) {
    const a = o * scale, b = (o + 1) * scale;
    const i0 = Math.floor(a), i1 = Math.min(srcN, Math.ceil(b));
    first[o] = idx.length;
    count[o] = i1 - i0;
    for (let i = i0; i < i1; i++) {
      idx.push(i);
      wts.push(Math.min(b, i + 1) - Math.max(a, i));
    }
  }
  return { first, count, idx, wts };
}

/** Area-average resample of straight RGBA to dw x dh. */
function resample(src, sw, sh, dw, dh) {
  const out = new Uint8ClampedArray(dw * dh * 4);
  const ax = axis(sw, dw), ay = axis(sh, dh);
  for (let oy = 0; oy < dh; oy++) {
    for (let ox = 0; ox < dw; ox++) {
      let r = 0, g = 0, b = 0, a = 0, ws = 0;
      for (let yy = 0; yy < ay.count[oy]; yy++) {
        const sy = ay.idx[ay.first[oy] + yy], wy = ay.wts[ay.first[oy] + yy];
        for (let xx = 0; xx < ax.count[ox]; xx++) {
          const sx = ax.idx[ax.first[ox] + xx], wx = ax.wts[ax.first[ox] + xx];
          const w = wx * wy, p = (sy * sw + sx) * 4, wa = w * src[p + 3];
          r += src[p] * wa;
          g += src[p + 1] * wa;
          b += src[p + 2] * wa;
          a += wa;
          ws += w;
        }
      }
      const d = (oy * dw + ox) * 4;
      if (a > 0) {
        out[d] = Math.round(r / a);
        out[d + 1] = Math.round(g / a);
        out[d + 2] = Math.round(b / a);
        out[d + 3] = Math.round(a / ws);
      }
    }
  }
  return out;
}

/* --------------------------------- canvas -------------------------------- */

/* A browser canvas keeps premultiplied 8-bit pixels, so a semi-transparent
 * colour comes back slightly changed. Doing the same round trip here is what
 * makes the engine see the pixels it sees in Chrome. */
const premul = (c, a) => (a === 255 ? c : a === 0 ? 0 : Math.min(255, Math.round(Math.round((c * a) / 255) * 255 / a)));

export class ImageData {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

export class Bitmap {
  constructor(width, height, data) {
    this.width = width;
    this.height = height;
    this.data = data;
  }
  close() {}
}

class Context2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.fillStyle = "#000000";
    this.imageSmoothingEnabled = true;
    this.imageSmoothingQuality = "low";
  }

  clearRect(x, y, w, h) {
    const c = this.canvas;
    for (let yy = Math.max(0, y); yy < Math.min(c.height, y + h); yy++) {
      c.data.fill(0, (yy * c.width + Math.max(0, x)) * 4, (yy * c.width + Math.min(c.width, x + w)) * 4);
    }
  }

  fillRect(x, y, w, h) {
    const hex = /^#([0-9a-f]{6})$/i.exec(this.fillStyle);
    const v = hex ? [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) : [0, 0, 0];
    const c = this.canvas;
    for (let yy = Math.max(0, y); yy < Math.min(c.height, y + h); yy++) {
      for (let xx = Math.max(0, x); xx < Math.min(c.width, x + w); xx++) {
        const p = (yy * c.width + xx) * 4;
        c.data[p] = v[0];
        c.data[p + 1] = v[1];
        c.data[p + 2] = v[2];
        c.data[p + 3] = 255;
      }
    }
  }

  drawImage(src, dx = 0, dy = 0, dw = src.width, dh = src.height) {
    dx = Math.round(dx); dy = Math.round(dy); dw = Math.round(dw); dh = Math.round(dh);
    const px = dw === src.width && dh === src.height
      ? src.data : resample(src.data, src.width, src.height, dw, dh);
    const c = this.canvas;
    for (let y = 0; y < dh; y++) {
      const ty = y + dy;
      if (ty < 0 || ty >= c.height) continue;
      for (let x = 0; x < dw; x++) {
        const tx = x + dx;
        if (tx < 0 || tx >= c.width) continue;
        const s = (y * dw + x) * 4, d = (ty * c.width + tx) * 4;
        const sa = px[s + 3];
        if (sa === 0) continue;
        const da = c.data[d + 3];
        if (sa === 255 || da === 0) {
          c.data[d] = premul(px[s], sa);
          c.data[d + 1] = premul(px[s + 1], sa);
          c.data[d + 2] = premul(px[s + 2], sa);
          c.data[d + 3] = sa;
        } else {
          const a = sa / 255, b = da / 255, oa = a + b * (1 - a);
          for (let k = 0; k < 3; k++) {
            c.data[d + k] = Math.round((px[s + k] * a + c.data[d + k] * b * (1 - a)) / oa);
          }
          c.data[d + 3] = Math.round(oa * 255);
        }
      }
    }
  }

  getImageData(x, y, w, h) {
    const c = this.canvas;
    const out = new Uint8ClampedArray(w * h * 4);
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const sx = x + xx, sy = y + yy;
        if (sx < 0 || sy < 0 || sx >= c.width || sy >= c.height) continue;
        const s = (sy * c.width + sx) * 4, d = (yy * w + xx) * 4;
        if (c.data[s + 3] === 0) continue;   // a browser canvas has lost this RGB too
        out[d] = c.data[s];
        out[d + 1] = c.data[s + 1];
        out[d + 2] = c.data[s + 2];
        out[d + 3] = c.data[s + 3];
      }
    }
    return new ImageData(out, w, h);
  }

  putImageData(img, x, y) {
    const c = this.canvas;
    for (let yy = 0; yy < img.height; yy++) {
      for (let xx = 0; xx < img.width; xx++) {
        const tx = x + xx, ty = y + yy;
        if (tx < 0 || ty < 0 || tx >= c.width || ty >= c.height) continue;
        const s = (yy * img.width + xx) * 4, d = (ty * c.width + tx) * 4;
        const a = img.data[s + 3];
        c.data[d] = premul(img.data[s], a);
        c.data[d + 1] = premul(img.data[s + 1], a);
        c.data[d + 2] = premul(img.data[s + 2], a);
        c.data[d + 3] = a;
      }
    }
  }
}

export class OffscreenCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
    this._ctx = null;
  }

  getContext(kind) {
    if (kind !== "2d") return null;
    return (this._ctx ||= new Context2D(this));
  }

  async convertToBlob({ type = "image/png", quality } = {}) {
    if (type === "image/png") {
      return new Blob([encodePng(this.data, this.width, this.height)], { type });
    }
    if (type === "image/webp") {
      const wp = await vm.runInThisContext("loadWebp")();   // the engine's own lazy loader (a script-scope const)
      if (!wp) return new Blob([], { type: "image/png" });
      const buf = await wp.encode(
        { data: this.data, width: this.width, height: this.height },
        { quality: Math.round((quality ?? 0.8) * 100) });
      return new Blob([buf], { type });
    }
    return new Blob([], { type: "image/png" });   // unsupported: the engine checks blob.type
  }
}

export async function createImageBitmap(src, opts) {
  if (src instanceof OffscreenCanvas || src instanceof Bitmap) {
    return new Bitmap(src.width, src.height, new Uint8ClampedArray(src.data));
  }
  const bytes = new Uint8Array(await src.arrayBuffer());
  const img = await decodeImage(bytes, { orientation: opts?.imageOrientation === "from-image" });
  return new Bitmap(img.width, img.height, img.data);
}
