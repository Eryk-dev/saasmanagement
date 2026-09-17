// A navigation owns its initial GETs. Once revealed, polling and SSE refreshes
// cannot reopen it. Each completion belongs to the generation that started it.
export function createNavigationLoad({ minimumMs = 180, quietMs = 80, slowMs = 12000,
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let snapshot = { ready: false, slow: false };
  let active = false, generation = 0, deadline = 0, readyTimer, slowTimer;
  const pending = new Set(), listeners = new Set();
  const publish = (next) => { snapshot = next; listeners.forEach((fn) => fn()); };
  const clearTimers = () => { clearTimer(readyTimer); clearTimer(slowTimer); };
  const reveal = () => {
    if (!active || snapshot.ready) return;
    clearTimers();
    publish({ ready: true, slow: false });
  };
  const schedule = () => {
    clearTimer(readyTimer);
    if (active && !snapshot.ready && pending.size === 0) {
      readyTimer = setTimer(reveal, Math.max(quietMs, deadline - now()));
    }
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    start() {
      clearTimers(); pending.clear(); generation++; active = true;
      deadline = now() + minimumMs;
      publish({ ready: false, slow: false });
      slowTimer = setTimer(() => {
        if (active && !snapshot.ready) publish({ ready: false, slow: true });
      }, slowMs);
      schedule();
    },
    begin() {
      if (!active || snapshot.ready) return () => {};
      const request = {}, epoch = generation;
      pending.add(request); clearTimer(readyTimer);
      return () => {
        if (!active || epoch !== generation || !pending.delete(request)) return;
        schedule();
      };
    },
    reveal,
    dispose() { active = false; generation++; pending.clear(); clearTimers(); },
  };
}

let currentLoad;
// Telas carregam sob demanda (React.lazy em app.jsx). O loader do lazy roda no
// RENDER, antes do layout effect que ativa a navegação nova — então o chunk
// não é visto como leitura pendente e o splash revelaria em `minimumMs` com o
// arquivo ainda baixando; os GETs da tela chegariam com `ready` já verdadeiro
// (begin() vira no-op) e a tela entraria vazia. Por isso o chunk SEMPRE entra
// numa fila, drenada pela próxima activateNavigation: é exatamente a
// navegação que aquele render criou, no epoch certo (A→B→C rápido não vaza:
// o chunk de B fica preso ao load de B, que é descartado com ele).
const queuedChunks = [];
export function trackChunk(promise) {
  queuedChunks.push(promise);
  return promise;
}

export function activateNavigation(load) {
  currentLoad = load;
  load.start();
  for (const chunk of queuedChunks.splice(0)) {
    const finish = load.begin();
    chunk.then(finish, finish);
  }
  return () => {
    load.dispose();
    if (currentLoad === load) currentLoad = undefined;
  };
}

export function beginPageRequest(method) {
  return method === "GET" && currentLoad ? currentLoad.begin() : () => {};
}
