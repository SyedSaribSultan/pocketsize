# Pocketsize

[![CI](https://github.com/SyedSaribSultan/pocketsize/actions/workflows/ci.yml/badge.svg)](https://github.com/SyedSaribSultan/pocketsize/actions/workflows/ci.yml)
[![Try it in the browser](https://img.shields.io/badge/try_it-in_the_browser-d29a5e)](https://pocketsize.syedsarib.com)

**Image compression that proves it didn't ruin your image.**

Most compressors ask you to pick a quality number and hope. This one saves each
image several different ways, opens every version back up, compares it to your
original, and keeps the smallest one that still looks close enough. Then it
shows you the evidence.

Put plainly: every image comes out as small as it can go without you being able
to see the difference — and you get the side-by-side to check that for
yourself.

Typical result on design assets: **70–90% smaller**, at a measured
visually-lossless quality level.

![The app, dark theme](docs/screenshot-dark.webp)

**[pocketsize.syedsarib.com](https://pocketsize.syedsarib.com)** — nothing to
install, and nothing to sign up for. It runs the whole comparison in your
browser, SSIMULACRA 2 included (ported to JavaScript and validated against the
reference implementation). Your images never leave your device.

That is not a promise you have to take on trust. The page is served under
`Content-Security-Policy: default-src 'none'; connect-src 'self'`, so the
browser itself will not let it send your picture anywhere, whatever the code
says. Open the network tab and watch.

[tests/BENCHMARK.md](tests/BENCHMARK.md) holds a reproducible head-to-head
against single-format pipelines and fixed-quality defaults, every strategy
searched to the same visual match of 90 or better. On that corpus Pocketsize is
the smallest or tied-smallest passing file on every image; on the 12 MP
photograph the browser version ships 362 KB where searched single-format
JPEG needs 517–544 KB — and every fixed-quality default misses the target
outright.

---

## Two ideas, both load-bearing

**1. Quality is measured, not guessed.**
Every version is opened back up and compared to the original with
[SSIMULACRA 2](https://github.com/cloudinary/ssimulacra2) — the metric the
image-compression community converged on, which correlates with human judgement
at r≈0.88 versus SSIM's ≈0.76, and unlike SSIM can actually see chroma damage.
The encoder quality setting is *found* by binary search, not assumed. Flat UI
artwork survives a very low setting; a noisy photograph automatically gets a
high one.

**2. The format is a comparison, not an assumption.**
Each image is saved as JPEG *and* palette PNG *and* lossless PNG (plus WebP if
you allow it), each searched separately, and the smallest one that still looks
close enough wins. The winner is genuinely content-dependent:

| Image | jpeg | png8 | png | webp | webp-lossless | winner |
| --- | --- | --- | --- | --- | --- | --- |
| photograph | **110 KB** | 536 KB | 1,531 KB | — | 1,468 KB | jpeg |
| UI screenshot | 43 KB | **10 KB** | 29 KB | 19 KB | 14 KB | png8 |
| vector logo (alpha) | n/a | 3.9 KB | 3.9 KB | 11 KB | **3.1 KB** | png8 / webp |
| smooth gradient | 7.5 KB | 115 KB | **2.7 KB** | 5.5 KB | 0.4 KB | png |

<sub>Smallest file scoring ≥ 80 SSIMULACRA 2.</sub>

Four images, four different answers, and up to a **40× spread** between the best
and worst format. Palette PNG is the best choice for two of them and the *worst
possible* choice for the gradient. Picking one format up front leaves a lot on
the table.

---

## The app

![Before / after comparison](docs/screenshot-compare.jpg)

Drop images anywhere in the window. Every file is queued, encoded in parallel,
and shown with its before/after size, the format that won, and the measured
score.

- **Split comparison** — drag the divider, or press <kbd>Space</kbd> to flip
  between original and compressed. Zoom to 100%, 200%, 400% and pan around.
  This is the point of the whole thing: you can *check*.
- **Versions panel** — see every version that was tried, why each one lost in a
  single sentence, and switch to any of them instantly.
- **Nothing is written until you press Save.** Review the whole batch, then
  save it or throw it away.

Every one of those runs in the browser, on your own machine. There is no
server to talk to and no account to make.

<details>
<summary>Light theme</summary>

![Light theme](docs/screenshot-light.webp)
</details>

## Why `documents` refuses WebP

"Just use WebP" is the standard advice and it is wrong if your image is going
into a design tool or a document. This looks like a limitation and is the
feature.

Figma's docs list WebP as an accepted upload format. But Figma's plugin API only
knows PNG, JPEG and GIF — `figma.createImage` rejects everything else — and the
standing community answer is that a WebP dropped onto the canvas is **decoded
and re-encoded as PNG**, with no way to recover the original. TIFF import
working *only in Safari* points the same way: Figma leans on the browser's
decoder, then re-encodes. Office suites and document editors behave much the
same way.

If that's right, handing one of these tools a beautifully compressed 40 KB WebP
photo gets you a multi-megabyte PNG inside the saved file. The downside is
severe and the upside is a few percent, so the **Design tool or document** destination sticks to formats
those tools are documented to store byte-for-byte. AVIF isn't supported by
Figma at all, and neither is JPEG XL.

`documents` carries two size numbers, doing two different jobs. **2560px** is
the everyday downscale, the same as `web` — memory pressure in these tools comes
from pixel dimensions more than from bytes, and no codec recovers what a 6000px
export wastes when it renders at 1200px. **4096px** is a ceiling, not a setting:
it clamps even an explicit larger limit, because anything above it is downscaled
destructively on import with no control over the resampling, so the choice is
between our Lanczos and theirs. Asking for more is not refused, just quietly
brought down — the intent is reasonable, the destination simply cannot carry
it.

Every other destination allows the modern formats, which is why `web` is the
default: the restriction is a fact about design tools, not about images.

## What it does to each image

1. **Caps the pixel dimensions.** The single biggest win; no codec recovers the
   bytes wasted on a 6000px export that renders at 1200px.
2. **Strips metadata** — EXIF, camera junk, colour profiles, XMP blobs.
3. **Runs the comparison**, searching each format for the smallest setting that
   still looks close enough to the original.
4. **Keeps the smallest winner**, and never writes a file bigger than the source.

Transparency is preserved, and scored against both a dark and a light backdrop
with the worse score winning — a halo you can't see on white is still a defect.
Animated GIFs pass through untouched. Corrupt files are reported and skipped,
never crashing the run.

JPEG output is always **4:4:4**. With chroma subsampling on, matching 4:4:4's
score on saturated content needed quality 97 instead of 76 — a **3.8× larger
file**. Luma-only metrics like SSIM can't see this, which is how the mistake
survives in most hand-rolled compressors.

---

## Development

There is nothing to build and no framework. The app is the files in `web/`,
served as they are.

```bash
git clone https://github.com/SyedSaribSultan/pocketsize && cd pocketsize

node tests/web/serve.mjs 8151     # the app, under production's exact CSP
```

Serving it through `serve.mjs` rather than any static server is the point: it
mirrors the `Content-Security-Policy` production sends, and two violations have
reached production before by being invisible locally.

The gates, which are what CI runs:

```bash
python -m pip install pillow          # only to write the test images
cd tests/web && npm ci && cd ../..    # puppeteer-core, for real Chrome

python -m unittest discover -s tests  # the static gates - 33 tests, under a second
python tests/web/make_web_fixtures.py # build the images the probes drop
node tests/web/e2e.mjs                # the promise suite, in real Chrome
node tests/web/ss2_validate.mjs       # the metric against the Python reference
node tests/web/verify_fonts.mjs       # the faces load, and nothing renders above 600
```

`resolve_puppeteer.mjs` defaults to a Windows Chrome path; set `CHROME_PATH` if
yours lives elsewhere.

Two files are generated and CI diffs them, so regenerate rather than hand-edit:
`web/ss2.module.js` (`python tools/gen_ss2_module.py`) and the ten use-case
pages (`python tools/gen_seo_pages.py`). `python tools/gen_fonts.py --display
"Some Family"` changes the typeface everywhere in one command.

See [CONTRIBUTING.md](CONTRIBUTING.md). The one rule worth stating up front: any
change that affects output needs a measurement at **matched perceptual quality**
— a smaller file at a lower score isn't an improvement, it's a different
setting. And never validate a metric change using that same metric.

## Licence

MIT.
