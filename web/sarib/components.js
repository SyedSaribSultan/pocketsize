// Sarib design system: behaviours v2.0.0. ESM, no dependencies.
// Opt-in through data attributes; one set of delegated listeners on document, so
// elements added later work too. Framework apps may skip this file and keep their
// own state, as long as the DOM, ARIA and classes match demo/index.html.
//
//   data-s-open="id"        open a drawer (.s-drawer / .s-sidebar) or a <dialog> by id
//   data-s-close            close the drawer/dialog it sits in (or data-s-close="id")
//   data-s-backdrop="id"    a .s-backdrop that belongs to drawer #id (click closes)
//   data-s-menu             trigger with aria-controls="menuId" (role=menu | role=listbox)
//   data-s-tooltip          on a .s-tip: tap toggles, Esc / outside click closes
//   data-s-tabs             on role=tablist: arrows, Home/End, panels via aria-controls
//   data-s-tree             on role=tree: arrows, Enter/Space, expand/collapse
//   data-s-seg              on a .s-seg group of aria-pressed buttons: single choice
//   data-s-toggle           on a button: flips aria-pressed (chips)
//   data-s-autogrow         on a textarea: grows to --s-field-max-h, marks .s-field[data-grown]
//   toast(message, {tone, action, onAction, duration})
//
// Exit motion waits for the fast duration token; reduced motion makes it 0.

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
const isSidebar = (el) => el.classList.contains("s-sidebar");
const isOpen = (el) =>
  el.tagName === "DIALOG" ? el.open : isSidebar(el) ? el.hasAttribute("data-open") : !el.hasAttribute("inert");
const backdropFor = (el) => doc.querySelector(`[data-s-backdrop="${el.id}"]`);

export function openOverlay(el, trigger = doc.activeElement) {
  if (!el || isOpen(el)) return;
  returnFocus.set(el, trigger);
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

/* ---------- autogrow ---------- */
function grow(ta) {
  const max = parseFloat(getComputedStyle(ta).maxHeight) || Infinity;
  ta.style.height = "auto";
  ta.style.height = `${Math.min(ta.scrollHeight, max)}px`;
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 24;
  const field = ta.closest(".s-field");
  if (field) field.toggleAttribute("data-grown", ta.scrollHeight > lh * 2 + parseFloat(getComputedStyle(ta).paddingTop) * 2 + 1);
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
    if (t.tagName === "DIALOG" && t.matches("dialog[open]")) { // click on ::backdrop
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
      const dlg = [...doc.querySelectorAll("dialog[open]")].pop();
      if (dlg) { e.preventDefault(); return closeOverlay(dlg); }
      const drawer = [...doc.querySelectorAll(".s-drawer:not([inert]), .s-sidebar[data-open]")].pop();
      if (drawer) return closeOverlay(drawer);
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

  // Native <dialog> Esc goes through "cancel": route it through the exit animation.
  doc.addEventListener("cancel", (e) => { if (e.target.tagName === "DIALOG") { e.preventDefault(); closeOverlay(e.target); } }, true);
  doc.addEventListener("input", (e) => { if (e.target.matches?.("textarea[data-s-autogrow]")) grow(e.target); });

  const setup = () => {
    doc.querySelectorAll("textarea[data-s-autogrow]").forEach(grow);
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
