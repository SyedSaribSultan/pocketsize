# Pocketsize — working rules for Claude

## UX decisions

The UX overhaul in `docs/UX_IMPLEMENTATION_PLAN.md` (owner-approved
2026-08-13) is implemented; the `docs/*PLAN.md` files are historical records
and name files that no longer exist. Their decisions still stand. If a change
needs a UX decision they do not cover, **stop and ask the owner — never
improvise a UX decision mid-implementation.**

## Binding constraints on every change

1. **Decision count must not grow.** First-run required decisions stay at 0;
   the plan panel shows 3 fields, everything else collapsed under More choices.
2. **Five-year-old-readable, literal copy.** No compression jargon outside
   More choices; technical residue carries its meaning in place
   ("always PNG — every pixel kept"). Say exactly what happens, no cleverness.
3. **Resize disclosure is non-negotiable:** if pixels were removed, the same
   line that shows the % says so — never after, never smaller.
4. **Legibility floor:** no text below 13px; body/control text 15–16px;
   spacious spacing.
5. **The page reads as a sequence:** add pictures → one question → result →
   evidence on demand.
6. **Local-first is the product.** No hosted API, no upload paths —
   "nothing is uploaded" is the moat.

## UI construction rules (owner-mandated 2026-08-14)

All UI in both interfaces is built strictly from the design system — the
vanilla-stack equivalent of "only use `@/components/ui`":

1. **One place for values.** Raw colours (`#hex`, `rgb()`, `hsl()`) exist in
   exactly two files: `web/sarib-tokens.css` (the Sarib design system's
   palette, generated) and
   `web/css/base.css` (the named vocabulary, including the deliberate
   over-the-photograph constants `--c-checker-*` / `--c-over-*`). Every other
   sheet, and the desktop `<style>` block, consumes names only.
   Machine-enforced: `test_design_system.test_only_base_defines_colour_literals`.
2. **No ad-hoc primitives.** A control is a central class (`.btn`, `.field`,
   `.chips`, …) from the region sheets. A missing pattern gets a class added
   centrally — never a one-off style on an element, never inline `style=`
   (the CSP blocks it in production anyway; the design-system test blocks it
   before that).
3. **No inline executable script.** The only inline `<script>` allowed in
   `web/index.html` is the JSON-LD data block (never executed; gate:
   `test_the_page_carries_no_inline_executable_script`).
4. **Generated files are never hand-edited.** Change the source and re-run
   its generator (see Repo invariants); CI runs each one with `--check`.
5. **New gates must be seen red.** Any new enforcement added for these rules
   follows the observed-failing rule: break it, watch it fail, then fix.

## Repo invariants (from the codebase itself)

- The app is `web/` only (the Python package and desktop app were removed).
  `web/destinations.js` is the source of truth for destinations and is edited
  directly.
- Generated, committed, and checked with `--check` (CI + unittests) — never
  hand-edit the outputs, change the source and re-run:
  - `tools/gen_ss2_module.py` — `web/ss2.js` → `web/ss2.module.js`
  - `tools/gen_seo_pages.py` — `web/index.html` → use-case pages + `web/sitemap.xml`
  - `tools/gen_fonts.py` — `tools/fonts.json` → `web/fonts.css`, content-hashed
    `web/fonts/*.woff2`, font preloads, `web/sw.js` precache
  - `tools/gen_tokens_subset.py` — `vendor/sarib-tokens.css` → `web/sarib-tokens.css`
- The design system is the Sarib system (syedsarib.com; source
  `sarib-design/tokens.css`, vendored verbatim). HeyOz tokens were retired
  2026-10-25 and must not come back.
- Any change that affects output needs a measurement at **matched perceptual
  quality** (see CONTRIBUTING.md). Never validate a metric change with that
  same metric.
- The browser harness asserts on real app state (`window.imgc`); copy and
  ordering changes must update assertions, not delete them.
- Run `python -m unittest discover -s tests` before declaring anything done.

Communication rules: follow `~/.claude/CLAUDE.md` (global). It loads alongside this file.
