import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function serviceWorker({ online = true, ok = true } = {}) {
  const handlers = {};
  const writes = [];
  const cacheNames = [];
  const ownPages = new Map([
    ["https://example.test/veil/guide.html", { body: "guide" }],
    ["./index.html", { body: "editor" }],
  ]);
  vm.runInNewContext(await readFile(new URL("../sw.js", import.meta.url), "utf8"), {
    URL, Response,
    self: {
      location: { origin: "https://example.test" },
      registration: { scope: "https://example.test/veil/" },
      addEventListener: (type, handler) => { handlers[type] = handler; },
    },
    caches: {
      // No global match: the worker must consult only its own named cache.
      open: async (name) => {
        cacheNames.push(name);
        return {
          match: async (request) => ownPages.get(request),
          put: async (request) => { writes.push(request); },
        };
      },
    },
    fetch: async () => {
      if (!online) throw new Error("offline");
      return { ok, clone: () => ({ body: "network" }) };
    },
  });
  const request = (url, mode = "navigate") => {
    let response;
    handlers.fetch({ request: { method: "GET", url, mode },
      respondWith: (promise) => { response = promise; } });
    return response;
  };
  return { request, writes, cacheNames };
}

test("offline guide navigation returns the guide from VEIL's own cache", async () => {
  const worker = await serviceWorker({ online: false });
  const response = await worker.request("https://example.test/veil/guide.html?from=help");
  assert.equal(response.body, "guide");
  assert.deepEqual(worker.cacheNames, ["veil-privacy-redactor-v2.0.0"]);
});

test("HTTP failures cannot replace the offline guide and query strings are not cached", async () => {
  const failed = await serviceWorker({ ok: false });
  await failed.request("https://example.test/veil/guide.html");
  assert.deepEqual(failed.writes, []);
  const success = await serviceWorker();
  await success.request("https://example.test/veil/guide.html?from=help");
  assert.deepEqual(success.writes, ["https://example.test/veil/guide.html"]);
});

test("VEIL leaves sibling projects and cross-origin requests alone", async () => {
  const worker = await serviceWorker();
  for (const url of ["https://example.test/mira/", "https://other.test/veil/"]) {
    assert.equal(worker.request(url), undefined);
  }
  assert.deepEqual(worker.cacheNames, []);
});
