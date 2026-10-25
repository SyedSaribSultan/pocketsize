/* Rendering the queue.
 *
 * Rows are reconciled by id rather than rebuilt. A batch re-renders on almost
 * every worker message, and replacing the list's innerHTML each time would throw
 * away focus, the scroll position and the selection ring several times a second -
 * which is exactly what it used to do.
 *
 * This module renders and nothing else. It attaches no handlers; main.js listens
 * once on the container and reads the row's data-id. That is what keeps a
 * renderer that runs constantly from accumulating listeners.
 */

import { $, setText, show } from "./dom.js";
import { state, isReady, isBusy, totals } from "./state.js";
import { human, fmtLabel } from "./format.js";
import { takeDirtyItems } from "./render.js";

/* id -> { el, and the children paintRow writes to }.
 *
 * The children are resolved once, when the row is built, rather than looked up
 * on every paint. paintRow ran seven querySelectors per row per frame, and a
 * batch repaints on nearly every worker message: at two hundred rows that was
 * about fourteen hundred selector matches a frame, all of them re-finding
 * elements that had not moved since the row was created. */
const rows = new Map();

/** The second line of a row: what happened, or what is happening. */
function subLine(it) {
  switch (it.status) {
    case "queued":
      return { text: it.stale ? "updating to your new settings…" : "waiting", tone: "" };
    case "working":
      return {
        text: it.stale ? "updating to your new settings…" : (it.progress || "working…"),
        tone: "",
      };
    case "failed":
      return { text: it.error || "failed", tone: "bad" };
    case "cancelled":
      return { text: "stopped", tone: "" };
    default: {
      const pct = it.originalBytes
        ? Math.round((1 - it.newBytes / it.originalBytes) * 100) : 0;
      const saved = pct > 0 ? `−${pct}%` : "no smaller";
      /* Pixels removed is said on the same line as the %, always. */
      const shrunk = it.outW && (it.outW !== it.width || it.outH !== it.height)
        ? " · shrunk" : "";
      const kept = it.status === "saved" ? " · downloaded" : "";
      return {
        text: `${human(it.originalBytes)} → ${fmtLabel(it.fmt)} · ${saved}${shrunk}${kept}`,
        tone: pct > 0 ? "good" : "",
        /* Only the delta carries the status colour; the whole line never
           turns green. */
        delta: pct > 0 ? saved : "",
      };
    }
  }
}

/* A row is a <div role="option">, not a <button>: it carries its own hover
 * actions (remove, retry), and a button inside a button is invalid HTML the
 * parser dismantles. The list container owns focus and the arrow keys, which
 * is the listbox pattern's one-tab-stop shape anyway.
 *
 * It is the system's large list row (s-row s-row--lg): a 40px thumbnail, the
 * name over what happened to it, then the weight now - with the row's own
 * actions (ghost icon buttons) taking that place while the row has the
 * pointer or focus. */
function makeRow(it) {
  const el = document.createElement("div");
  el.className = "s-row s-row--lg s-row--interactive";
  el.dataset.id = it.id;
  el.setAttribute("role", "option");
  el.innerHTML =
    '<img class="s-row__thumb s-skeleton" alt="" decoding="async">' +
    '<span class="s-row__text">' +
    '<span class="s-row__title name"><span class="name-head"></span><span class="name-tail"></span></span>' +
    '<span class="s-row__sub"></span>' +
    '<span class="s-progress__track row-track" hidden><span class="s-progress__bar"></span></span>' +
    '</span>' +
    '<span class="row-end">' +
    '<span class="s-row__meta now"></span>' +
    '<span class="s-row__actions row-acts">' +
    '<button type="button" class="s-btn s-btn--ghost s-btn--sm s-btn--icon row-act retry" title="Try this one again" aria-label="Try this one again" hidden>' +
    '<span class="s-icon" data-icon="retry" aria-hidden="true"></span></button>' +
    '<button type="button" class="s-btn s-btn--ghost s-btn--sm s-btn--icon row-act rm" title="Remove this one" aria-label="Remove this one">' +
    '<span class="s-icon" data-icon="x" aria-hidden="true"></span></button>' +
    '</span></span>';
  /* Resolved once. Everything paintRow touches is found here and never looked
     up again for the life of the row. */
  return {
    el,
    thumb: el.querySelector(".s-row__thumb"),
    head: el.querySelector(".name-head"),
    tail: el.querySelector(".name-tail"),
    retry: el.querySelector(".retry"),
    now: el.querySelector(".now"),
    sub: el.querySelector(".s-row__sub"),
    track: el.querySelector(".row-track"),
    bar: el.querySelector(".row-track > .s-progress__bar"),
    subKey: "",
  };
}

/* The second line, written only when it changed. A saving is said in the
   line's own colour with the delta alone in the success colour; a failure is
   the whole line in the critical colour, because the whole line is the
   failure. */
function paintSub(row, { text, tone, delta }) {
  const key = `${tone}|${text}`;
  if (row.subKey === key) return;
  row.subKey = key;
  const cls = tone === "bad" ? "s-row__sub s-delta-bad" : "s-row__sub";
  if (row.sub.className !== cls) row.sub.className = cls;
  const at = delta ? text.indexOf(delta) : -1;
  if (tone === "good" && at >= 0) {
    const d = document.createElement("span");
    d.className = "s-delta-good";
    d.textContent = delta;
    row.sub.replaceChildren(text.slice(0, at), d, text.slice(at + delta.length));
  } else {
    row.sub.textContent = text;
  }
}

/* End-ellipsis hides exactly the part of an export name that distinguishes it
 * from its siblings, so the tail survives: the last few characters and the
 * extension stay visible while the middle gives way. The full name rides the
 * row's title for anyone who wants all of it. */
function paintName(row, name) {
  const TAIL = 10;
  setText(row.head, name.length > TAIL ? name.slice(0, -TAIL) : "");
  setText(row.tail, name.length > TAIL ? name.slice(-TAIL) : name);
}

function paintRow(row, it) {
  const el = row.el;
  if (it.thumbURL && row.thumb.getAttribute("src") !== it.thumbURL) {
    row.thumb.src = it.thumbURL;
    // Decoded: the skeleton's pulse has said "coming" for long enough.
    row.thumb.classList.remove("s-skeleton");
  }
  paintName(row, it.name);
  if (el.title !== it.name) el.title = it.name;

  show(row.retry, it.status === "failed");
  setText(row.now, isReady(it) ? human(it.newBytes) : "");

  const sub = subLine(it);
  const { text } = sub;
  paintSub(row, sub);

  /* Progress is only drawn while there is progress to draw. A track sitting at
     zero on a finished row reads as a job that never started. */
  const busy = it.status === "working";
  show(row.track, busy);
  if (busy) row.bar.style.setProperty("--s-value", `${((it.frac || 0) * 100).toFixed(1)}%`);

  /* Status and chosen format as data attributes as well as words. Anything that
     needs to know what state a row is in - a stylesheet, the browser harness -
     reads these rather than parsing the sentence, which is display text and free
     to be reworded. */
  if (el.dataset.status !== it.status) el.dataset.status = it.status;
  const fmt = it.fmt || "";
  if (el.dataset.format !== fmt) el.dataset.format = fmt;
  const selected = String(state.selected === it.id);
  if (el.getAttribute("aria-selected") !== selected) {
    el.setAttribute("aria-selected", selected);
  }
  /* The row's whole accessible name, so a screen reader gets the file and its
     result in one read rather than four unlabelled fragments. Guarded like the
     rest: rewriting an unchanged aria-label is not free, and on some screen
     readers it re-announces the row. */
  const label = `${it.name}. ${text}`;
  if (el.getAttribute("aria-label") !== label) {
    el.setAttribute("aria-label", label);
  }
}

export function renderQueue() {
  const list = $("queue-list");
  const any = state.items.length > 0;

  show($("queue-empty"), !any);
  show(list, any);
  show($("queue-hint"), any);
  show($("queue-foot"), any);
  show($("clear-btn"), any);
  setText($("queue-count"), String(state.items.length));

  // Drop the rows whose items are gone, so a cleared queue leaves no orphans.
  for (const [id, row] of rows) {
    if (!state.byId.has(id)) { row.el.remove(); rows.delete(id); }
  }

  /* Which rows actually changed, or null for all of them. The ordering pass
     below still walks every item on every render - it is one property read and
     a comparison per row, and it is what keeps the DOM in the model's order -
     but paintRow, which is fifteen or so DOM operations, runs only where
     something moved. */
  const only = takeDirtyItems();

  let prev = null;
  for (const it of state.items) {
    let row = rows.get(it.id);
    if (!row) {
      row = makeRow(it);
      rows.set(it.id, row);
      paintRow(row, it);          // a new row is dirty by definition
    } else if (!only || only.has(it.id)) {
      paintRow(row, it);
    }
    // Keep the DOM order equal to the model order without touching rows that are
    // already in the right place.
    const shouldFollow = prev ? prev.nextElementSibling : list.firstElementChild;
    if (shouldFollow !== row.el) list.insertBefore(row.el, shouldFollow || null);
    prev = row.el;
  }

  renderBatch();
  renderFoot();
}

/* Progress across the whole run, as a hairline under the bar. Each image
   contributes its own fraction, so the line advances smoothly through a batch
   rather than jumping once per completed file. */
function renderBatch() {
  const n = state.items.length;
  if (!n) {
    $("batch-bar").style.setProperty("--s-value", "0%");
    $("batch").setAttribute("aria-valuenow", "0");
    return;
  }
  let done = 0;
  for (const it of state.items) {
    if (isReady(it) || it.status === "failed" || it.status === "cancelled") done += 1;
    else if (it.status === "working") done += it.frac || 0;
  }
  const frac = done / n;
  $("batch-bar").style.setProperty("--s-value", `${(frac * 100).toFixed(1)}%`);
  $("batch").setAttribute("aria-valuenow", String(Math.round(frac * 100)));
  // A finished run has nothing left to report, so the line goes away rather than
  // sitting full across the page as a permanent 100%.
  $("batch").style.opacity = state.items.some(isBusy) ? "1" : "0";
}

function renderFoot() {
  const t = totals();
  /* Totals over the images that actually have a result. A failed image contributes
     nothing to either side - counting its original in "before" and nothing in
     "after" would report a saving that never happened.

     The saving leads with the percentage, because that is the unit people
     reason in; the megabytes ride along as the receipt. */
  const pct = t.before ? Math.round((t.saved / t.before) * 100) : 0;
  setText($("t-sizes"), t.ready ? `${human(t.before)} → ${human(t.after)}` : "");
  setText($("t-saved"), t.saved ? `−${pct}% · ${human(t.saved)} saved` : "");

  const failed = state.items.filter((i) => i.status === "failed").length;
  const working = state.items.filter(isBusy).length;
  const parts = [];
  /* Mid-run, progress is one quantity, not three: "4 of 6 done" answers the
     only question a wait asks. The breakdown returns when the run settles. */
  if (working) parts.push(`${t.ready + failed} of ${state.items.length} done`);
  else if (t.ready) parts.push(`${t.ready} ready`);
  if (failed) parts.push(`${failed} failed`);
  setText($("t-count"), parts.join(" · "));

  const ready = state.items.filter(isReady).length;
  const busy = state.items.some(isBusy);
  const btn = $("save-btn");
  // Present only when it would do something. See the note in index.html.
  show(btn, ready > 0);
  btn.disabled = !ready || busy;
  /* The button says what it will actually produce - the shape AND the size,
     so nobody commits to a download without knowing what it costs. One image
     is a file; several are a zip. The size rides along in both shapes, which
     also keeps this label from reading as a twin of the stage's own plain
     "Download" when there is one picture. */
  /* Two parts, one sentence: on a phone the "how" folds away (still read
     out) and the size stays on the button, so nobody commits to a download
     without seeing what it costs. */
  paintSaveLabel(ready > 1 ? `Download ${ready} as zip · ` : "Download · ", human(t.after));
}

/* The bar's download label: "Download 2 as zip · " then the size, as two
   spans so the narrow layout can fold the first. Rebuilt only when the words
   change. */
function paintSaveLabel(what, size) {
  const el = $("save-label");
  if (el.textContent === what + size) return;
  const w = document.createElement("span");
  w.className = "save-what";
  w.textContent = what;
  el.replaceChildren(w, size);
}
