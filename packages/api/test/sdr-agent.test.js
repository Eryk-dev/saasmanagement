// As mãos do agente SDR externo (OpenBot) no cockpit: sdr-agent.js e as rotas
// /api/sdr/agent. Mundo em memória, WhatsApp e Meet falsos, relógio de verdade
// (a agenda do robô é calculada a partir de agora).
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeSdrAgent } from "../src/sdr/sdr-agent.js";
import { registerSdrAgentRoutes } from "../src/sdr/routes.sdr-agent.js";
import { makeSdrBrain } from "../src/sdr/sdr-brain.js";
import { agentOwns, sdrBotConfig, SDR_AUTHOR, makeSdrRunner } from "../src/sdr/sdr-flow.js";
import { activeHolds, holdSlots, wallNow, slotsForLead, OFFER_HOURS } from "../src/crm/agenda-slots.js";

const FUNNEL = [{ stage: "Novo lead", kind: "novo" }, { stage: "Qualificando", kind: "qualificacao" }, { stage: "Call agendada", kind: "call" }];
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();

// Próximo dia útil a pelo menos `min` dias de hoje, no relógio de Brasília.
function businessDay(min) {
  const d = wallNow();
  d.setUTCDate(d.getUTCDate() + min);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function world({ sdrBot = {}, lead = {}, messages } = {}) {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL, sdrBot: { enabled: true, conversation: true, agentSince: ago(60), ...sdrBot } });
  for (const u of [{ id: "sdr", name: "Manuela", roles: ["sdr"] }, { id: "leo", name: "Leonardo Parra", roles: ["closer"], compLevel: 1 }, { id: "vit", name: "Vitor Silva", roles: ["closer"], compLevel: 3 }]) await repo.create("users", u);
  await repo.create("leads", { id: "ana", saas: "leverads", owner: "sdr", name: "Ana", phone: "41999990000", stage: "Novo lead", createdAt: ago(30), ...lead });
  await repo.create("leads", { id: "bia", saas: "leverads", owner: "sdr", name: "Bia", phone: "41999991111", stage: "Novo lead", createdAt: ago(20) });
  await repo.create("wa_threads", { id: "5541999990000", phone: "5541999990000", leadId: "ana", saas: "leverads", name: "Ana" });
  for (const [i, m] of (messages || [{ direction: "in", text: "quero conhecer", at: ago(5) }]).entries()) {
    await repo.create("wa_messages", { id: "m" + (i + 1), thread: "5541999990000", leadId: "ana", saas: "leverads", ...m });
  }
  const sent = [], meets = [], meetCancels = [];
  const wa = { configured: () => true, sendText: async (to, text) => { sent.push({ to, text }); return { messageId: "wm_" + sent.length }; } };
  const agent = makeSdrAgent({ repo, whatsapp: wa, autoCallMeet: async (id) => { meets.push(id); await repo.update("leads", id, { callUrl: "https://meet.google.com/abc" }); }, cancelCallMeet: async (id) => { meetCancels.push(id); }, partDelayMs: 0, log: { warn: () => {} } });
  return { repo, agent, sent, meets, meetCancels };
}

test("lead é do agente quando nasceu depois do agentSince ou está em agentLeads; interno e lead antigo ficam com o robô nativo", () => {
  const cfg = sdrBotConfig({ sdrBot: { enabled: true, agentSince: "2026-11-26T22:00:00.000Z", agentLeads: ["teste"] } });
  assert.equal(agentOwns(cfg, { id: "novo", createdAt: "2026-11-26T22:00:01.000Z" }), true);
  assert.equal(agentOwns(cfg, { id: "antigo", createdAt: "2026-11-26T21:59:59.000Z" }), false);
  assert.equal(agentOwns(cfg, { id: "time", createdAt: "2026-11-27T10:00:00.000Z", internal: true }), false);
  assert.equal(agentOwns(cfg, { id: "teste", createdAt: "2026-01-01T00:00:00.000Z", internal: true }), true);
  assert.equal(agentOwns(sdrBotConfig({ sdrBot: { enabled: true } }), { id: "novo", createdAt: "2026-11-27T10:00:00.000Z" }), false);
  assert.equal(agentOwns(null, { id: "novo", createdAt: "2026-11-27T10:00:00.000Z" }), false);
});

test("nenhuma ação sai pra lead que não é do agente, nem pra lead que o time parou", async () => {
  const antigo = await world({ lead: { createdAt: ago(600) } });
  for (const run of [() => antigo.agent.send("ana", { parts: ["oi"] }), () => antigo.agent.hold("ana", { slots: [`${businessDay(2)}T10:00`] }), () => antigo.agent.book("ana", { at: `${businessDay(2)}T10:00` }),
    () => antigo.agent.cancel("ana"), () => antigo.agent.handoff("ana", { kind: "pessoa", why: "pediu pessoa" }), () => antigo.agent.optOut("ana"), () => antigo.agent.callback("ana", { day: businessDay(3) })]) {
    const r = await run();
    assert.deepEqual([r.status, r.body.error], [409, "not_agent_lead"]);
  }
  const parado = await world({ lead: { sdrOff: true } });
  const r = await parado.agent.send("ana", { parts: ["oi"] });
  assert.deepEqual([r.status, r.body.error], [409, "paused"]);
  assert.equal(parado.sent.length + antigo.sent.length, 0);
  assert.equal((await antigo.agent.send("nao-existe", { parts: ["oi"] })).status, 404);
});

test("send: os balões saem em ordem como o robô, ficam na conversa e o card anda pra qualificação", async () => {
  const { repo, agent, sent } = await world();
  const r = await agent.send("ana", { parts: ["Oiii Ana, tudo bem?", "Você já vende no Mercado Livre?"], replyTo: "m1" });
  assert.equal(r.status, 200);
  assert.deepEqual(sent.map((s) => s.text), ["Oiii Ana, tudo bem?", "Você já vende no Mercado Livre?"]);
  const out = (await repo.list("wa_messages")).filter((m) => m.direction === "out");
  assert.deepEqual(out.map((m) => [m.author, m.text]), [[SDR_AUTHOR, "Oiii Ana, tudo bem?"], [SDR_AUTHOR, "Você já vende no Mercado Livre?"]]);
  assert.equal((await repo.get("leads", "ana")).stage, "Qualificando");
});

test("send: resposta que nasceu velha não sai (lead escreveu de novo, gente respondeu, janela fechou)", async () => {
  const novo = await world({ messages: [{ direction: "in", text: "oi", at: ago(9) }, { direction: "in", text: "e o preço?", at: ago(1) }] });
  assert.equal((await novo.agent.send("ana", { parts: ["oi"], replyTo: "m1" })).body.error, "superseded");
  const gente = await world({ messages: [{ direction: "in", text: "oi", at: ago(9) }, { direction: "out", author: "sdr", text: "Oi Ana, é a Manu", at: ago(2) }] });
  // gente respondeu depois do lead: pausa de humano ativo em expediente, "respondeu antes" fora dele
  assert.match((await gente.agent.send("ana", { parts: ["oi"], replyTo: "m1" })).body.error, /^human_(active|answered)$/);
  const fechada = await world({ messages: [{ direction: "in", text: "oi", at: ago(25 * 60) }] });
  assert.equal((await fechada.agent.send("ana", { parts: ["oi"], replyTo: "m1" })).body.error, "window_closed");
  assert.equal((await novo.agent.send("ana", { parts: [] })).status, 400);
  assert.equal(novo.sent.length + gente.sent.length + fechada.sent.length, 0);
});

test("hold e book: o horário oferecido fica reservado, outro lead não leva, e marcar usa o closer da agenda e cria a sala", async () => {
  const { repo, agent, meets } = await world();
  const day = businessDay(2);
  const held = await agent.hold("ana", { slots: [`${day}T10:00`, `${day}T15:00`] });
  assert.deepEqual([held.status, held.body.held], [200, [`${day}T10:00`, `${day}T15:00`]]);
  assert.deepEqual((await activeHolds(repo, "leverads")).map((h) => [h.at, h.leadId]), [[`${day}T10:00`, "ana"], [`${day}T15:00`, "ana"]]);
  // a Bia segura as 11h: a Ana não reserva nem marca esse horário, e recebe os mais próximos
  await holdSlots(repo, { saas: "leverads", leadId: "bia", slots: [{ at: `${day}T11:00` }] });
  const taken = await agent.hold("ana", { slots: [`${day}T11:00`] });
  assert.deepEqual([taken.status, taken.body.error, taken.body.taken], [409, "taken", [`${day}T11:00`]]);
  assert.ok(taken.body.alternatives.length && !taken.body.alternatives.includes(`${day}T11:00`));
  assert.equal((await agent.book("ana", { at: `${day}T11:00` })).body.error, "taken");
  const booked = await agent.book("ana", { at: `${day}T15:00` });
  assert.equal(booked.status, 200);
  const lead = await repo.get("leads", "ana");
  assert.deepEqual([lead.callAt, lead.stage, lead.callConfirmed], [`${day}T15:00`, "Call agendada", false]);
  assert.ok(["leo", "vit"].includes(lead.closer), "closer da agenda");
  assert.deepEqual([booked.body.callAt, booked.body.callUrl, booked.body.closer], [`${day}T15:00`, "https://meet.google.com/abc", lead.closer]);
  assert.deepEqual(meets, ["ana"]);
  assert.deepEqual((await activeHolds(repo, "leverads")).map((h) => h.leadId), ["bia"], "marcou: a reserva da Ana cai");
  assert.equal((await agent.book("ana", { at: `${day}T15:00` })).body.already, true);
});

test("cancel: desmarca de verdade (card volta, sala morre) e é idempotente", async () => {
  const { repo, agent, meetCancels } = await world();
  const day = businessDay(2);
  await agent.book("ana", { at: `${day}T10:00` });
  const r = await agent.cancel("ana");
  assert.deepEqual([r.status, r.body.was], [200, `${day}T10:00`]);
  const lead = await repo.get("leads", "ana");
  assert.deepEqual([lead.callAt, lead.stage], ["", "Qualificando"]);
  assert.deepEqual(meetCancels, ["ana"]);
  assert.equal((await agent.cancel("ana")).body.already, true);
  assert.equal(meetCancels.length, 1);
});

test("handoff, opt-out e callback: carimbos que o resto do cockpit já entende", async () => {
  const { repo, agent } = await world();
  const h = await agent.handoff("ana", { kind: "sala", why: "Ana entrou às 15h04, sala vazia" });
  assert.deepEqual([h.status, h.body.notified], [200, "sdr"]);
  let lead = await repo.get("leads", "ana");
  assert.deepEqual([lead.sdrLog.handoffKind, lead.sdrLog.handoffWhy], ["agente:sala", "Ana entrou às 15h04, sala vazia"]);
  const [alert] = await repo.list("wa_alerts");
  assert.match(alert.text, /LEAD NA SALA.*sala vazia/);
  const [note] = await repo.list("notifications");
  assert.deepEqual([note.user, note.type], ["sdr", "sdr_handoff"]);
  assert.equal((await agent.handoff("ana", { kind: "", why: "" })).status, 400);
  const day = businessDay(3);
  const cb = await agent.callback("ana", { day });
  assert.equal(cb.status, 200);
  lead = await repo.get("leads", "ana");
  assert.equal(lead.sdrLog.callbackAt, new Date(`${day}T09:30:00-03:00`).toISOString());
  assert.equal(lead.sdrLog.handoffKind, "agente:sala", "um carimbo não apaga o outro");
  assert.equal((await agent.callback("ana", { day: "2020-01-01" })).status, 400);
  assert.equal((await agent.optOut("ana")).status, 200);
  assert.equal((await repo.get("leads", "ana")).whatsappOptOut, true);
});

test("lead na sala sem especialista: quem do time está com a agenda livre agora também é avisado", async () => {
  const { repo } = await world();
  // relógio de parede fixo num dia útil às 10h05: a agenda de hoje tem gente livre às 10h30
  const day = businessDay(1);
  const wall = () => new Date(`${day}T10:05:00Z`);
  const agent = makeSdrAgent({ repo, whatsapp: { configured: () => true }, wall, partDelayMs: 0, log: { warn: () => {} } });
  const { slots } = await slotsForLead(repo, { lead: await repo.get("leads", "ana"), saas: "leverads", sdr: true, ...OFFER_HOURS, now: wall(), minNoticeMin: 0, days: 1, limit: 0 });
  const soon = slots.find((s) => s.at === `${day}T10:30`);
  assert.ok(soon, "o mundo de teste tem closer livre às 10h30");
  const other = ["leo", "vit"].find((u) => u !== soon.closer);
  // a call da Ana é agora, com o OUTRO closer, que não apareceu
  await repo.update("leads", "ana", { closer: other, stage: "Call agendada", callAt: `${day}T10:00` });
  const r = await agent.handoff("ana", { kind: "sala", why: "entrou às 10h04, sala vazia" });
  assert.equal(r.status, 200);
  const freeUser = (await repo.list("users")).find((u) => u.name === r.body.free);
  assert.ok(freeUser && freeUser.id !== other, "o livre não é o closer que faltou");
  const notes = await repo.list("notifications");
  assert.ok(notes.some((n) => n.user === freeUser.id && /LEAD NA SALA.*agenda livre às 10:30/.test(n.text)));
  assert.match((await repo.list("wa_alerts"))[0].text, /LEAD NA SALA.*está livre às 10:30/);
  // aviso de outro tipo não procura closer livre
  const outro = await world();
  assert.equal((await outro.agent.handoff("ana", { kind: "pessoa", why: "pediu pessoa" })).body.free, undefined);
});

test("confirm: a presença confirmada na conversa, no dia, grava a marca da régua; véspera não vale e o link não repete", async () => {
  const day = businessDay(1);
  const wall = () => new Date(`${day}T09:00:00Z`);
  const booked = { stage: "Call agendada", callAt: `${day}T14:00`, closer: "leo", callUrl: "https://meet.google.com/abc" };
  const make = async (opts) => {
    const w = await world(opts);
    return { ...w, agent: makeSdrAgent({ repo: w.repo, whatsapp: { configured: () => true, sendText: async () => ({ messageId: "x" }) }, wall, partDelayMs: 0, log: { warn: () => {} } }) };
  };
  // "simm! mto obg" ao lembrete: a régua não leu, o agente confirma; o link fica com o fluxo (2c)
  const { repo, agent } = await make({ lead: booked, messages: [{ direction: "out", author: SDR_AUTHOR, text: "Bom dia Ana, temos um horário reservado para hoje às 14h, tudo certo?", at: ago(9) }, { direction: "in", text: "simm! mto obg", at: ago(5) }] });
  const r = await agent.confirm("ana");
  assert.deepEqual([r.status, r.body.link], [200, "flow"]);
  const ana = await repo.get("leads", "ana");
  assert.equal(ana.callConfirmed, true);
  assert.equal(ana.confirmLog.at, booked.callAt);
  assert.ok(Date.parse(ana.confirmLog.confirmed) > 0 && !ana.confirmLog.linkSentAt);
  // confirmado: a resposta é o link do fluxo, o agente não escreve por cima; e confirmar de novo não muda nada
  assert.equal((await agent.send("ana", { parts: ["Combinado Ana"] })).body.error, "reminder_confirmed");
  assert.equal((await agent.confirm("ana")).body.already, true);
  // o agente já mandou o link depois da última mensagem do lead: fica carimbado, o fluxo não manda outro
  const jaFoi = await make({ lead: booked, messages: [{ direction: "in", text: "pode ser hoje às 14h, confirmado", at: ago(5) }, { direction: "out", author: SDR_AUTHOR, text: `O link pra entrar é este: ${booked.callUrl}`, at: ago(4) }] });
  assert.equal((await jaFoi.agent.confirm("ana")).body.link, "sent");
  assert.ok((await jaFoi.repo.get("leads", "ana")).confirmLog.linkSentAt);
  // demonstração de outro dia: quem confirma o dia é o lembrete da manhã
  const vespera = await make({ lead: { ...booked, callAt: `${new Date(Date.parse(`${day}T00:00:00Z`) + 24 * 3600_000).toISOString().slice(0, 10)}T14:00` } });
  assert.deepEqual([(await vespera.agent.confirm("ana")).status, (await vespera.agent.confirm("ana")).body.error], [409, "not_today"]);
  assert.ok(!(await vespera.repo.get("leads", "ana")).callConfirmed);
  // hora que já passou e lead sem demonstração
  const passou = await make({ lead: { ...booked, callAt: `${day}T08:30` } });
  assert.equal((await passou.agent.confirm("ana")).body.error, "not_today");
  const semCall = await make();
  assert.equal((await semCall.agent.confirm("ana")).body.error, "no_call");
});

test("as cercas do cérebro nativo valem pro agente: etapa de closer, gente falando há pouco e a positiva ao lembrete", async () => {
  const closer = await world({ lead: { stage: "Proposta" } });
  assert.equal((await closer.agent.send("ana", { parts: ["oi"] })).body.error, "out_of_region");
  assert.equal((await closer.agent.book("ana", { at: `${businessDay(2)}T10:00` })).body.error, "out_of_region");
  const fora = await world({ lead: { disqualified: true } });
  assert.equal((await fora.agent.hold("ana", { slots: [`${businessDay(2)}T10:00`] })).body.error, "out_of_region");
  // a Manu falou há 30 min e o lead respondeu a ela: nenhuma ação do agente, nem marcar
  const gente = await world({ messages: [{ direction: "out", author: "sdr", text: "Oi Ana, é a Manu", at: ago(30) }, { direction: "in", text: "pode ser amanhã 10h", at: ago(2) }] });
  for (const run of [() => gente.agent.send("ana", { parts: ["oi"] }), () => gente.agent.book("ana", { at: `${businessDay(2)}T10:00` }), () => gente.agent.hold("ana", { slots: [`${businessDay(2)}T10:00`] })]) {
    assert.equal((await run()).body.error, "human_active");
  }
  assert.equal((await gente.repo.get("leads", "ana")).callAt, undefined);
  // gente falou há 5 horas: a pausa acabou
  const antes = await world({ messages: [{ direction: "out", author: "sdr", text: "Oi Ana", at: ago(300) }, { direction: "in", text: "oi", at: ago(2) }] });
  assert.equal((await antes.agent.send("ana", { parts: ["Oiii Ana"], replyTo: "m2" })).status, 200);
  // "sim" ao lembrete: a régua da call confirmou nesta mensagem e manda o link; o agente não fala por cima
  const sim = await world({ lead: { stage: "Call agendada", callAt: `${businessDay(1)}T10:00`, callConfirmed: true, confirmLog: { at: `${businessDay(1)}T10:00`, manha: ago(20), confirmed: ago(3) } },
    messages: [{ direction: "out", author: SDR_AUTHOR, via: "flow", text: "Bom dia Ana, tudo certo pra hoje?", at: ago(20) }, { direction: "in", text: "sim", at: ago(3) }] });
  assert.equal((await sim.agent.send("ana", { parts: ["Perfeito Ana, o link é este"], replyTo: "m2" })).body.error, "reminder_confirmed");
  assert.equal(closer.sent.length + fora.sent.length + gente.sent.length + sim.sent.length, 0);
});

test("a 1ª resposta do agente carimba o 1º toque, e o fluxo não manda o 1º toque em cima de quem acabou de escrever", async () => {
  const { repo, agent } = await world();
  await agent.send("ana", { parts: ["Oiii Ana, tudo bem?"], replyTo: "m1" });
  const log = (await repo.get("leads", "ana")).sdrLog;
  assert.equal(log.firstTouchVia, "agent");
  await agent.send("ana", { parts: ["Você já vende no Mercado Livre?"], replyTo: "m1" });
  assert.equal((await repo.get("leads", "ana")).sdrLog.firstTouchAt, log.firstTouchAt, "carimba uma vez");

  // fluxo: lead do agente que escreveu há 2 min espera o agente; há 15 min sem resposta, o toque sai
  const flow = async (lastInMin) => {
    const w = await world({ lead: { createdAt: ago(40) }, messages: [{ direction: "in", text: "Oi, quero saber mais", at: ago(lastInMin) }] });
    const sent = [];
    const wa = { configured: () => true, sendText: async (to, text) => { sent.push(text); return { messageId: "wm_f" + sent.length }; }, sendTemplate: async () => ({ messageId: "wm_t" }), listTemplates: async () => [], tokenWabaIds: async () => [] };
    await makeSdrRunner({ repo: w.repo, whatsapp: wa, log: { warn: () => {} } }).tick();
    return sent.length;
  };
  assert.equal(await flow(2), 0, "espera o agente");
  assert.equal(await flow(15), 1, "agente não respondeu em 10 min: o 1º toque sai");
});

test("o cérebro nativo fica calado no lead do agente e segue respondendo o lead antigo", async () => {
  const run = async (createdAt) => {
    const { repo } = await world({ lead: { createdAt, stage: "Qualificando" } });
    const sent = [], calls = [];
    const brain = makeSdrBrain({
      repo, whatsapp: { configured: () => true, sendText: async (to, text) => { sent.push(text); return { messageId: "wm_" + sent.length }; } },
      anthropic: { configured: () => true, sdrDecide: async (ctx) => { calls.push(ctx); return { acao: "responder", mensagem: "Oi Ana", horario: "", email: "", motivoHumano: "" }; } },
      log: { warn: () => {} }, replyDelayMs: 0, sleep: async () => {},
    });
    await brain.handleInbound({ message: { id: "m1", from: "5541999990000", text: "quero conhecer" } });
    return { sent, calls };
  };
  const doAgente = await run(ago(30));
  assert.deepEqual([doAgente.sent.length, doAgente.calls.length], [0, 0]);
  const antigo = await run(ago(600));
  assert.equal(antigo.calls.length, 1, "lead de antes do agentSince: a IA nativa decide como sempre");
});

test("rotas: só a chave mestre ou admin; o status e o corpo da ação voltam como vieram", async (t) => {
  const { agent } = await world();
  const app = Fastify();
  app.addHook("preHandler", async (req) => { if (req.headers["x-user"]) req.authUser = { id: "u1", roles: [req.headers["x-user"]] }; });
  registerSdrAgentRoutes(app, agent);
  t.after(() => app.close());
  const sdr = await app.inject({ method: "POST", url: "/api/sdr/agent/leads/ana/send", headers: { "x-user": "sdr" }, payload: { parts: ["oi"] } });
  assert.equal(sdr.statusCode, 403);
  const ok = await app.inject({ method: "POST", url: "/api/sdr/agent/leads/ana/send", payload: { parts: ["Oiii Ana"], replyTo: "m1" } });
  assert.deepEqual([ok.statusCode, ok.json().ok], [200, true]);
  const stale = await app.inject({ method: "POST", url: "/api/sdr/agent/leads/ana/send", payload: { parts: ["de novo"], replyTo: "outra" } });
  assert.deepEqual([stale.statusCode, stale.json().error], [409, "superseded"]);
  for (const path of ["hold", "book", "cancel", "handoff", "opt-out", "callback"]) {
    const r = await app.inject({ method: "POST", url: `/api/sdr/agent/leads/ana/${path}`, payload: {} });
    assert.notEqual(r.statusCode, 404, path);
  }
});
