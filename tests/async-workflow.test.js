import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as redaction from "../src/redaction.js";

// Exercise real asynchronous orchestration with deferred decoders, without
// loading OCR models or storing any personal fixture images.
async function appHarness() {
  const source = (await readFile(new URL("../assets/app.js", import.meta.url), "utf8"))
    .replace(/^import\s*\{[\s\S]*?\}\s*from\s*"[^\"]+";/, "")
    .replace(/\ninit\(\);\s*$/, "");
  const context = vm.createContext({
    ...redaction, structuredClone, console, URL,
    location: { href: "https://example.test/veil/" },
    localStorage: { getItem: () => null },
    document: { querySelector: () => ({ hidden: true }) },
    window: { setTimeout: () => 0, clearTimeout() {} },
  });
  vm.runInContext(source + `
    renderAll = renderControls = setScanProgress = showToast = () => {};
    globalThis.app = { state, elements, runScan, loadImageFile, getOcrWorker };
  `, context);
  return { context, ...context.app };
}

test("an obsolete scan cannot clear the busy state or regions of a newer image", async () => {
  const { context, state, runScan } = await appHarness();
  const jobs = [];
  context.faceJob = (source) => new Promise((resolve) => jobs.push({ source, resolve }));
  vm.runInContext("detectFaces = faceJob", context);
  state.detection = { faces: true };
  const first = { width: 100, height: 100 };
  const second = { width: 200, height: 200 };
  state.imageCanvas = first;
  const oldScan = runScan();
  state.scanToken += 1; // A newly decoded image invalidates the previous scan.
  state.imageCanvas = second;
  state.scanning = false;
  const newScan = runScan();
  assert.equal(jobs[0].source, first);
  assert.equal(jobs[1].source, second);
  jobs[0].resolve([{ id: "old", type: "face", rect: { x: 0, y: 0, width: 10, height: 10 } }]);
  await oldScan;
  assert.equal(state.scanning, true);
  assert.equal(state.regions.length, 0);
  jobs[1].resolve([{ id: "new", type: "face", rect: { x: 20, y: 20, width: 10, height: 10 } }]);
  await newScan;
  assert.equal(state.scanning, false);
  assert.equal(state.regions[0].id, "new");
});

test("slow image decoding cannot replace the most recently selected image", async () => {
  const { context, state, loadImageFile } = await appHarness();
  const jobs = [];
  const loaded = [];
  context.decodeJob = () => new Promise((resolve) => jobs.push(resolve));
  context.recordLoad = (source, name) => loaded.push(name);
  vm.runInContext("decodeImage = decodeJob; canvasFromSource = recordLoad", context);
  const first = loadImageFile({ name: "first.png", type: "image/png", size: 10 });
  const second = loadImageFile({ name: "second.png", type: "image/png", size: 10 });
  jobs[1]({ width: 100, height: 100 });
  await second;
  let closed = false;
  jobs[0]({ width: 100, height: 100, close() { closed = true; } });
  await first;
  assert.deepEqual(loaded, ["second.png"]);
  assert.equal(closed, true);
  assert.equal(state.loadToken, 2);
});

test("OCR jobs serialize across image changes and retain captured category settings", async () => {
  const { context, state, runScan } = await appHarness();
  const jobs = [];
  const worker = { recognize: (source) => new Promise((resolve) => jobs.push({ source, resolve })) };
  context.worker = worker;
  vm.runInContext(`
    getOcrWorker = async () => worker;
    createScaledCanvas = (source) => ({ canvas: source, ratio: 1 });
  `, context);
  const firstSource = { width: 100, height: 100 };
  const secondSource = { width: 200, height: 200 };
  state.detection = { emails: true };
  state.imageCanvas = firstSource;
  const oldScan = runScan();
  await new Promise(setImmediate);
  assert.equal(jobs.length, 1);
  state.scanToken += 1;
  state.scanning = false;
  state.imageCanvas = secondSource;
  const newScan = runScan();
  // Changing controls during this job affects only the next scan.
  state.detection.emails = false;
  await new Promise(setImmediate);
  assert.equal(jobs.length, 1);
  jobs[0].resolve({ data: { blocks: [] } });
  await oldScan;
  await new Promise(setImmediate);
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].source, firstSource);
  assert.equal(jobs[1].source, secondSource);
  jobs[1].resolve({ data: { blocks: [{ paragraphs: [{ lines: [{
    text: "alice@example.com", confidence: 90,
    bbox: { x0: 10, y0: 20, x1: 120, y1: 40 },
  }] }] }] } });
  await newScan;
  assert.equal(state.regions[0].type, "email");
  assert.equal(state.ocrScanToken, null);
});

test("service worker activation preserves other apps' offline caches", async () => {
  const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");
  const listeners = {};
  const deleted = [];
  vm.runInNewContext(source, {
    self: { addEventListener: (name, listener) => { listeners[name] = listener; }, clients: { claim() {} } },
    caches: {
      keys: async () => ["veil-privacy-redactor-v1.2.1", "veil-privacy-redactor-v2.0.0", "mira-hrt-v1"],
      delete: async (name) => { deleted.push(name); },
    },
  });
  let activation;
  listeners.activate({ waitUntil: (task) => { activation = task; } });
  await activation;
  assert.deepEqual(deleted, ["veil-privacy-redactor-v1.2.1"]);
});

test("a worker resolving after initialization timeout is terminated and never reused", async () => {
  const { context, state, getOcrWorker } = await appHarness();
  let timeout;
  let deliver;
  let terminated = 0;
  context.window.setTimeout = (callback) => { timeout = callback; return 1; };
  context.window.Tesseract = {
    createWorker: () => new Promise((resolve) => { deliver = resolve; }),
  };
  const pending = getOcrWorker();
  timeout();
  await assert.rejects(pending, /timed out/);
  deliver({ terminate: async () => { terminated += 1; }, setParameters: async () => {} });
  await new Promise(setImmediate);
  assert.equal(terminated, 1);
  assert.equal(state.ocrWorker, null);
  assert.equal(state.ocrWorkerPromise, null);
});

test("OCR parameter initialization failure terminates the worker before retry", async () => {
  const { context, state, getOcrWorker } = await appHarness();
  let terminated = 0;
  context.window.Tesseract = { createWorker: async () => ({
    terminate: async () => { terminated += 1; },
    setParameters: async () => { throw new Error("parameter setup failed"); },
  }) };
  await assert.rejects(getOcrWorker(), /parameter setup failed/);
  assert.equal(terminated, 1);
  assert.equal(state.ocrWorkerPromise, null);
});
