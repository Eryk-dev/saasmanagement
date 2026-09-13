// NPS: o índice, a agenda da pergunta, a entrega e o que a resposta dispara.
import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { npsIndex } from "../src/metrics-core.js";
import { npsDue, npsBucket, askNps, answerNps, waWindowOpen, startNpsAsks, npsAskText, npsLink } from "../src/nps.js";
import { npsPageHtml, npsDoneHtml, npsNotFoundHtml } from "../src/nps-page.js";

const DAY = 86_400_000;
const HOJE = Date.UTC(2026, 8, 13);
const desde = (d) => new Date(HOJE - d * DAY).toISOString();

// ── Índice ────────────────────────────────────────────────────────────────
test("npsIndex: promotores menos detratores, na mesma base", () => {
  // 2 promotores (9,10), 1 neutro (8), 1 detrator (6) → (2−1)/4 = 25
  assert.deepEqual(npsIndex([9, 10, 8, 6]), { index: 25, promoters: 2, passives: 1, detractors: 1, count: 4 });
  assert.equal(npsIndex([10, 10]).index, 100);
  assert.equal(npsIndex([0, 3]).index, -100);
  assert.equal(npsIndex([7, 8]).index, 0);
});

test("npsIndex: sem resposta o índice é null, não zero", () => {
  assert.deepEqual(npsIndex([]), { index: null, promoters: 0, passives: 0, detractors: 0, count: 0 });
  assert.equal(npsIndex(["", null, 42, -1]).index, null); // nota fora de 0-10 não entra
});

test("npsBucket: 9-10 promotor, 7-8 neutro, 0-6 detrator", () => {
  assert.deepEqual([10, 9, 8, 7, 6, 0].map(npsBucket), ["promotor", "promotor", "neutro", "neutro", "detrator", "detrator"]);
  assert.equal(npsBucket(null), "");
});

// ── Agenda ────────────────────────────────────────────────────────────────
test("npsDue: nada antes do mês 1; mês 1, mês 3 e de 90 em 90 depois", () => {
  assert.equal(npsDue({ startedAt: desde(20) }, { now: HOJE }), null);
  assert.equal(npsDue({ startedAt: desde(30) }, { now: HOJE }), "checkin_m1");
  assert.equal(npsDue({ startedAt: desde(95) }, { now: HOJE }), "revisao_m3");
  assert.equal(npsDue({ startedAt: desde(400) }, { now: HOJE }), "ciclo");
  assert.equal(npsDue({}, { now: HOJE }), null);
});

test("npsDue: pedido recente segura a próxima pergunta por 60 dias", () => {
  const c = { startedAt: desde(200) };
  assert.equal(npsDue(c, { now: HOJE, lastAskedAt: desde(10) }), null);
  assert.equal(npsDue(c, { now: HOJE, lastAskedAt: desde(70) }), "ciclo");
});

// ── Entrega ───────────────────────────────────────────────────────────────
function fakeMailer(caixa) {
  return { ready: async () => true, send: async (m) => { caixa.push(m); return { id: "m1" }; } };
}

async function base({ customer = {} } = {}) {
  const repo = makeMemRepo();
  await repo.create("users", { id: "eryk", roles: ["integrator"] });
  const c = await repo.create("customers", {
    id: "cu_1", saas: "leverads", name: "Lupa", contact: "Ana", owner: "eryk",
    startedAt: desde(30), email: "ana@lupa.com.br", phone: "5541999990000", ...customer,
  });
  return { repo, c };
}

test("askNps: manda e-mail, grava o pedido em aberto e monta o link com o token", async () => {
  const caixa = [];
  const { repo, c } = await base();
  const doc = await askNps(repo, c, { baseUrl: "https://levermoney.com.br", mailer: fakeMailer(caixa) });
  assert.equal(doc.status, "asked");
  assert.equal(doc.score, null);
  assert.match(doc.token, /^[0-9a-f]{32}$/);
  assert.equal(doc.channel, "email");
  assert.equal(caixa.length, 1);
  assert.equal(caixa[0].to, "ana@lupa.com.br");
  assert.match(caixa[0].text, new RegExp(`https://levermoney\\.com\\.br/public/nps/${doc.token}`));
  assert.equal((await repo.list("tasks")).length, 0);
});

test("askNps: sem e-mail e fora da janela do WhatsApp vira tarefa do dono", async () => {
  const { repo, c } = await base({ customer: { email: "" } });
  const doc = await askNps(repo, c, { baseUrl: "https://x.com" });
  assert.equal(doc.channel, "task");
  const t = (await repo.list("tasks"))[0];
  assert.equal(t.title, "Pedir o NPS de Lupa");
  assert.deepEqual(t.assignees, ["eryk"]);
  assert.match(t.description, /wa\.me\/5541999990000/);
  assert.match(t.description, /de 0 a 10/);
});

test("askNps: dentro da janela de 24h manda pelo WhatsApp, sem tarefa", async () => {
  const { repo, c } = await base({ customer: { email: "" } });
  await repo.create("wa_threads", { id: "5541999990000", lastDir: "in", lastAt: new Date(HOJE - 3600_000).toISOString() });
  const enviados = [];
  const doc = await askNps(repo, c, {
    baseUrl: "https://x.com",
    whatsapp: { sendText: async (to, text) => { enviados.push({ to, text }); return { messageId: "w1" }; } },
    now: () => new Date(HOJE),
  });
  assert.equal(doc.channel, "whatsapp");
  assert.equal(enviados.length, 1);
  assert.equal((await repo.list("tasks")).length, 0);
});

test("waWindowOpen: só abre com entrada nas últimas 24h", async () => {
  const repo = makeMemRepo();
  await repo.create("wa_threads", { id: "5541999990000", lastDir: "in", lastAt: new Date(HOJE - 25 * 3600_000).toISOString() });
  assert.equal(await waWindowOpen(repo, "5541999990000", { now: HOJE }), false);
  await repo.update("wa_threads", "5541999990000", { lastAt: new Date(HOJE - 2 * 3600_000).toISOString() });
  assert.equal(await waWindowOpen(repo, "5541999990000", { now: HOJE }), true);
  assert.equal(await waWindowOpen(repo, "", { now: HOJE }), false);
});

// ── Resposta ──────────────────────────────────────────────────────────────
test("answerNps: grava a nota e o motivo, e nota até 6 abre tarefa P1 pro dono", async () => {
  const { repo, c } = await base();
  const doc = await askNps(repo, c, { baseUrl: "https://x.com" });
  const saved = await answerNps(repo, doc, { score: 4, reason: "o suporte demora" });
  assert.equal(saved.status, "answered");
  assert.equal(saved.score, 4);
  assert.ok(saved.answeredAt);
  const detrator = (await repo.list("tasks")).find((t) => t.title.startsWith("Ligar pra"));
  assert.equal(detrator.title, "Ligar pra Lupa: nota 4 no NPS");
  assert.equal(detrator.priority, "P1");
  assert.deepEqual(detrator.assignees, ["eryk"]);
  assert.match(detrator.description, /o suporte demora/);
});

test("answerNps: nota de promotor não abre tarefa", async () => {
  const { repo, c } = await base();
  const doc = await askNps(repo, c, { baseUrl: "https://x.com" });
  await answerNps(repo, doc, { score: 10 });
  assert.equal((await repo.list("tasks")).filter((t) => t.title.startsWith("Ligar pra")).length, 0);
});

// ── Runner ────────────────────────────────────────────────────────────────
test("runner: pergunta a quem está na hora, uma vez só, e pula mentoria e churnado", async () => {
  const caixa = [];
  const { repo } = await base();
  await repo.create("customers", { id: "cu_novo", saas: "leverads", startedAt: desde(10), email: "n@x.com" });
  await repo.create("customers", { id: "cu_kids", saas: "uniquekids", startedAt: desde(200), email: "k@x.com" });
  await repo.create("customers", { id: "cu_churn", saas: "leverads", startedAt: desde(200), endedAt: desde(3), email: "c@x.com" });
  const runner = startNpsAsks(repo, { intervalMs: 1e9, mailer: fakeMailer(caixa), baseUrl: "https://x.com", now: () => new Date(HOJE) });
  assert.deepEqual(await runner.tick(new Date(HOJE)), { asked: 1 });
  assert.deepEqual((await repo.list("nps")).map((n) => n.customer), ["cu_1"]);
  assert.deepEqual(await runner.tick(new Date(HOJE)), { asked: 0 }); // a trava de 60 dias segura
  runner.stop();
});

// ── Página ────────────────────────────────────────────────────────────────
test("página: 11 botões, o token embutido e o agradecimento pronto", () => {
  const html = npsPageHtml({ token: "abc", company: "Lupa", contact: "Ana" });
  assert.match(html, /Oi, Ana\./);
  assert.match(html, /de 0 a 10/i);
  assert.match(html, /"token":"abc"/);
  assert.match(html, /__NPS_DONE__/);
  assert.match(html, /noindex/);
  assert.match(npsDoneHtml("Lupa"), /Obrigado/);
  assert.match(npsNotFoundHtml, /não existe/);
});

test("página: nome com HTML não escapa pro markup", () => {
  const html = npsPageHtml({ token: "t", company: '<script>alert(1)</script>', contact: "" });
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.match(html, /&lt;script&gt;/);
});

test("texto do pedido: WhatsApp curto com o link, e-mail com saudação", () => {
  const c = { contact: "Ana" };
  const link = npsLink("https://levermoney.com.br/", "tok");
  assert.equal(link, "https://levermoney.com.br/public/nps/tok");
  assert.match(npsAskText(c, link), /^Oi Ana, uma pergunta rápida/);
  assert.match(npsAskText(c, link, { canal: "email" }), /^Oi, Ana\./);
});
