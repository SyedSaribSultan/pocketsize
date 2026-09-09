# Guide to this repository

The product is a web page. Everything here runs in the browser, on the reader's
own machine - there is no server, no account and no upload path.

## The mental model

Everything follows one rule: **never assume quality, measure it.** The app
encodes an image several different ways, decodes each result back, scores it
against the original, and keeps the smallest file that still clears your quality
floor. Every design decision falls out of that.

The second rule follows from the first: **the best format is content-dependent.**
A photograph wants JPEG, a screenshot wants palette PNG, a smooth gradient wants
lossless PNG. So the app doesn't pick - it tries them all and keeps the winner.

A note on history, because the git log will otherwise confuse you. This repo
used to carry a second complete implementation in Python - a CLI, a desktop
app, a local server, and video support - kept in step with the browser by
parity tests and a sync tool. `9761685` removed all of it. One implementation
cannot drift from itself. Older commits, `CHANGELOG.md` and the `docs/VIDEO_*`
plans still describe that world; they are kept as design records, not as a map
of the tree. If a document names a `.py` file outside `tools/` or `tests/`, it
is history.

## Where to make changes

| You want to… | Go to |
| --- | --- |
| Change what formats a destination gets | `web/destinations.js` → `DESTINATION_FORMATS` |
| Change quality or size defaults | `web/destinations.js` |
| Add or rename a destination | `web/destinations.js`, then keep `web/index.html`'s control in step |
| Change how quality is judged | `web/ss2.js`, then `python tools/gen_ss2_module.py` |
| Change the search strategy | `web/worker.js` → `searchOne` / `searchUnderSize` |
| Change resize / metadata behaviour | `web/worker.js` → `decodeNormalised` |
| Add a format | `web/worker.js` → `makeEncoders`, and list it on a destination |
| Change the worker pool or dispatch | `web/js/engine.js` |
| Change what a size cap does | `web/worker.js` → `searchUnderSize` |
| Change the typeface | `python tools/gen_fonts.py --display "Family"` - one command, everywhere |

## Running it

```bash
node tests/web/serve.mjs 8151          # the app, under production's exact CSP

python -m pip install pillow           # only to write the test images
cd tests/web && npm ci && cd ../..     # puppeteer-core, to drive real Chrome

python -m unittest discover -s tests   # the static gates, ~1s
python tests/web/make_web_fixtures.py  # build the images the probes drop
node tests/web/e2e.mjs                 # the promise suite, in real Chrome
node tests/web/ss2_validate.mjs        # the metric vs the Python reference
node tests/web/verify_fonts.mjs        # faces load; nothing renders above 600
node tests/web/bench.mjs               # per-format sizes and scores
```

Serve it through `serve.mjs` rather than any other static server: it sends
production's `Content-Security-Policy`, and two CSP violations have reached
production by being invisible under a server that sent none.

`tests/web/` also holds a probe per concern - `probe_pool.mjs` (how many
workers the machine is given), `probe_backpressure.mjs` (a large batch stays
inside its memory window), `probe_flow.mjs`, `probe_presets.mjs`,
`probe_theme.mjs` and others. They assert on real app state through
`window.imgc`, so copy and ordering changes update assertions rather than
deleting them.

Two probes are known-bad on a clean checkout: `probe_sizecap.mjs` throws, and
`probe_pool.mjs` is flaky across back-to-back Chrome runs when a previous run
left service-worker cache behind. Re-run alone before believing a failure.

---

# The app (`web/`)

Deployed at [pocketsize.syedsarib.com](https://pocketsize.syedsarib.com).

**The engine**, independent of any interface: `worker.js` (ladder bisection, the
bake-off, dual-backdrop transparency scoring, the never-bigger rule), `ss2.js`
(the metric) and `destinations.js` (the destination table - once generated from
Python, now the reference itself and edited directly).

**The interface**, one page and nothing else. `index.html` is the dashboard;
`web/css/` holds six stylesheets, one per concern, with every colour and space
defined once in `base.css`; `web/js/` holds the ES modules with a strict
dependency direction — `format` and `dom` depend on nothing, `state` holds the
store, `engine` owns the worker pool and the message contract, `queue`/`compare`/
`facts` only render, `render` schedules them, and `main` is the only module that
binds an event listener. The one classic script is `js/theme.js`, loaded from
`<head>` so a saved Light/Dark choice is true before first paint; the cycling
control itself is bound in `main.js` like everything else.

The interface reads the `--oz-*` token layer again — through one indirection.
`web/css/base.css` aliases the app's six-name vocabulary (`--c-*`, `--s-*`,
`--radius`, `--font-*`, `--s-target`) onto HeyOz tokens, and every other sheet
consumes only those aliases; `tests/test_design_system.py` holds them to it.
Theme flips are the token layer's own `data-theme` mechanism: `js/theme.js`
always stamps a RESOLVED theme before first paint (the saved choice, or the
OS's answer for "match my device", re-stamped live when the OS changes),
because the token layer knows nothing about `prefers-color-scheme`.

There is one page. The marketing sections, the `/compare` and `/download` pages,
the synthetic demo, the lifetime savings counter and the CSV/JSON report export
were removed: none of them was part of compressing an image. Two of those ideas
later came back in different, smaller shapes because real users asked: a
three-state theme control (Light / Dark / Match my device, one cycling button),
and a written record — `pocketsize-report.txt` rides in every zip with each
picture's before/after, measured match, and the full versions-tried table.

### The first five seconds after a drop

There is one page, and a drop starts the work with nothing to press. The sequence
that makes that acceptable is an ordering, and the ordering is load-bearing —
`probe_flow.mjs` and `e2e.mjs` assert each step, because every one of them is a
thing someone will later be tempted to collapse.

1. **The untouched original is painted first.** `addFiles()` in `js/intake.js`
   calls the three renderers synchronously — not `scheduleRender()` — so the
   original's `src` is in the document immediately, and then holds `dispatch()`
   until the *next* animation frame so the browser has actually painted before an
   encoder is asked for anything. It costs a frame. Do not "optimise" it away:
   the difference between *here is your image, now watch* and *something happened
   to my file* is entirely in that ordering.
   The harness observes this frame through `imgc.holdWork(true)`, which is why
   that seam exists: `dispatch` is a module binding, so there is no global to
   stub.
2. **What is being tried is named, not spun.** `#stage-work` reports the format
   being measured right now. Never a bare spinner: the wait should be legible
   rather than merely long.
3. **The result appears the moment the first format clears the floor.** The
   worker posts each candidate as it finishes (`candidate` messages); the stage
   adopts the smallest passing one — "Here's the JPEG — still trying 3 more
   ways in the background" — and the chips fill in live, disabled until the run
   settles. The `done` message stays the authority: a later pass (the lossless
   recompressor, the chroma check) may still improve on what the preview
   showed. `mode` starts at `"split"`, and both layers live in one `#frame` at
   natural size so a single transform moves them together. The original never
   leaves the stage.
4. **The evidence appears when there is evidence.** The chips, the measurements
   and the per-image override are three blocks in `#facts`; before any result
   exists the region is hidden rather than sitting as dimmed scaffolding, and
   from the first live candidate onward it is on screen with no drawer to find.
5. **A settings change never blanks a finished result.** The old picture stays
   up, marked "updating to your new settings…", until its replacement lands;
   workers mid-flight get an `abort` message and decline the next probe instead
   of completing an answer nobody will see.

### Candidates: the chips are the format control

`worker.js` used to throw away every encode but the winner. It now carries all
of them home — `attachCandidateBytes()` copies each into its own buffer and
adds it to the transfer list — so `chooseCandidate()` is a relabel and a new
object URL rather than another run of the whole bake-off.

* Copied, not transferred in place. The winner's buffer is already in the
  transfer list and two candidates can be views over one buffer; moving such a
  buffer detaches every other view of it.
* `adoptCandidateBytes()` turns those buffers into **Blobs** on arrival and
  deletes the raw field. Blobs are backed by the browser's own store rather
  than the JS heap, which is what makes holding every encode of every image in
  a large batch affordable. It also keeps `item.candidates` plain JSON, which
  the benchmark and the E2E both serialise.
* Three fields carry the state: `item.auto` (the engine's answer, kept whole
  so it can always be returned to), `item.candBlobs`, and `item.pick` (what
  the person chose to look at instead — `null` while the engine's answer
  stands). `applyView()` points the live fields at one of them, so every
  number, the split view, the heatmap and the download follow from one swap.
* `ORIGINAL_PICK` is a real candidate: keeping the file exactly as it arrived.
  It is what makes "your original is one action away" true rather than
  reassuring.
* **`#ov-format` is deliberately not kept in sync with the chips.** It means
  "run this image again forcing that format", which is a different act from
  showing an encode the run already produced. Making it echo a chip would
  claim a re-run that never happened.
* During a run the same chips render from `item.liveCandidates` — real files,
  streamed in as `candidate` messages with their bytes — but as information,
  not controls: choosing among candidates that are still arriving is a race
  the person cannot win, so they enable when the run settles.

### Zoom

Two rules, both learned the hard way:

* **The frame is centred by transform, never by CSS alignment.** Grid and flex
  silently switch a centred item to `start` once it overflows its container —
  the "safe" behaviour — so the instant you zoomed past the stage the image
  snapped to the top-left and the rest hung off the bottom. `translate(-50%,
  -50%)` has no such rule.
* **Zoom is anchored to the pointer and panning is clamped to the overhang.**
  `zoomAt()` keeps whatever is under the cursor under the cursor; `clampPan()`
  allows movement only as far as the frame overhangs the stage, so an axis that
  still fits stays centred and the image can never be dragged into empty space.

### The plan's controls, and why they are shaped that way

Three questions are visible; everything else folds into one named disclosure
("More choices" — a native `<details>`, no script). The first-run flow requires
zero decisions: the defaults compress on drop.

* **Going to** is one `<select>` over the offered destinations. Picking one
  applies all three of its numbers — formats, size cap and minimum visual
  match — because otherwise "Thumbnail or avatar" would mean nothing but a
  shorter format list. Pre-2.7 stored names are mapped by `destinationOf`.
  Format is its own control now ("File type", under More choices); a pinned
  format *keeps* the destination, so someone who chose "Email or chat" and
  then "always JPEG" still gets something that fits in an email.
* **Must still look** is `#quality-preset` (words) sitting on top of
  `#quality` (the hidden 60–99 floor). *One setting, two views* — the words
  write the number and `reflectQualityWords` writes back, showing a hidden
  `custom` option when the floor lands between the landmarks. **Never make the
  words the source of truth:** the engine reads the floor from the DOM, and a
  control that displays one thing while the engine runs another is exactly the
  shape of the floor-99 bug. Its top rung, **"identical — every pixel kept"**,
  is not a floor but a different promise: the bake-off restricts to the
  pixel-exact set (`DESTINATION_FORMATS.lossless`, intersected with what the
  destination can store as-given), shrinking turns off and says why, and
  pixel-changing format pins go dark. The `90` option carries an explicit
  `selected` attribute — a select's initial value is otherwise its FIRST
  option, and a fresh profile must not boot into the lossless promise by
  accident of option order (this shipped as a bug for about an hour and the
  E2E's fresh-profile assertions caught it).
* **Shrink big photos** merges the old pixel-limit and edge-mode pair into one
  row: "to at most [2560] px" or "never — keep every pixel". Which edge the
  number counts is expert nuance and lives under More choices. When the
  `documents` ceiling will override a "never" — design tools crush anything
  over 4096px on import — the plan says so under the control BEFORE it
  happens, and the result carries a warning stated by the worker's own
  `hardCapped` flag, never inferred from the numbers.
* **JPEG cannot store alpha**, so choosing it with transparent artwork queued
  opens `#alpha-ask` rather than resolving it silently in either direction.
  *Invariants:* `item.alpha` is measured from decoded pixels in the worker and
  reports the **source**, so it does not move when flattening rewrites those
  pixels; dismissing the dialog by any route (Esc, backdrop, Cancel) restores
  the control to the setting actually in force; flattening runs before any
  encode or score, so the reference the result is measured against is the
  flattened original rather than transparency the output could never carry.
  A chosen format that gets filtered out — no alpha channel, or no codec in
  this browser — falls back to the automatic set with a warning rather than
  failing the image (and under "identical", the fallback is the pixel-exact
  set, never the lossy one).
* **If pixels were removed, the same line that shows the % says so** — stage
  bar, queue row, zip toast, and the full-strength `.note.strong` line above
  the measured stats. A headline number that quietly includes a resize is the
  least trustworthy number on the page; this rule is why it can't happen.

### The metric is SSIMULACRA 2 itself

`web/ss2.js` is a JavaScript port of the Python `ssimulacra2` package — the
implementation the desktop scores with. Anyone touching it must know:

* **It is validated, not trusted.** `tests/web/ss2_validate.mjs` scores a
  60-pair corpus (four content types × jpeg/webp/avif/palette distortions ×
  quality levels, plus small-image cases) against Python-reference scores.
  Float64 planes matched to |Δ| = 0.0000; the shipped Float32 planes match to
  mean |Δ| 0.0045, worst 0.0229, on the 100-point scale. Any change to ss2.js
  must re-run that harness.
* **Two boundary quirks are deliberate.** The reference transposes to (W, H)
  before scoring, so its blur zero-pads along the image's *x* axis and
  reflects along *y*; the port keeps row-major planes and swaps the boundary
  treatment to compensate. And the Gaussian is scipy's exact construction:
  radius `int(3.33 × 1.5 + 0.5) = 5`, discrete-sampled, normalised. "Fixing"
  either breaks agreement with the desktop.
* **Memory is budgeted, and that is load-bearing.** Full-frame scoring above
  `VERIFY_BUDGET` (2.75MP) runs on a 3×3 spread of native-resolution 512px
  tiles instead. Float64 full-frame on a 12MP image needed ~1.8GB, the
  allocations threw inside the worker, every lossy candidate died silently,
  and multi-megabyte lossless files won by forfeit. The 5MP E2E fixture exists
  to catch exactly that: it asserts lossy candidates are *measured* past the
  budget, not forfeited. The plane pool also refuses to retain buffers above
  ~12MB (`SS2_POOL_MAX_LEN`), or one 12MP job could pin hundreds of megabytes.
* The per-channel SSIM chroma guard applies **only under the `ssim` fallback
  metric** — SSIMULACRA 2 works in XYB and weighs chroma natively, and the
  reference has no such extra pass.

What's honestly different from the desktop version now:

* **Workflow** — folder watching, batch saves to disk, a scriptable CLI.
* **libimagequant / zopfli** — the browser quantizer is median-cut with two
  Lloyd refinement iterations plus an oxipng pass, which measures competitive
  with pngquant+zopfli on flat art but can still trail on photographic
  palettes.
* **Video** — the desktop tier compresses video today. The browser has an engine
  of its own, measured in a real browser; the page around it is the piece still
  landing. See below.
* Everything else is at parity: same metric, same floors, same candidate
  ladders, mozjpeg / oxipng / libwebp (incl. lossless) / libaom via WASM.

### Video in the browser

`web/video-worker.js` is the same promise with a different set of hands.
Mediabunny (MPL-2.0, vendored and hash-pinned in `web/vendor/LICENSES.md`) reads
and writes the containers — MP4, QuickTime, WebM, Matroska, iPhone HEVC MOV
included — and does nothing else here. Every frame is decoded and encoded by
**WebCodecs**, which is the browser's own codec: the one the `<video>` element
plays with, generally running on the machine's video hardware.

That choice is the whole architecture, and it buys three things:

* it is fast, because it is silicon rather than a WebAssembly interpreter;
* **no codec ships with the page**, so the download stays small and no patent
  licence travels with it — the browser vendor already holds the ones that
  matter, and a site calling the API distributes nothing;
* and it needs **no cross-origin isolation**, so the site's existing CSP and
  service worker are untouched.

The alternative was FFmpeg compiled to WebAssembly, rejected on three counts
each of which was sufficient: it runs roughly 12–25× slower than native, its
default build links x264 and x265 and is therefore GPL, and its threaded build
needs cross-origin isolation — which would have meant setting COEP across the
whole site and breaking any cross-origin resource that does not opt in.

**What it costs, said plainly here because it is said to the person too.** A
browser's encoder is tuned for video calls, not for archives: Chrome's AV1 is
libaom at realtime speeds, and a hardware encoder is roughly SVT-AV1 preset 9–10
class. A browser encode is realistically **10–30% larger at matched quality**
than the desktop's patient one. The direction of that is well supported; the
magnitude is an estimate, and `docs/VIDEO_RESEARCH.md` records it as such. Two
things stay true regardless: the measured score is real, because we certify what
we actually made rather than what we hoped for, and the desktop app is the tier
that wins on size. That is the same register `tests/BENCHMARK.md` already uses
to concede the 2.5 KB quantizer gap.

Two mechanical details are load-bearing:

* **The rungs are quantizer values, not CRF**, because per-frame QP is the
  handle WebCodecs exposes. The shape is identical — ascending in quality,
  bisected by the same search — so nothing else in the engine has to know.
  `probeSupport()` asks `isConfigSupported()` rather than assuming: encode
  support varies by browser, by operating system, by whether a hardware encoder
  is present and by codec, and the page needs the real answer so it can say
  plainly when nothing works instead of failing halfway through a job.
* **The metric is shared, not copied.** The image worker is a classic worker and
  reads `ss2.js` with `importScripts`; a module worker has no `importScripts` at
  all, and the CSP rules out every runtime escape hatch (`eval`, `new Function`,
  `data:` URLs). Rather than keep a second hand-written copy of a validated
  metric, `tools/gen_ss2_module.py` generates `web/ss2.module.js` from
  `web/ss2.js` and CI checks it — exactly how the destinations table is handled.
  One implementation, two loading mechanisms; drift here would mean the browser's
  two engines quietly disagreeing about what "looks the same" means.

Three smaller things this cost, recorded because they are not obvious:

* The vendored bundle is `mediabunny.min.js`, **not `.mjs`**. A module served as
  `application/octet-stream` under `nosniff` is refused outright, and `.mjs` is
  missing from more static hosts' MIME tables than is comfortable. Module-ness
  comes from the worker's `type: "module"`, never from the extension.
* `media-src 'self' blob:` was added to `vercel.json`'s CSP, because
  `default-src 'none'` blocks playing back a result, and `sw.js` went to `v3`
  with the new files precached.
* `tests/web/probe_video.mjs` originally launched Chrome with a
  SharedArrayBuffer flag, which the real site never has. Testing a browser with
  a capability the product deliberately avoids is testing a different product;
  the flag is gone. As it stands the probe compresses a real clip against the
  real CSP in real Chrome — 18 KB to 6.9 KB as AV1, measured at 74.7 by the same
  SSIMULACRA 2 port the image tier scores with, with progress reported
  throughout and no console errors.

**Where the seam is:** everything above is the engine, and it is finished and
measured. The page's own queue, settings panel and split-compare view
(`web/js/*`) are the surface around it, and they are a separate piece of work —
if you are looking for why a deployed build compresses pictures and not video,
that is where to look rather than in the worker.

Deploys from `web/` as the Vercel project root (`vercel.json` holds the strict
CSP and cache headers — no third-party requests of any kind). The browser test
harness lives in `tests/web/`: the promise-suite E2E, the perf bench with its
snapshot gates, the width-sweep and theme probes, the fixture generators, and a
static server that replays production's headers. `tests/web/README.md` has the
run instructions.

**It is an installable, fully-offline PWA.** `sw.js` precaches the whole
compressor on the first visit — codecs and faces included — with the app shell
network-first (deploys land on the next visit; offline gets the last one seen)
and the heavy `/vendor/` + `/fonts/` payloads cache-first. Bump `VERSION` in
`sw.js` only when the cached SET changes shape; content changes need nothing.
The manifest registers image `file_handlers`, and `main.js` consumes
`window.launchQueue`, so an installed copy appears in the OS "Open with" menu
and launches land straight in the queue. `vercel.json` serves `sw.js` with
`no-cache` so a new worker is picked up promptly.

**The panels are user-sized.** `js/panels.js` binds the two `role="separator"`
handles (sidebar right edge, evidence top edge): pointer-draggable,
arrow-steppable, double-click/Home to reset, persisted in localStorage as
`--side-w` / `--facts-h` on `<html>` — layout.css reads them with automatic
fallbacks, so "never touched" and "reset" are the same state. Focus mode
(`F`, Escape, or the stage button) hides the side and facts regions;
`body[data-focus="1"]` carries it.

### Design system

`web/heyoz-tokens.css` is a **vendored copy** of `dist/tokens.css` from the
HeyOz design-token system (`~/Downloads/heyoz-ds`, commit `3556f78`). Do not
edit it — it is generated by that repo's `node build/build.mjs`, and a change
here is silently overwritten on the next sync. To change a value, change it
upstream, rebuild, and re-copy.

`pocketsize/webui/app.html` consumes those tokens and hand-types nothing: no
hex, no `rgb()`, no `cubic-bezier`. **The browser app consumes them through
`web/css/base.css`**, which aliases its six-name vocabulary onto `--oz-*`
values; the one-place guarantee (values defined once, consumed by name
everywhere else) is enforced by `TheBrowserAppHasOnePlaceForValues` in
`tests/test_design_system.py`, and every other browser sheet may only use the
alias names base.css defines. Four of the system's rules are load-bearing for
the desktop app:

* **Adjacent regions never share a surface rung.** Separation is a surface step
  or space, never a border — `background` → `surface-primary` (toolbar, queue,
  panes) → `surface-secondary` (header, results bar, advanced tray) →
  `surface-tertiary` (inputs, fills). Every remaining border says what job it
  does; only `affordance` and `state` are legal.
* **Spatial travel goes through `--oz-motion-spatial-scale`**, so reduced
  motion collapses movement and keeps fades. `.btn:active` is the documented
  exception — that transform *is* the state, so it keeps its distance.
* **Effects springs must not overshoot, spatial springs must.** Colour and
  opacity take `--oz-spring-effects-*`; transform and size take
  `--oz-spring-spatial-*`.
* **Two elements are scoped dark islands** (`class="dark"`): the stage tags and
  the split divider. Both sit on a photograph behind a scrim that is dark in
  both themes, so their colour must not follow the page. A mode-specific
  override was the alternative and the system forbids it, because the two modes
  then drift.

### Typography

The faces the tokens name are **self-hosted**, in `web/fonts/` and declared by
`web/fonts.css`: Bricolage Grotesque (display, heading), Geist (body, label),
Geist Mono. Upstream fetches these from Google Fonts by `<link>`; this app
cannot, because a third-party request would break both the CSP
(`default-src 'none'`) and the promise that nothing leaves the device. Six
variable `woff2` faces, latin and latin-ext, 191 KB total, each keeping the
exact `unicode-range` Google ships so an out-of-subset glyph falls through the
token stack instead of rendering tofu. The two above-the-fold faces are
preloaded.

**Nothing renders above semibold (600), anywhere.** Three things enforce it,
because there are three ways to break it:

* Call sites use `--oz-weight-semibold`; the two heavier steps
  (`--oz-default-weight-display` at 800, `--oz-weight-bold` at 700) are simply
  never referenced. The tokens are *not* redefined — a token that no longer
  means what it says is worse than a call site that picked a different one.
* The self-hosted faces are cut to `wght 400..600`, so there is no heavier
  master to render even if something asked.
* `b, strong, th, h1–h6, optgroup` are reset to 600, because the user agent
  renders those at `bold` and a stylesheet that never writes 700 otherwise
  still gets 700. This is the one that actually bit — it is invisible to source
  grepping and was caught only by measuring computed styles in the browser.

### The app shell is flex, deliberately

`.app` and `#inspector-body` are flex columns, not grid row templates, and that
is load-bearing. Both contain children toggled with `hidden` — the advanced tray
and the detail panel — and a hidden element generates no grid box, so
auto-placement silently shifts every later child up a track. That bug shipped:
the body fell into an `auto` row while the results bar inherited the `1fr`,
leaving ~185px of empty track under the panes and a 130px-tall results bar. Flex
ignores absent children, so the growing region stays the growing region.

Two related rules, both straight out of the system's layout primitives:

* `.workspace` needs a **definite** `height`, not a `min-height`. `height: 100%`
  on a child cannot resolve against a parent that only has a minimum, so the
  `1fr` had no definite space to claim.
* Its `grid-template-columns` is wrapped in `minmax(0, 1fr)`. An implicit grid
  column is `max-content`, so without it the widest descendant sets the shell's
  width and the whole page scrolls sideways on a phone.

### Speed, and the invariants that make it safe

The engine got about **2.2× faster** (min-of-3 on a mixed corpus with a 12MP
photograph: 30.9s → 14.1s) with **byte-identical output** on both the documents
and web destinations. Four changes did it, and each rests on an invariant that
must hold if anyone touches this code:

* **oxipng runs only where it could change the winner.** It was 37% of all
  worker CPU, most of it spent losslessly shrinking a 25MB PNG of a photograph
  that loses to JPEG by 34×. It now runs after ranking, on PNG-family
  candidates where `size × 0.7 ≤ best`. *Invariant:* oxipng never takes more
  than 30% off a canvas-written PNG. If that were ever false the constant is
  `OXI_BEST_CASE`.
* **The per-channel chroma check runs on the winner only**, not on every
  candidate — it costs three to six extra full-frame passes each and only one
  candidate ships. If the winner fails it is escalated up its ladder, or
  dropped and the next-best checked. *Invariant:* the gate applies only when
  something cleared the floor; a best-effort result is never rejected over
  chroma, or a usable file would become a failed one.
* **Encodes are memoised per (level, effort).** Only AVIF's output depends on
  the effort flag, so `fastAffects` is set there and nowhere else. *Invariant:*
  if any other encoder is ever given a real fast path, it must set that flag,
  or the shipped bytes will silently be the probe's cheap encode.
* **The search bisects the whole ladder** instead of probing the top rung
  first. Score rises with quality, so a rung that passes proves every rung
  above it would — that first probe bought nothing and cost the most expensive
  encode of the image. Note the scores are *not* perfectly monotonic (tiled
  sampling), so a different probe order can land on a different rung; both old
  and new only guarantee that the chosen rung passes the full-frame check.
* **JPEG quantisation tables compete at the finish line.** Which mozjpeg
  table wins is content-dependent — the benchmark's real photograph ships
  smaller with the default ImageMagick table, its hard synthetic ships 23%
  smaller with Annex K — so after the search converges, the alternate table
  is encoded at the chosen rung and the rung below, verified with the same
  scorer, and the smallest passing file ships (`encoder.alternates` in
  `worker.js`). *Invariants:* at most two extra encodes; an alternate that
  is not smaller is discarded before verification; a best-effort failure is
  never "improved", only a passing result.

A second round of speed work targets the *perceived* cost — the waits a person
actually sits through — and each piece carries its own invariant:

* **Probe scores are memoised per (format, rung)** on the cached decode
  (`job.scoreMemo`), so a floor nudge re-reads measurements instead of paying
  for five encodes and comparisons per format. *Invariant:* the memo lives on
  the decode-cache entry and dies with it — same pixels, same scores, and a
  frame change (new `frameKey`) starts clean.
* **Stale jobs are aborted, not discarded on arrival.** A settings change sends
  `abort`; the worker checks a flag between probes and between formats and
  declines the next unit of work. A wasm encode cannot be interrupted
  mid-flight, so "stop" means "within one probe". *Invariant:* an abort is
  never a format failure — it rethrows past the per-encoder catch, or a stopped
  run would ship a warnings list full of lies.
* **Codec loads are single-flight** (`CODEC_LOADS` caches the promise, not just
  the result). The idle prefetch and the first job both ask; a second
  `importScripts` of the same glue re-declares its top-level bindings, throws,
  and used to mark the codec unavailable — silently dropping its format from
  every bake-off on that worker. The E2E's format-completeness guard is what
  catches that class of failure.
* **Weak devices (≤3 cores or ≤4GB) drop AVIF from the automatic set** and the
  result says so, with "always AVIF" as the way to insist. *Invariant:* an
  explicit pin or the lossless promise is never overridden — the trim applies
  to delegation only.

`tests/web/bench.mjs` measures all of it and doubles as the regression gate:
it writes a snapshot of every fixture's winner, level, bytes and score, and
fails on any change to them. It also reports **deterministic operation counts**
(encodes, oxipng passes, SSIM passes), which is what an algorithmic claim should
rest on — wall-clock on a thermally throttled laptop varied 2.3× across
identical runs, so timings are reported as min-of-N.

### Gates

Both live in `tests/web/`:

* `verify_tokens.mjs` — the desktop app only, since it is the only consumer of
  the token layer now. Fails on a `var(--oz-*)` the layer does not define, any
  colour literal in `webui/app.html`, a leftover pre-migration variable, a weight
  above 600 reaching the app layer, and a declared face missing from disk. The
  browser app's equivalent rules run in `tests/test_design_system.py`, without
  Chrome and without Node.
* `verify_fonts.mjs` — loads the real page in Chrome and asserts the six faces
  register and parse, that Bricolage and Geist are what actually paint, that
  **no rendered element** computes above 600 (checked twice: empty state, then
  with the app populated), and that every request stays on this origin.
