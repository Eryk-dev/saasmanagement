// Análise de Desempenho (Leo, 10/09/2026): as réguas novas do metrics-core
// (ICP nas agendadas, contato sem resposta, follow-up executado, lead de social
// selling), os campos novos do scoreboard e a rota /api/desempenho (objeções
// por closer na janela, produção do social, registro manual do dia).

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import {
  isIcpLead, isSocialSellingLead, unansweredContacts, followupTouches, contactAttribution,
  callOutcome, callResultOf, dayKey,
} from "../src/metrics-core.js";
import { registerRoutes } from "../src/routes.js";
import { startStoriesCapture } from "../src/routes.desempenho.js";
import { invalidateStoriesSync } from "../src/social-stories.js";

const NOW = new Date("2026-09-10T18:00:00.000Z"); // 15h em Brasília, 10/09
const FUNNEL = [
  { stage: "Novo lead", kind: "novo", conv: 1 },
  { stage: "Qualificando", kind: "qualificacao", conv: 1 },
  { stage: "Call agendada", kind: "call", conv: 1 },
  { stage: "No show", kind: "contato", conv: 1 },
  { stage: "Follow-up", kind: "followup", conv: 1 },
  { stage: "Ganho", kind: "ganho", conv: 1 },
  { stage: "Perdido", kind: "perdido", conv: 0 },
];
const PRODUCT = { id: "leverads", name: "LeverAds", funnel: FUNNEL, metaIgUser: "ig1" };
const DAY = "?since=2026-09-10&until=2026-09-10";
// Janela de 3 dias pro placar: uma call marcada pra 12/09 é "a realizar" (só
// existe call futura dentro de uma janela que alcança o futuro).
const WIN3 = "?since=2026-09-10&until=2026-09-12";
const inDay = (iso) => iso && dayKey(iso) === "2026-09-10";

// Instagram falso: 2 posts + 1 reel no dia, 1 post de ontem; 2 stories vivos.
const fakeSocial = ({ fail = false } = {}) => ({
  configured: () => true,
  async igMedia() {
    if (fail) throw new Error("Graph indisponível");
    return [
      { id: "m1", type: "IMAGE", at: "2026-09-10T12:00:00.000Z", permalink: "https://ig/m1", caption: "post 1" },
      { id: "m2", type: "CAROUSEL_ALBUM", at: "2026-09-10T13:00:00.000Z", permalink: "https://ig/m2", caption: "post 2" },
      { id: "m3", type: "VIDEO", at: "2026-09-10T14:00:00.000Z", permalink: "https://ig/m3", caption: "reel" },
      { id: "m0", type: "IMAGE", at: "2026-09-09T12:00:00.000Z", permalink: "https://ig/m0", caption: "ontem" },
    ];
  },
  async igStories() {
    return [
      { id: "s1", at: "2026-09-10T09:00:00.000Z", type: "IMAGE", reach: 10 },
      { id: "s2", at: "2026-09-10T11:00:00.000Z", type: "VIDEO", reach: 12 },
    ];
  },
});

test("régua: ICP = nota S/A/B; social selling pela origem escrita", () => {
  assert.equal(isIcpLead({ accounts: "6-10", listings: "2000-10000" }), true);   // S
  assert.equal(isIcpLead({ accounts: "2", listings: "2000-10000" }), true);      // B
  assert.equal(isIcpLead({ accounts: "1", listings: "0-100" }), false);          // E
  assert.equal(isIcpLead({}), false);                                             // sem resposta = sem nota
  assert.equal(isSocialSellingLead({ source: "Social selling" }), true);
  assert.equal(isSocialSellingLead({ source: "social-selling · IG" }), true);
  assert.equal(isSocialSellingLead({ source: "Form · /pricing" }), false);
});

test("contato sem resposta: só conta quem NÃO respondeu depois do 1º contato", () => {
  const leads = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const acts = { a: [{ type: "whatsapp", author: "sdr", at: "2026-09-10T10:00:00.000Z" }], b: [], c: [] };
  const wa = [
    { leadId: "b", saas: "leverads", direction: "out", author: "sdr", at: "2026-09-10T10:00:00.000Z" },
    { leadId: "b", saas: "leverads", direction: "in", at: "2026-09-10T10:05:00.000Z" }, // respondeu DEPOIS
    { leadId: "c", saas: "leverads", direction: "in", at: "2026-09-10T08:00:00.000Z" }, // falou ANTES do contato
    { leadId: "c", saas: "leverads", direction: "out", author: "sdr", at: "2026-09-10T09:00:00.000Z" },
  ];
  const contact = contactAttribution({ leads, actsOf: (id) => acts[id], waMessages: wa, saas: "leverads", inWin: inDay, humanIds: new Set(["sdr"]) });
  const un = unansweredContacts({ contact, waMessages: wa, saas: "leverads" });
  assert.deepEqual(un.get("sdr"), { count: 2, leadIds: ["c", "a"] }); // a: nunca respondeu; c: só falou antes
  assert.ok(un.get("sdr").count <= contact.byAuthor.get("sdr"), "sem resposta ⊆ contatados");
});

test("follow-up executado: toque humano em lead em Follow-up, 1 por lead por dia", () => {
  const leads = [
    { id: "f1", stage: "Follow-up" },
    { id: "f2", stage: "Qualificando" }, // caiu em follow-up na janela e voltou
    { id: "n1", stage: "Novo lead" },    // nunca esteve em follow-up
  ];
  const acts = {
    f1: [
      { type: "call", author: "clo", at: "2026-09-10T10:00:00.000Z" },
      { type: "whatsapp", author: "clo", at: "2026-09-10T11:00:00.000Z" }, // mesmo dia = mesmo follow-up
      { type: "whatsapp", author: "sdr-bot", at: "2026-09-10T12:00:00.000Z" }, // robô não conta
    ],
    f2: [{ type: "stage", at: "2026-09-10T08:00:00.000Z", meta: { from: "Call agendada", to: "Follow-up" } }],
    n1: [{ type: "whatsapp", author: "clo", at: "2026-09-10T10:00:00.000Z" }],
  };
  const wa = [
    { leadId: "f2", saas: "leverads", direction: "out", author: "clo", at: "2026-09-10T09:00:00.000Z" },
    { leadId: "f2", saas: "leverads", direction: "out", author: "clo", at: "2026-09-10T09:30:00.000Z" },
  ];
  const ft = followupTouches({ product: PRODUCT, leads, actsOf: (id) => acts[id] || [], waMessages: wa, inWin: inDay, humanIds: new Set(["clo", "sdr"]) });
  assert.equal(ft.get("clo").count, 2);
  assert.deepEqual([...ft.get("clo").leadIds].sort(), ["f1", "f2"]);
});

test("callResultOf é o mesmo classificador que o callOutcome soma", () => {
  const list = [
    { id: "w", stage: "Ganho", customerId: "c", wonAt: "2026-09-10T12:00:00.000Z", callAt: "2026-09-09T12:00:00.000Z" },
    { id: "s", stage: "Follow-up", callAt: "2026-09-09T12:00:00.000Z" },
    { id: "n", stage: "No show", callAt: "2026-09-09T12:00:00.000Z" },
    { id: "p", stage: "Call agendada", callAt: "2026-09-12T12:00:00.000Z" },
  ];
  const actsOf = () => [];
  const sum = callOutcome(PRODUCT, list, actsOf, "2026-09-10");
  const each = list.map((l) => callResultOf(PRODUCT, l, actsOf, "2026-09-10"));
  assert.deepEqual(each, ["won", "shown", "noShow", "pending"]);
  assert.deepEqual(sum, { shown: 2, noShow: 1, pending: 1, won: 1 });
});

async function buildApp({ social = fakeSocial(), user = null } = {}) {
  const repo = makeMemRepo();
  await repo.create("products", PRODUCT);
  await repo.create("users", { id: "sdr", name: "Manuela", roles: ["sdr"] });
  await repo.create("users", { id: "clo", name: "Jonathan", roles: ["closer"] });
  await repo.create("users", { id: "igor", name: "Igor", roles: ["social"] });
  await repo.create("users", { id: "leo", name: "Leo", roles: ["closer", "admin"] });
  const app = Fastify();
  if (user) app.addHook("onRequest", async (req) => { req.authUser = user; });
  registerRoutes(app, repo, { scoreboard: { now: () => NOW }, desempenho: { social, now: () => NOW } });
  return { app, repo };
}

const at = "2026-09-10T12:00:00.000Z";

test("scoreboard: SDR ganha calls com ICP, sem resposta e leads de social selling; closer ganha no-show e follow-ups", async () => {
  const { app, repo } = await buildApp();
  // 3 calls agendadas hoje pelo SDR: i1 ICP (S) furou, i2 ICP (B) aconteceu, c1 sem nota, futura.
  await repo.create("leads", { id: "i1", saas: "leverads", name: "Ana", owner: "sdr", closer: "clo", stage: "No show", accounts: "6-10", listings: "2000-10000", createdAt: at, callAt: "2026-09-10T10:00:00.000Z" });
  await repo.create("leads", { id: "i2", saas: "leverads", name: "Bia", owner: "sdr", closer: "clo", stage: "Follow-up", accounts: "2", listings: "2000-10000", createdAt: at, callAt: "2026-09-10T11:00:00.000Z" });
  await repo.create("leads", { id: "c1", saas: "leverads", name: "Caio", owner: "sdr", closer: "clo", stage: "Call agendada", createdAt: at, callAt: "2026-09-12T11:00:00.000Z" });
  // Contatos humanos do SDR hoje: i1 (respondeu), i2 (não respondeu), ss1 (social selling, não respondeu).
  await repo.create("activities", { id: "t1", saas: "leverads", lead: "i1", type: "whatsapp", author: "sdr", at });
  await repo.create("wa_messages", { id: "w1", saas: "leverads", leadId: "i1", direction: "in", at: "2026-09-10T12:10:00.000Z" });
  await repo.create("activities", { id: "t2", saas: "leverads", lead: "i2", type: "whatsapp", author: "sdr", at });
  await repo.create("leads", { id: "ss1", saas: "leverads", name: "Dani", owner: "sdr", stage: "Qualificando", source: "Social selling", createdAt: at });
  await repo.create("wa_messages", { id: "w2", saas: "leverads", leadId: "ss1", direction: "out", author: "sdr", at: "2026-09-10T13:00:00.000Z" });
  // Follow-up do closer: toque em i2 (em Follow-up) hoje, duas vezes.
  await repo.create("activities", { id: "t3", saas: "leverads", lead: "i2", type: "call", author: "clo", at: "2026-09-10T15:00:00.000Z" });
  await repo.create("wa_messages", { id: "w3", saas: "leverads", leadId: "i2", direction: "out", author: "clo", at: "2026-09-10T15:30:00.000Z" });

  const sb = (await app.inject({ url: `/api/scoreboard/leverads${WIN3}` })).json();
  const s = sb.sdr.find((p) => p.user === "sdr");
  assert.equal(s.callsBooked, 3);
  assert.equal(s.callsBookedIcp, 2);
  assert.ok(s.callsBookedIcp <= s.callsBooked, "ICP ⊆ agendadas");
  assert.equal(s.noShow, 1);
  assert.equal(s.pending, 1);
  assert.equal(s.contacted, 3);
  assert.equal(s.noReply, 2);
  assert.ok(s.noReply <= s.contacted, "sem resposta ⊆ contatados");
  assert.equal(s.socialSellingLeads, 1);
  assert.deepEqual(s.detail.noShow, [{ id: "i1", name: "Ana" }]);
  assert.deepEqual(s.detail.icp.map((r) => r.id).sort(), ["i1", "i2"]);
  assert.deepEqual(s.detail.noReply.map((r) => r.id).sort(), ["i2", "ss1"]);
  assert.deepEqual(s.detail.socialSelling, [{ id: "ss1", name: "Dani" }]);

  const c = sb.closer.find((p) => p.user === "clo");
  assert.equal(c.calls, 3);
  assert.equal(c.callsShown, 1);
  assert.equal(c.noShow, 1);
  assert.equal(c.pending, 1);
  assert.equal(c.noShow + c.callsShown + c.pending, c.calls, "agendadas = realizadas + furos + a realizar");
  assert.equal(c.followupsDone, 1); // 2 toques no mesmo lead no mesmo dia = 1
  assert.deepEqual(c.detail.followups, [{ id: "i2", name: "Bia" }]);
  assert.deepEqual(c.detail.noShow, [{ id: "i1", name: "Ana" }]);
  await app.close();
});

test("GET /api/desempenho: objeções por closer SÓ da janela, feed/stories do Instagram e registros do dia", async () => {
  const { app, repo } = await buildApp();
  await repo.create("leads", { id: "l1", saas: "leverads", name: "Ana", owner: "sdr", closer: "clo", stage: "Follow-up", createdAt: at, callAt: at });
  await repo.create("leads", { id: "l2", saas: "leverads", name: "Bia", owner: "sdr", closer: "clo", stage: "Follow-up", createdAt: at, callAt: at });
  await repo.create("leads", { id: "q1", saas: "leverads", name: "Quali", owner: "sdr", stage: "Qualificando", createdAt: at });
  const sum = (objecao, resolvida, temperatura = "morno") => ({ temperatura, resumo: "resumo", dores: ["custo"], objecoes: [{ objecao, resolvida }] });
  await repo.create("activities", { id: "cs1", saas: "leverads", lead: "l1", type: "system", author: "cockpit", at: "2026-09-10T11:00:00.000Z", meta: { event: "call_summary", kind: "call", meetEventId: "m1", summary: sum("preço", false) } });
  await repo.create("activities", { id: "cs1b", saas: "leverads", lead: "l1", type: "system", author: "cockpit", at: "2026-09-10T11:30:00.000Z", meta: { event: "call_summary", kind: "call", meetEventId: "m1", summary: sum("preço", true, "quente") } }); // re-resumo da MESMA call
  await repo.create("activities", { id: "cs2", saas: "leverads", lead: "l2", type: "system", author: "cockpit", at: "2026-09-09T11:00:00.000Z", meta: { event: "call_summary", kind: "call", meetEventId: "m2", summary: sum("prazo", false) } }); // ontem: fora
  await repo.create("activities", { id: "cs3", saas: "leverads", lead: "q1", type: "system", author: "cockpit", at: "2026-09-10T12:00:00.000Z", meta: { event: "call_summary", kind: "call", summary: sum("tempo", false, "frio") } }); // qualificação do SDR
  await repo.create("activities", { id: "ib", saas: "leverads", lead: "l1", type: "system", author: "cockpit", at: "2026-09-10T16:00:00.000Z", meta: { event: "call_summary", kind: "integracao", summary: { sentimento: "satisfeito" } } }); // integração: fora
  await repo.create("daily_logs", { id: "dl_leverads_sdr_2026-09-10", saas: "leverads", user: "sdr", day: "2026-09-10", socialSelling: 4, creatives: 0 });
  await repo.create("daily_logs", { id: "dl_leverads_igor_2026-09-10", saas: "leverads", user: "igor", day: "2026-09-10", socialSelling: 0, creatives: 3 });
  await repo.create("daily_logs", { id: "dl_leverads_igor_2026-09-09", saas: "leverads", user: "igor", day: "2026-09-09", socialSelling: 0, creatives: 9 }); // ontem: fora

  const res = await app.inject({ url: `/api/desempenho/leverads${DAY}` });
  assert.equal(res.statusCode, 200);
  const d = res.json();
  assert.equal(d.admin, true);
  // closer: 1 call (re-resumo deduplicado, ficou o mais recente), objeção "preço" tratada
  assert.equal(d.objections.clo.count, 1);
  assert.deepEqual(d.objections.clo.temperatura, { quente: 1, morno: 0, frio: 0 });
  assert.deepEqual(d.objections.clo.objecoes, [{ objecao: "preço", total: 1, abertas: 0 }]);
  assert.equal(d.objections.clo.recent[0].leadName, "Ana");
  // SDR: a call de qualificação dela (lead sem closer) cai na linha dela
  assert.equal(d.objections.sdr.count, 1);
  assert.deepEqual(d.objections.sdr.objecoes, [{ objecao: "tempo", total: 1, abertas: 1 }]);
  // social: 2 posts + 1 reel hoje (o de ontem fica fora); stories capturados na hora
  assert.equal(d.social.feed, 3);
  assert.equal(d.social.posts, 2);
  assert.equal(d.social.reels, 1);
  assert.equal(d.social.stories, 2);
  assert.deepEqual(d.socialUsers, ["igor"]);
  // registros do dia: só os da janela
  assert.equal(d.logs.sdr.socialSelling, 4);
  assert.equal(d.logs.igor.creatives, 3);
  assert.deepEqual(Object.keys(d.logs.igor.days), ["2026-09-10"]);
  await app.close();
});

test("GET /api/desempenho: Graph fora do ar não derruba a rota (erro no payload, stories do banco)", async () => {
  const { app, repo } = await buildApp({ social: fakeSocial({ fail: true }) });
  await repo.create("social_stories", { id: "old", saas: "leverads", at: "2026-09-10T08:00:00.000Z", type: "IMAGE" });
  const res = await app.inject({ url: `/api/desempenho/leverads${DAY}` });
  assert.equal(res.statusCode, 200);
  const d = res.json();
  assert.equal(d.social.feed, null);
  assert.match(d.social.errors.feed, /Graph/);
  assert.equal(d.social.stories, 1);
  await app.close();
});

test("lente individual: sem etiqueta admin só o próprio recorte volta", async () => {
  const { app, repo } = await buildApp({ user: { id: "sdr", roles: ["sdr"] } });
  await repo.create("daily_logs", { id: "dl_leverads_sdr_2026-09-10", saas: "leverads", user: "sdr", day: "2026-09-10", socialSelling: 2, creatives: 0 });
  await repo.create("daily_logs", { id: "dl_leverads_igor_2026-09-10", saas: "leverads", user: "igor", day: "2026-09-10", socialSelling: 0, creatives: 3 });
  const d = (await app.inject({ url: `/api/desempenho/leverads${DAY}` })).json();
  assert.equal(d.admin, false);
  assert.equal(d.me, "sdr");
  assert.deepEqual(Object.keys(d.logs), ["sdr"]);
  await app.close();
});

test("POST /api/desempenho/:saas/log: upsert por pessoa+dia, inc soma, nunca negativo; só admin grava pelos outros", async () => {
  const { app } = await buildApp({ user: { id: "sdr", roles: ["sdr"] } });
  let r = await app.inject({ method: "POST", url: "/api/desempenho/leverads/log", payload: { inc: { socialSelling: 1 } } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().id, "dl_leverads_sdr_2026-09-10"); // dia de hoje (BRT) e a própria pessoa por padrão
  assert.equal(r.json().socialSelling, 1);
  r = await app.inject({ method: "POST", url: "/api/desempenho/leverads/log", payload: { inc: { socialSelling: 1 }, note: "2 DMs no IG" } });
  assert.equal(r.json().socialSelling, 2);
  assert.equal(r.json().note, "2 DMs no IG");
  r = await app.inject({ method: "POST", url: "/api/desempenho/leverads/log", payload: { inc: { socialSelling: -5 } } });
  assert.equal(r.json().socialSelling, 0, "nunca negativo");
  r = await app.inject({ method: "POST", url: "/api/desempenho/leverads/log", payload: { socialSelling: 7, day: "2026-09-09" } });
  assert.equal(r.json().id, "dl_leverads_sdr_2026-09-09");
  assert.equal(r.json().socialSelling, 7);
  r = await app.inject({ method: "POST", url: "/api/desempenho/leverads/log", payload: { user: "igor", creatives: 3 } });
  assert.equal(r.statusCode, 403, "usuário comum não registra pelos outros");
  r = await app.inject({ method: "POST", url: "/api/desempenho/leverads/log", payload: { day: "hoje" } });
  assert.equal(r.statusCode, 400);
  await app.close();

  // Admin (e a key mestre) registra por qualquer um.
  const adm = await buildApp({ user: { id: "leo", roles: ["closer", "admin"] } });
  r = await adm.app.inject({ method: "POST", url: "/api/desempenho/leverads/log", payload: { user: "igor", creatives: 3 } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().creatives, 3);
  const d = (await adm.app.inject({ url: `/api/desempenho/leverads${DAY}` })).json();
  assert.equal(d.logs.igor.creatives, 3);
  await adm.app.close();
});

test("startStoriesCapture: o tick captura os stories vivos de cada produto com Instagram", async () => {
  const repo = makeMemRepo();
  await repo.create("products", PRODUCT);
  await repo.create("products", { id: "elo", name: "Elo" }); // sem IG: pulado
  invalidateStoriesSync("leverads"); // o throttle de 10 min é por processo: os testes acima já capturaram
  const job = startStoriesCapture(repo, { social: fakeSocial(), intervalMs: 60_000 });
  const n = await job.tick();
  job.stop();
  assert.equal(n, 2);
  assert.equal((await repo.list("social_stories")).length, 2);
  assert.equal(startStoriesCapture(repo, { social: { configured: () => false } }), null, "sem token = desligado");
});
