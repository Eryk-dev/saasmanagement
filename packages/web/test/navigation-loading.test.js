import test from "node:test";
import assert from "node:assert/strict";
import { activateNavigation, beginPageRequest, createNavigationLoad } from "../src/lib/navigation-loading.js";

function clock() {
  let now = 0, id = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimer(fn, ms) { timers.set(++id, { fn, at: now + ms }); return id; },
    clearTimer(id) { timers.delete(id); },
    tick(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].fn();
      }
      now = end;
    },
  };
}

test("reveals only after all initial reads, including chained reads, have settled", () => {
  const time = clock(), load = createNavigationLoad(time), stop = activateNavigation(load);
  const first = beginPageRequest("GET"), slow = beginPageRequest("GET");
  time.tick(200); first(); time.tick(500);
  assert.equal(load.getSnapshot().ready, false);
  slow(); time.tick(50);
  const chained = beginPageRequest("GET");
  time.tick(100); assert.equal(load.getSnapshot().ready, false);
  chained(); time.tick(79); assert.equal(load.getSnapshot().ready, false);
  time.tick(1); assert.equal(load.getSnapshot().ready, true);
  stop();
});

test("writes never block navigation and background reads never reopen it", () => {
  const time = clock(), load = createNavigationLoad(time), stop = activateNavigation(load);
  beginPageRequest("POST"); time.tick(180);
  assert.equal(load.getSnapshot().ready, true);
  const finish = beginPageRequest("GET"); time.tick(15000); finish();
  assert.deepEqual(load.getSnapshot(), { ready: true, slow: false }); stop();
});

test("old navigation completions cannot release a new page or a restarted effect", () => {
  const time = clock(), first = createNavigationLoad(time), second = createNavigationLoad(time);
  const stopFirst = activateNavigation(first), finishOld = beginPageRequest("GET");
  const stopSecond = activateNavigation(second); stopFirst();
  const finishNew = beginPageRequest("GET"); finishOld(); time.tick(1000);
  assert.equal(second.getSnapshot().ready, false);
  stopSecond(); activateNavigation(second);
  const finishRestarted = beginPageRequest("GET"); finishNew(); time.tick(1000);
  assert.equal(second.getSnapshot().ready, false);
  finishRestarted(); time.tick(80); assert.equal(second.getSnapshot().ready, true); stopSecond();
});

test("slow reads keep loading until the user chooses to see partial content", () => {
  const time = clock(), load = createNavigationLoad(time), stop = activateNavigation(load);
  const finish = beginPageRequest("GET"); time.tick(12000);
  assert.deepEqual(load.getSnapshot(), { ready: false, slow: true });
  load.reveal(); finish(); finish(); time.tick(100);
  assert.deepEqual(load.getSnapshot(), { ready: true, slow: false }); stop();
});

test("unmounted pages cancel timers and do not publish stale completions", () => {
  const time = clock(), load = createNavigationLoad(time), stop = activateNavigation(load);
  const finish = beginPageRequest("GET"); let published = 0;
  load.subscribe(() => published++); stop(); finish(); time.tick(20000);
  assert.equal(published, 0);
});

// Exercise the real REST client: headers arriving is not enough; the JSON body
// and all error paths must release the same collector used by React.
test("REST waits for JSON parsing and settles network, HTTP and JSON errors", async () => {
  const { createServer } = await import("vite");
  const server = await createServer({ configFile: false, root: new URL("..", import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "silent" });
  const originalFetch = globalThis.fetch;
  let stop;
  try {
    const { api } = await server.ssrLoadModule("/src/lib/api.js");
    const { createNavigationLoad, activateNavigation } = await server.ssrLoadModule("/src/lib/navigation-loading.js");
    const time = clock(), load = createNavigationLoad(time);
    stop = activateNavigation(load);
    let resolveBody;
    const body = new Promise((resolve) => { resolveBody = resolve; });
    globalThis.fetch = async () => ({ ok: true, status: 200, json: () => body });
    const request = api.bootstrap();
    await new Promise((resolve) => setImmediate(resolve));
    time.tick(1000); assert.equal(load.getSnapshot().ready, false);
    resolveBody({ saas: [] }); await request; time.tick(80);
    assert.equal(load.getSnapshot().ready, true);
    const failures = [
      async () => { throw new Error("offline"); },
      async () => ({ ok: false, status: 401, text: async () => '{"error":"unauthorized"}' }),
      async () => ({ ok: true, status: 200, json: async () => { throw new Error("invalid JSON"); } }),
    ];
    for (const fail of failures) {
      stop(); stop = activateNavigation(load); globalThis.fetch = fail;
      await assert.rejects(api.bootstrap()); time.tick(180);
      assert.equal(load.getSnapshot().ready, true);
    }
  } finally { stop?.(); globalThis.fetch = originalFetch; await server.close(); }
});
