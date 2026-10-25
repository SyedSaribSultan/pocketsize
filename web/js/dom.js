/* The two things every module needs from the document, and nothing else.
 *
 * `$` is by id on purpose. Every element this app addresses has one, so there is
 * no query-selector coupling to class names or nesting - a stylesheet can be
 * rewritten from scratch without breaking a single line of behaviour. That is
 * not a hypothetical: it is exactly what just happened to this app.
 */

export const $ = (id) => document.getElementById(id);

export const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Set text only when it changed. Writing the same string back is a layout
 *  invalidation for nothing, and these run on every frame of a batch. */
export function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

/** Show or hide, and say so to assistive tech at the same time. `hidden` is the
 *  single carrier of visibility here - there is no CSS class that also hides
 *  things, so there is no way for the two to disagree. */
export function show(el, on) {
  if (el) el.hidden = !on;
}

/* A transient acknowledgement. Never the only place something is said: a
 * failure also lands on the row it belongs to, and this is the receipt.
 *
 * Three behaviours a bare textContent-and-timer could not give:
 *
 *   Messages QUEUE instead of overwriting. Two toasts a second apart used to
 *   mean the first was never read; now each gets its turn.
 *
 *   The duration follows the length. "Copied" needs two seconds; the zip
 *   receipt with three facts in it needs seven. Reading speed is the clock,
 *   not a constant.
 *
 *   An optional ACTION rides along - `toast("Cleared 6", { label, onAction })`
 *   renders one button - which is what makes undo possible without a dialog.
 */
let toastTimer = null;
const pending = [];

/* The system's toast: a P3 card (s-toast) inside the s-toasts region, which
 * is the live region. One shows at a time - the queue above is what keeps
 * two messages from blurring together. */
function showNext() {
  const region = $("toast");
  if (!region || toastTimer || !pending.length) return;
  const { message, action } = pending.shift();

  const card = document.createElement("div");
  card.className = "s-toast";
  const text = document.createElement("span");
  text.className = "s-toast__text";
  text.textContent = message;
  card.append(text);
  if (action) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "s-btn s-btn--ghost s-btn--sm";
    b.id = "toast-action";
    const label = document.createElement("span");
    label.className = "s-btn__label";
    label.textContent = action.label;
    b.append(label);
    b.addEventListener("click", () => {
      dismiss();
      action.onAction();
    });
    card.append(b);
  }
  region.replaceChildren(card);
  region.dataset.up = "1";

  // ~200ms a word, clamped: never a flash, never a squatter. An actionable
  // toast holds longer, because it is also a control.
  const words = message.trim().split(/\s+/).length;
  const ms = Math.max(2600, Math.min(9000, words * 340 + (action ? 2400 : 0)));
  toastTimer = setTimeout(dismiss, ms);
}

function dismiss() {
  const region = $("toast");
  clearTimeout(toastTimer);
  toastTimer = null;
  if (region) {
    delete region.dataset.up;
    // The system's exit: the card fades on the exit curve, then goes.
    const card = region.firstElementChild;
    if (card) {
      card.dataset.closing = "";
      setTimeout(() => { if (card.parentNode === region && !region.dataset.up) card.remove(); }, 160);
    }
  }
  // The next message waits for the exit, so two reads never blur together.
  setTimeout(showNext, 240);
}

/* The receipt for something the person just DID. It preempts whatever is
 * showing - a click's acknowledgement that queues behind an ambient notice
 * reads as the click not working. */
export function toast(message, action) {
  if (!message) return;
  pending.unshift({ message, action });
  const el = $("toast");
  const wasUp = !!el?.dataset.up;
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  if (el) delete el.dataset.up;
  setTimeout(showNext, wasUp ? 240 : 0);
}

/* A notice nobody asked for - a tip, a capability, an offer. It waits its
 * turn behind anything already showing, because it can. */
export function toastAside(message, action) {
  if (!message) return;
  pending.push({ message, action });
  showNext();
}
