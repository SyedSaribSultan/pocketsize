/* One worker thread = one copy of the browser engine.
 *
 * web/worker.js is a classic Web Worker script. Here it is run, unmodified, in
 * a worker_threads thread whose globals look enough like a browser worker:
 * importScripts, postMessage/onmessage, fetch for vendor/*.wasm, and the canvas
 * and bitmap classes from canvas.mjs. The file is read from web/ at start-up,
 * so the browser and this server always run the same algorithm.
 */

import { parentPort, workerData } from "node:worker_threads";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { OffscreenCanvas, ImageData, createImageBitmap } from "./canvas.mjs";

const WEB = workerData.webDir;

// stdout belongs to the MCP protocol; nothing in the engine may print there.
if (!process.env.PS_DEBUG) console.log = console.info = console.debug = console.warn = () => {};

globalThis.self = globalThis;
globalThis.onmessage = null;
globalThis.location = { href: "https://localhost/" };   // the codec glue resolves its wasm name against this
globalThis.OffscreenCanvas = OffscreenCanvas;
globalThis.ImageData = ImageData;
globalThis.createImageBitmap = createImageBitmap;

globalThis.importScripts = (...files) => {
  for (const f of files) {
    const file = path.join(WEB, f);
    vm.runInThisContext(readFileSync(file, "utf8"), { filename: file });
  }
};

globalThis.fetch = async (url) => {
  const file = path.join(WEB, String(url));
  try {
    return new Response(readFileSync(file), { headers: { "content-type": "application/wasm" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
};

const FORWARD = new Set(["done", "failed", "aborted"]);
globalThis.postMessage = (msg, transfer) => {
  if (FORWARD.has(msg.type)) parentPort.postMessage(msg, transfer || []);
};

globalThis.importScripts("worker.js");

parentPort.on("message", (m) => globalThis.onmessage({ data: m }));
parentPort.postMessage({ type: "ready" });
