// R-122 (Leo, 13/11/2026): resposta a um DISPARO com retorno automático
// (webinário). Quem respondeu ao broadcast dizendo que quer recebe o texto do
// retorno (link do grupo) uma vez; a mensagem seguinte dele PARA o robô nessa
// conversa (sdrOff) e avisa o Inbox; quem responde sem confirmar ou dizendo
// não deixa o robô calado e vira alerta. Tag da regra: #R-122
import test from "node:test";
import assert from "node:assert/strict";
import { world, makeFakes, brainOf, NOW, ISO } from "./helpers/sdr-world.js";
import { broadcastReplyIntent, broadcastReplyDecision, replyCampaignFor } from "../src/sdr/sdr-broadcast-reply.js";

const THREAD = "5541999990000";
const LINK = "Maravilha! Será um prazer ter você com a gente! 😊\n\nEntre no nosso grupo pelo link abaixo:\n\n👉 https://chat.whatsapp.com/JJxtJud2R1b5zO45A2NNMO?mode=gi_t\n\nTe esperamos! 🚀";
const BROADCAST = { direction: "out", author: "disparo", text: "Oi, Rafael, tudo bem? Aqui é a Manu, da Lever. A gente vai fazer uma aula ao vivo… Se quiser participar, só me avisar que já mando o link de convite do grupo", at: ISO("2026-08-19T11:53:00Z") };

async function setup({ lead = {}, messages = [BROADCAST], reply = { enabled: true, text: LINK }, sentAt = "2026-08-19T11:53:00Z" } = {}) {
  const repo = await world({ lead, messages });
  await repo.create("campaigns", { id: "ca_web", saas: "leverads", name: "Webinário 17/11", channel: "whatsapp", status: "done", reply,
    sent: { L1: { queuedAt: ISO(sentAt), whatsapp: ISO(sentAt), waStatus: "sent", waMessageId: "wamid.x" } } });
  const fakes = makeFakes({ decisions: [{ acao: "responder", mensagens: ["A LeverAds espelha e gerencia seus anúncios"], oferecer: true }] });
  const brain = brainOf(repo, fakes);
  let seq = 900;
  const say = async (text, at = ISO(NOW)) => {
    const id = `in${++seq}`;
    await repo.create("wa_messages", { id, thread: THREAD, leadId: "L1", saas: "leverads", direction: "in", text, at });
    return brain.handleInbound({ message: { from: THREAD, text, id } });
  };
  return { repo, fakes, say };
}

test("intenção da resposta ao disparo #R-122", () => {
  for (const t of ["Sim", "Bom dia! Sim, gostaria de participar.", "Ok quero", "Sim link quero ver", "pode mandar", "[reaction] 👍", "Ok", "tenho interesse", "manda o link"]) assert.equal(broadcastReplyIntent(t), "yes", t);
  for (const t of ["Nao me recordo do que se trata", "Pode desconsiderar por favor", "Não tenho interesse", "não, obrigado", "tira meu número"]) assert.equal(broadcastReplyIntent(t), "no", t);
  for (const t of ["Oi", "Bom dia", "Olá", "do que se trata?", "é para quando?", "📷 imagem"]) assert.equal(broadcastReplyIntent(t), "other", t);
  assert.equal(broadcastReplyIntent("Oi, me chamo Alan e quero saber mais sobre o Lever OEM. Minha operação: autopeças"), "form");
});

test("sim ao disparo: robô manda o retorno (link do grupo) uma vez, sem pitch nem horário, e carimba #R-122", async () => {
  const { repo, fakes, say } = await setup();
  const r = await say("Bom dia! Sim, gostaria de participar.");
  assert.equal(r, "broadcast-link");
  assert.deepEqual(fakes.sent.map((s) => s.text), [LINK]);
  assert.equal(fakes.calls.length, 0, "a IA não é chamada");
  const lead = await repo.get("leads", "L1");
  assert.equal(lead.sdrLog.broadcastReply.campaign, "ca_web");
  assert.ok(lead.sdrLog.broadcastReply.linkAt);
  assert.equal(lead.sdrOff, undefined, "ainda não parou: só depois da próxima mensagem dele");
  assert.equal(lead.stage, "Qualificando", "o card não anda");
  const msgs = await repo.list("wa_messages");
  assert.ok(msgs.some((m) => m.direction === "out" && m.author === "sdr-bot" && m.text === LINK), "o retorno fica no Inbox");
});

test("mensagem depois do retorno: robô PARA nesta conversa (sdrOff) e avisa o Inbox #R-122", async () => {
  const { repo, fakes, say } = await setup();
  await say("Sim quero", ISO("2026-08-19T12:00:00Z"));
  const r = await say("Entrei no grupo, obrigado", ISO("2026-08-19T13:30:00Z"));
  assert.equal(r, "broadcast-off");
  const lead = await repo.get("leads", "L1");
  assert.equal(lead.sdrOff, true);
  assert.ok(lead.sdrLog.broadcastReply.offAt);
  assert.equal(fakes.sent.length, 1, "só o retorno saiu; nada depois");
  const alerts = await repo.list("wa_alerts");
  assert.ok(alerts.some((a) => /DEPOIS do retorno/.test(a.text) && /robô parado/.test(a.text)), JSON.stringify(alerts));
  // terceira mensagem: nem decisão (botão parar robô)
  assert.equal(await say("alguém aí?", ISO("2026-08-19T13:40:00Z")), null);
  assert.equal(fakes.sent.length, 1);
});

test("retorno gravado com {{nome}} sai com o nome do lead #R-122", async () => {
  const { fakes, say } = await setup({ reply: { enabled: true, text: "Maravilha {{nome}}! Entra no grupo: https://chat.whatsapp.com/x" } });
  await say("Sim");
  assert.deepEqual(fakes.sent.map((s) => s.text), ["Maravilha Rafael! Entra no grupo: https://chat.whatsapp.com/x"]);
});

test("'Oi' ou 'do que se trata?' em resposta ao disparo: robô calado + alerta; depois 'sim' ainda recebe o link #R-122", async () => {
  const { repo, fakes, say } = await setup();
  assert.equal(await say("Bom dia", ISO("2026-08-19T12:00:00Z")), "broadcast-other");
  assert.equal(fakes.sent.length, 0);
  const alerts = await repo.list("wa_alerts");
  assert.ok(alerts.some((a) => /sem confirmar/.test(a.text)), JSON.stringify(alerts));
  assert.equal(await say("Sim, quero participar", ISO("2026-08-19T12:20:00Z")), "broadcast-link");
  assert.deepEqual(fakes.sent.map((s) => s.text), [LINK]);
});

test("'não' / 'pode desconsiderar' em resposta ao disparo: robô calado + alerta, sem opt-out automático #R-122", async () => {
  const { repo, fakes, say } = await setup();
  assert.equal(await say("Pode desconsiderar por favor"), "broadcast-no");
  assert.equal(fakes.sent.length, 0);
  const lead = await repo.get("leads", "L1");
  assert.equal(lead.whatsappOptOut, undefined);
  assert.equal(lead.sdrOff, undefined);
  const alerts = await repo.list("wa_alerts");
  assert.ok(alerts.some((a) => /NÃO quer/.test(a.text)));
});

test("formulário reenviado depois do disparo NÃO é resposta ao disparo: fluxo normal #R-122", async () => {
  const { fakes, say } = await setup();
  const r = await say("Oi, me chamo Rafael e quero saber mais sobre o Lever OEM. Minha operação: autopeças, Só online, 1 conta, Até 500 anúncios ativos.");
  assert.notEqual(r, "broadcast-link");
  assert.ok(!fakes.sent.some((s) => s.text === LINK));
});

test("robô ou gente já falou depois do disparo: conversa segue o fluxo normal #R-122", async () => {
  const { fakes, say } = await setup({ messages: [BROADCAST, { direction: "out", author: "sdr", text: "Oi Rafael, aqui é a Manu de verdade", at: ISO("2026-08-19T12:00:00Z") }] });
  const r = await say("Sim", ISO("2026-08-19T12:50:00Z"));
  assert.notEqual(r, "broadcast-link");
  assert.ok(!fakes.sent.some((s) => s.text === LINK));
});

test("disparo sem retorno automático ou fora da validade: nada muda #R-122", async () => {
  const a = await setup({ reply: { enabled: false, text: LINK } });
  assert.notEqual(await a.say("Sim"), "broadcast-link");
  assert.ok(!a.fakes.sent.some((s) => s.text === LINK));
  const b = await setup({ reply: { enabled: true, text: LINK, until: "2026-08-18T14:00" } });
  assert.notEqual(await b.say("Sim"), "broadcast-link");
  const c = await setup({ sentAt: "2026-07-20T11:53:00Z", messages: [{ ...BROADCAST, at: ISO("2026-07-20T11:53:00Z") }] });
  assert.notEqual(await c.say("Sim"), "broadcast-link", "14 dias depois do envio o retorno não vale mais");
});

test("lead fora da região do cérebro (desqualificado) que recebeu o disparo: sim recebe o link; outra coisa fica calado #R-122", async () => {
  const a = await setup({ lead: { disqualified: true, stage: "Qualificando" } });
  assert.equal(await a.say("quero sim"), "broadcast-link");
  assert.deepEqual(a.fakes.sent.map((s) => s.text), [LINK]);
  const b = await setup({ lead: { disqualified: true } });
  assert.equal(await b.say("Oi"), "broadcast-other");
  assert.equal(b.fakes.calls.length, 0);
});

test("replyCampaignFor escolhe o disparo mais recente recebido e ignora fila/falha #R-122", async () => {
  const repo = await world({});
  const lead = await repo.get("leads", "L1");
  await repo.create("campaigns", { id: "c1", saas: "leverads", reply: { enabled: true, text: "x" }, sent: { L1: { whatsapp: ISO("2026-08-10T10:00:00Z"), waStatus: "delivered" } } });
  await repo.create("campaigns", { id: "c2", saas: "leverads", reply: { enabled: true, text: "y" }, sent: { L1: { whatsapp: ISO("2026-08-15T10:00:00Z"), waStatus: "read" } } });
  await repo.create("campaigns", { id: "c3", saas: "leverads", reply: { enabled: true, text: "z" }, sent: { L1: { queuedAt: ISO("2026-08-18T10:00:00Z"), waStatus: "queued" } } });
  await repo.create("campaigns", { id: "c4", saas: "leverads", reply: { enabled: true, text: "w" }, sent: { L1: { whatsapp: ISO("2026-08-18T10:00:00Z"), waStatus: "failed" } } });
  const hit = await replyCampaignFor(repo, lead, { nowMs: NOW.getTime() });
  assert.equal(hit.campaign.id, "c2");
  const dec = broadcastReplyDecision({ lead, hit, nowMs: NOW.getTime(), msgs: [{ direction: "out", author: "disparo", at: ISO("2026-08-15T10:00:00Z") }, { direction: "in", text: "sim", at: ISO(NOW) }] });
  assert.equal(dec.kind, "link");
  assert.equal(dec.text, "y");
});
