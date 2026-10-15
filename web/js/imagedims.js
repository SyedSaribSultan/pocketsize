/* An image's pixel size, read from its header - without decoding it.
 *
 * A decoder allocates width x height x 4 bytes before it draws a pixel, and a
 * file's byte size says nothing about that: a few-kilobyte PNG can declare
 * 50,000 x 50,000 and ask for ten gigabytes. Decoding one of those takes the
 * tab down with it. So both the page (before it draws a thumbnail) and the
 * worker (before it decodes for encoding) read the declared size first and
 * refuse anything over MAX_PIXELS with a message that says why.
 *
 * Deliberately a classic script that only assigns to the global object: the
 * image worker is a classic worker and loads it with importScripts, and the
 * page imports it as a side-effect module. One parser, no generator, and
 * nothing that differs between the two.
 *
 * Unknown or truncated headers return null, which means "not known to be too
 * big" - the decoder still gets to decide whether the file is readable.
 */

"use strict";

(function (root) {
  /* 100 megapixels: 400 MB of RGBA once decoded, before the encoder's own
     copies. Comfortably above any camera or phone this app is for. */
  const MAX_PIXELS = 100_000_000;

  const be16 = (b, i) => (b[i] << 8) | b[i + 1];
  const le16 = (b, i) => b[i] | (b[i + 1] << 8);
  const be32 = (b, i) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
  const le24 = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  const le32s = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);
  const tag = (b, i, s) => {
    for (let k = 0; k < s.length; k++) if (b[i + k] !== s.charCodeAt(k)) return false;
    return true;
  };

  function png(b) {
    if (b.length < 24 || b[0] !== 0x89 || !tag(b, 1, "PNG") || !tag(b, 12, "IHDR")) return null;
    return { width: be32(b, 16), height: be32(b, 20) };
  }

  function gif(b) {
    if (b.length < 10 || !tag(b, 0, "GIF8")) return null;
    return { width: le16(b, 6), height: le16(b, 8) };
  }

  function bmp(b) {
    if (b.length < 26 || !tag(b, 0, "BM")) return null;
    return { width: Math.abs(le32s(b, 18)), height: Math.abs(le32s(b, 22)) };
  }

  function jpeg(b) {
    if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }                     // fill byte
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      if (m === 0xd9 || m === 0xda) return null;               // EOI / scan before a frame
      // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC).
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { width: be16(b, i + 7), height: be16(b, i + 5) };
      }
      i += 2 + be16(b, i + 2);
    }
    return null;
  }

  function webp(b) {
    if (b.length < 30 || !tag(b, 0, "RIFF") || !tag(b, 8, "WEBP")) return null;
    if (tag(b, 12, "VP8 ")) {
      return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
    }
    if (tag(b, 12, "VP8L")) {
      const b0 = b[21], b1 = b[22], b2 = b[23], b3 = b[24];
      return {
        width: 1 + (((b1 & 0x3f) << 8) | b0),
        height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
      };
    }
    if (tag(b, 12, "VP8X")) return { width: 1 + le24(b, 24), height: 1 + le24(b, 27) };
    return null;
  }

  /* AVIF / HEIF: the size lives in an 'ispe' property. A grid image carries
     one for the canvas and one per tile, so the largest is the canvas. */
  function isobmff(b) {
    if (b.length < 12 || !tag(b, 4, "ftyp")) return null;
    let best = null;
    for (let i = 8; i + 16 <= b.length; i++) {
      if (b[i] === 0x69 && tag(b, i, "ispe")) {
        const width = be32(b, i + 8), height = be32(b, i + 12);
        if (!best || width * height > best.width * best.height) best = { width, height };
      }
    }
    return best;
  }

  /** {width, height} as the header declares it, or null if unknown. */
  function imageDims(input) {
    const b = input instanceof Uint8Array ? input : new Uint8Array(input);
    for (const read of [png, jpeg, webp, gif, bmp, isobmff]) {
      const d = read(b);
      if (d) return d.width > 0 && d.height > 0 ? d : null;
    }
    return null;
  }

  /** The words for a file that is too big to open, or null if it is fine. */
  function tooManyPixels(input) {
    const d = imageDims(input);
    if (!d || d.width * d.height <= MAX_PIXELS) return null;
    const mp = Math.round(d.width * d.height / 1e6).toLocaleString();
    return `This picture is too big to open here: ${d.width.toLocaleString()} × `
      + `${d.height.toLocaleString()} pixels is ${mp} megapixels, and the limit `
      + `is ${MAX_PIXELS / 1e6} megapixels. Try a smaller copy.`;
  }

  root.imageDims = imageDims;
  root.tooManyPixels = tooManyPixels;
  root.IMAGE_MAX_PIXELS = MAX_PIXELS;
})(typeof self !== "undefined" ? self : globalThis);
