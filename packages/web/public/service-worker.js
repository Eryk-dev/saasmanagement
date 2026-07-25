// Service worker MATA-ZUMBI. O cockpit NÃO usa service worker; este arquivo
// existe pra destruir registros deixados por sites que moraram neste domínio
// antes. Um SW zumbi intercepta a navegação e serve um shell VELHO do cache
// pra qualquer caminho, mesmo com o servidor atualizado (25/07: o Leo ficou
// preso num build antigo por causa disso). O zumbi checa a própria URL em
// busca de atualização; ao receber ESTE script, ele se instala, limpa todos
// os caches, se desregistra e recarrega as abas — e morre.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    try { const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k))); } catch { /* segue */ }
    try { await self.registration.unregister(); } catch { /* segue */ }
    try { const cs = await self.clients.matchAll({ type: "window" }); cs.forEach((c) => c.navigate(c.url)); } catch { /* segue */ }
  })());
});
