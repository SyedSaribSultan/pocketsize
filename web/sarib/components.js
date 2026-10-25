// Sarib design system: behaviours v2.4.0. ESM, no dependencies.
// Opt-in through data attributes; one set of delegated listeners on document, so
// elements added later work too. Framework apps may skip this file and keep their
// own state, as long as the DOM, ARIA and classes match demo/index.html.
//
//   data-s-open="id"        open a drawer (.s-drawer / .s-sidebar) or a <dialog> by id
//   data-s-close            close the drawer/dialog it sits in (or data-s-close="id")
//   data-s-backdrop="id"    a .s-backdrop that belongs to drawer #id (click closes)
//   data-s-menu             trigger with aria-controls="menuId" (role=menu | role=listbox)
//   data-s-tooltip          on a .s-tip: tap toggles, Esc / outside click closes
//   data-s-tip="Label"      on any control (icon-only buttons, rail items): a label tooltip on hover
//                           and keyboard focus, never clipped (fixed, in <body>). Side: data-s-tip-side
//                           = bottom (default) | top | right | left; rails default to right.
//   data-s-chart-value="75 views" (+ data-s-chart-label="Saturday") on a chart mark (SVG rect,
//                           circle, path): the same float, drawn as .s-chart-tip, above the mark.
//                           Mouse hover, keyboard focus (give marks tabindex="0") or a tap.
//   data-s-tabs             on role=tablist: arrows, Home/End, panels via aria-controls
//   data-s-tree             on role=tree: arrows, Enter/Space, expand/collapse
//   data-s-seg              on a .s-seg group of aria-pressed buttons: single choice
//   data-s-toggle           on a button: flips aria-pressed (chips)
//   data-s-autogrow         on a textarea: grows to --s-field-max-h, marks .s-field[data-grown]
//   toast(message, {tone, action, onAction, duration})
//   data-s-amount           on a .s-amount (v2.4): live grouping, caret kept, figures that scale down
//                           and settle in; data-s-amount-add / -set on quick chips; data-keypad builds
//                           the phone keypad. amount(el) returns { value, set(n), add(n) }; the root
//                           fires "s-amount" with detail { value } (a Number, or null when empty).
//
// Exit motion waits for the fast duration token; reduced motion makes it 0.
//
// v2.3: overlay keys are scoped. Esc, the dialog "cancel" event and backdrop clicks only act on
// drawers and dialogs that this file opened (data-s-open / openOverlay). An app that runs its own
// <dialog> or drawer (React/Preact state) can load this file for tips, menus and toasts without it
// closing that app's overlays.

const doc = document;
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const ms = (name) => {
  const v = getComputedStyle(doc.documentElement).getPropertyValue(name).trim();
  return v.endsWith("ms") ? parseFloat(v) : v.endsWith("s") ? parseFloat(v) * 1000 : 0;
};
const fast = () => ms("--s-motion-duration-fast");
const slow = () => ms("--s-motion-duration-slow");
const byId = (id) => (id ? doc.getElementById(id) : null);

/* ---------- scroll lock (html keeps scrollbar-gutter: stable, so nothing shifts) ---------- */
let locks = 0;
const lock = () => { if (locks++ === 0) doc.documentElement.style.overflow = "hidden"; };
const unlock = () => { if (locks > 0 && --locks === 0) doc.documentElement.style.overflow = ""; };

/* ---------- overlays: drawers and dialogs ---------- */
const returnFocus = new WeakMap();
const managed = new Set(); // overlays opened through openOverlay, newest last
const isSidebar = (el) => el.classList.contains("s-sidebar");
const isOpen = (el) =>
  el.tagName === "DIALOG" ? el.open : isSidebar(el) ? el.hasAttribute("data-open") : !el.hasAttribute("inert");
const backdropFor = (el) => doc.querySelector(`[data-s-backdrop="${el.id}"]`);

export function openOverlay(el, trigger = doc.activeElement) {
  if (!el || isOpen(el)) return;
  returnFocus.set(el, trigger);
  managed.delete(el);
  managed.add(el);
  if (el.tagName === "DIALOG") {
    el.removeAttribute("data-closing");
    el.showModal();
  } else {
    if (isSidebar(el)) el.setAttribute("data-open", "");
    else el.removeAttribute("inert");
    backdropFor(el)?.setAttribute("data-open", "");
    (el.querySelector("[data-s-close]") || el.querySelector(FOCUSABLE))?.focus();
  }
  doc.querySelectorAll(`[data-s-open="${el.id}"]`).forEach((t) => t.setAttribute("aria-expanded", "true"));
  lock();
}

export function closeOverlay(el) {
  if (!el || !isOpen(el)) return;
  managed.delete(el);
  const done = () => {
    unlock();
    const t = returnFocus.get(el);
    if (t && doc.contains(t)) t.focus();
  };
  doc.querySelectorAll(`[data-s-open="${el.id}"]`).forEach((t) => t.setAttribute("aria-expanded", "false"));
  if (el.tagName === "DIALOG") {
    el.setAttribute("data-closing", "");
    const d = el.classList.contains("s-sheet") ? slow() : fast();
    setTimeout(() => { el.close(); el.removeAttribute("data-closing"); done(); }, d);
  } else {
    if (isSidebar(el)) el.removeAttribute("data-open");
    else el.setAttribute("inert", "");
    backdropFor(el)?.removeAttribute("data-open");
    done();
  }
}

/* ---------- menus and listboxes ---------- */
let openMenu = null; // { trigger, menu }
const items = (menu) =>
  [...menu.querySelectorAll('[role="menuitem"],[role="option"],[role="menuitemcheckbox"],[role="menuitemradio"]')].filter(
    (i) => !i.disabled && i.getAttribute("aria-disabled") !== "true",
  );
function focusItem(menu, item) {
  items(menu).forEach((i) => { i.tabIndex = -1; i.removeAttribute("data-active"); });
  if (!item) return;
  item.tabIndex = 0;
  item.setAttribute("data-active", "");
  item.focus();
}
function placeMenu(trigger, menu) {
  menu.style.top = menu.style.bottom = "";
  menu.removeAttribute("data-side");
  const r = menu.getBoundingClientRect();
  if (r.bottom > innerHeight && trigger.getBoundingClientRect().top > r.height) {
    menu.setAttribute("data-side", "top");
    menu.style.top = "auto";
    menu.style.bottom = "calc(100% + var(--s-spacing-3))";
  }
  const r2 = menu.getBoundingClientRect();
  if (r2.right > innerWidth) { menu.style.left = "auto"; menu.style.right = "0"; }
}
function openMenuFor(trigger, focusLast = false) {
  const menu = byId(trigger.getAttribute("aria-controls"));
  if (!menu) return;
  closeMenu(false);
  menu.hidden = false;
  menu.removeAttribute("data-closing");
  trigger.setAttribute("aria-expanded", "true");
  openMenu = { trigger, menu };
  placeMenu(trigger, menu);
  const list = items(menu);
  const selected = list.find((i) => i.getAttribute("aria-selected") === "true");
  focusItem(menu, selected || (focusLast ? list[list.length - 1] : list[0]));
}
function closeMenu(restore = true) {
  if (!openMenu) return;
  const { trigger, menu } = openMenu;
  openMenu = null;
  trigger.setAttribute("aria-expanded", "false");
  menu.setAttribute("data-closing", "");
  setTimeout(() => { if (menu.hasAttribute("data-closing")) { menu.hidden = true; menu.removeAttribute("data-closing"); } }, fast());
  if (restore) trigger.focus();
}
function chooseItem(item) {
  const menu = item.closest('[role="menu"],[role="listbox"]');
  if (menu?.getAttribute("role") === "listbox") {
    items(menu).forEach((i) => i.setAttribute("aria-selected", String(i === item)));
    const trigger = openMenu?.trigger;
    const label = trigger?.querySelector("[data-s-value]");
    if (label) label.textContent = item.querySelector(".s-menu__text")?.firstChild?.textContent?.trim() || item.textContent.trim();
    trigger?.dispatchEvent(new CustomEvent("s-change", { bubbles: true, detail: { value: item.dataset.value ?? item.textContent.trim(), item } }));
  }
  if (item.getAttribute("role") === "menuitemcheckbox") {
    item.setAttribute("aria-checked", String(item.getAttribute("aria-checked") !== "true"));
    return;
  }
  closeMenu();
}
let typeahead = "", typeTimer = 0;
function menuKeys(e, menu) {
  const list = items(menu);
  const i = list.indexOf(doc.activeElement);
  const go = (n) => { e.preventDefault(); focusItem(menu, list[(n + list.length) % list.length]); };
  switch (e.key) {
    case "ArrowDown": return go(i + 1);
    case "ArrowUp": return go(i - 1);
    case "Home": return go(0);
    case "End": return go(list.length - 1);
    case "Escape": e.preventDefault(); return closeMenu();
    case "Tab": return closeMenu(false);
    case "Enter": case " ": if (i >= 0) { e.preventDefault(); chooseItem(list[i]); } return;
  }
  if (e.key.length === 1 && /\S/.test(e.key)) {
    clearTimeout(typeTimer);
    typeahead += e.key.toLowerCase();
    typeTimer = setTimeout(() => (typeahead = ""), 500);
    const hit = list.find((it) => it.textContent.trim().toLowerCase().startsWith(typeahead));
    if (hit) focusItem(menu, hit);
  }
}

/* ---------- tabs ---------- */
function selectTab(tab, focus = true) {
  const list = tab.closest('[role="tablist"]');
  [...list.querySelectorAll('[role="tab"]')].forEach((t) => {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    const panel = byId(t.getAttribute("aria-controls"));
    if (panel) panel.hidden = !on;
  });
  if (focus) tab.focus();
  list.dispatchEvent(new CustomEvent("s-change", { bubbles: true, detail: { tab } }));
}

/* ---------- tree ---------- */
const visibleItems = (tree) =>
  [...tree.querySelectorAll('[role="treeitem"]')].filter((it) => !it.parentElement.closest('[role="treeitem"][aria-expanded="false"]'));
function focusTreeItem(tree, it) {
  tree.querySelectorAll('[role="treeitem"]').forEach((x) => (x.tabIndex = -1));
  it.tabIndex = 0;
  it.focus();
}
function toggleTreeItem(it, open) {
  if (!it.hasAttribute("aria-expanded")) return false;
  const next = open ?? it.getAttribute("aria-expanded") !== "true";
  it.setAttribute("aria-expanded", String(next));
  return true;
}
function selectTreeItem(tree, it) {
  tree.querySelectorAll('[role="treeitem"][aria-selected="true"]').forEach((x) => x.setAttribute("aria-selected", "false"));
  it.setAttribute("aria-selected", "true");
  tree.dispatchEvent(new CustomEvent("s-change", { bubbles: true, detail: { item: it } }));
}
function treeKeys(e, tree, it) {
  const list = visibleItems(tree);
  const i = list.indexOf(it);
  const exp = it.getAttribute("aria-expanded");
  const handled = () => e.preventDefault();
  switch (e.key) {
    case "ArrowDown": handled(); if (list[i + 1]) focusTreeItem(tree, list[i + 1]); break;
    case "ArrowUp": handled(); if (list[i - 1]) focusTreeItem(tree, list[i - 1]); break;
    case "Home": handled(); focusTreeItem(tree, list[0]); break;
    case "End": handled(); focusTreeItem(tree, list[list.length - 1]); break;
    case "ArrowRight":
      handled();
      if (exp === "false") toggleTreeItem(it, true);
      else if (exp === "true") { const c = it.querySelector('[role="treeitem"]'); if (c) focusTreeItem(tree, c); }
      break;
    case "ArrowLeft": {
      handled();
      if (exp === "true") toggleTreeItem(it, false);
      else { const p = it.parentElement.closest('[role="treeitem"]'); if (p) focusTreeItem(tree, p); }
      break;
    }
    case "Enter": case " ": handled(); if (!toggleTreeItem(it)) selectTreeItem(tree, it); else selectTreeItem(tree, it); break;
  }
}

/* ---------- toast ---------- */
let region = null;
function toastRegion() {
  if (region && doc.contains(region)) return region;
  region = doc.querySelector(".s-toasts") || Object.assign(doc.createElement("div"), { className: "s-toasts" });
  if (!region.isConnected) doc.body.append(region);
  return region;
}
const ICONS = { success: "circle-check", warning: "triangle-alert", critical: "circle-alert", info: "info" };
export function toast(message, { tone, action, onAction, duration } = {}) {
  const r = toastRegion();
  const el = doc.createElement("div");
  el.className = `s-toast${tone ? ` s-toast--${tone}` : ""}`;
  el.setAttribute("role", tone === "critical" ? "alert" : "status");
  el.setAttribute("aria-live", tone === "critical" ? "assertive" : "polite");
  if (tone && ICONS[tone]) {
    const icon = doc.createElement("span");
    icon.className = "s-icon";
    icon.dataset.icon = ICONS[tone];
    icon.setAttribute("aria-hidden", "true");
    el.append(icon);
  }
  const text = Object.assign(doc.createElement("span"), { className: "s-toast__text", textContent: message });
  el.append(text);
  if (action) {
    const b = Object.assign(doc.createElement("button"), { type: "button", className: "s-btn s-btn--link-brand s-btn--sm" });
    b.append(Object.assign(doc.createElement("span"), { className: "s-btn__label", textContent: action }));
    b.addEventListener("click", () => { onAction?.(); dismiss(); });
    el.append(b);
  }
  const close = Object.assign(doc.createElement("button"), { type: "button", className: "s-btn s-btn--ghost s-btn--sm s-btn--icon" });
  close.setAttribute("aria-label", "Dismiss");
  close.innerHTML = '<span class="s-icon" data-icon="close" aria-hidden="true"></span>';
  close.addEventListener("click", () => dismiss());
  el.append(close);
  r.append(el);
  while (r.children.length > 3) r.firstElementChild.remove();

  let timer = 0, left = duration ?? (action ? 8000 : 4000), started = Date.now();
  const sticky = tone === "critical" && duration === undefined; // errors never auto-dismiss
  const arm = () => { if (!sticky) { started = Date.now(); timer = setTimeout(dismiss, left); } };
  const pause = () => { clearTimeout(timer); left -= Date.now() - started; };
  el.addEventListener("mouseenter", pause);
  el.addEventListener("focusin", pause);
  el.addEventListener("mouseleave", arm);
  el.addEventListener("focusout", (e) => { if (!el.contains(e.relatedTarget)) arm(); });
  function dismiss() {
    clearTimeout(timer);
    el.setAttribute("data-closing", "");
    setTimeout(() => el.remove(), fast());
  }
  arm();
  return { el, dismiss };
}

/* ---------- label tips: data-s-tip="Label" ----------
   One shared .s-tooltip.s-tooltip--float in <body>, placed with fixed coordinates so a scrolling rail
   or sidebar never clips it. Fine pointers: hover (420ms first, instant while one is showing).
   Keyboard: focus-visible. Leaves on pointer out, blur, Esc, scroll or click. The control keeps its
   accessible name (aria-label is set from the tip when missing), so the tip itself is aria-hidden. */
const TIP = "[data-s-tip], [data-s-chart-value]";
let tipEl = null, tipFor = null, tipTimer = 0, tipWarm = 0;
function floatTip() {
  if (tipEl && doc.contains(tipEl)) return tipEl;
  tipEl = doc.createElement("span");
  tipEl.setAttribute("aria-hidden", "true");
  doc.body.append(tipEl);
  return tipEl;
}
function fillTip(t) {
  const tip = floatTip();
  const chart = t.hasAttribute("data-s-chart-value");
  tip.className = chart ? "s-chart-tip s-chart-tip--float" : "s-tooltip s-tooltip--float";
  tip.textContent = "";
  if (!chart) tip.textContent = t.getAttribute("data-s-tip");
  else {
    const label = t.getAttribute("data-s-chart-label");
    if (label) tip.append(Object.assign(doc.createElement("span"), { className: "s-chart-tip__label", textContent: label }));
    tip.append(Object.assign(doc.createElement("span"), { className: "s-chart-tip__value", textContent: t.getAttribute("data-s-chart-value") }));
  }
}
const px = (name) => parseFloat(getComputedStyle(doc.documentElement).getPropertyValue(name)) || 0;
function placeTip(t) {
  const tip = floatTip();
  const side = t.getAttribute("data-s-tip-side") || (t.closest(".s-sidebar--rail") ? "right" : t.hasAttribute("data-s-chart-value") ? "top" : "bottom");
  const r = t.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight, gap = px("--s-spacing-3"), edge = px("--s-spacing-3");
  let x = side === "right" ? r.right + gap : side === "left" ? r.left - gap - w : r.left + r.width / 2 - w / 2;
  let y = side === "top" ? r.top - gap - h : side === "bottom" ? r.bottom + gap : r.top + r.height / 2 - h / 2;
  if (side === "bottom" && y + h > innerHeight - edge) y = r.top - gap - h;
  if (side === "top" && y < edge) y = r.bottom + gap;
  x = Math.max(edge, Math.min(x, innerWidth - w - edge));
  y = Math.max(edge, Math.min(y, innerHeight - h - edge));
  tip.style.left = `${Math.round(x)}px`;
  tip.style.top = `${Math.round(y)}px`;
  tip.setAttribute("data-side", side);
}
function showTip(t, now = false) {
  clearTimeout(tipTimer);
  const go = () => {
    const tip = floatTip();
    fillTip(t);
    tipFor = t;
    placeTip(t);
    tip.setAttribute("data-open", "");
  };
  now || Date.now() - tipWarm < slow() ? go() : (tipTimer = setTimeout(go, slow()));
}
function hideTip() {
  clearTimeout(tipTimer);
  if (!tipFor) return;
  tipFor = null;
  tipWarm = Date.now();
  tipEl?.removeAttribute("data-open");
}
function nameTips(root = doc) {
  root.querySelectorAll?.("[data-s-tip]:not([aria-label]):not([aria-labelledby])").forEach((t) => {
    if (!t.textContent.trim()) t.setAttribute("aria-label", t.getAttribute("data-s-tip"));
  });
}

/* ---------- autogrow ---------- */
function grow(ta) {
  const max = parseFloat(getComputedStyle(ta).maxHeight) || Infinity;
  ta.style.height = "auto";
  ta.style.height = `${Math.min(ta.scrollHeight, max)}px`;
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 24;
  const field = ta.closest(".s-field");
  if (field) field.toggleAttribute("data-grown", ta.scrollHeight > lh * 2 + parseFloat(getComputedStyle(ta).paddingTop) * 2 + 1);
}

/* ---------- display amount field (v2.4) ---------- */
// The input stays the real value (caret, selection, autofill, screen readers). An aria-hidden figures
// layer draws the same text on top so new digits can settle in and separators can sit back in faint.
const amounts = new WeakMap();
const MINUS = "−";
function amountFmt(root) {
  const locale = root.dataset.locale || doc.documentElement.lang || undefined;
  let group = ",", decimal = ".";
  try {
    for (const p of new Intl.NumberFormat(locale).formatToParts(12345.6)) {
      if (p.type === "group") group = p.value;
      if (p.type === "decimal") decimal = p.value;
    }
  } catch { /* keep the defaults */ }
  let ints;
  try { ints = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }); } catch { ints = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }); }
  const dec = root.dataset.decimals === undefined ? 2 : Math.max(0, parseInt(root.dataset.decimals, 10) || 0);
  return { group, decimal, ints, dec, max: parseInt(root.dataset.maxDigits, 10) || 12, neg: root.hasAttribute("data-allow-negative") };
}
// "Rs 1,250.5" (any paste) -> { neg, int: "1250", frac: "5", point: true }
function amountParse(text, f) {
  let neg = false, int = "", frac = "", point = false;
  for (const ch of text) {
    if ((ch === "-" || ch === MINUS) && f.neg && !int && !point) neg = !neg;
    else if (ch >= "0" && ch <= "9") { if (point) { if (frac.length < f.dec) frac += ch; } else int += ch; }
    else if ((ch === f.decimal || (ch === "." && f.group !== ".")) && f.dec > 0 && !point) point = true;
  }
  int = int.replace(/^0+(?=\d)/, "");
  if (point && !int) int = "0";
  return { neg, int, frac, point };
}
function amountText(p, f) {
  if (!p.int && !p.neg) return "";
  const grouped = p.int ? f.ints.format(BigInt(p.int)) : "";
  return `${p.neg ? "-" : ""}${grouped}${p.point ? f.decimal + p.frac : ""}`;
}
const amountDigits = (p) => p.int + p.frac;
const isSig = (ch, f) => (ch >= "0" && ch <= "9") || ch === "-" || ch === f.decimal;
const significant = (s, f) => [...s].filter((ch) => isSig(ch, f)).length;

function amountRender(st, inserted) {
  const { root, input, figures, f } = st;
  const text = input.value;
  const box = doc.createElement("span");
  box.className = "s-amount__text";
  // The sign shows faint beside the placeholder too (start-aligned), so its reserved room reads as the sign.
  if (root.dataset.tone && (text || !root.classList.contains("s-amount--center"))) {
    const sign = doc.createElement("span");
    sign.className = text ? "s-amount__sign" : "s-amount__sign s-amount__sign--empty";
    sign.textContent = root.dataset.tone === "income" ? "+" : MINUS;
    box.append(sign);
  }
  let digit = 0, frac = false;
  for (const ch of text) {
    const c = doc.createElement("span");
    c.className = "s-amount__ch";
    const isDigit = ch >= "0" && ch <= "9";
    if (ch === f.decimal && f.dec > 0) frac = true;
    if (isDigit) { if (inserted.has(digit)) c.setAttribute("data-new", ""); digit++; }
    if (frac) c.classList.add("s-amount__ch--frac");
    else if (!isDigit && ch !== "-") c.classList.add("s-amount__ch--sep");
    c.textContent = ch === "-" ? MINUS : ch;
    box.append(c);
  }
  figures.replaceChildren(box);
  amountFit(st);
}
function amountFit(st) {
  const { root, input, figures, win } = st;
  const box = figures.firstChild;
  const cs = getComputedStyle(input);
  const size = parseFloat(cs.fontSize) || 1;
  const pad = parseFloat(cs.paddingInlineStart) || 0;
  const sign = box?.querySelector?.(".s-amount__sign")?.offsetWidth || 0;
  const center = root.classList.contains("s-amount--center");
  const need = (box?.offsetWidth || 0) + (center ? sign * 2 : pad) + size * 0.2; // room for the caret
  const min = parseFloat(getComputedStyle(root).getPropertyValue("--s-amount-fit-min")) || 0.4;
  const fit = win.clientWidth > 0 && need > 0 ? Math.max(min, Math.min(1, win.clientWidth / need)) : 1;
  root.style.setProperty("--_fit", String(Math.round(fit * 1000) / 1000));
  root.toggleAttribute("data-overflow", input.scrollWidth > input.clientWidth + 1);
}
function amountCommit(st, p, caretSig, announce = false) {
  const { root, input, f } = st;
  const prev = st.digits;
  const text = amountText(p, f);
  input.value = text;
  st.prev = text;
  // Keep the caret after the same number of significant characters (digits, sign, decimal point).
  if (caretSig !== null && doc.activeElement === input) {
    let i = 0, n = 0;
    while (i < text.length && n < caretSig) { if (isSig(text[i], f)) n++; i++; }
    input.setSelectionRange(i, i);
  }
  // Which digits are new: everything between the unchanged head and the unchanged tail.
  const next = amountDigits(p);
  let a = 0;
  while (a < prev.length && a < next.length && prev[a] === next[a]) a++;
  let b = 0;
  while (b < prev.length - a && b < next.length - a && prev[prev.length - 1 - b] === next[next.length - 1 - b]) b++;
  const inserted = new Set();
  if (st.ready) for (let k = a; k < next.length - b; k++) inserted.add(k);
  st.digits = next;
  const value = p.int ? Number(`${p.neg ? "-" : ""}${p.int}.${p.frac || 0}`) : null;
  root.dataset.value = value === null ? "" : String(value);
  const hidden = root.querySelector("input.s-amount__value");
  if (hidden) hidden.value = root.dataset.value;
  amountRender(st, inserted);
  if (announce) {
    const cur = root.querySelector(".s-amount__currency")?.textContent.trim();
    st.live.textContent = text ? `${cur ? `${cur} ` : ""}${text}` : "Empty";
  }
  root.dispatchEvent(new CustomEvent("s-amount", { bubbles: true, detail: { value, text } }));
}
function amountKeypad(st) {
  const { root, input, f } = st;
  input.setAttribute("inputmode", "none"); // the keypad is the keyboard on phones
  let pad = root.querySelector(".s-amount__keypad");
  if (!pad) {
    pad = doc.createElement("div");
    pad.className = "s-amount__keypad";
    pad.setAttribute("role", "group");
    pad.setAttribute("aria-label", "Keypad");
    const extra = f.dec > 0 ? f.decimal : f.neg ? MINUS : "";
    for (const k of ["1", "2", "3", "4", "5", "6", "7", "8", "9", extra, "0", "back"]) {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "s-amount__key";
      if (k === "back") {
        b.dataset.key = "back";
        b.setAttribute("aria-label", "Delete last digit");
        b.innerHTML = '<span class="s-icon" data-icon="delete" aria-hidden="true"></span>';
      } else if (!k) { b.disabled = true; b.setAttribute("aria-hidden", "true"); b.tabIndex = -1; }
      else { b.dataset.key = k; b.textContent = k; if (k === MINUS) b.setAttribute("aria-label", "Negative"); }
      pad.append(b);
    }
    root.append(pad);
  }
  // Mouse and touch keep the caret in the input; keyboard users can still tab to each key.
  pad.addEventListener("pointerdown", (e) => { if (doc.activeElement === input) e.preventDefault(); });
}
function amountPress(st, key) {
  const { input, f } = st;
  const focused = doc.activeElement === input;
  const v = input.value;
  let start = focused ? input.selectionStart ?? v.length : v.length;
  const end = focused ? input.selectionEnd ?? v.length : v.length;
  let next;
  if (key === "back") {
    if (start === end) { while (start > 0 && !isSig(v[start - 1], f)) start--; start = Math.max(0, start - 1); }
    next = v.slice(0, start) + v.slice(end);
  } else {
    next = v.slice(0, start) + (key === MINUS ? "-" : key) + v.slice(end);
    start += 1;
  }
  const p = amountParse(next, f);
  if (p.int.length > f.max) return;
  amountCommit(st, p, significant(next.slice(0, start), f), true);
}
export function amount(root) {
  if (!root) return null;
  let st = amounts.get(root);
  if (!st) {
    const input = root.querySelector(".s-amount__input");
    const win = root.querySelector(".s-amount__window");
    if (!input || !win) return null;
    const figures = doc.createElement("span");
    figures.className = "s-amount__figures";
    figures.setAttribute("aria-hidden", "true");
    input.after(figures);
    const live = doc.createElement("span");
    live.className = "s-sr-only";
    live.setAttribute("aria-live", "polite");
    root.append(live);
    st = { root, input, win, figures, live, f: amountFmt(root), digits: "", ready: false };
    amounts.set(root, st);
    for (const [k, v] of [["autocomplete", "off"], ["autocorrect", "off"], ["autocapitalize", "off"], ["spellcheck", "false"]]) if (!input.hasAttribute(k)) input.setAttribute(k, v);
    if (!input.hasAttribute("inputmode")) input.setAttribute("inputmode", st.f.dec > 0 ? "decimal" : "numeric");
    if (root.hasAttribute("data-keypad")) amountKeypad(st);
    amountCommit(st, amountParse(input.value, st.f), null);
    st.ready = true;
    root.setAttribute("data-ready", "");
    win.addEventListener("scroll", () => { win.scrollLeft = 0; win.scrollTop = 0; }); // overflow: clip fallback
    if (typeof ResizeObserver === "function") new ResizeObserver(() => amountFit(st)).observe(win);
    doc.fonts?.ready.then(() => amountFit(st));
  }
  const api = {
    get value() { return root.dataset.value === "" ? null : Number(root.dataset.value); },
    set(n) { amountCommit(st, amountParse(n === null || n === undefined ? "" : String(n).replace(".", st.f.decimal), st.f), null); },
    add(n) { const k = 10 ** st.f.dec; api.set(Math.round((Number(root.dataset.value || 0) + Number(n)) * k) / k); },
  };
  return api;
}
function amountInput(input) {
  const root = input.closest("[data-s-amount]");
  if (!root) return;
  const fresh = !amounts.has(root);
  amount(root);
  const st = amounts.get(root);
  if (!st || fresh) return;
  const v = input.value, caret = input.selectionStart ?? v.length;
  const p = amountParse(v, st.f);
  if (p.int.length > st.f.max) { // too many digits: undo the keystroke
    return amountCommit(st, amountParse(st.prev ?? "", st.f), Math.max(0, significant(v.slice(0, caret), st.f) - 1));
  }
  amountCommit(st, p, significant(v.slice(0, caret), st.f));
}

/* ---------- wiring ---------- */
let wired = false;
export function init() {
  if (wired) return;
  wired = true;

  doc.addEventListener("click", (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;

    const opener = t.closest("[data-s-open]");
    if (opener) {
      const el = byId(opener.getAttribute("data-s-open"));
      if (el) { e.preventDefault(); isOpen(el) && el.tagName !== "DIALOG" ? closeOverlay(el) : openOverlay(el, opener); }
      return;
    }
    const closer = t.closest("[data-s-close]");
    if (closer) {
      const el = byId(closer.getAttribute("data-s-close")) || closer.closest("dialog, .s-drawer, .s-sidebar");
      if (el) { e.preventDefault(); closeOverlay(el); }
      return;
    }
    const bd = t.closest("[data-s-backdrop]");
    if (bd) { closeOverlay(byId(bd.getAttribute("data-s-backdrop"))); return; }
    if (t.tagName === "DIALOG" && t.matches("dialog[open]") && managed.has(t)) { // click on ::backdrop
      const r = t.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeOverlay(t);
      return;
    }

    const menuTrigger = t.closest("[data-s-menu]");
    if (menuTrigger) {
      openMenu?.trigger === menuTrigger ? closeMenu() : openMenuFor(menuTrigger);
      return;
    }
    const item = t.closest('[role="menuitem"],[role="option"],[role="menuitemcheckbox"],[role="menuitemradio"]');
    if (item && openMenu?.menu.contains(item)) { chooseItem(item); return; }
    if (openMenu && !openMenu.menu.contains(t)) closeMenu(false);

    const tipBtn = t.closest("[data-s-tooltip] > [aria-describedby]");
    doc.querySelectorAll('[data-s-tooltip] > [aria-expanded="true"]').forEach((b) => { if (b !== tipBtn) b.setAttribute("aria-expanded", "false"); });
    if (tipBtn) tipBtn.setAttribute("aria-expanded", String(tipBtn.getAttribute("aria-expanded") !== "true"));

    const tab = t.closest('[data-s-tabs] [role="tab"]');
    if (tab) { selectTab(tab); return; }

    const seg = t.closest("[data-s-seg] > [aria-pressed]");
    if (seg && !seg.disabled) {
      [...seg.parentElement.children].forEach((b) => b.setAttribute("aria-pressed", String(b === seg)));
      seg.parentElement.dispatchEvent(new CustomEvent("s-change", { bubbles: true, detail: { item: seg } }));
      return;
    }
    const tog = t.closest("[data-s-toggle][aria-pressed]");
    if (tog && !tog.disabled) { tog.setAttribute("aria-pressed", String(tog.getAttribute("aria-pressed") !== "true")); return; }

    const key = t.closest("[data-s-amount] .s-amount__key[data-key]");
    if (key && !key.disabled) { const root = key.closest("[data-s-amount]"); amount(root); amountPress(amounts.get(root), key.dataset.key); return; }
    const quick = t.closest("[data-s-amount] [data-s-amount-add], [data-s-amount] [data-s-amount-set]");
    if (quick && !quick.disabled) {
      const root = quick.closest("[data-s-amount]"), api = amount(root);
      quick.hasAttribute("data-s-amount-set") ? api.set(quick.dataset.sAmountSet) : api.add(quick.dataset.sAmountAdd);
      const st = amounts.get(root);
      st.live.textContent = st.input.value || "Empty";
      return;
    }

    const row = t.closest('[data-s-tree] [role="treeitem"] > .s-tree__row');
    if (row && !t.closest(".s-tree__actions")) {
      const it = row.parentElement, tree = it.closest("[data-s-tree]");
      toggleTreeItem(it);
      selectTreeItem(tree, it);
      focusTreeItem(tree, it);
    }
  });

  doc.addEventListener("keydown", (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (openMenu && openMenu.menu.contains(t)) return menuKeys(e, openMenu.menu);
    const mt = t?.closest("[data-s-menu]");
    if (mt && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); return openMenuFor(mt, e.key === "ArrowUp"); }
    if (e.key === "Escape") {
      const tip = doc.querySelector('[data-s-tooltip] > [aria-expanded="true"]');
      if (tip) { tip.setAttribute("aria-expanded", "false"); return; }
      const top = [...managed].filter((el) => el.isConnected && isOpen(el)).pop();
      if (top) { e.preventDefault(); return closeOverlay(top); }
    }
    const tab = t?.closest('[data-s-tabs] [role="tab"]');
    if (tab) {
      const tabs = [...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]:not(:disabled)')];
      const i = tabs.indexOf(tab);
      const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (to !== undefined) { e.preventDefault(); selectTab(tabs[(to + tabs.length) % tabs.length]); }
      return;
    }
    const it = t?.closest('[data-s-tree] [role="treeitem"]');
    if (it && it === t) treeKeys(e, it.closest("[data-s-tree]"), it);
  });

  // Label tips (data-s-tip).
  doc.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse") return;
    const t = e.target instanceof Element ? e.target.closest(TIP) : null;
    if (t && t !== tipFor && !t.matches(":disabled")) showTip(t, t.hasAttribute("data-s-chart-value"));
    else if (!t) hideTip();
  });
  doc.addEventListener("pointerout", (e) => {
    const t = e.target instanceof Element ? e.target.closest(TIP) : null;
    if (t && !(e.relatedTarget instanceof Element && t.contains(e.relatedTarget))) hideTip();
  });
  doc.addEventListener("focusin", (e) => {
    const t = e.target instanceof Element ? e.target.closest(TIP) : null;
    if (t && t.matches(":focus-visible")) showTip(t, true);
  });
  doc.addEventListener("focusout", hideTip);
  doc.addEventListener("pointerdown", (e) => {
    const mark = e.pointerType !== "mouse" && e.target instanceof Element ? e.target.closest("[data-s-chart-value]") : null;
    if (mark && mark !== tipFor) showTip(mark, true); // touch: a tap shows the value
    else hideTip();
  }, true);
  doc.addEventListener("scroll", hideTip, true);
  doc.addEventListener("keydown", (e) => { if (e.key === "Escape" && tipFor) hideTip(); }, true);
  let naming = false;
  new MutationObserver(() => {
    if (tipFor && !tipFor.isConnected) hideTip();
    if (naming) return;
    naming = true;
    requestAnimationFrame(() => { naming = false; nameTips(); });
  }).observe(doc.documentElement, { subtree: true, childList: true, attributeFilter: ["data-s-tip"] });

  // Native <dialog> Esc goes through "cancel": route it through the exit animation.
  doc.addEventListener("cancel", (e) => { if (e.target.tagName === "DIALOG" && managed.has(e.target)) { e.preventDefault(); closeOverlay(e.target); } }, true);
  doc.addEventListener("input", (e) => {
    if (e.target.matches?.("textarea[data-s-autogrow]")) grow(e.target);
    if (e.target.matches?.("[data-s-amount] .s-amount__input")) amountInput(e.target);
  });
  doc.addEventListener("focusin", (e) => { const r = e.target instanceof Element ? e.target.closest("[data-s-amount]") : null; if (r) amount(r); });

  const setup = () => {
    nameTips();
    doc.querySelectorAll("textarea[data-s-autogrow]").forEach(grow);
    doc.querySelectorAll("[data-s-amount]").forEach((r) => amount(r));
    doc.querySelectorAll("[data-s-tabs]").forEach((list) => {
      const sel = list.querySelector('[role="tab"][aria-selected="true"]') || list.querySelector('[role="tab"]');
      if (sel) selectTab(sel, false);
    });
    doc.querySelectorAll("[data-s-tree]").forEach((tree) => {
      const all = tree.querySelectorAll('[role="treeitem"]');
      all.forEach((x) => (x.tabIndex = -1));
      const first = tree.querySelector('[role="treeitem"][aria-selected="true"]') || all[0];
      if (first) first.tabIndex = 0;
    });
  };
  doc.readyState === "loading" ? doc.addEventListener("DOMContentLoaded", setup) : setup();
}

init();
