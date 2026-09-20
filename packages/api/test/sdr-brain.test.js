import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeSdrBrain, bookCall, stripDuration, stripDeviceAsk, PRICE_RX } from "../src/sdr-brain.js";

// Relógio dos testes: quarta 19/08/2026, 10h BRT (13h UTC). Com o closer livre
// o primeiro horário OFERTÁVEL é 09:00 do próximo dia útil.
const NOW = new Date("2026-08-19T13:00:00Z");
const ISO = (s) => new Date(s).toISOString();
const SLOT1 = "2026-08-20T09:00";

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
    { id: "pl", name: "Jonathan", roles: ["closer"], compLevel: 2 },
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
    messages: [{ direction: "in", text: "pode remarcar para amanhã às 9h?", at: ISO("2026-08-19T12:59:00Z") }],
  });
  const fakes = makeFakes({ decisions: [{ acao: "remarcar", horario: SLOT1 }] });
  assert.equal(await brainOf(repo, fakes).handleInbound(INBOUND), "remarcar");
  assert.match(fakes.sent[0].text, /remarcado então pra amanhã \(20\/08\) às 9h/);
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
    { direction: "out", author: "sdr-bot", text: "Consigo amanhã às 9h ou amanhã às 11h, qual fica melhor?", at: ISO("2026-08-19T12:50:00Z") },
    { direction: "in", text: "pode ser sim", at: ISO("2026-08-19T12:59:00Z") },
  ] });
  const fakes2 = makeFakes({ decisions: [{ acao: "responder", mensagem: "Maravilha, vai ser uma ótima conversa" }] });
  await brainOf(repo2, fakes2).handleInbound({ message: { from: "5541999990000", text: "pode ser sim" } });
  // Sem "algum dos horários que te passei" (frase proibida, Leo 17/09): os horários vão escritos.
  assert.match(fakes2.sent.at(-1).text, /^Fica melhor amanhã às 9h ou amanhã às 11h\?$/);

  // Lead ADIANDO ("vou pensar e te falo"): resposta sem pergunta passa sem empurrão.
  const repo3 = await world({ messages: [
    { direction: "in", text: "vou pensar e depois te falo", at: ISO("2026-08-19T12:59:00Z") },
  ] });
  const fakes3 = makeFakes({ decisions: [{ acao: "responder", mensagem: "Tranquilo, fico no aguardo" }] });
  await brainOf(repo3, fakes3).handleInbound({ message: { from: "5541999990000", text: "vou pensar e depois te falo" } });
  assert.equal(fakes3.sent.length, 1);
  assert.ok(!/qual fica melhor/.test(fakes3.sent[0].text));
});

test("oferta fantasma: 'os horários que te passei' sem ter passado vira a oferta real", async () => {
  // Caso Gabriel (25/08): retomada é template SEM horário, e a IA respondeu
  // citando horários que nunca existiram.
  const repo = await world({ messages: [
    { direction: "out", author: "sdr-bot", text: "Oiii Gabriel, tudo bem? Vamos retomar nossa conversa sobre a LeverAds? Me dá um ok aqui, por favor", at: ISO("2026-08-19T12:00:00Z") },
    { direction: "in", text: "Ola tudo bem e com você ?", at: ISO("2026-08-19T12:59:00Z") },
  ] });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagens: [
    "Tudo certo por aqui também",
    "Conseguimos retomar a demonstração amanhã, algum dos horários que te passei encaixa?",
  ] }] });
  await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "Ola tudo bem e com você ?" } });
  const textos = fakes.sent.map((s) => s.text);
  assert.ok(!textos.some((t) => /que te passei/i.test(t)), "a frase mentirosa não sai");
  // "Ola tudo bem" não é interesse: a oferta real cai pela trava de qualificação e fica a descoberta (Leo, 17/09).
  assert.equal(textos.at(-1), "Isso ajudaria na sua operação hoje?");
  assert.equal(textos[0], "Tudo certo por aqui também", "o resto da resposta é preservado");
  assert.ok((await repo.get("leads", "L1")).sdrLog.fakeOfferGuardAt);

  // Lead que JÁ engajou ("sim, tenho interesse"): a oferta de verdade entra no lugar da fantasma.
  const repo2 = await world({ messages: [
    { direction: "out", author: "sdr-bot", text: "Oiii Gabriel, tudo bem? Vamos retomar nossa conversa sobre a LeverAds? Me dá um ok aqui, por favor", at: ISO("2026-08-19T12:00:00Z") },
    { direction: "in", text: "Sim, tenho interesse", at: ISO("2026-08-19T12:59:00Z") },
  ] });
  const fakes2 = makeFakes({ decisions: [{ acao: "responder", mensagens: ["Perfeito", "Algum dos horários que te passei encaixa?"] }] });
  await brainOf(repo2, fakes2).handleInbound({ message: { from: "5541999990000", text: "Sim, tenho interesse" } });
  assert.match(fakes2.sent.at(-1).text, /Consigo .*às \d/, "entra a oferta de verdade");
});

test("horário JÁ oferecido antes: a referência é legítima e passa", async () => {
  const repo = await world({ messages: [
    { direction: "out", author: "sdr-bot", text: "Consigo amanhã às 9h ou amanhã às 11h, qual fica melhor?", at: ISO("2026-08-19T12:00:00Z") },
    { direction: "in", text: "vou ver aqui", at: ISO("2026-08-19T12:59:00Z") },
  ] });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagem: "Tranquilo! Algum dos horários que te passei encaixa?" }] });
  await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "vou ver aqui" } });
  assert.match(fakes.sent[0].text, /que te passei/i);
  assert.equal((await repo.get("leads", "L1")).sdrLog?.fakeOfferGuardAt, undefined);
});

test("dia solto sem hora vira oferta concreta (o mais cedo primeiro)", async () => {
  const repo = await world({ messages: [
    { direction: "out", author: "sdr-bot", text: "Isso ajudaria na sua operação?", at: ISO("2026-08-19T12:50:00Z") },
    { direction: "in", text: "sim, ajudaria", at: ISO("2026-08-19T12:59:00Z") },
  ] });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagem: "Conseguimos retomar a demonstração amanhã, o que acha?" }] });
  await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "sim, ajudaria" } });
  const ultima = fakes.sent.at(-1).text;
  assert.match(ultima, /às \d/, "sai com hora escrita");
  // O relógio do teste é 10h BRT e há vaga hoje, mas a oferta começa amanhã às 9h.
  assert.match(fakes.sent.map((x) => x.text).join(" "), /amanhã às 9h/);
});

test("resposta que já traz hora não é mexida", async () => {
  const repo = await world({ messages: [
    { direction: "in", text: "sim, quero", at: ISO("2026-08-19T12:59:00Z") },
  ] });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagem: "Perfeito! Consigo amanhã às 9h ou amanhã às 11h, qual fica melhor pra você?" }] });
  await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "sim, quero" } });
  assert.equal(fakes.sent.length, 1);
  assert.match(fakes.sent[0].text, /amanhã às 9h ou amanhã às 11h/);
});

test("afiliado da Shopee: robô não agenda, desmarca o que estava marcado e chama gente", async () => {
  // Caso Judite (25/08): marcou call, depois disse que era afiliada, e o robô
  // manteve o horário "pro especialista avaliar".
  const repo = await world({
    lead: { stage: "Call agendada", callAt: SLOT1, closer: "pl", callUrl: "https://meet.google.com/abc" },
    messages: [{ direction: "in", text: "Não querida sou afilhado da shopee etc", at: ISO("2026-08-19T12:59:00Z") }],
  });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagem: "Nosso especialista confirma se a ferramenta se aplica" }] });
  const r = await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "Não querida sou afilhado da shopee etc" } });
  assert.equal(r, "afiliado");
  const lead = await repo.get("leads", "L1");
  assert.equal(lead.callAt || "", "", "a call foi desmarcada e o horário liberado");
  assert.ok(lead.sdrLog.affiliateGuardAt);
  assert.ok(lead.sdrLog.handoffAt, "robô sai da conversa");
  assert.match(fakes.sent[0].text, /conta PRÓPRIA/);
  const alerts = await repo.list("wa_alerts");
  assert.match(alerts[0].text, /AFILIADO/);
  // Não repete o desmarque nas mensagens seguintes.
  const fakes2 = makeFakes({ decisions: [{ acao: "responder", mensagem: "ok" }] });
  assert.notEqual(await brainOf(repo, fakes2).handleInbound({ message: { from: "5541999990000", text: "entendi" } }), "afiliado");
});

test("vendedor com conta própria na Shopee NÃO é confundido com afiliado", async () => {
  const repo = await world({ messages: [{ direction: "in", text: "tenho loja própria na shopee e no ML, pode ser às 10h", at: ISO("2026-08-19T12:59:00Z") }] });
  const fakes = makeFakes({ decisions: [{ acao: "agendar", horario: SLOT1 }] });
  const r = await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "tenho loja própria na shopee e no ML, pode ser às 10h" } });
  assert.equal(r, "agendar");
  assert.equal((await repo.get("leads", "L1")).callAt, SLOT1);
});

test("horário preenchido no meio do caminho: pede desculpa e diz que outro cliente pegou", async () => {
  // Caso Gabriel (25/08): escolheu um horário que NÓS oferecemos e ouviu
  // "Esse horário não consigo" seco.
  const repo = await world({ messages: [
    { direction: "out", author: "sdr-bot", text: "Consigo amanhã às 9h ou amanhã às 11h, qual fica melhor?", at: ISO("2026-08-19T12:50:00Z") },
    { direction: "in", text: "as 15h fica melhor", at: ISO("2026-08-19T12:59:00Z") },
  ] });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagem: "Esse horário não consigo, mas tenho amanhã às 9h" }] });
  await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "as 15h fica melhor" } });
  const texto = fakes.sent.map((x) => x.text).join(" ");
  assert.ok(!/não consigo/i.test(texto), "a recusa seca não sai");
  assert.match(texto, /preenchido por outro cliente/);
  assert.match(texto, /desculpa/i);
  assert.match(texto, /às \d/, "já vem com horário novo");
  assert.ok((await repo.get("leads", "L1")).sdrLog.slotTakenGuardAt);
});

test("re-oferta determinística (horário inventado pela IA) também pede desculpa", async () => {
  const repo = await world({ messages: [{ direction: "in", text: "pode ser 9h", at: ISO("2026-08-19T12:59:00Z") }] });
  const fakes = makeFakes({ decisions: [{ acao: "agendar", horario: "2026-08-19T09:00" }] });
  assert.equal(await brainOf(repo, fakes).handleInbound(INBOUND), "reoferta");
  assert.match(fakes.sent[0].text, /preenchido por outro cliente, me desculpa/);
  assert.match(fakes.sent[0].text, /amanhã às 9h/);
});

test("oferta só em hora cheia; hora quebrada só quando o LEAD pede", async () => {
  const repo = await world({ messages: [{ direction: "in", text: "sim, quero ver", at: ISO("2026-08-19T12:59:00Z") }] });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagem: "Perfeito" }] });
  await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "sim, quero ver" } });
  // A trava de beco emenda a oferta: tem que vir em hora cheia.
  const ofertado = fakes.sent.map((x) => x.text).join(" ");
  assert.ok(!/\dh30/.test(ofertado), `oferta não usa hora quebrada: ${ofertado}`);
  // O PAR que a IA recebeu também é de hora cheia.
  for (const s of fakes.calls[0].suggestedPair) assert.ok(s.at.endsWith(":00"), `par sugerido em hora cheia: ${s.at}`);
  // Mas a lista COMPLETA (pra agendar o que o lead pedir) mantém as quebradas.
  assert.ok(fakes.calls[0].slots.some((s) => s.at.endsWith(":30")), "lista completa mantém meia hora");
});

test("lead que pede hora quebrada é agendado nela", async () => {
  const repo = await world({ messages: [{ direction: "in", text: "consigo só 13h30", at: ISO("2026-08-19T12:59:00Z") }] });
  const fakes = makeFakes({ decisions: [{ acao: "agendar", horario: "2026-08-20T13:30" }] });
  const r = await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "consigo só 13h30" } });
  assert.equal(r, "agendar");
  assert.equal((await repo.get("leads", "L1")).callAt, "2026-08-20T13:30");
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

test("PRICE_RX: pega valor escrito de todo jeito e deixa passar contagem de anúncios, minutos e hora", () => {
  for (const t of ["R$ 299", "299 reais", "a partir de 300", "1.500 por mês", "custa 2 mil reais", "12x de 250",
    "quinhentos reais", "10% de desconto", "no plano Escala", "sai por R$ 1.200,00", "fica em torno de 800,00", "R$ mil"]) {
    assert.ok(PRICE_RX.test(t), `devia travar: ${t}`);
  }
  for (const t of ["clona 200 anúncios", "a demonstração leva 30 minutos", "cerca de 20 contas", "amanhã às 14h",
    "escalar a operação", "fica em 2 contas", "12 anúncios por dia"]) {
    assert.ok(!PRICE_RX.test(t), `não devia travar: ${t}`);
  }
});

test("preço pela 2ª vez: robô explica os planos e puxa pra call, sem número, sem gente e sem prometer valor por aqui", async () => {
  const repo = await world({
    lead: { sdrLog: { priceGuardAt: ISO("2026-08-19T12:31:00Z") } },
    messages: [
      { direction: "in", text: "quanto custa?", at: ISO("2026-08-19T12:30:00Z") },
      { direction: "out", author: "sdr-bot", text: "O investimento é de acordo com as necessidades da sua operação: primeiro a gente entende o seu cenário.", at: ISO("2026-08-19T12:31:00Z") },
      { direction: "in", text: "só me diz a faixa de preço pra ver a viabilidade", at: ISO("2026-08-19T12:59:00Z") },
    ],
  });
  // Mesmo que a IA ainda peça gente, o motor manda a explicação e segue.
  const fakes = makeFakes({ decisions: [{ acao: "humano", motivoHumano: "insistiu no preço" }] });
  const r = await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "só me diz a faixa de preço pra ver a viabilidade" } });
  assert.equal(r, "preco-explicado");
  assert.equal(fakes.sent.length, 1);
  const t = fakes.sent[0].text;
  assert.match(t, /planos diferentes/);
  assert.match(t, /só fecha na call/);
  assert.ok(!PRICE_RX.test(t), `explicação sem valor: ${t}`);
  assert.match(t, /Consigo .* ou .*, qual fica melhor/, "puxa pra call com os 2 horários reais");
  assert.equal((await repo.list("wa_alerts")).length, 0, "2ª vez não chama gente");
  const lead = await repo.get("leads", "L1");
  assert.ok(lead.sdrLog.priceExplainedAt);
  assert.ok(!lead.sdrLog.handoffAt);
});

test("preço pela 2ª vez com call já marcada: aponta pra call marcada em vez de oferecer horário", async () => {
  const repo = await world({
    lead: { stage: "Call agendada", callAt: "2026-08-20T10:00", sdrLog: { priceGuardAt: ISO("2026-08-19T12:31:00Z") } },
    messages: [
      { direction: "in", text: "qual o valor?", at: ISO("2026-08-19T12:30:00Z") },
      { direction: "out", author: "sdr-bot", text: "O investimento é de acordo com as necessidades da sua operação.", at: ISO("2026-08-19T12:31:00Z") },
      { direction: "in", text: "me passa o preço antes da call", at: ISO("2026-08-19T12:59:00Z") },
    ],
  });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagem: "Claro!" }] });
  const r = await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "me passa o preço antes da call" } });
  assert.equal(r, "preco-explicado");
  assert.match(fakes.sent[0].text, /Na nossa call de amanhã \(20\/08\) às 10h o especialista já te mostra o plano certo e o valor/);
  assert.ok(!/Consigo/.test(fakes.sent[0].text));
});

test("preço pela 3ª vez: gente assume, o alerta manda levar pra call e o robô não promete valor por aqui", async () => {
  const repo = await world({
    lead: { sdrLog: { priceGuardAt: ISO("2026-08-19T12:31:00Z"), priceExplainedAt: ISO("2026-08-19T12:41:00Z") } },
    messages: [
      { direction: "in", text: "quanto custa?", at: ISO("2026-08-19T12:30:00Z") },
      { direction: "out", author: "sdr-bot", text: "O investimento é de acordo com as necessidades da sua operação.", at: ISO("2026-08-19T12:31:00Z") },
      { direction: "in", text: "só me diz a faixa", at: ISO("2026-08-19T12:40:00Z") },
      { direction: "out", author: "sdr-bot", text: "Te explico o porquê: a gente tem planos diferentes, por isso o valor a gente só fecha na call.", at: ISO("2026-08-19T12:41:00Z") },
      { direction: "in", text: "sem preço eu não marco nada", at: ISO("2026-08-19T12:59:00Z") },
    ],
  });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagem: "Entendo, quer marcar?" }] });
  const r = await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "sem preço eu não marco nada" } });
  assert.equal(r, "preco-humano");
  const alerts = await repo.list("wa_alerts");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].text, /PREÇO SÓ NA CALL/);
  assert.ok(!/fala de valor/.test(alerts[0].text));
  assert.equal(fakes.sent.length, 1);
  assert.ok(!/valor|pre[çc]o|te falo/i.test(fakes.sent[0].text), `ponte sem promessa de valor: ${fakes.sent[0].text}`);
  const lead = await repo.get("leads", "L1");
  assert.ok(lead.sdrLog.handoffAt && lead.sdrLog.priceHandoffAt);
});

test("lead pede preço e escolhe horário na mesma mensagem: agendar vence a escada de preço", async () => {
  const repo = await world({
    lead: { sdrLog: { priceGuardAt: ISO("2026-08-19T12:31:00Z") } },
    messages: [
      { direction: "in", text: "quanto custa?", at: ISO("2026-08-19T12:30:00Z") },
      { direction: "out", author: "sdr-bot", text: "O investimento é de acordo com as necessidades da sua operação.", at: ISO("2026-08-19T12:31:00Z") },
      { direction: "in", text: "ok, pode ser 9h, e o preço me fala na call então", at: ISO("2026-08-19T12:59:00Z") },
    ],
  });
  const fakes = makeFakes({ decisions: [{ acao: "agendar", horario: SLOT1 }] });
  const r = await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "ok, pode ser 9h, e o preço me fala na call então" } });
  assert.equal(r, "agendar");
  assert.equal((await repo.get("leads", "L1")).callAt, SLOT1);
});


test("agendar com horário da lista: card vai pra etapa de call pelo caminho canônico, com confirmação comprovada e Meet automático", async () => {
  const repo = await world({ messages: [{ direction: "in", text: "pode ser 9h", at: ISO("2026-08-19T12:59:00Z") }] });
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
  assert.match(fakes.sent[0].text, /Perfeito Rafael, agendado então pra amanhã \(20\/08\) às 9h/);
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
  assert.match(fakes.sent[0].text, /amanhã às 9h/);
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
    messages: [{ direction: "in", text: "consegui não, pode ser 9h amanhã?", at: ISO("2026-08-19T12:59:00Z") }],
  });
  const fakes = makeFakes({ decisions: [{ acao: "remarcar", horario: SLOT1 }] });
  const r = await brainOf(repo, fakes).handleInbound(INBOUND);
  assert.equal(r, "remarcar");
  const lead = await repo.get("leads", "L1");
  assert.equal(lead.callAt, SLOT1);
  assert.equal(lead.stage, "Call agendada");
  assert.equal(lead.callConfirmed, false, "confirmação é do horário novo");
  assert.deepEqual(lead.callHistory, [{ at: "2026-08-18T10:00", closer: "pl" }]);
  assert.equal(lead.nextActionAt, new Date("2026-08-20T09:00:00-03:00").toISOString());
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
  const transcriber = { configured: () => true, transcribe: async () => "pode ser 9h então" };
  const brain = makeSdrBrain({
    repo, whatsapp: fakes.wa, anthropic: fakes.anthropic, autoCallMeet: fakes.autoCallMeet, transcriber,
    log: { warn: () => {} }, now: () => NOW, replyDelayMs: 0, sleep: async () => {},
  });
  assert.equal(await brain.handleInbound(INBOUND), "agendar");
  // A IA viu o texto transcrito, não o "🎤 áudio"…
  assert.match(fakes.calls[0].conversation.at(-1).text, /\[áudio\] pode ser 9h/);
  // …e o transcript ficou gravado na mensagem (conversa legível pra sempre).
  const msg = (await repo.list("wa_messages")).find((m) => m.media?.kind === "audio");
  assert.equal(msg.transcript, "pode ser 9h então");
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
  assert.match(text, /Perfeito Rafael, agendado então pra amanhã \(20\/08\) às 9h/);
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

// ── Carimbo da decisão + varredura de mensagem sem decisão (16/09) ─────────
// O disparo do webhook morre com o processo (deploy no meio do debounce): a
// resposta sumia sem alerta. Agora toda decisão carimba thread.brain e o
// poller retoma o que ficou sem carimbo.
const TID = "5541999990000";

test("carimbo: toda mensagem tratada deixa id + ação em thread.brain (inclusive silêncio)", async () => {
  const repo = await world({ messages: [{ direction: "in", text: "ok", at: ISO("2026-08-19T12:59:00Z") }] });
  const fakes = makeFakes({ decisions: [{ acao: "silencio" }] });
  const r = await brainOf(repo, fakes).handleInbound({ message: { from: TID, text: "ok", id: "m1" } });
  assert.equal(r, "silencio");
  const t = await repo.get("wa_threads", TID);
  assert.equal(t.brain.msgId, "m1");
  assert.equal(t.brain.action, "silencio");
  assert.equal(t.brain.at, NOW.toISOString());
});

test("carimbo: disparo superado pela rajada NÃO carimba (quem carimba é o disparo da última mensagem)", async () => {
  const repo = await world({ messages: [
    { direction: "in", text: "oi tudo bem", at: ISO("2026-08-19T12:58:00Z") },
    { direction: "in", text: "sim como faço?", at: ISO("2026-08-19T12:59:00Z") },
  ] });
  const fakes = makeFakes();
  const r = await brainOf(repo, fakes).handleInbound({ message: { from: TID, text: "oi tudo bem", id: "m1" } });
  assert.equal(r, "superseded");
  assert.equal((await repo.get("wa_threads", TID)).brain, undefined);
  assert.equal(fakes.calls.length, 0);
});

test("varredura: mensagem recebida há 3 min sem carimbo é retomada sem debounce e respondida", async () => {
  const repo = await world({ messages: [
    { direction: "out", author: "sdr-bot", text: "Oiii Vinicius, tudo bem?", at: ISO("2026-08-19T12:56:00Z") },
    { direction: "in", text: "sim como faço?", at: ISO("2026-08-19T12:57:00Z") },
  ] });
  await repo.update("wa_threads", TID, { lastDir: "in", lastAt: ISO("2026-08-19T12:57:00Z"), lastText: "sim como faço?", lastInId: "m2" });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagem: "Na demonstração o especialista te mostra o passo a passo, qual período fica melhor?" }] });
  let slept = 0;
  const brain = makeSdrBrain({
    repo, whatsapp: fakes.wa, anthropic: fakes.anthropic, log: { warn: () => {}, info: () => {} }, now: () => NOW,
    replyDelayMs: 0, sleep: async (ms) => { slept += ms; },
  });
  const done = await brain.resumeStalled();
  assert.deepEqual(done, [{ thread: TID, action: "responder" }]);
  assert.equal(slept, 0, "retomada não dorme o debounce");
  assert.equal(fakes.sent.length, 1);
  assert.match(fakes.sent[0].text, /passo a passo/);
  assert.equal((await repo.get("wa_threads", TID)).brain.msgId, "m2");
  // Segundo passe: já carimbada, nada a retomar.
  assert.deepEqual(await brain.resumeStalled(), []);
  assert.equal(fakes.calls.length, 1);
});

test("varredura: ignora mensagem fresca (o webhook ainda está tratando), já carimbada, velha demais ou com a vez do lado de cá", async () => {
  const mk = async (patch) => {
    const repo = await world({ messages: [{ direction: "in", text: "sim", at: ISO("2026-08-19T12:57:00Z") }] });
    await repo.update("wa_threads", TID, { lastDir: "in", lastAt: ISO("2026-08-19T12:57:00Z"), lastText: "sim", lastInId: "m1", ...patch });
    const fakes = makeFakes({ decisions: [{ acao: "responder", mensagem: "Perfeito, qual período fica melhor?" }] });
    return { done: await brainOf(repo, fakes).resumeStalled(), fakes };
  };
  assert.deepEqual((await mk({ lastAt: ISO("2026-08-19T12:59:40Z") })).done, [], "20s atrás: ainda é do webhook");
  assert.deepEqual((await mk({ brain: { msgId: "m1", action: "silencio" } })).done, [], "já decidida");
  assert.deepEqual((await mk({ lastAt: ISO("2026-08-19T09:00:00Z") })).done, [], "4h atrás: fora da janela");
  assert.deepEqual((await mk({ lastDir: "out" })).done, [], "última fala é nossa");
  assert.deepEqual((await mk({ lastInId: "" })).done, [], "thread antiga sem lastInId");
});

test("varredura: gates continuam valendo na retomada (humano falou há pouco = robô calado, mas carimba)", async () => {
  const repo = await world({ messages: [
    { direction: "out", author: "sdr", text: "Oi, sou a Manuela", at: ISO("2026-08-19T12:50:00Z") },
    { direction: "in", text: "oi Manuela", at: ISO("2026-08-19T12:57:00Z") },
  ] });
  await repo.update("wa_threads", TID, { lastDir: "in", lastAt: ISO("2026-08-19T12:57:00Z"), lastText: "oi Manuela", lastInId: "m2" });
  const fakes = makeFakes();
  const done = await brainOf(repo, fakes).resumeStalled();
  assert.deepEqual(done, [{ thread: TID, action: "human-active" }]);
  assert.equal(fakes.sent.length, 0);
  assert.equal((await repo.get("wa_threads", TID)).brain.msgId, "m2");
});

test("mesma mensagem em tratamento (IA lenta): segundo disparo é ignorado, sem resposta dupla", async () => {
  const repo = await world({ messages: [{ direction: "in", text: "sim como faço?", at: ISO("2026-08-19T12:57:00Z") }] });
  await repo.update("wa_threads", TID, { lastDir: "in", lastAt: ISO("2026-08-19T12:57:00Z"), lastText: "sim como faço?", lastInId: "m1" });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagem: "Perfeito, qual período fica melhor?" }, { acao: "responder", mensagem: "Perfeito, qual período fica melhor?" }] });
  let release;
  const gate = new Promise((r) => { release = r; });
  const slowAi = { configured: () => true, sdrDecide: async (ctx) => { await gate; return fakes.anthropic.sdrDecide(ctx); } };
  const brain = makeSdrBrain({ repo, whatsapp: fakes.wa, anthropic: slowAi, log: { warn: () => {}, info: () => {} }, now: () => NOW, replyDelayMs: 0, sleep: async () => {} });
  const first = brain.handleInbound({ message: { from: TID, text: "sim como faço?", id: "m1" } });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(await brain.resumeStalled(), [{ thread: TID, action: "inflight" }]);
  release();
  assert.equal(await first, "responder");
  assert.equal(fakes.sent.length, 1);
  assert.equal((await repo.get("wa_threads", TID)).brain.action, "responder");
});


// ── Ajustes do Leo, 17/09 ────────────────────────────────────────────────────
test("trava de duração: '20 minutos' sai da conversa; o '5 minutos' do pitch OEM fica", async () => {
  assert.equal(stripDuration("É uma conversa de 20 minutos no Google Meet, nosso especialista roda um código OEM seu ao vivo"), "É uma conversa no Google Meet, nosso especialista roda um código OEM seu ao vivo");
  assert.match(stripDuration("Dura cerca de 20 minutos Juan, te espero hoje às 10h então?"), /^A duração vai de acordo com o que você quiser ver Juan, te espero hoje às 10h então\?$/);
  assert.equal(stripDuration("A LeverAds cria o anúncio em menos de 5 minutos, quer ver na demonstração?"), "A LeverAds cria o anúncio em menos de 5 minutos, quer ver na demonstração?");
  assert.equal(stripDuration("Combinado, te chamo aqui em 10 minutos"), "Combinado, te chamo aqui em 10 minutos"); // sem contexto de conversa/demonstração, não mexe

  const repo = await world({ messages: [
    { direction: "out", author: "sdr-bot", text: "Isso ajudaria na sua operação?", at: ISO("2026-08-19T12:50:00Z") },
    { direction: "in", text: "Opa sim", at: ISO("2026-08-19T12:59:00Z") },
  ] });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagens: [
    "É uma conversa de 20 minutos no Google Meet, nosso especialista roda um código OEM seu ao vivo",
    "Consigo amanhã às 9h ou amanhã às 11h, qual fica melhor pra você?",
  ] }] });
  await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "Opa sim" } });
  assert.equal(fakes.sent[0].text, "É uma conversa no Google Meet, nosso especialista roda um código OEM seu ao vivo");
  assert.ok(!fakes.sent.some((s) => /minutos/.test(s.text)));
});

test("celular × computador: a pergunta 'celular ou computador?' sai; lead no celular ouve a dica do computador por perto", async () => {
  assert.equal(stripDeviceAsk("Perfeito, te espero às 13h. Você vai entrar pelo celular ou pelo computador?"), "Perfeito, te espero às 13h.");
  const lead = { stage: "Call agendada", callAt: "2026-08-19T16:00", closer: "pl" };
  const repo = await world({ lead, messages: [
    { direction: "out", author: "sdr-bot", text: "Oi Pedro! Está tudo certo pra nossa conversa hoje às 16h?", at: ISO("2026-08-19T12:00:00Z") },
    { direction: "in", text: "Pode ser pelo celular ?", at: ISO("2026-08-19T12:59:00Z") },
  ] });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagens: ["Pode sim Pedro, é só acessar o link pelo celular", "Consegue entrar por ele?"] }] });
  await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "Pode ser pelo celular ?" } });
  const textos = fakes.sent.map((s) => s.text);
  assert.equal(textos[0], "Pode sim Pedro, é só acessar o link pelo celular");
  assert.match(textos[1], /computador por perto/);
  assert.ok(!textos.some((t) => /celular ou pelo computador/i.test(t)));

  // IA perguntando por onde entra: a pergunta é podada e o resto segue.
  const repo2 = await world({ lead, messages: [
    { direction: "out", author: "sdr-bot", text: "Oi Pedro! Está tudo certo pra nossa conversa hoje às 16h?", at: ISO("2026-08-19T12:00:00Z") },
    { direction: "in", text: "Confirmado", at: ISO("2026-08-19T12:59:00Z") },
  ] });
  const fakes2 = makeFakes({ decisions: [{ acao: "responder", mensagens: ["Perfeito Pedro, te espero às 16h", "Você vai entrar pelo celular ou pelo computador?"] }] });
  await brainOf(repo2, fakes2).handleInbound({ message: { from: "5541999990000", text: "Confirmado" } });
  assert.deepEqual(fakes2.sent.map((s) => s.text), ["Perfeito Pedro, te espero às 16h"]);
});

test("lead nega a conversa marcada: gente confere; o robô só avisa que vai confirmar (callAt em UTC é lido no relógio BRT)", async () => {
  // Caso Renan (16/09): callAt gravado "…T13:00:00.000Z" (= 10h BRT). O lembrete dizia 13h.
  const repo = await world({ lead: { stage: "Call agendada", callAt: "2026-08-19T13:00:00.000Z", closer: "pl" }, messages: [
    { direction: "out", author: "sdr-bot", text: "Oi Rafael! Está tudo certo pra nossa conversa hoje às 13h?", at: ISO("2026-08-19T11:17:00Z") },
    { direction: "in", text: "Olá, bom dia.\nNão tenho call as 13:00…", at: ISO("2026-08-19T12:59:00Z") },
  ] });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagens: ["Entendi Rafael, aqui constava nossa conversa hoje às 13h", "Sem problemas, algum dos horários que te passei encaixa pra você?"] }] });
  const r = await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "Olá, bom dia.\nNão tenho call as 13:00…" } });
  assert.equal(r, "nega-call-humano");
  assert.deepEqual(fakes.sent.map((s) => s.text), ["Rafael, deixa eu confirmar aqui com o especialista e já te retorno"]);
  const alerts = await repo.list("wa_alerts");
  assert.ok(alerts.some((a) => /nega a conversa marcada \(hoje \(19\/08\) às 10h\)/.test(a.text)), JSON.stringify(alerts.map((a) => a.text)));
  assert.ok((await repo.get("leads", "L1")).sdrLog.handoffAt);
});

test("descoberta antes do horário: a mensagem do form não é interesse; oferta e agendamento esperam o lead responder", async () => {
  const form = "Oi, me chamo Eduardo e quero saber mais sobre o Lever Ads. Minha operação: Autopeças, 1 conta contas, Até 500 anúncios ativos.";
  const repo = await world({ messages: [
    { direction: "out", author: "sdr-bot", text: "Consegue me dizer se hoje você replica esses anúncios manualmente?", at: ISO("2026-08-12T12:00:00Z") },
    { direction: "in", text: form, at: ISO("2026-08-19T12:59:00Z") },
  ] });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagens: [
    "Oi Eduardo, tudo certo?",
    "Vi que agora você mencionou autopeças, sua operação hoje é de eletrônicos ou autopeças?",
    "Consigo amanhã às 9h ou amanhã às 11h, qual fica melhor pra você?",
  ] }] });
  await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: form } });
  assert.equal(fakes.calls[0].engaged, false);
  const textos = fakes.sent.map((s) => s.text);
  assert.equal(textos.length, 2);
  assert.ok(!textos.some((t) => /às \d/.test(t)), "sem horário antes da descoberta");
  assert.match(textos.at(-1), /eletrônicos ou autopeças\?$/);

  // IA tentando AGENDAR sem o lead ter engajado: vira descoberta, nada é marcado.
  const repo2 = await world({ messages: [{ direction: "in", text: "Oi", at: ISO("2026-08-19T12:59:00Z") }] });
  const fakes2 = makeFakes({ decisions: [{ acao: "agendar", horario: SLOT1 }] });
  const r = await brainOf(repo2, fakes2).handleInbound({ message: { from: "5541999990000", text: "Oi" } });
  assert.equal(r, "responder");
  assert.equal((await repo2.get("leads", "L1")).callAt, undefined);
  assert.equal(fakes2.sent.at(-1).text, "Isso ajudaria na sua operação hoje?");

  // Lead que respondeu "sim" está engajado: a oferta passa.
  const repo3 = await world({ messages: [
    { direction: "out", author: "sdr-bot", text: "Isso ajudaria na sua operação?", at: ISO("2026-08-19T12:50:00Z") },
    { direction: "in", text: "Ajudaria sim", at: ISO("2026-08-19T12:59:00Z") },
  ] });
  const fakes3 = makeFakes({ decisions: [{ acao: "responder", mensagens: ["Perfeito", "Consigo amanhã às 9h ou amanhã às 11h, qual fica melhor pra você?"] }] });
  await brainOf(repo3, fakes3).handleInbound({ message: { from: "5541999990000", text: "Ajudaria sim" } });
  assert.equal(fakes3.calls[0].engaged, true);
  assert.equal(fakes3.sent.at(-1).text, "Consigo amanhã às 9h ou amanhã às 11h, qual fica melhor pra você?");
});

test("mais cedo primeiro: oferta que pula a primeira vaga de amanhã sem o lead pedir é reescrita com o par sugerido", async () => {
  const msgs = [
    { direction: "out", author: "sdr-bot", text: "Isso ajudaria na sua operação?", at: ISO("2026-08-19T12:50:00Z") },
    { direction: "in", text: "Ajudaria sim", at: ISO("2026-08-19T12:59:00Z") },
  ];
  const repo = await world({ messages: msgs });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagens: ["Perfeito Leonardo, nosso especialista pode te mostrar isso na prática", "Consigo amanhã às 11h ou amanhã às 13h, qual fica melhor pra você?"] }] });
  await brainOf(repo, fakes).handleInbound({ message: { id: "m2", from: "5541999990000", text: "Ajudaria sim" } });
  assert.equal(fakes.sent[1].text, "Consigo amanhã às 9h ou amanhã às 11h, qual fica melhor pra você?");
  assert.ok((await repo.get("leads", "L1")).sdrLog.earliestGuardAt);
  const thread = await repo.get("wa_threads", "5541999990000");
  assert.deepEqual(thread.brain.pair, ["amanhã às 9h", "amanhã às 11h"]);
  assert.equal(thread.brain.slots[0], "amanhã às 9h");

  // Lead pediu período/dia: a oferta da IA fica como está.
  const repo2 = await world({ messages: [
    { direction: "out", author: "sdr-bot", text: "Isso ajudaria na sua operação?", at: ISO("2026-08-19T12:50:00Z") },
    { direction: "in", text: "sim, mas só amanhã de tarde", at: ISO("2026-08-19T12:59:00Z") },
  ] });
  const fakes2 = makeFakes({ decisions: [{ acao: "responder", mensagens: ["Combinado", "Consigo amanhã às 14h ou amanhã às 16h, qual fica melhor pra você?"] }] });
  await brainOf(repo2, fakes2).handleInbound({ message: { from: "5541999990000", text: "sim, mas só amanhã de tarde" } });
  assert.equal(fakes2.sent[1].text, "Consigo amanhã às 14h ou amanhã às 16h, qual fica melhor pra você?");
});

test("horário já oferecido = só oferta de verdade: lembrete e confirmação com hora não contam", async () => {
  const repo = await world({ lead: { stage: "Call agendada", callAt: "2026-08-19T16:00", closer: "pl" }, messages: [
    { direction: "out", author: "sdr-bot", text: "Perfeito Rafael, agendado então pra hoje (19/08) às 16h. Te chamo aqui um pouco antes com o lembrete!", at: ISO("2026-08-19T11:00:00Z") },
    { direction: "out", author: "sdr-bot", text: "Oi Rafael! Está tudo certo pra nossa conversa hoje às 16h?", at: ISO("2026-08-19T12:00:00Z") },
    { direction: "in", text: "vão mandar o link?", at: ISO("2026-08-19T12:59:00Z") },
  ] });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagem: "Sim, o link chega por aqui um pouco antes, combinado?" }] });
  await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "vão mandar o link?" } });
  assert.equal(fakes.calls[0].slotsOffered, false);

  const repo2 = await world({ messages: [
    { direction: "out", author: "sdr-bot", text: "Consigo hoje às 13h ou hoje às 15h, qual fica melhor pra você?", at: ISO("2026-08-19T12:00:00Z") },
    { direction: "in", text: "vou ver aqui", at: ISO("2026-08-19T12:59:00Z") },
  ] });
  const fakes2 = makeFakes({ decisions: [{ acao: "responder", mensagem: "Tranquilo, me avisa?" }] });
  await brainOf(repo2, fakes2).handleInbound({ message: { from: "5541999990000", text: "vou ver aqui" } });
  assert.equal(fakes2.calls[0].slotsOffered, true);
});

test("gente escreveu no meio da fala do robô: o resto das partes é descartado", async () => {
  const repo = await world({ messages: [
    { direction: "out", author: "sdr-bot", text: "Isso ajudaria na sua operação?", at: ISO("2026-08-19T12:50:00Z") },
    { direction: "in", text: "Ajudaria sim", at: ISO("2026-08-19T12:59:00Z") },
  ] });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagens: ["Perfeito", "Nosso especialista te mostra na prática", "Consigo amanhã às 9h ou amanhã às 11h, qual fica melhor pra você?"] }] });
  const orig = fakes.wa.sendText;
  fakes.wa.sendText = async (to, text) => {
    const r = await orig(to, text);
    if (fakes.sent.length === 1) await repo.create("wa_messages", { id: "h1", thread: "5541999990000", leadId: "L1", saas: "leverads", direction: "out", author: "leonardo", text: "Bom dia Rafael, tudo bem?", at: new Date(NOW.getTime() + 1000).toISOString() });
    return r;
  };
  const r = await brainOf(repo, fakes).handleInbound({ message: { id: "m2", from: "5541999990000", text: "Ajudaria sim" } });
  assert.equal(r, "abortado");
  assert.equal(fakes.sent.length, 1);
});

test("agenda SDR: sem pedido do lead, modelo não oferece nem agenda D+2, mesmo com amanhã cheio", async () => {
  for (const decision of [
    { acao: "agendar", horario: "2026-08-21T14:00" },
    { acao: "responder", mensagem: "Consigo sexta às 14h, pode ser?" },
    { acao: "responder", mensagem: "Consigo sexta, pode ser?" },
  ]) {
    const repo = await world({ messages: [{ direction: "in", text: "Sim, quero", at: ISO("2026-08-19T12:59:00Z") }] });
    await repo.create("agenda_blocks", { id: "full", user: "pl", recur: "once", date: "2026-08-20", allDay: true });
    const fakes = makeFakes({ decisions: [decision] });
    await brainOf(repo, fakes).handleInbound(INBOUND);
    assert.deepEqual(fakes.calls[0].slots, []);
    assert.ok(!(await repo.get("leads", "L1")).callAt);
    assert.deepEqual(fakes.meets, []);
    assert.doesNotMatch(fakes.sent.map((x) => x.text).join(" "), /sexta|21\/08/);
    assert.match(fakes.sent.at(-1).text, /Qual outra data/);
  }
});

test("agenda SDR: pedido de sexta persiste quando o cliente escolhe a hora na mensagem seguinte", async () => {
  const repo = await world({ messages: [
    { direction: "in", text: "Só consigo sexta, tem às 14h?", at: ISO("2026-08-19T12:55:00Z") },
    { direction: "out", author: "sdr-bot", text: "Consigo sexta às 14h ou sexta às 16h, qual fica melhor?", at: ISO("2026-08-19T12:57:00Z") },
    { direction: "in", text: "14h", at: ISO("2026-08-19T12:59:00Z") },
  ] });
  const fakes = makeFakes({ decisions: [{ acao: "agendar", horario: "2026-08-21T14:00" }] });
  assert.equal(await brainOf(repo, fakes).handleInbound(INBOUND), "agendar");
  assert.equal((await repo.get("leads", "L1")).callAt, "2026-08-21T14:00");
  assert.ok(fakes.calls[0].slots.every((s) => s.at.startsWith("2026-08-21T")));
});

test("agenda SDR: áudio pedindo data posterior libera só o dia transcrito antes de montar a lista", async () => {
  const repo = await world({ messages: [{ direction: "in", text: "🎤 áudio", media: { kind: "audio", id: "MID1", mime: "audio/ogg" }, at: ISO("2026-08-19T12:59:00Z") }] });
  await repo.create("wa_media", { id: "m1", mime: "audio/ogg", data: Buffer.from("a".repeat(2048)).toString("base64") });
  const fakes = makeFakes({ decisions: [{ acao: "agendar", horario: "2026-08-21T14:00" }] });
  const brain = makeSdrBrain({ repo, whatsapp: fakes.wa, anthropic: fakes.anthropic,
    transcriber: { configured: () => true, transcribe: async () => "Amanhã não consigo, pode ser sexta às 14h?" },
    log: { warn: () => {} }, now: () => NOW, replyDelayMs: 0, sleep: async () => {},
  });
  assert.equal(await brain.handleInbound(INBOUND), "agendar");
  assert.equal(fakes.calls[0].offerDate, "2026-08-21");
  assert.equal(fakes.calls[0].requestedDate, true);
  assert.equal((await repo.get("leads", "L1")).callAt, "2026-08-21T14:00");
});

test("agenda SDR: pedido de sexta não autoriza agendar segunda por conta própria", async () => {
  const repo = await world({ messages: [
    { direction: "in", text: "Pode ser sexta às 14h?", at: ISO("2026-08-19T12:59:00Z") },
  ] });
  const fakes = makeFakes({ decisions: [{ acao: "agendar", horario: "2026-08-24T14:00" }] });
  assert.equal(await brainOf(repo, fakes).handleInbound(INBOUND), "reoferta");
  assert.ok(!(await repo.get("leads", "L1")).callAt);
  assert.doesNotMatch(fakes.sent[0].text, /segunda/);
});
