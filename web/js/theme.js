/* The theme, resolved and applied before first paint.
 *
 * A classic script loaded from <head>, on purpose: a module would be deferred
 * past the first paint, and someone who chose dark would watch the page flash
 * light on every visit. Classic scripts in the head block rendering, which is
 * exactly the property wanted here - the work is two property reads.
 *
 * The token layer (sarib-tokens.css) flips its palette on data-theme="dark"
 * and treats everything else as light. Every visit starts in light, whatever
 * the OS theme; dark is a manual choice from the header button, saved in
 * localStorage. The stamp is always set, so the stylesheet never has an
 * unstamped state to style.
 *
 * The header button that cycles the mode lives in main.js; it calls
 * window.__applyTheme after writing the new mode.
 */

"use strict";

(function () {
  function mode() {
    // The in-memory choice wins: it is what makes the button work for this
    // visit even where storage is refused (private browsing).
    if (typeof window.__themeMode === "string") {
      return window.__themeMode === "dark" ? "dark" : "light";
    }
    try {
      if (localStorage.getItem("imgc-theme") === "dark") return "dark";
    } catch (e) { /* private browsing; fall through to light */ }
    return "light";
  }

  function apply() {
    document.documentElement.dataset.theme = mode();
  }

  apply();

  // The seam main.js drives after the button writes a new mode.
  window.__applyTheme = apply;
})();
