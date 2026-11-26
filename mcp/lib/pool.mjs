/* A pool of engine threads, one per CPU. Each thread holds its own copy of the
 * browser engine (see engine-worker.mjs) and takes one job at a time. */

import { Worker } from "node:worker_threads";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const WEB_DIR = path.resolve(here, "..", "..", "web");
const PROTOCOL = 1;   // web/worker.js stamps the same number; a mismatch fails loudly below

export class Pool {
  constructor({ size = Math.max(1, os.availableParallelism?.() ?? os.cpus().length), timeoutMs = 300_000 } = {}) {
    this.size = size;
    this.timeoutMs = timeoutMs;
    this.idle = [];
    this.waiting = [];
    this.live = new Set();
    this.nextId = 1;
  }

  _spawn() {
    const w = new Worker(path.join(here, "engine-worker.mjs"), {
      workerData: { webDir: WEB_DIR },
      stdout: false, stderr: false,
    });
    w.ready = new Promise((resolve, reject) => {
      w.once("message", (m) => (m.type === "ready" ? resolve() : reject(new Error("bad hello"))));
      w.once("error", reject);
    });
    w.on("error", () => {});
    this.live.add(w);
    return w;
  }

  async _acquire() {
    if (this.idle.length) return this.idle.pop();
    if (this.live.size < this.size) {
      const w = this._spawn();
      await w.ready;
      return w;
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  _release(w) {
    const next = this.waiting.shift();
    if (next) next(w); else this.idle.push(w);
  }

  _discard(w) {
    this.live.delete(w);
    w.terminate();
    // Someone may be queued for a slot this worker held.
    const next = this.waiting.shift();
    if (next) {
      const fresh = this._spawn();
      fresh.ready.then(() => next(fresh));
    }
  }

  /** Run one job through the engine. Resolves to the engine's final message. */
  async run({ name, bytes, mime, settings }) {
    const w = await this._acquire();
    const id = this.nextId++;
    const buffer = new Uint8Array(bytes).buffer;   // a copy: the thread takes ownership
    return new Promise((resolve) => {
      let timer;
      const finish = (msg, broken) => {
        clearTimeout(timer);
        w.off("message", onMsg);
        w.off("error", onErr);
        w.off("exit", onExit);
        if (broken) this._discard(w); else this._release(w);
        resolve(msg);
      };
      const onMsg = (m) => {
        if (m.id !== id) return;
        if (m.type === "done" || m.type === "failed" || m.type === "aborted") finish(m, false);
      };
      const onErr = (e) => finish({ type: "failed", error: String(e && e.message || e) }, true);
      const onExit = () => finish({ type: "failed", error: "engine thread stopped unexpectedly" }, true);
      w.on("message", onMsg);
      w.on("error", onErr);
      w.on("exit", onExit);
      timer = setTimeout(
        () => finish({ type: "failed", error: `took longer than ${Math.round(this.timeoutMs / 1000)} s, gave up` }, true),
        this.timeoutMs);
      w.postMessage({ type: "job", id, rev: 0, protocol: PROTOCOL, name, mime, buffer, settings }, [buffer]);
    });
  }

  async close() {
    await Promise.all([...this.live].map((w) => w.terminate()));
    this.live.clear();
    this.idle.length = 0;
  }
}
