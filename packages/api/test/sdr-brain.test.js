import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeSdrBrain, bookCall } from "../src/sdr-brain.js";

// Relógio dos testes: quarta 19/08/2026, 10h BRT (13h UTC). Com o closer livre
// e aviso mínimo de 2h, o primeiro horário OFERTÁVEL é 13:00 do próprio dia
// (12:00-13:00 é o almoço bloqueado na janela de oferta do robô).
const NOW = new Date("2026-08-19T13:00:00Z");
const ISO = (s) => new Date(s).toISOString();
const SLOT1 = "2026-08-19T13:00";

const FUNNEL = [
  { stage: "Novo lead", kind: "novo" },
  { stage: "Qualificando", kind: "qualificacao" },
  { stage: "Call agendada", kind: "call" },
  { stage: "No show", kind: "contato" },
  { stage: "Ganho", kind: "ganho" },
];

async function world({ lead = {}, messages = [], sdrBot = {}, users } = {}) {
  const repo = makeMemRepo();
  await repo.create("products", {
    id: "leverads", name: "LeverAds", funnel: FUNNEL,
    leadQuestions: [{ key: "accounts", label: "Contas", options: [{ value: "3-5", label: "3 a 5 contas" }] }],
    painMap: { B: "Conta banida, precisa anunciar em conta nova", OEM: "Anunciar pelo código OEM sem montar ficha" },
    sdrBot: { enabled: true, enabledAt: ISO("2026-08-01T00:00:00Z"), conversation: true, ...sdrBot },
  });
  for (const u of users || [
    { id: "sdr", name: "Manuela", roles: ["sdr"] },
    { id: "leonardo", name: "Leonardo", roles: ["admin"] },
    { id: "pl", name: "Plena", roles: ["closer"], compLevel: 2 },
  ]) await repo.create("users", u);
  await repo.create("leads", {
    id: "L1", saas: "leverads", owner: "sdr", name: "Rafael Silva", phone: "41999990000",
    stage: "Qualificando", accounts: "3-5", createdAt: ISO("2026-08-19T12:00:00Z"), ...lead,
  });
  await repo.create("wa_threads", { id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads", name: "Rafael" });
  let seq = 0;
  for (const m of messages) {
    await repo.create("wa_messages", { id: "m" + (++seq), thread: "5541999990000", leadId: "L1", saas: "leverads", ...m });
  }
  return repo;
}

function makeFakes({ decisions = [] } = {}) {
  const sent = [];
  const calls = [];
  const meets = [];
  const meetCancels = [];
  const queue = [...decisions];
  const wa = {
    configured: () => true,
    sendText: async (to, text) => { sent.push({ to, text }); return { messageId: "wm_" + sent.length }; },
  };
  const anthropic = {
    configured: () => true,
    sdrDecide: async (ctx) => {
      calls.push(ctx);
      const d = queue.shift() || { acao: "silencio" };
      return { acao: "silencio", mensagem: "", horario: "", email: "", motivoHumano: "", ...d };
    },
  };
  const autoCallMeet = async (id) => { meets.push(id); return null; };
  const cancelCallMeet = async (id) => { meetCancels.push(id); return null; };
  return { wa, anthropic, autoCallMeet, cancelCallMeet, sent, calls, meets, meetCancels };
}

const brainOf = (repo, fakes) => makeSdrBrain({
  repo, whatsapp: fakes.wa, anthropic: fakes.anthropic, autoCallMeet: fakes.autoCallMeet, cancelCallMeet: fakes.cancelCallMeet,
  log: { warn: () => {} }, now: () => NOW, replyDelayMs: 0, sleep: async () => {},
});

const INBOUND = { message: { from: "5541999990000", text: "quanto custa?" } };

test("chave conversation desligada: o cérebro nem chama a IA", async () => {
  const repo = await world({ sdrBot: { conversation: false }, messages: [{ direction: "in", text: "oi", at: ISO("2026-08-19T12:59:00Z") }] });
  const fakes = makeFakes();
  assert.equal(await brainOf(repo, fakes).handleInbound(INBOUND), null);
  assert.equal(fakes.calls.length, 0);
});

test("responder: manda o texto da IA com autoria sdr-bot e contexto completo (agenda + conversa)", async () => {
  const repo = await world({ messages: [{ direction: "in", text: "como funciona?", at: ISO("2026-08-19T12:59:00Z") }] });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagem: "A gente clona seus anúncios entre contas. Consigo te mostrar ao vivo, qual período fica melhor?" }] });
  const r = await brainOf(repo, fakes).handleInbound(INBOUND);
  assert.equal(r, "responder");
  assert.equal(fakes.sent.length, 1);
  assert.match(fakes.sent[0].text, /clona seus anúncios/);
  const out = (await repo.list("wa_messages")).filter((m) => m.direction === "out");
  assert.equal(out.length, 1);
  assert.equal(out[0].author, "sdr-bot");
  // A IA recebeu a agenda real e a conversa.
  const ctx = fakes.calls[0];
  assert.equal(ctx.slots[0].at, SLOT1);
  assert.equal(ctx.conversation.at(-1).who, "LEAD");
  assert.equal(ctx.sdrName, "Manuela");
});

test("firstReply: conversa sem NENHUMA mensagem nossa liga a descoberta; template já enviado desliga", async () => {
  // Lead escreveu primeiro (clique do form): descoberta antes de agendar.
  const repo = await world({ messages: [{ direction: "in", text: "Oi, quero saber mais sobre a LeverAds", at: ISO("2026-08-19T12:59:00Z") }] });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagem: "Isso ajudaria na sua operação?" }] });
  await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "Oi, quero saber mais sobre a LeverAds" } });
  assert.equal(fakes.calls[0].firstReply, true);

  // 1º toque (template) já saiu: conversa em andamento, sem descoberta de novo.
  const repo2 = await world({ messages: [
    { direction: "out", author: "sdr-bot", text: "Oiii, Rafael. Recebi seu diagnóstico aqui. Isso ajudaria na sua operação?", at: ISO("2026-08-19T12:50:00Z") },
    { direction: "in", text: "ajudaria sim", at: ISO("2026-08-19T12:59:00Z") },
  ] });
  const fakes2 = makeFakes({ decisions: [{ acao: "responder", mensagem: "Perfeito, vamos agendar?" }] });
  await brainOf(repo2, fakes2).handleInbound({ message: { from: "5541999990000", text: "ajudaria sim" } });
  assert.equal(fakes2.calls[0].firstReply, false);
});

test("walk-in: conversa sem lead vira card preenchido pelo prefill e o robô atende", async () => {
  const repo = await world({ messages: [] });
  // Conversa de um número DESCONHECIDO (sem lead): só thread + mensagem dele.
  await repo.create("wa_threads", { id: "5532988887777", phone: "5532988887777", saas: "leverads", name: "José Larino Souza" });
  const texto = "Oi, me chamo José Larino e quero saber mais sobre a LeverAds. Resumo da minha operação: segmento - Autopeças, contas no ML/Shopee - 3 a 5 contas, anúncios na maior conta - 500 a 2 mil.";
  await repo.create("wa_messages", { id: "wk1", thread: "5532988887777", direction: "in", text: texto, at: ISO("2026-08-19T12:59:00Z") });
  // leadQuestions do produto ganham os rótulos usados no prefill.
  await repo.update("products", "leverads", { leadQuestions: [
    { key: "niche", label: "Nicho", options: [{ value: "autopecas", label: "Autopeças" }] },
    { key: "accounts", label: "Contas", options: [{ value: "3-5", label: "3 a 5 contas" }] },
    { key: "listings", label: "Anúncios", options: [{ value: "500-2000", label: "500 a 2 mil" }] },
  ] });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagem: "Isso ajudaria na sua operação?" }] });
  const r = await brainOf(repo, fakes).handleInbound({ message: { from: "5532988887777", text: texto, id: "wk1" } });
  assert.equal(r, "responder");
  const novo = (await repo.list("leads")).find((l) => l.phone === "5532988887777");
  assert.ok(novo, "lead do walk-in criado");
  assert.equal(novo.name, "José Larino");
  assert.equal(novo.niche, "autopecas");
  assert.equal(novo.accounts, "3-5");
  assert.equal(novo.listings, "500-2000");
  assert.equal(novo.source, "WhatsApp · chegou direto");
  assert.equal((await repo.get("wa_threads", "5532988887777")).leadId, novo.id);
  assert.equal(fakes.sent.length, 1);
});

test("walk-in: cliente da casa e robô de loja NÃO viram lead", async () => {
  const repo = await world({ messages: [] });
  await repo.create("customers", { id: "C1", name: "Cliente", phone: "41911112222" });
  await repo.create("wa_threads", { id: "5541911112222", phone: "5541911112222", saas: "leverads", name: "Cliente" });
  await repo.create("wa_messages", { id: "wk2", thread: "5541911112222", direction: "in", text: "oi, preciso de suporte", at: ISO("2026-08-19T12:59:00Z") });
  const fakes = makeFakes();
  assert.equal(await brainOf(repo, fakes).handleInbound({ message: { from: "5541911112222", text: "oi, preciso de suporte", id: "wk2" } }), null);

  await repo.create("wa_threads", { id: "5541933334444", phone: "5541933334444", saas: "leverads", name: "Loja X" });
  await repo.create("wa_messages", { id: "wk3", thread: "5541933334444", direction: "in", text: "Loja X agradece seu contato. Como podemos ajudar?", at: ISO("2026-08-19T12:59:00Z") });
  assert.equal(await brainOf(repo, fakes).handleInbound({ message: { from: "5541933334444", text: "Loja X agradece seu contato. Como podemos ajudar?", id: "wk3" } }), "auto-reply");
  assert.equal((await repo.list("leads")).filter((l) => l.id !== "L1").length, 0, "nenhum lead novo criado");
  assert.equal(fakes.calls.length, 0);
});

test("auto-atendimento de loja na 1ª resposta: silêncio, sem gastar IA", async () => {
  const repo = await world({ messages: [
    { direction: "out", author: "sdr-bot", text: "Oiii, Rafael. Isso ajudaria na sua operação?", at: ISO("2026-08-19T12:58:00Z") },
    { direction: "in", text: "MAF Imports agradece seu contato. Como podemos ajudar? Para facilitar informe os 7 últimos números do chassi.", at: ISO("2026-08-19T12:59:00Z") },
  ] });
  const fakes = makeFakes();
  assert.equal(await brainOf(repo, fakes).handleInbound(INBOUND), "auto-reply");
  assert.equal(fakes.calls.length, 0);
  assert.equal(fakes.sent.length, 0);
  // Gente de verdade escrevendo depois segue o fluxo normal.
  await repo.create("wa_messages", { id: "mX", thread: "5541999990000", leadId: "L1", direction: "in", text: "oi, tem interesse sim", at: ISO("2026-08-19T13:05:00Z") });
  const fakes2 = makeFakes({ decisions: [{ acao: "responder", mensagem: "Perfeito" }] });
  assert.equal(await brainOf(repo, fakes2).handleInbound({ message: { from: "5541999990000", text: "oi, tem interesse sim", id: "mX" } }), "responder");
});

test("remarcar: confirmação CURTA, sem repetir sócio e lembrete", async () => {
  const repo = await world({
    lead: { stage: "Call agendada", callAt: "2026-08-19T16:00", email: "r@x.com", callUrl: "https://meet.google.com/abc", closer: "pl" },
    messages: [{ direction: "in", text: "consegue mais cedo?", at: ISO("2026-08-19T12:59:00Z") }],
  });
  const fakes = makeFakes({ decisions: [{ acao: "remarcar", horario: SLOT1 }] });
  assert.equal(await brainOf(repo, fakes).handleInbound(INBOUND), "remarcar");
  assert.match(fakes.sent[0].text, /remarcado então pra hoje \(19\/08\) às 13h/);
  assert.match(fakes.sent[0].text, /convite atualizado/);
  assert.ok(!/sócio/.test(fakes.sent[0].text), "remarcação não repete o bloco do sócio");
  assert.equal((await repo.get("leads", "L1")).callAt, SLOT1);
});

test("trava de beco: interesse respondido sem pergunta ganha a oferta do par; adiamento não", async () => {
  // Caso Daniel: "Opa sim" → afirmação solta. O motor emenda a oferta.
  const repo = await world({ messages: [
    { direction: "out", author: "sdr-bot", text: "Isso ajudaria na sua operação?", at: ISO("2026-08-19T12:50:00Z") },
    { direction: "in", text: "Opa sim", at: ISO("2026-08-19T12:59:00Z") },
  ] });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagem: "Perfeito, nosso especialista mostra a ferramenta funcionando na prática" }] });
  await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "Opa sim" } });
  assert.equal(fakes.sent.length, 2);
  assert.match(fakes.sent[1].text, /qual fica melhor pra você\?/);
  assert.match(fakes.sent[1].text, /às \d/);

  // Horários JÁ oferecidos: repescagem curta, sem re-listar.
  const repo2 = await world({ messages: [
    { direction: "out", author: "sdr-bot", text: "Consigo hoje às 13h ou hoje às 15h, qual fica melhor?", at: ISO("2026-08-19T12:50:00Z") },
    { direction: "in", text: "pode ser sim", at: ISO("2026-08-19T12:59:00Z") },
  ] });
  const fakes2 = makeFakes({ decisions: [{ acao: "responder", mensagem: "Maravilha, vai ser uma ótima conversa" }] });
  await brainOf(repo2, fakes2).handleInbound({ message: { from: "5541999990000", text: "pode ser sim" } });
  assert.match(fakes2.sent.at(-1).text, /Algum dos horários que te passei encaixa/);

  // Lead ADIANDO ("vou pensar e te falo"): resposta sem pergunta passa sem empurrão.
  const repo3 = await world({ messages: [
    { direction: "in", text: "vou pensar e depois te falo", at: ISO("2026-08-19T12:59:00Z") },
  ] });
  const fakes3 = makeFakes({ decisions: [{ acao: "responder", mensagem: "Tranquilo, fico no aguardo" }] });
  await brainOf(repo3, fakes3).handleInbound({ message: { from: "5541999990000", text: "vou pensar e depois te falo" } });
  assert.equal(fakes3.sent.length, 1);
  assert.ok(!/qual fica melhor/.test(fakes3.sent[0].text));
});

test("trava de preço: resposta da IA com valor vira o desvio com autoridade (sem número)", async () => {
  const repo = await world({ messages: [{ direction: "in", text: "quanto custa?", at: ISO("2026-08-19T12:59:00Z") }] });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagem: "O plano parte de R$ 299 por mês, fechado?" }] });
  const r = await brainOf(repo, fakes).handleInbound(INBOUND);
  assert.equal(r, "preco-travado");
  assert.equal(fakes.sent.length, 1);
  assert.ok(!/299|R\$/.test(fakes.sent[0].text));
  assert.match(fakes.sent[0].text, /necessidades da sua operação/);
  assert.ok(!/às \d/.test(fakes.sent[0].text), "resposta de preço não re-oferece horário");
  assert.ok((await repo.get("leads", "L1")).sdrLog.priceGuardAt);
});

test("agendar com horário da lista: card vai pra etapa de call pelo caminho canônico, com confirmação comprovada e Meet automático", async () => {
  const repo = await world({ messages: [{ direction: "in", text: "pode ser meio dia", at: ISO("2026-08-19T12:59:00Z") }] });
  const fakes = makeFakes({ decisions: [{ acao: "agendar", horario: SLOT1 }] });
  const r = await brainOf(repo, fakes).handleInbound(INBOUND);
  assert.equal(r, "agendar");
  const lead = await repo.get("leads", "L1");
  assert.equal(lead.stage, "Call agendada");
  assert.equal(lead.callAt, SLOT1);
  assert.equal(lead.closer, "pl");
  assert.equal(lead.callConfirmed, false);
  // Movimento canônico: activity de stage registrada.
  const stageActs = (await repo.list("activities")).filter((a) => a.type === "stage");
  assert.equal(stageActs.length, 1);
  assert.equal(stageActs[0].meta.to, "Call agendada");
  // Confirmação enxuta (Leo, 23/08) e com a data cravada (Leo, 24/08):
  // combinado + sócio + lembrete, sem re-descrever a demo e sem pedir e-mail.
  assert.match(fakes.sent[0].text, /Perfeito Rafael, agendado então pra hoje \(19\/08\) às 13h/);
  assert.ok(!/entrar nas suas contas/.test(fakes.sent[0].text), "a gente não entra nas contas do lead");
  assert.match(fakes.sent[0].text, /sócio/);
  assert.deepEqual(fakes.meets, ["L1"]);
});

test("agendar com horário INVENTADO: nada é marcado, re-oferta determinística", async () => {
  const repo = await world({ messages: [{ direction: "in", text: "pode ser 9h", at: ISO("2026-08-19T12:59:00Z") }] });
  const fakes = makeFakes({ decisions: [{ acao: "agendar", horario: "2026-08-19T09:00" }] });
  const r = await brainOf(repo, fakes).handleInbound(INBOUND);
  assert.equal(r, "reoferta");
  const lead = await repo.get("leads", "L1");
  assert.equal(lead.stage, "Qualificando");
  assert.equal(lead.callAt || "", "");
  assert.match(fakes.sent[0].text, /hoje às 13h/);
});

test("humano: alerta quente + transição curta, e o robô fica calado até gente falar", async () => {
  const repo = await world({ messages: [{ direction: "in", text: "esse part number 123 puxa?", at: ISO("2026-08-19T12:59:00Z") }] });
  const fakes = makeFakes({ decisions: [{ acao: "humano", motivoHumano: "dúvida técnica de part number", mensagem: "Boa! Vou chamar nosso especialista de autopeças aqui pra te responder certinho." }] });
  const brain = brainOf(repo, fakes);
  assert.equal(await brain.handleInbound(INBOUND), "humano");
  const alerts = await repo.list("wa_alerts");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].text, /part number/);
  assert.equal(fakes.sent.length, 1);
  assert.ok((await repo.get("leads", "L1")).sdrLog.handoffAt);
  // Próxima mensagem do lead: sem humano na conversa, o robô espera.
  assert.equal(await brain.handleInbound({ message: { from: "5541999990000", text: "e aí?" } }), "waiting-human");
  assert.equal(fakes.calls.length, 1, "a IA não é chamada de novo no handoff pendente");
});

test("gente falou há pouco na conversa: o robô não fala por cima", async () => {
  const repo = await world({
    messages: [
      { direction: "out", author: "leonardo", text: "deixa comigo", at: ISO("2026-08-19T12:30:00Z") },
      { direction: "in", text: "ok", at: ISO("2026-08-19T12:59:00Z") },
    ],
  });
  const fakes = makeFakes();
  assert.equal(await brainOf(repo, fakes).handleInbound(INBOUND), "human-active");
  assert.equal(fakes.calls.length, 0);
});

test("e-mail que aparece na mensagem entra no cadastro do lead", async () => {
  const repo = await world({ messages: [{ direction: "in", text: "meu email é rafa@loja.com.br", at: ISO("2026-08-19T12:59:00Z") }] });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagem: "Perfeito, convite indo!", email: "rafa@loja.com.br" }] });
  await brainOf(repo, fakes).handleInbound(INBOUND);
  assert.equal((await repo.get("leads", "L1")).email, "rafa@loja.com.br");
});

test("teto diário por conversa: depois de 15 mensagens do robô, vira handoff com alerta", async () => {
  const many = Array.from({ length: 15 }, (_, i) => ({
    direction: "out", author: "sdr-bot", text: "msg " + i, at: ISO(`2026-08-19T0${Math.min(9, i % 10)}:0${i % 6}:00Z`),
  }));
  const repo = await world({ messages: [...many, { direction: "in", text: "hmm", at: ISO("2026-08-19T12:59:00Z") }] });
  const fakes = makeFakes();
  assert.equal(await brainOf(repo, fakes).handleInbound(INBOUND), "cap");
  assert.equal(fakes.calls.length, 0);
  assert.equal((await repo.list("wa_alerts")).length, 1);
});

test("remarcar: callAt antigo já passado vai pro histórico e o GPS segue o horário novo", async () => {
  const repo = await world({
    lead: { stage: "Call agendada", callAt: "2026-08-18T10:00", closer: "pl", callConfirmed: true },
    messages: [{ direction: "in", text: "consegui não, pode ser meio dia hoje?", at: ISO("2026-08-19T12:59:00Z") }],
  });
  const fakes = makeFakes({ decisions: [{ acao: "remarcar", horario: SLOT1 }] });
  const r = await brainOf(repo, fakes).handleInbound(INBOUND);
  assert.equal(r, "remarcar");
  const lead = await repo.get("leads", "L1");
  assert.equal(lead.callAt, SLOT1);
  assert.equal(lead.stage, "Call agendada");
  assert.equal(lead.callConfirmed, false, "confirmação é do horário novo");
  assert.deepEqual(lead.callHistory, [{ at: "2026-08-18T10:00", closer: "pl" }]);
  assert.equal(lead.nextActionAt, new Date("2026-08-19T13:00:00-03:00").toISOString());
});

test("desmarcar: call sai da agenda de verdade, Meet cancelado, time avisado e remarcação oferecida", async () => {
  // Caso 24/08: lead avisou que não ia conseguir, o robô aceitou de boca,
  // deixou o callAt de pé e o lembrete de 1h ainda disparou depois.
  const repo = await world({
    lead: { stage: "Call agendada", callAt: "2026-08-19T16:00", closer: "pl", callConfirmed: true, callUrl: "https://meet.google.com/abc", meetEventId: "ev1" },
    messages: [{ direction: "in", text: "não vou conseguir hoje, entro em contato pra reagendar", at: ISO("2026-08-19T12:59:00Z") }],
  });
  const fakes = makeFakes({ decisions: [{ acao: "desmarcar" }] });
  const r = await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "não vou conseguir hoje, entro em contato pra reagendar" } });
  assert.equal(r, "desmarcar");
  const lead = await repo.get("leads", "L1");
  assert.equal(lead.callAt || "", "", "callAt limpo: lembrete de 1h/10min não dispara mais");
  assert.equal(lead.stage, "Qualificando", "card volta pro funil pelo caminho canônico");
  assert.equal(lead.callConfirmed, false);
  assert.ok(!(lead.callHistory || []).length, "call futura cancelada não vira histórico de call feita");
  const stageActs = (await repo.list("activities")).filter((a) => a.type === "stage");
  assert.equal(stageActs.length, 1);
  assert.equal(stageActs[0].meta.to, "Qualificando");
  // Resposta: confirma a desmarcação e JÁ oferece horários reais de remarcação.
  assert.equal(fakes.sent.length, 2);
  assert.match(fakes.sent[0].text, /já desmarquei aqui/);
  assert.match(fakes.sent[1].text, /qual fica melhor pra você\?/);
  assert.match(fakes.sent[1].text, /às \d/);
  // Convite do Meet cancelado e alerta pro time.
  assert.deepEqual(fakes.meetCancels, ["L1"]);
  const alerts = await repo.list("wa_alerts");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].text, /Desmarcou a call de hoje \(19\/08\) às 16h/);
});

test("desmarcar sem call marcada: nada a cancelar, a resposta segue o fluxo comum", async () => {
  const repo = await world({ messages: [{ direction: "in", text: "hoje não consigo falar", at: ISO("2026-08-19T12:59:00Z") }] });
  const fakes = makeFakes({ decisions: [{ acao: "desmarcar", mensagem: "Tranquilo, quando ficar bom me chama aqui" }] });
  const r = await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "hoje não consigo falar" } });
  assert.equal(r, "responder");
  assert.equal(fakes.meetCancels.length, 0);
  assert.equal((await repo.get("leads", "L1")).stage, "Qualificando");
  assert.equal((await repo.list("wa_alerts")).length, 0);
});

test("lead fora da região do SDR (ganho) ou com opt-out: o cérebro não age", async () => {
  const repo1 = await world({ lead: { stage: "Ganho", customerId: "c1" }, messages: [{ direction: "in", text: "oi", at: ISO("2026-08-19T12:59:00Z") }] });
  const f1 = makeFakes();
  assert.equal(await brainOf(repo1, f1).handleInbound(INBOUND), null);
  const repo2 = await world({ lead: { whatsappOptOut: true }, messages: [{ direction: "in", text: "oi", at: ISO("2026-08-19T12:59:00Z") }] });
  const f2 = makeFakes();
  assert.equal(await brainOf(repo2, f2).handleInbound(INBOUND), null);
  assert.equal(f1.calls.length + f2.calls.length, 0);
});

test("IA quebrada não derruba nada: vira log + um alerta espaçado", async () => {
  const repo = await world({ messages: [{ direction: "in", text: "oi", at: ISO("2026-08-19T12:59:00Z") }] });
  const fakes = makeFakes();
  fakes.anthropic.sdrDecide = async () => { throw new Error("provider caiu"); };
  const brain = brainOf(repo, fakes);
  assert.equal(await brain.handleInbound(INBOUND), "error");
  assert.equal((await repo.list("wa_alerts")).length, 1);
  assert.equal(await brain.handleInbound(INBOUND), "error");
  assert.equal((await repo.list("wa_alerts")).length, 1, "alerta de erro não empilha (janela de 6h)");
});

test("bookCall direto: exige etapa de call no funil", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "x", funnel: [{ stage: "Novo", kind: "novo" }] });
  const product = await repo.get("products", "x");
  const lead = await repo.create("leads", { id: "L9", saas: "x", stage: "Novo" });
  await assert.rejects(() => bookCall(repo, { lead, product, at: "2026-08-19T12:00", closer: "c" }), /funil sem etapa de call/);
});

test("nota de voz é transcrita antes da decisão: áudio com horário vira agendamento", async () => {
  const repo = await world({ messages: [{ direction: "in", text: "🎤 áudio", media: { kind: "audio", id: "MID1", mime: "audio/ogg" }, at: ISO("2026-08-19T12:59:00Z") }] });
  await repo.create("wa_media", { id: "m1", mime: "audio/ogg", data: Buffer.from("a".repeat(2048)).toString("base64") });
  const fakes = makeFakes({ decisions: [{ acao: "agendar", horario: SLOT1 }] });
  const transcriber = { configured: () => true, transcribe: async () => "pode ser meio dia então" };
  const brain = makeSdrBrain({
    repo, whatsapp: fakes.wa, anthropic: fakes.anthropic, autoCallMeet: fakes.autoCallMeet, transcriber,
    log: { warn: () => {} }, now: () => NOW, replyDelayMs: 0, sleep: async () => {},
  });
  assert.equal(await brain.handleInbound(INBOUND), "agendar");
  // A IA viu o texto transcrito, não o "🎤 áudio"…
  assert.match(fakes.calls[0].conversation.at(-1).text, /\[áudio\] pode ser meio dia/);
  // …e o transcript ficou gravado na mensagem (conversa legível pra sempre).
  const msg = (await repo.list("wa_messages")).find((m) => m.media?.kind === "audio");
  assert.equal(msg.transcript, "pode ser meio dia então");
});

test("sem transcrição configurada, o áudio segue como áudio (e o prompt manda pra humano)", async () => {
  const repo = await world({ messages: [{ direction: "in", text: "🎤 áudio", media: { kind: "audio", id: "MID1" }, at: ISO("2026-08-19T12:59:00Z") }] });
  const fakes = makeFakes({ decisions: [{ acao: "humano", motivoHumano: "áudio sem transcrição" }] });
  const transcriber = { configured: () => false, transcribe: async () => { throw new Error("não chega aqui"); } };
  const brain = makeSdrBrain({
    repo, whatsapp: fakes.wa, anthropic: fakes.anthropic, autoCallMeet: fakes.autoCallMeet, transcriber,
    log: { warn: () => {} }, now: () => NOW, replyDelayMs: 0, sleep: async () => {},
  });
  assert.equal(await brain.handleInbound(INBOUND), "humano");
  assert.match(fakes.calls[0].conversation.at(-1).text, /áudio/);
});

test("modo teste: com conversationTest, a IA conversa com lead INTERNO; lead real fica de fora", async () => {
  const repo = await world({
    sdrBot: { conversation: false, conversationTest: true },
    lead: { internal: true },
    messages: [{ direction: "in", text: "como funciona?", at: ISO("2026-08-19T12:59:00Z") }],
  });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagem: "A gente clona seus anúncios, quer ver ao vivo?" }] });
  assert.equal(await brainOf(repo, fakes).handleInbound(INBOUND), "responder");

  // Lead REAL com só o modo teste ligado: intocado.
  const repo2 = await world({
    sdrBot: { conversation: false, conversationTest: true },
    messages: [{ direction: "in", text: "como funciona?", at: ISO("2026-08-19T12:59:00Z") }],
  });
  const f2 = makeFakes();
  assert.equal(await brainOf(repo2, f2).handleInbound(INBOUND), null);
  assert.equal(f2.calls.length, 0);

  // E o inverso: produção ligada NÃO conversa com lead interno (teste não vaza).
  const repo3 = await world({
    sdrBot: { conversation: true, conversationTest: false },
    lead: { internal: true },
    messages: [{ direction: "in", text: "oi", at: ISO("2026-08-19T12:59:00Z") }],
  });
  const f3 = makeFakes();
  assert.equal(await brainOf(repo3, f3).handleInbound(INBOUND), null);
});

test("dor de origem chega na IA com o foco certo (clone × OEM)", async () => {
  const repo = await world({
    lead: { sourcePain: "B" },
    messages: [{ direction: "in", text: "oi", at: ISO("2026-08-19T12:59:00Z") }],
  });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagem: "Entendo, conta banida trava tudo mesmo." }] });
  await brainOf(repo, fakes).handleInbound(INBOUND);
  assert.deepEqual(fakes.calls[0].pain, { code: "B", label: "Conta banida, precisa anunciar em conta nova", mode: "clone" });

  const repo2 = await world({
    lead: { sourcePain: "OEM" },
    messages: [{ direction: "in", text: "oi", at: ISO("2026-08-19T12:59:00Z") }],
  });
  const f2 = makeFakes({ decisions: [{ acao: "responder", mensagem: "O OEM monta o anúncio pelo código da peça." }] });
  await brainOf(repo2, f2).handleInbound(INBOUND);
  assert.equal(f2.calls[0].pain.mode, "oem");
});

test("saudação com timer de 6h: conversa quente proíbe 'Oi' de novo; fria libera", async () => {
  // Quente: última troca 2 min antes da mensagem nova.
  const repo = await world({
    messages: [
      { direction: "out", author: "sdr-bot", text: "Posso te mostrar segunda?", at: ISO("2026-08-19T12:57:00Z") },
      { direction: "in", text: "oi", at: ISO("2026-08-19T12:59:00Z") },
    ],
  });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagem: "Fica melhor 13h ou 13h30?" }] });
  await brainOf(repo, fakes).handleInbound(INBOUND);
  assert.equal(fakes.calls[0].canGreet, false);
  assert.ok(fakes.calls[0].gapMin < 10);

  // Fria: última troca 8h antes.
  const repo2 = await world({
    messages: [
      { direction: "out", author: "sdr-bot", text: "Posso te mostrar segunda?", at: ISO("2026-08-19T04:50:00Z") },
      { direction: "in", text: "oi", at: ISO("2026-08-19T12:59:00Z") },
    ],
  });
  const f2 = makeFakes({ decisions: [{ acao: "responder", mensagem: "Oi, Rafael! Retomamos?" }] });
  await brainOf(repo2, f2).handleInbound(INBOUND);
  assert.equal(f2.calls[0].canGreet, true);
});

test("convite de demonstração não se repete: a IA recebe o aviso quando ele já saiu", async () => {
  const repo = await world({
    messages: [
      { direction: "out", author: "sdr-bot", text: "Posso te mostrar a ferramenta funcionando ao vivo na segunda?", at: ISO("2026-08-19T12:50:00Z") },
      { direction: "in", text: "pode ser de tarde?", at: ISO("2026-08-19T12:59:00Z") },
    ],
  });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagem: "Tenho 13h ou 13h30, qual fica melhor?" }] });
  await brainOf(repo, fakes).handleInbound(INBOUND);
  assert.equal(fakes.calls[0].demoOffered, true);

  const repo2 = await world({ messages: [{ direction: "in", text: "oi", at: ISO("2026-08-19T12:59:00Z") }] });
  const f2 = makeFakes({ decisions: [{ acao: "responder", mensagem: "..." }] });
  await brainOf(repo2, f2).handleInbound(INBOUND);
  assert.equal(f2.calls[0].demoOffered, false);
});

test("rajada de mensagens: só o disparo da ÚLTIMA responde, lendo a conversa inteira", async () => {
  const repo = await world({
    messages: [
      { direction: "in", text: "olá", at: ISO("2026-08-19T12:58:50Z") },
      { direction: "in", text: "me ajudaria sim", at: ISO("2026-08-19T12:59:00Z") },
    ],
  });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagem: "Que bom! Quer ver funcionando ao vivo?" }] });
  const brain = brainOf(repo, fakes);
  // O disparo da PRIMEIRA mensagem acorda do debounce e vê que chegou mais nova: aborta.
  assert.equal(await brain.handleInbound({ message: { from: "5541999990000", text: "olá", id: "m1" } }), "superseded");
  assert.equal(fakes.calls.length, 0);
  // O disparo da ÚLTIMA responde, com a rajada inteira no contexto.
  assert.equal(await brain.handleInbound({ message: { from: "5541999990000", text: "me ajudaria sim", id: "m2" } }), "responder");
  assert.equal(fakes.calls.length, 1);
  assert.equal(fakes.sent.length, 1);
  const convo = fakes.calls[0].conversation;
  assert.equal(convo.at(-2).text, "olá");
  assert.equal(convo.at(-1).text, "me ajudaria sim");
});

test("o template do 1º toque conta como pitch feito: a IA recebe a proibição de re-listar", async () => {
  const repo = await world({
    messages: [
      { direction: "out", author: "sdr-bot", text: "Oiii, Rafael. A LeverAds cria o anúncio completo da sua autopeça só com o OEM (part number): fotos, título de 200 caracteres, descrição e compatibilidade inteira. Isso ajudaria?", at: ISO("2026-08-19T12:50:00Z") },
      { direction: "in", text: "quanto custa?", at: ISO("2026-08-19T12:59:00Z") },
    ],
  });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagem: "O especialista fecha o plano na demonstração. Segunda 9h ou 9h30?" }] });
  await brainOf(repo, fakes).handleInbound(INBOUND);
  assert.equal(fakes.calls[0].demoOffered, true, "pitch do template detectado, mesmo sem a palavra demonstração");
});

test("horário já oferecido não se repete: a IA recebe o aviso quando a agenda já foi passada", async () => {
  const repo = await world({
    messages: [
      { direction: "out", author: "sdr-bot", text: "Consigo te mostrar na segunda às 9h ou às 9h30, qual fica melhor?", at: ISO("2026-08-19T12:50:00Z") },
      { direction: "in", text: "quanto custa?", at: ISO("2026-08-19T12:59:00Z") },
    ],
  });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagem: "Depende da operação. Algum dos horários que te passei encaixa?" }] });
  await brainOf(repo, fakes).handleInbound(INBOUND);
  assert.equal(fakes.calls[0].slotsOffered, true);

  const repo2 = await world({ messages: [{ direction: "in", text: "oi", at: ISO("2026-08-19T12:59:00Z") }] });
  const f2 = makeFakes({ decisions: [{ acao: "responder", mensagem: "..." }] });
  await brainOf(repo2, f2).handleInbound(INBOUND);
  assert.equal(f2.calls[0].slotsOffered, false);
});

test("resposta longa quebra em até 3 envios em sequência; direta segue em um só", async () => {
  const repo = await world({ messages: [{ direction: "in", text: "me explica tudo", at: ISO("2026-08-19T12:59:00Z") }] });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagens: ["Boa! Te explico rapidinho.", "Você digita o OEM e recebe o anúncio pronto.", "Quer ver ao vivo?"] }] });
  await brainOf(repo, fakes).handleInbound(INBOUND);
  assert.equal(fakes.sent.length, 3);
  assert.match(fakes.sent[0].text, /Te explico/);
  assert.match(fakes.sent[2].text, /ao vivo/);
  const out = (await repo.list("wa_messages")).filter((m) => m.direction === "out");
  assert.equal(out.length, 3, "cada parte vira uma mensagem separada na conversa");
});

test("confirmação de agendamento enxuta: sem re-descrever a demo e sem pedir e-mail", async () => {
  const repo = await world({ messages: [{ direction: "in", text: "pode ser 13h", at: ISO("2026-08-19T12:59:00Z") }] });
  const fakes = makeFakes({ decisions: [{ acao: "agendar", horario: SLOT1 }] });
  await brainOf(repo, fakes).handleInbound(INBOUND);
  const text = fakes.sent[0].text;
  assert.match(text, /Perfeito Rafael, agendado então pra hoje \(19\/08\) às 13h/);
  assert.ok(!/\bcall\b/i.test(text), "a palavra call nunca chega no lead");
  assert.match(text, /sócio/);
  assert.match(text, /lembrete/);
  assert.ok(!/demonstraç/.test(text), "não re-descreve a demonstração");
  assert.ok(!/e-mail/.test(text), "não pede e-mail (vem do formulário)");
});

test("digitando… aparece pro lead enquanto a IA pensa e entre as partes", async () => {
  const repo = await world({ messages: [{ id: "in9", direction: "in", text: "me explica", at: ISO("2026-08-19T12:59:00Z") }] });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagens: ["Parte um.", "Parte dois."] }] });
  const typed = [];
  fakes.wa.sendTyping = async (id) => { typed.push(id); };
  await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "me explica", id: "in9" } });
  assert.ok(typed.length >= 2, "digitando ao pensar + reaceso entre as partes");
  assert.ok(typed.every((id) => id === "in9"));
  assert.equal(fakes.sent.length, 2);
});

test("confirmação avisa do convite por e-mail SÓ quando o card tem e-mail", async () => {
  const repo = await world({
    lead: { email: "rafa@loja.com.br" },
    messages: [{ direction: "in", text: "pode ser 13h", at: ISO("2026-08-19T12:59:00Z") }],
  });
  const fakes = makeFakes({ decisions: [{ acao: "agendar", horario: SLOT1 }] });
  await brainOf(repo, fakes).handleInbound(INBOUND);
  assert.match(fakes.sent[0].text, /o convite vai chegar no seu e-mail/);
});
