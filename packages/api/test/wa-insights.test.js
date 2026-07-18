// Números do inbox de WhatsApp (waInsights): quem está esperando resposta,
// tempo de resposta e janelas de 24h abertas. As regras que importam: "espera"
// e "janela" são do estado ATUAL (não do período), a rajada do cliente conta
// uma espera só, e o tempo de resposta é MEDIANA (uma conversa esquecida no
// fim de semana não pode virar o retrato do dia a dia).

import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { waInsights } = await import("../src/wa-store.js");

const NOW = new Date("2026-07-18T18:00:00.000Z").getTime();
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();

async function seed(threads) {
  const repo = makeMemRepo();
  for (const [id, t] of Object.entries(threads)) {
    await repo.create("wa_threads", {
      id, phone: id, unread: t.unread || 0, leadId: t.leadId || null,
      createdAt: t.createdAt || hoursAgo(200),
      lastAt: t.msgs[t.msgs.length - 1]?.[1],
    });
    for (const [i, [direction, at]] of t.msgs.entries()) {
      await repo.create("wa_messages", { id: `${id}-${i}`, thread: id, direction, at, text: "x" });
    }
  }
  return repo;
}

test("espera e janela de 24h saem do estado ATUAL da conversa", async () => {
  const repo = await seed({
    // cliente falou por último há 3h: espera resposta e a janela está aberta
    "5541900000001": { msgs: [["in", hoursAgo(5)], ["out", hoursAgo(4)], ["in", hoursAgo(3)]], unread: 2 },
    // respondida: não espera, mas a janela segue aberta (última do cliente há 6h)
    "5541900000002": { msgs: [["in", hoursAgo(6)], ["out", hoursAgo(5)]] },
    // cliente falou há 40h e ninguém respondeu: espera, mas a janela FECHOU
    "5541900000003": { msgs: [["in", hoursAgo(40)]] },
  });
  const r = await waInsights(repo, { days: 30, now: NOW });

  assert.equal(r.awaiting, 2);       // conversas 1 e 3
  assert.equal(r.oldestWaitHours, 40); // a que espera há mais tempo
  assert.equal(r.openWindow, 2);     // conversas 1 e 2 (a 3 passou das 24h)
  assert.equal(r.unread, 2);
  assert.equal(r.threads, 3);
  assert.equal(r.activeThreads, 3);
});

test("tempo de resposta: mediana, e rajada do cliente conta uma espera só", async () => {
  const repo = await seed({
    // 3 mensagens seguidas do cliente e UMA resposta 30 min depois da primeira
    "5541900000001": { msgs: [["in", hoursAgo(10)], ["in", hoursAgo(9.9)], ["in", hoursAgo(9.8)], ["out", hoursAgo(9.5)]] },
    "5541900000002": { msgs: [["in", hoursAgo(8)], ["out", hoursAgo(7)]] },      // 60 min
    "5541900000003": { msgs: [["in", hoursAgo(30)], ["out", hoursAgo(6)]] },     // 24h esquecida
  });
  const r = await waInsights(repo, { days: 30, now: NOW });

  assert.equal(r.replySample, 3);
  assert.equal(r.medianReplyMinutes, 60);  // mediana de 30 · 60 · 1440
  assert.equal(r.awaiting, 0);             // todas respondidas
  assert.equal(r.answeredRate, 100);
});

test("período filtra volume e novas conversas, sem mexer no que está em aberto", async () => {
  const repo = await seed({
    // conversa velha (fora de 7d) que ainda espera resposta
    "5541900000001": { createdAt: hoursAgo(400), msgs: [["in", hoursAgo(300)]] },
    "5541900000002": { createdAt: hoursAgo(50), msgs: [["in", hoursAgo(50)], ["out", hoursAgo(49)]] },
  });
  const r = await waInsights(repo, { days: 7, now: NOW });

  assert.equal(r.days, 7);
  assert.equal(r.activeThreads, 1);   // só a de 50h atrás teve mensagem em 7d
  assert.equal(r.newThreads, 1);
  assert.equal(r.inbound, 1);
  assert.equal(r.outbound, 1);
  assert.equal(r.awaiting, 1);        // a velha continua esperando: estado atual
  assert.equal(r.medianReplyMinutes, 60);
});

test("inbox vazio não quebra e não inventa número", async () => {
  const r = await waInsights(makeMemRepo(), { days: 30, now: NOW });
  assert.equal(r.threads, 0);
  assert.equal(r.awaiting, 0);
  assert.equal(r.medianReplyMinutes, null); // sem amostra é "—" na tela, não zero
  assert.equal(r.oldestWaitHours, null);
  assert.equal(r.answeredRate, null);
});

test("conversa sem lead vinculado entra na contagem própria", async () => {
  const repo = await seed({
    "5541900000001": { leadId: "ld1", msgs: [["in", hoursAgo(2)]] },
    "5541900000002": { msgs: [["in", hoursAgo(2)]] },
  });
  const r = await waInsights(repo, { days: 30, now: NOW });
  assert.equal(r.withLead, 1);
  assert.equal(r.withoutLead, 1);
});
