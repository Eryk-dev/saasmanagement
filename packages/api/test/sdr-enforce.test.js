// guardsMode "enforce": o validador manda e o resultado é o MESMO da cadeia
// legada (audit) em texto enviado, desfecho e carimbos. É o que autoriza a
// troca por config em produção.
import test from "node:test";
import assert from "node:assert/strict";
import { world, makeFakes, brainOf, ISO } from "./helpers/sdr-world.js";

const PITCH = "Oiii Rafael, tudo bem? A LeverAds faz clonagem de anúncios entre contas, com estoque, atendimento e edição em um lugar só. Isso ajudaria na sua operação?";
const OFFER = "Consigo amanhã às 9h ou às 11h, qual fica melhor pra você?";
const pitched = [{ direction: "out", author: "sdr-bot", text: PITCH, at: ISO("2026-08-19T12:00:00Z") }];
const offered = [...pitched, { direction: "in", text: "sim", at: ISO("2026-08-19T12:30:00Z") }, { direction: "out", author: "sdr-bot", text: OFFER, at: ISO("2026-08-19T12:31:00Z") }];

// [título, mundo, decisão da IA, mensagem do lead, regras]
const CASES = [
  ["valor dito pela IA vira o desvio oficial", { messages: pitched }, { acao: "responder", mensagens: ["Fica em R$ 299 por mês"] }, "quanto custa?", "#R-050"],
  ["link de outro canal descarta a fala e chama gente", { messages: pitched }, { acao: "responder", mensagens: ["Fala com o comercial em wa.me/5541999999999"] }, "sim", "#R-008"],
  ["promessa de ver depois vira a agenda real", { messages: pitched }, { acao: "responder", mensagens: ["Deixa eu ver na agenda e te confirmo em minutos"] }, "pode ser", "#R-030"],
  ["frase requentada sem nada novo vira handoff", { messages: [...pitched, { direction: "out", author: "sdr-bot", text: "Primeiro a gente entende o seu cenário, e aí te mostra os pontos que dá pra alavancar na demonstração", at: ISO("2026-08-19T12:40:00Z") }] }, { acao: "responder", mensagens: ["Primeiro a gente entende o seu cenário, e aí te mostra os pontos que dá pra alavancar na demonstração"] }, "e aí?", "#R-009"],
  ["oferta fantasma vira a oferta real", { messages: pitched }, { acao: "responder", mensagens: ["Algum dos horários que te passei encaixa?"] }, "sim", "#R-029"],
  ["oferta que pula o mais cedo é reescrita", { messages: pitched }, { acao: "responder", mensagens: ["Perfeito", "Consigo amanhã às 11h ou às 14h, qual fica melhor pra você?"] }, "Opa sim", "#R-022"],
  ["duração e pergunta de dispositivo saem; dica do computador entra", { messages: offered }, { acao: "responder", mensagens: ["É uma conversa de 20 minutos. Vai entrar pelo celular ou pelo computador?"] }, "vou entrar pelo celular, pode ser 9h?", "#R-060 #R-061"],
  ["resposta sem pergunta ganha a oferta do par", { messages: pitched }, { acao: "responder", mensagens: ["Que bom que ajuda Rafael"] }, "Opa sim", "#R-031"],
  ["dois pares na mesma resposta: fica um", { messages: pitched }, { acao: "responder", mensagens: ["Consigo amanhã às 9h ou às 11h, qual fica melhor pra você?", "Ou então amanhã às 14h ou às 16h, qual fica melhor pra você?"] }, "Opa sim", "#R-026"],
  ["texto limpo passa igual", { messages: offered }, { acao: "responder", mensagens: ["Tem sim Rafael, a demonstração é ao vivo na sua conta"] }, "a demo é ao vivo?", "#R-003"],
];

async function runIn(mode, w, decision, text) {
  const repo = await world({ ...w, sdrBot: { ...(w.sdrBot || {}), guardsMode: mode } });
  const fakes = makeFakes({ decisions: [decision] });
  const brain = brainOf(repo, fakes);
  await repo.create("wa_messages", { id: "inX", thread: "5541999990000", leadId: "L1", saas: "leverads", direction: "in", text, at: ISO("2026-08-19T13:00:00Z") });
  const result = await brain.handleInbound({ message: { from: "5541999990000", text, id: "inX" } });
  const lead = await repo.get("leads", "L1");
  const stamps = Object.fromEntries(Object.entries(lead.sdrLog || {}).filter(([k]) => /GuardAt$|handoffAt|handoffKind|lastOffer/.test(k)).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : v]));
  return { result, sent: fakes.sent.map((s) => s.text), stamps };
}

for (const [title, w, decision, text, rules] of CASES) {
  test(`enforce = audit: ${title} ${rules}`, async () => {
    const a = await runIn("audit", w, decision, text);
    const e = await runIn("enforce", w, decision, text);
    assert.equal(e.result, a.result, "desfecho");
    assert.deepEqual(e.sent, a.sent, "texto enviado");
    assert.deepEqual(e.stamps, a.stamps, "carimbos");
  });
}
