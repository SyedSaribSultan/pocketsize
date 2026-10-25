"""Prune the vendored Sarib token sheet to the tokens this app actually reads.

`vendor/sarib-tokens.css` is a verbatim copy of `tokens.css` from the Sarib
design system (`sarib-design/`, the visual system of syedsarib.com). It carries
the entire kit: primitives, every semantic role in light and dark, the type
scale, springs, and a block of drop-in base element styles (`.btn`, `.s-card`,
...) for apps that have no controls of their own. This app reads a few dozen of
its tokens and none of its base styles - it has its own control vocabulary in
web/css/, built from those tokens through web/css/base.css.

So the shipped sheet is cut two ways:

* The drop-in base styles are removed whole: everything from the kit's
  "Base element styles" banner to the end of the file. Shipping them would put
  a second `.btn` and a second `body` rule in front of the app's own, which is
  two design systems arguing about one button.
* The token declarations are pruned to what is reachable. Reachability is
  transitive: it starts from every `var(--x)` written anywhere outside the
  token sheet, then follows each surviving token's own value for further
  `var()` references, so a token used only to define another used token is
  kept.

Why it is worth cutting. The sheet is render-blocking on every entry point and
the full kit is ~58KB, so its dead weight would be paid before first paint by
every visitor, on every cold load, and again by the service worker's install.

Why a generator rather than an edit. The vendored file is a copy of the design
system's own; hand editing it means the next re-vendor silently restores the
bloat, and a diff against upstream stops being meaningful. So the vendored copy
stays pristine at `vendor/sarib-tokens.css` - OUTSIDE web/, because web/ is the
deploy root - and the pruned sheet is built from it, the same shape as
tools/gen_seo_pages.py and gen_ss2_module.py.

    cp ../sarib-design/tokens.css vendor/sarib-tokens.css   # re-vendor
    python tools/gen_tokens_subset.py            # writes web/sarib-tokens.css
    python tools/gen_tokens_subset.py --check    # exit 1 if it is stale

tests/test_design_system.py gates the --check, so a re-vendor that reintroduces
dead tokens fails CI rather than shipping.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
SOURCE = ROOT / "vendor" / "sarib-tokens.css"
OUT = WEB / "sarib-tokens.css"

# Where the kit's drop-in base element styles begin. Everything from this
# banner on is cut: the app styles its own elements (see the module docstring).
BASE_STYLES = re.compile(r"^/\* =+ Base element styles", re.M)

# Where a token may be *used*: every sheet and page the browser loads, plus the
# app's own modules, which set custom properties by name from JavaScript.
CONSUMERS = (
    sorted(WEB.glob("css/*.css"))
    + sorted(WEB.glob("*.html"))
    + sorted(WEB.glob("js/*.js"))
    + [WEB / "fonts.css"]
)

VAR_USE = re.compile(r"var\(\s*(--[A-Za-z0-9_-]+)")
# A declaration line: the token, and the value it is defined as. MULTILINE so
# the same pattern can sweep the whole sheet with findall and test one line at
# a time with match - the anchors have to mean "line" in both uses.
DECL = re.compile(r"^(\s*)(--[A-Za-z0-9_-]+)\s*:([^;]*);\s*$", re.M)
# js/panels.js writes these by name rather than through var(), so a textual
# var() sweep cannot see them. They are the person's own panel sizes.
JS_WRITTEN = re.compile(r"""["'](--[A-Za-z0-9_-]+)["']""")


def used_tokens() -> set[str]:
    """Every token named outside the sheet: in var(), or by JS as a string."""
    seeds: set[str] = set()
    for path in CONSUMERS:
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        seeds.update(VAR_USE.findall(text))
        if path.suffix == ".js":
            seeds.update(JS_WRITTEN.findall(text))
    return seeds


def reachable(source: str, seeds: set[str]) -> set[str]:
    """Seeds, plus every token reached transitively through token values."""
    refs: dict[str, set[str]] = {}
    for _, name, value in DECL.findall(source):
        refs.setdefault(name, set()).update(VAR_USE.findall(value))

    defined = set(refs)
    keep = {s for s in seeds if s in defined}
    frontier = list(keep)
    while frontier:
        for ref in refs.get(frontier.pop(), ()):
            if ref in defined and ref not in keep:
                keep.add(ref)
                frontier.append(ref)
    return keep


def prune(source: str, keep: set[str]) -> str:
    """Drop declaration lines for tokens nothing reaches.

    Only whole single-line declarations are removed. Everything else - the
    @layer wrapper, selectors, media queries, comments, and any multi-line or
    non-token rule - is passed through untouched, so the output stays a valid
    sheet without this script needing to understand CSS.
    """
    out, dropped = [], 0
    cut = BASE_STYLES.search(source)
    if cut is None:
        raise SystemExit("no 'Base element styles' banner in the vendored sheet - "
                         "has the kit's layout changed?")
    source = source[:cut.start()].rstrip("\n") + "\n"
    for line in source.splitlines(keepends=True):
        match = DECL.match(line.rstrip("\n"))
        if match and match.group(2) not in keep:
            dropped += 1
            continue
        out.append(line)

    text = "".join(out)
    # A block emptied of every declaration is a selector with nothing in it.
    text = re.sub(r"\n[^\n{}]+\{\s*\}\n", "\n", text)
    header = (
        "/* GENERATED by tools/gen_tokens_subset.py - do not edit.\n"
        " *\n"
        f" * The Sarib token sheet, pruned to the {len(keep)} tokens this app can\n"
        f" * actually reach. {dropped} unreachable declarations and the kit's\n"
        " * drop-in base element styles removed. The full vendored sheet is\n"
        " * vendor/sarib-tokens.css; re-vendor it from sarib-design/tokens.css\n"
        " * and run the generator - never edit this file.\n"
        " */\n"
    )
    # Replace the kit's own header comment with ours.
    text = re.sub(r"\A/\*.*?\*/\n", header, text, count=1, flags=re.S)
    return text


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if not SOURCE.exists():
        print(f"{SOURCE.relative_to(ROOT)} missing - vendor the full sheet there first",
              file=sys.stderr)
        return 2

    source = SOURCE.read_text(encoding="utf-8")
    keep = reachable(source, used_tokens())
    built = prune(source, keep)

    if "--check" in argv:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if current != built:
            print("web/sarib-tokens.css is stale - run tools/gen_tokens_subset.py",
                  file=sys.stderr)
            return 1
        print(f"token sheet is current ({len(keep)} tokens)")
        return 0

    OUT.write_text(built, encoding="utf-8", newline="\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(keep)} tokens kept, "
          f"{len(source.encode()) - len(built.encode())} bytes removed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
