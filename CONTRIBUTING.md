# Contributing

Thanks for taking a look.

## Getting set up

The app is the files in `web/`, served as they are. There is no build step and
no framework, so there is nothing to compile before you can see a change.

```bash
git clone https://github.com/SyedSaribSultan/pocketsize
cd pocketsize

node tests/web/serve.mjs 8151      # then open http://localhost:8151
```

Serve it that way rather than through any other static server: `serve.mjs`
sends production's exact `Content-Security-Policy`, and two CSP violations have
reached production by being invisible under a server that sent no policy.

The gates need two toolchains, both only for testing — the app itself needs
neither at runtime:

```bash
python -m pip install pillow           # writes the test images
cd tests/web && npm ci && cd ../..     # puppeteer-core, to drive real Chrome

python -m unittest discover -s tests   # the static gates, ~1s
python tests/web/make_web_fixtures.py  # build the images the probes drop
node tests/web/e2e.mjs                 # the promise suite, in real Chrome
node tests/web/ss2_validate.mjs        # the metric vs the Python reference
node tests/web/verify_fonts.mjs        # faces load; nothing renders above 600
```

`resolve_puppeteer.mjs` defaults to a Windows Chrome path and reads
`CHROME_PATH` as the documented override.

## The one thing to know before changing behaviour

This project's whole claim is that quality is *measured*, not guessed. So any
change that affects output has to come with a measurement, and the measurement
has to be at **matched perceptual quality**. A smaller file at a lower score
isn't an improvement, it's a different setting.

The corpus and the harness for that live in `tests/web/`:

```bash
python tests/web/make_web_fixtures.py   # the corpus
node tests/web/bench.mjs                # per-format sizes and scores
node tests/web/ss2_validate.mjs         # the metric itself, against the reference
```

And don't validate a change to the metric using that same metric — that's
circular, and it is exactly the mistake that made version 1 look fine. When you
change the scorer, `ss2_validate.mjs` is the witness: it compares against
scores produced by the Python reference implementation, not by this code.

A worked example, from the commit that made the metric 1.7-1.9x faster: the
claim was "faster, and the output does not move", so the evidence was a Chrome
timing either side *and* the fact that all 48 validation vectors returned the
byte-identical float. Speed measured in Node was ~1.6x more flattering than
Chrome — quote the browser number, since that is the one users get.


## Every new gate must be observed failing

A test, check or CI job that has never been seen to go red is a guess about
whether it measures anything. Before you open the PR: break the thing it
watches, watch it fail, restore, and **say so in the commit message** — what
you broke and what it said.

This is not hypothetical bookkeeping. Four checks on one branch reported
success while checking nothing:

| The check | Why it was green | Caught by |
| --- | --- | --- |
| A byte-comparison snapshot | The frame size had been pinned by hand, so it certified a configuration no user would ever run | Review |
| The AVIF corpus skip | A failed plugin install dropped 12 vectors and still printed `VALIDATED` | Review |
| A parser-based parity test | Every regex could match nothing and pass | Writing this rule |
| A `diff` against a regenerated file | The job had not written the file yet, so it compared it to itself | A file mtime |

Two were found in review and one by luck. Watching a gate fail once costs a
minute and is the only thing that distinguishes it from a comment.

The same rule applies to guards *about* guards. `tests/test_corpus_guard.py`
exists because `check_ss2_corpus.py` was itself only verified by hand.

## Generated files

Several things are generated from a source of truth and committed, because
neither `web/` nor a pip install has a build step and neither should grow one:

```bash
python tools/gen_ss2_module.py      --check   # web/ss2.module.js
python tools/gen_seo_pages.py       --check   # the use-case pages + sitemap
python tools/gen_fonts.py           --check   # web/fonts.css + the woff2 files
python tools/gen_tokens_subset.py   --check   # web/heyoz-tokens.css
```

Drop `--check` to rewrite them. **Never edit the outputs.** Change the source
and re-run. `gen_seo_pages`, `gen_fonts` and `gen_tokens_subset` are each gated
by a test inside the suite (`test_seo_pages.py`, `test_design_system.py`), so a
stale output fails the build. **`gen_ss2_module` has a CI step but no test**,
which by this project's own rule makes it a convention rather than a guarantee
— if you touch `web/ss2.js`, run the generator by hand and commit the result.

`web/destinations.js` was generated from a Python source that no longer ships.
It is now the reference itself, and is edited directly.

| Output | Source |
| --- | --- |
| `web/destinations.js` | `pocketsize/destinations.py` |
| `web/ss2.module.js` | `web/ss2.js` |
| `web/<slug>.html` + `web/sitemap.xml` | `web/index.html` |
| `pocketsize/webui/heyoz-tokens.css` | `web/heyoz-tokens.css` |
| `pocketsize/webui/fonts.css` + `fonts/` | `web/fonts.css` + `web/fonts/` |
| `pocketsize/webui/favicon.svg` | `web/favicon.svg` |

`web/ss2.module.js` is there for a reason worth knowing before you are tempted
to "simplify" it away. The image worker is a classic worker and pulls the metric
in with `importScripts`; the video worker is a module worker, because Mediabunny
ships as an ES module, and a module worker has no `importScripts` at all. The
CSP rules out every runtime escape hatch — no `eval`, no `new Function`, no
`data:` URLs — so the two loading mechanisms genuinely do not meet. One
validated implementation, generated into two forms, beats two hand-maintained
copies: drift between them would mean the browser's two engines quietly
disagreeing about what "looks the same" means.

If you find yourself typing a destination's name, a frame size, a colour or a
corner radius into a second file, that is the mistake these exist to prevent —
the previous hand-written copy of the destination table drifted from its
reference within an hour of being created.

## One design system, and one set of motion values

Both interfaces render from `web/heyoz-tokens.css`. The desktop app gets a
committed copy of it; nothing in either app declares a colour, a corner or a
duration of its own.

```bash
node tests/web/verify_tokens.mjs     # static: both app layers, colour + motion
node tests/web/verify_desktop.mjs    # runtime: the desktop app in real Chrome
node tests/web/shoot_both.mjs        # screenshots, both apps, both themes
```

Four more run the parts of the product that only exist in a browser:

```bash
node tests/web/probe_video.mjs        # the engine: Mediabunny + WebCodecs, real CSP
node tests/web/probe_video_ui.mjs     # the product: a file dropped into the real page
node tests/web/probe_i18n.mjs         # numbers in three locales, real Chrome each time
node tests/web/probe_video_pages.mjs  # each use-case page sets the plan it promises
```

`probe_i18n.mjs` launches the browser in a different locale per case rather
than stubbing `Intl`, because the thing being tested is whether the code asks
the platform at all — a formatter pinned to `en-US` passes a mocked test and
fails every German user. `probe_video_pages.mjs` reads the settings the app
**adopted**, never the `data-preset-*` attribute in the HTML: an attribute
being present proves nothing about anything consuming it.

`verify_tokens.mjs` fails on a hand-typed colour, a hand-typed duration or
easing curve, `transition: all`, and — the one that costs users something real
— **any transition of a layout property**. `width`, `height`, `top`, `left`,
`margin`, `padding` and `inset` all force the browser to recompute layout on
every frame; `transform` and `opacity` are composited and cannot. Three
progress bars in this app animated `width` before that rule existed.

Use the values the system already ships: `--oz-duration-*`, `--oz-ease-*`, and
the `--oz-spring-{effects,spatial}-{fast,default,slow}` pairs. Do not add a
second motion vocabulary — `--oz-ease-exit` already exists, and redefining it
would silently change every exit animation in the product.

`prefers-reduced-motion` is handled once, in the token layer, for both
interfaces. It collapses spatial travel and takes the overshoot off the springs
while leaving fades alone, because a fade is often the thing carrying the
meaning. Do not re-handle it per component or per app.

## Ground rules

- **Pip-installable dependencies only.** No shelling out to `cwebp`, `pngquant`
  or `avifenc` — and, since video landed, no shelling out to `ffmpeg` either. A
  designer on Windows has to be able to run this with nothing but Python, so
  every engine we use must ship a Windows wheel. PyAV is the whole reason video
  could be added under that rule at all: its wheels carry a complete FFmpeg,
  x264 and SVT-AV1 included, for Windows x64 and ARM64, macOS and Linux, and the
  API is in-process rather than a command line whose output has to be parsed.
- **The `video` extra must not reach the standalone installers.** Depending on
  PyAV is fine and leaves this package's own MIT licence alone; *bundling* the
  GPL FFmpeg inside it into a shipped binary is a different act with different
  obligations, and until that is resolved the installers ship without it. See
  `docs/VIDEO_IMPLEMENTATION_PLAN.md`, decision V3.
- **Optional engines must degrade, not crash.** Guard imports and fall back.
- **New behaviour needs a test**, especially the awkward cases: transparency,
  CMYK, animated GIFs, corrupt files, extreme aspect ratios — and, for video,
  rotated frames, non-square pixels, HDR, variable frame rate and more than one
  soundtrack. Those five are what `tests/make_real_world_fixtures.py` exists to
  produce, and every one of them was a real defect before it was a fixture.
- **Inherited values have no recorded reason.** The repository landed in a
  single initial commit, so nothing before it has a documented rationale. If
  you change one, write down why — you are the first person who can.
- Run `ruff check .` before opening a PR.

## Reporting a bug

Include your browser and version, your OS, and ideally the file that triggered
it. "It made my file bigger" is a great bug report if the file is attached.

Two things worth pasting, because they answer most questions at once: whatever
the browser console printed, and the output of `window.imgc.poolPlan()` typed
into that console — it reports how many workers the machine was given and what
it decided that from, which is the first thing to know for anything slow, stuck
or memory-related.
