// Tabela de intenções: UMA linha por frase real do lead. Quando o Leo pede um
// ajuste ("'boa tarde' não é período"), a tabela mostra na hora quais outras
// frases viram junto. Rótulo primário em ordem de precedência (INTENTS) +
// co-rótulos (LABELS).

import test from "node:test";
import assert from "node:assert/strict";
import { wallFromNaive } from "../src/crm/agenda-slots.js";
import { classifyInbound, INTENTS, LABELS, isShortYes } from "../src/sdr/sdr-intents.js";

const WNOW = wallFromNaive("2026-09-21T08:00"); // segunda-feira
const OFFERED = [{ at: "2026-09-22T09:00", label: "amanhã às 9h" }, { at: "2026-09-22T17:00", label: "amanhã às 17h" }];
const ONE = [{ at: "2026-09-22T09:00", label: "amanhã às 9h" }];
const CALL = "2026-09-22T10:00";

// [frase, contexto, primário esperado, co-rótulos que TÊM que estar, co-rótulos que NÃO podem estar]
const CASES = [
  ["Oi, me chamo Rafael e quero saber mais sobre a LeverAds. Minha operação: autopeças, 3 contas", {}, "form_message", ["interest"], []],  // "quero" casa INTEREST_RX; é leadEngaged quem exclui a mensagem do form
  ["MAF Imports agradece seu contato. Como podemos ajudar? informe os 7 últimos números do chassi", {}, "auto_reply", ["question"], []],
  ["Sou afiliado da Shopee, não tenho loja", {}, "affiliate", [], []],
  ["Pode cancelar o agendamento", { callAt: CALL }, "cancel", [], []],
  ["Não vou conseguir comparecer", { callAt: CALL }, "cancel", [], []],
  ["Não quero cancelar, só não consigo abrir o link", { callAt: CALL }, "other", [], []],  // não é cancel (R-036) nem "não" seco
  ["Não marquei nada com vocês", { callAt: CALL }, "deny_call", [], []],
  ["Não marquei nada com vocês", {}, "other", [], []],
  ["Estou na sala sozinho, cadê o especialista?", { callAt: CALL }, "waiting_room", ["question"], []],
  ["Não tenho mais interesse, obrigado", {}, "no_interest", [], []],
  ["Vamos pausar por enquanto", {}, "no_interest", [], []],
  ["Não vou usar, já tenho o Bling", { callAt: CALL }, "objection", [], []],
  ["pode ser 17h", { offered: OFFERED, slotsOffered: true }, "accept_slot", ["has_hour", "interest"], []],
  ["pode", { offered: ONE, slotsOffered: true }, "accept_slot", ["interest"], []],
  ["o primeiro", { offered: OFFERED, slotsOffered: true }, "accept_slot", [], []],
  ["11", { offered: OFFERED, slotsOffered: true }, "bare_hour", [], []],
  ["18", { offered: OFFERED, slotsOffered: true }, "bare_hour", [], []],
  ["18", {}, "other", [], []],
  ["Pode ser quarta?", { wnow: WNOW }, "schedule_ask", ["question", "day_word", "interest"], []],
  ["Posso na quinta às 14h", { wnow: WNOW }, "schedule_ask", ["has_hour", "day_word"], []],
  ["Podemos marcar um horário?", { wnow: WNOW }, "schedule_ask", ["question"], []],
  ["só depois desse horário, pq a minha operação é toda na parte da manhã", { wnow: WNOW, offered: OFFERED, slotsOffered: true }, "schedule_ask", ["period_ask"], []],
  ["Como estaria sua agenda na sexta-feira?", { wnow: WNOW }, "schedule_ask", ["question", "day_word"], []],
  ["Consigo no período da tarde", { wnow: WNOW }, "schedule_ask", ["period_ask"], []],
  ["Quero remarcar", {}, "reschedule_ask", ["interest"], []],
  ["Dá pra mudar o horário?", { callAt: CALL }, "schedule_ask", ["question"], []],
  ["Sim", {}, "yes", ["interest"], []],
  ["Opa sim, ajudaria", {}, "yes", ["interest"], []],
  ["pode ser", {}, "yes", ["interest"], []],
  ["ok", {}, "yes", ["interest"], []],
  ["Não", {}, "no", [], ["interest"]],
  ["não consigo", {}, "no", [], []],
  ["Vou ver com meu sócio e te retorno", {}, "postpone", [], []],
  ["te retorno amanhã", { wnow: WNOW }, "postpone", ["day_word"], []],  // o parser da agenda diz que não é pedido; é adiamento (R-031)
  ["Olá, boa tarde", {}, "greeting_only", [], []],
  ["Bom dia", {}, "greeting_only", [], []],
  ["quanto custa?", {}, "question", ["price_ask"], []],
  ["Qual o valor?", {}, "question", ["price_ask"], []],
  ["Sim, pode marcar. E qual o valor?", { offered: ONE, slotsOffered: true }, "accept_slot", ["price_ask", "interest"], []],
  ["Como funciona a clonagem?", {}, "question", [], ["price_ask"]],
  ["Vou entrar pelo celular", {}, "other", ["device_mobile"], []],
  ["meu email é rafael@loja.com.br", {}, "other", ["email"], []],
  ["Tenho interesse", {}, "yes", ["interest"], []],
  ["Ainda não vendo em marketplace", {}, "other", [], []],
];

for (const [text, ctx, primary, must, mustNot] of CASES) {
  test(`intenção: "${text.slice(0, 60)}" → ${primary}${must.length ? ` + ${must.join(",")}` : ""} #R-032 #R-034 #R-083`, () => {
    const r = classifyInbound(text, ctx);
    assert.equal(r.primary, primary, `primário de "${text}"`);
    for (const l of must) assert.ok(r.all.has(l), `"${text}" devia ter ${l}; tem ${[...r.all].join(",")}`);
    for (const l of mustNot) assert.ok(!r.all.has(l), `"${text}" não devia ter ${l}`);
    assert.ok(INTENTS.includes(r.primary));
    for (const l of r.all) assert.ok(LABELS.includes(l), `rótulo fora da lista: ${l}`);
  });
}

test("intenção: e-mail, hora solta e janela de agenda vêm junto do rótulo #R-027 #R-032 #R-096", () => {
  assert.equal(classifyInbound("meu email é rafael@loja.com.br").email, "rafael@loja.com.br");
  assert.equal(classifyInbound("11", { slotsOffered: true }).hour, 11);
  assert.equal(classifyInbound("23", { slotsOffered: true }).hour, null, "23 não é hora de call");
  assert.equal(classifyInbound("Pode ser quarta?", { wnow: WNOW }).window.startDate, "2026-09-23");
  assert.equal(classifyInbound("pode ser 17h", { offered: OFFERED }).slot.at, "2026-09-22T17:00");
});

test("isShortYes é o 'sim' curto do roteiro: sem pergunta, preço, dia, hora ou ressalva #R-070", () => {
  for (const t of ["sim", "Opa sim", "pode ser", "ajudaria sim", "Claro, quero"]) assert.ok(isShortYes(t), t);
  for (const t of ["sim, quanto custa?", "sim mas só na quarta", "pode ser às 10h", "talvez", "sim, quero saber mais sobre a LeverAds. Minha operação: moda", "sim sim sim sim sim sim sim sim sim"]) assert.ok(!isShortYes(t), t);
});

// Dívida visível (R-032, 15/10): "boa tarde" ainda casa PERIOD_ASK_RX como
// co-rótulo, o que desliga a trava "mais cedo primeiro" do cérebro. O parser
// da agenda já ignora (#1150); a regex do cérebro ainda não. Entra no PR3.
test.todo("'Olá, boa tarde' não leva o co-rótulo period_ask #R-032 (PR3)");
