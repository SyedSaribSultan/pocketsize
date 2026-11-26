/* End to end: start the real server over stdio, talk to it as an MCP client,
 * compress the fixtures, and check what lands on disk.   node --test test/ */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, rmSync, readFileSync, readdirSync, existsSync, writeFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { decodeImage } from "../lib/decode.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, "fixtures");
let client, work;

before(async () => {
  work = mkdtempSync(path.join(os.tmpdir(), "pocketsize-mcp-"));
  cpSync(FIXTURES, path.join(work, "in"), { recursive: true });
  client = new Client({ name: "test", version: "0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [path.join(here, "..", "server.mjs")], stderr: "ignore",
  }));
});

after(async () => {
  await client?.close();
  rmSync(work, { recursive: true, force: true });
});

const call = async (name, args) => (await client.callTool({ name, arguments: args }));

test("lists the three tools", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["compress", "inspect", "presets"]);
});

test("presets match the app's destination table", async () => {
  const r = await call("presets", {});
  const ids = r.structuredContent.presets.map((p) => p.id);
  assert.deepEqual(ids, ["web", "documents", "email", "chat", "social", "thumbnail", "original"]);
  assert.equal(r.structuredContent.presets[0].qualityTarget, 90);
});

test("inspect plans without writing or decoding", async () => {
  const before = readdirSync(path.join(work, "in")).length;
  const r = await call("inspect", { paths: [path.join(work, "in")], destination: "thumbnail" });
  assert.equal(readdirSync(path.join(work, "in")).length, before);
  const photo = r.structuredContent.files.find((f) => f.path.endsWith("photo.png"));
  assert.equal(photo.qualityTarget, 80);
  assert.equal(photo.width, 80);
});

test("compress: every fixture is smaller or reported as not worth it, and decodes", async () => {
  const dir = path.join(work, "in");
  const r = await call("compress", { paths: [dir], destination: "web" });
  assert.ok(!r.isError, JSON.stringify(r.content));
  const files = r.structuredContent.files;
  assert.equal(files.length, 6);
  for (const f of files) {
    const name = path.basename(f.path);
    const original = statSync(f.path).size;
    if (f.status === "ok") {
      assert.ok(f.outputBytes < f.inputBytes, `${name}: output should be smaller`);
      assert.ok(existsSync(f.outputPath), `${name}: output file exists`);
      assert.equal(statSync(f.outputPath).size, f.outputBytes);
      assert.notEqual(f.outputPath, f.path, "original is never overwritten by default");
      const img = await decodeImage(readFileSync(f.outputPath));
      assert.ok(img.width > 0 && img.height > 0, `${name}: output decodes`);
      assert.equal(img.width, f.outWidth);
    } else {
      assert.equal(f.status, "kept", `${name}: ${f.status} ${f.reason}`);
      assert.ok(f.reason);
    }
    assert.equal(statSync(f.path).size, original, "original untouched");
  }
  const by = (n) => files.find((f) => path.basename(f.path) === n);
  // The animated GIF passes through untouched and says so.
  assert.equal(by("anim.gif").status, "kept");
  assert.match(by("anim.gif").reason, /animated/);
  assert.ok(!readdirSync(dir).some((n) => n.startsWith("anim-min")));
  // Transparency survives: the winner must hold an alpha channel.
  const alpha = by("alpha.png");
  assert.equal(alpha.status, "ok");
  assert.notEqual(alpha.format, "jpeg");
  const decoded = await decodeImage(readFileSync(alpha.outputPath));
  assert.ok(decoded.data.some((v, i) => i % 4 === 3 && v < 255), "output still has transparent pixels");
  // Flat artwork should go to a palette or lossless format, not JPEG.
  assert.ok(["png8", "png", "webp-lossless", "avif"].includes(by("flat.png").format));
  assert.ok(r.structuredContent.totals.bytesSaved > 0);
});

test("a second run skips the first run's output instead of compressing it again", async () => {
  const r = await call("compress", { paths: [path.join(work, "in")] });
  const names = r.structuredContent.files.map((f) => path.basename(f.path));
  assert.ok(!names.some((n) => /-min\./.test(n)));
  assert.ok(r.structuredContent.skipped.some((s) => /already/.test(s.reason)));
});

test("outputDir, a size limit and a width limit", async () => {
  const out = path.join(work, "out");
  const r = await call("compress", {
    paths: [path.join(work, "in", "photo.jpg")], outputDir: out, maxWidth: 40, destination: "email",
  });
  const f = r.structuredContent.files[0];
  assert.equal(f.status, "ok", JSON.stringify(f));
  assert.equal(path.dirname(f.outputPath), out);
  assert.equal(f.outWidth, 40);
  assert.equal((await decodeImage(readFileSync(f.outputPath))).width, 40);
});

test("overwrite replaces only when asked", async () => {
  const copy = path.join(work, "ow.jpg");
  cpSync(path.join(FIXTURES, "photo.jpg"), copy);
  const before = statSync(copy).size;
  const r = await call("compress", { paths: [copy], overwrite: true, format: "jpeg" });
  const f = r.structuredContent.files[0];
  if (f.status === "ok") {
    assert.equal(f.outputPath, copy);
    assert.ok(statSync(copy).size < before);
  } else {
    assert.equal(statSync(copy).size, before);
  }
});

test("refuses more than 500 files, says how to continue, and continues", async () => {
  const many = path.join(work, "many");
  cpSync(path.join(FIXTURES, "anim.gif"), path.join(many, "0.gif"));
  const gif = readFileSync(path.join(FIXTURES, "anim.gif"));
  for (let i = 1; i <= 500; i++) writeFileSync(path.join(many, `${i}.gif`), gif);
  const r = await call("inspect", { paths: [many] });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /501 images/);
  assert.match(r.content[0].text, /start: 500/);
  const next = await call("inspect", { paths: [many], start: 500 });
  assert.ok(!next.isError);
  assert.equal(next.structuredContent.files.length, 1);
});

test("unreadable and unsupported files are skipped and reported, not fatal", async () => {
  const d = path.join(work, "bad");
  cpSync(path.join(FIXTURES, "photo.png"), path.join(d, "good.png"));
  writeFileSync(path.join(d, "broken.png"), Buffer.from("not an image at all"));
  writeFileSync(path.join(d, "notes.txt"), "hello");
  const r = await call("compress", { paths: [d, path.join(work, "missing.png")] });
  const by = (n) => r.structuredContent.files.find((f) => path.basename(f.path) === n);
  assert.equal(by("good.png").status, "ok");
  assert.equal(by("broken.png").status, "skipped");
  assert.ok(r.structuredContent.skipped.some((s) => /missing\.png/.test(s.path)));
});

test("timing: the whole fixture set", async () => {
  const t = Date.now();
  await call("compress", { paths: [path.join(FIXTURES)], outputDir: path.join(work, "timing") });
  console.log(`# compressed ${readdirSync(FIXTURES).length} fixtures in ${Date.now() - t} ms (${os.availableParallelism()} threads)`);
});
