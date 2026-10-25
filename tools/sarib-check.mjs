#!/usr/bin/env node
// VENDORED from sarib-design/scripts/check.mjs (v2.0.0) so CI can run it
// without the sibling repo; re-copy it when sarib-design is re-synced.
// Verify an app's vendored sarib-design copy. Run from the app's test script:
//   node <path>/sarib-design/scripts/check.mjs [app-dir]
// Copy this file into the app (e.g. scripts/sarib-check.mjs) if the sibling repo is not
// available in CI; it has no dependencies and reads only the app.
//
// Fails (exit 1) on:
//   1. integrity: a vendored file is missing or its sha256 differs from sarib-design.lock.json
//   2. restyling: app CSS defines a .s-* selector, a --s-* custom property, or .btn
//      (allowed only via sarib.allow.json entries that carry a written reason)
// Warns on:
//   3. freshness: the lock is older than the sibling sarib-design VERSION (if present)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const LOCK = "sarib-design.lock.json";
const ALLOW = "sarib.allow.json";
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".vercel", ".dart_tool", "coverage", "out", "vendor", "screenshots", "shots"]);
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function walk(dir, out = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.isDirectory()) { if (!SKIP_DIRS.has(d.name)) walk(path.join(dir, d.name), out); }
    else out.push(path.join(dir, d.name));
  }
  return out;
}
const cmpVer = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };

export function check(appDir = ".") {
  const app = path.resolve(appDir);
  const errors = [], warnings = [];
  const lockPath = path.join(app, LOCK);
  if (!fs.existsSync(lockPath)) return { errors: [`no ${LOCK} in ${app} (run sarib-design/scripts/sync.mjs)`], warnings };
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));

  // 1. integrity
  for (const [rel, want] of Object.entries(lock.files)) {
    const p = path.join(app, rel);
    if (!fs.existsSync(p)) { errors.push(`missing vendored file: ${rel}`); continue; }
    const got = sha(fs.readFileSync(p));
    if (got !== want) errors.push(`drift: ${rel} was edited (sha256 ${got.slice(0, 12)} ≠ lock ${want.slice(0, 12)}). Change sarib-design instead, then sync.`);
  }

  // 2. restyling s- classes outside the vendor dirs
  const allow = fs.existsSync(path.join(app, ALLOW)) ? JSON.parse(fs.readFileSync(path.join(app, ALLOW), "utf8")).entries || [] : [];
  for (const a of allow) if (!a.reason || a.reason.trim().length < 12) errors.push(`${ALLOW}: entry for ${a.file} needs a written functional reason`);
  const managed = [lock.target, lock.flutter].filter(Boolean).map((d) => path.join(app, d));
  const cssFiles = walk(app).filter((f) => /\.(css|scss)$/.test(f) && !managed.some((m) => f.startsWith(m + path.sep)));
  const rules = [
    [/(^|[\s,>+~}(])\.s-[\w-]+[^{};]*\{/m, "defines an .s-* selector (restyles a shared component)"],
    [/(^|[;{\s])--s-[\w-]+\s*:/m, "redefines a --s-* token"],
    [/(^|[\s,>+~}(])\.btn(?![\w-])[^{};]*\{/m, "defines .btn (use .s-btn)"],
  ];
  for (const f of cssFiles) {
    const rel = path.relative(app, f).split(path.sep).join("/");
    const css = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [re, msg] of rules) {
      const m = re.exec(css);
      if (!m) continue;
      if (allow.some((a) => a.file === rel && (!a.pattern || m[0].includes(a.pattern)))) continue;
      const line = css.slice(0, m.index).split("\n").length;
      errors.push(`${rel}:${line} ${msg}: ${m[0].trim().slice(0, 60)}`);
    }
  }

  // 3. freshness
  const sibling = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "VERSION");
  if (fs.existsSync(sibling)) {
    const latest = fs.readFileSync(sibling, "utf8").trim();
    if (cmpVer(lock.version, latest) < 0) warnings.push(`vendored v${lock.version} is older than sarib-design v${latest} (run propagate)`);
  }
  return { errors, warnings, lock };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const appDir = process.argv[2] || ".";
  const { errors, warnings, lock } = check(appDir);
  for (const w of warnings) console.warn(`  ! ${w}`);
  if (errors.length) {
    console.error(errors.map((e) => `  ✗ ${e}`).join("\n"));
    console.error(`sarib-design check failed: ${errors.length} problem(s).`);
    process.exit(1);
  }
  console.log(`sarib-design check ok: v${lock.version}, ${Object.keys(lock.files).length} files match the lock, no restyled s- classes.`);
}
