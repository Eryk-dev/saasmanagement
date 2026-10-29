// Tabela de intenções: UMA linha por frase real do lead. Quando o Leo pede um
// ajuste ("'boa tarde' não é período"), a tabela mostra na hora quais outras
// frases viram junto. Rótulo primário em ordem de precedência (INTENTS) +
// co-rótulos (LABELS).

import test from "node:test";
import assert from "node:assert/strict";
import { wallFromNaive } from "../src/crm/agenda-slots.js";
import { classifyInbound, INTENTS, LABELS, isShortYes, asksReschedule, burstInboundText, callbackDay, leadEngaged, statedPainOf, isNonAnswer, NO_INTEREST_RX, plainReply, referralIn, PRICE_ASK_RX, DEMO_COST_RX, WEAK_PROFILE_RX, EXPLAIN_HERE_RX } from "../src/sdr/sdr-intents.js";

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

test("saudação não é período, e 'amanhã' é dia (não 'manhã'): PERIOD_ASK_RX com os lookbehinds do parser #R-032 #R-022", () => {
  for (const t of ["Olá, boa tarde", "Bom dia!", "boa noite", "te retorno amanhã", "Amanhã pode ser"]) assert.ok(!classifyInbound(t).all.has("period_ask"), t);
  for (const t of ["pode ser de manhã", "à tarde fica melhor", "só depois das 15h", "mais tarde", "semana que vem", "prefiro de noite"]) assert.ok(classifyInbound(t).all.has("period_ask"), t);
});

// Raio-x 28/10: adiar com call marcada, rajada inteira e retorno combinado.
test("asksReschedule: 'podemos deixar pra outra semana?', 'estou em viagem', 'se tiver outro horário' pedem remarcação; 'não quero remarcar' não #R-042", () => {
  for (const t of ["Podemos deixar pra outra semana?", "Eu estou em viagem. Por isso pedi pra deixar pra outra semana", "Eu estava marcada para 9h mas se tiver outro horário seria melhor", "Quais seriam os horários disponíveis após o almoço? Preciso adiar", "não vou conseguir hoje, podemos remarcar", "Dá pra mudar pra quinta?"]) {
    assert.equal(asksReschedule(t), true, t);
  }
  for (const t of ["Não quero remarcar, pode cancelar", "Pode confirmar", "Bom dia", "Sim, pode ser às 10h"]) assert.equal(asksReschedule(t), false, t);
});

test("burstInboundText: balões seguidos do lead (até 10 min, sem fala nossa) viram um texto só #R-046", () => {
  const at = (m) => `2026-09-21T11:${String(m).padStart(2, "0")}:00Z`;
  const msgs = [
    { direction: "out", author: "sdr-bot", text: "Consigo hoje às 14h, fica bom pra você?", at: at(0) },
    { direction: "in", text: "Não consigo participar da reunião", at: at(1) },
    { direction: "in", text: "Consegue me explicar por áudio por aqui?", at: at(2) },
  ];
  assert.equal(burstInboundText(msgs), "Não consigo participar da reunião. Consegue me explicar por áudio por aqui?");
  // Fala nossa no meio fecha a rajada; balão com mais de 10 min também.
  assert.equal(burstInboundText([...msgs, { direction: "out", author: "sdr-bot", text: "Claro", at: at(3) }, { direction: "in", text: "ok", at: at(4) }]), "ok");
  assert.equal(burstInboundText([{ direction: "in", text: "oi", at: "2026-09-21T10:00:00Z" }, { direction: "in", text: "tudo bem?", at: at(30) }]), "tudo bem?");
  assert.equal(burstInboundText([]), "");
});

test("callbackDay: 'me chama na terça', 'contato somente a partir de terça', 'te chamo amanhã' viram o dia; conversa comum não #R-084", () => {
  assert.equal(callbackDay("Me chama segunda e agendamos", WNOW), "2026-09-28");
  assert.equal(callbackDay("Contato somente a partir de terça", WNOW), "2026-09-22");
  assert.equal(callbackDay("Amanhã cedo te chamo aqui para combinarmos", WNOW), "2026-09-22");
  assert.equal(callbackDay("Pode me chamar na sexta", WNOW), "2026-09-25");
  assert.equal(callbackDay("Pode ser terça às 10h?", WNOW), null, "pedido de horário não é retorno combinado");
  assert.equal(callbackDay("te retorno", WNOW), null, "sem dia não há o que carimbar");
});

// Raio-x 28/10: engajamento de verdade, desinteresse de verdade, dor declarada.
test("leadEngaged: 'Olá boa tarde' não engaja; 'Sem dúvida alguma', dor declarada e hora engajam; 'Não quero começar' não #R-011 #R-083", () => {
  const eng = (t) => leadEngaged([{ direction: "in", text: t }]);
  for (const t of ["Olá boa tarde", "Boa noite!", "Bom dia", "Não quero começar", "Não tenho interesse", "Tudo bem e vc?", "Conta jurídica"]) assert.equal(eng(t), false, t);
  for (const t of ["Sem dúvida alguma", "Com certeza", "Em suma todos mas o principal é compatibilidade", "Manual. Meu nicho é muito específico e precisa ser técnico porém a compatibilidade atrasa o processo.", "pode ser quarta às 10h", "sim", "quero ver", "Me interessa, pode ser à tarde?"]) assert.equal(eng(t), true, t);
});

test("statedPainOf: dor com as próprias palavras, por produto; pergunta e pedido de preço não contam #R-011 #R-045", () => {
  assert.equal(statedPainOf("o meu principal problema é cadastrar produtos em massa com qualidade, título, categoria e principalmente pesquisa de mercado"), "oem");
  assert.equal(statedPainOf("Em suma todos mas o principal é compatibilidade"), "oem");
  assert.equal(statedPainOf("E monitorar as promoções"), "price");
  assert.equal(statedPainOf("já tomei prejuízo por precificar errado, a margem some"), "price");
  assert.equal(statedPainOf("Integração entre contas"), "ads");
  assert.equal(statedPainOf("Qual o valor?"), null);
  assert.equal(statedPainOf("Vocês cobram por anúncios feitos?"), null);
  assert.equal(statedPainOf("Oi, me chamo Rafael e quero saber mais sobre a LeverAds. Minha operação: autopeças"), null);
  assert.equal(statedPainOf("Tudo bem e vc?"), null);
});

test("isNonAnswer e NO_INTEREST_RX: saudação/ack/'e você?' não respondem a pergunta pendente; 'não quero começar', 'agora não', 'ainda não é o momento' são desinteresse #R-047 #R-083", () => {
  for (const t of ["Tudo bem e vc?", "Que bom", "ok", "Bom dia", "[reaction] 👍", "👍", "Legal"]) assert.equal(isNonAnswer(t), true, t);
  for (const t of ["Conta jurídica", "Sim, vendo no ML", "Não vendo ainda", "Quanto custa?"]) assert.equal(isNonAnswer(t), false, t);
  for (const t of ["Não quero começar", "Nao quero fazer call, queria ver os valores", "Agora não", "ainda não é o momento para a minha empresa", "Não tenho mais interesse"]) assert.equal(NO_INTEREST_RX.test(plainReply(t)), true, t);
  for (const t of ["Não quero cancelar, só não consigo abrir o link", "quero saber mais sobre o Lever Price", "Não quero perder tempo, pode ser hoje?"]) assert.equal(NO_INTEREST_RX.test(plainReply(t)), false, t);
});

test("referralIn: pedido de falar com terceiro (texto com número, cartão 👤, 'é o Lucas'); número próprio e pedido de dia não são indicação #R-043", () => {
  assert.deepEqual(referralIn("11998116287\nChama Larissa explica para ela como funciona\nBom dia", { ownPhone: "5511939426885" }), { phone: "5511998116287", name: "Larissa", asked: true });
  assert.deepEqual(referralIn("👤 Vitória Ecommerce Digital · +55 11 92505-5005 · Vitória Ecommerce Digital", {}), { phone: "5511925055005", name: "Vitória Ecommerce Digital", asked: true });
  assert.deepEqual(referralIn("vou te passar um numero, é o Lucas, responsavel pelo meu ecommerce. 11 96213-5572", {}), { phone: "5511962135572", name: "Lucas", asked: true });
  assert.deepEqual(referralIn("Pedir para chamar minha gerente de mercado livre", {}), { phone: "", name: "", asked: true });
  assert.equal(referralIn("meu numero é 41 99999-0000", { ownPhone: "5541999990000" }), null);
  assert.equal(referralIn("me chama na terça", {}), null);
  assert.equal(referralIn("Pode ser quarta às 10h?", {}), null);
});

test("PRICE_ASK_RX: pedido de preço do SERVIÇO pega; 'valores médios de mercado', 'tenho produto é preço', 'preço e margem' não; custo da demonstração é outra régua #R-050", () => {
  for (const t of ["Qual é o valor da plataforma de vocês?", "quanto custa?", "Qual o valor?", "Os valores", "Isso, gostaria de saber os valores", "Eu gostaria de sabet o valor", "qual valores", "Quer me adiantar o valor", "Bom dia qual valor, ja que no site nao informa.", "Eu quero saber como funciona e valor", "Vocês cobram por anúncios feitos ?", "voce tem os valores dos planos ?", "Ok como funciona os valores", "Mas os planos não tem disponível? Só por uma conversa?", "mensalidade?", "quanto custa por mês o sistema?"]) assert.equal(PRICE_ASK_RX.test(t), true, t);
  for (const t of ["Hoje temos uma equipe de anúncios que executa muito bem o serviço mas não entendem muito sobre compatibilidade e valores médios de mercado", "Tenho produto é preço preciso vender", "Preço e margem", "Porque temos produtos com valor do frete diferentes para o mesmo produto", "nós utilizamos o shopping de preços", "já tomei prejuízo por precificar errado"]) assert.equal(PRICE_ASK_RX.test(t), false, t);
  for (const t of ["tem algum custo ?", "Qual o valor da consulta?", "essa demonstração é paga?"]) assert.equal(DEMO_COST_RX.test(t), true, t);
  for (const t of ["quanto custa?", "Qual o valor da plataforma?"]) assert.equal(DEMO_COST_RX.test(t), false, t);
});

test("WEAK_PROFILE_RX e EXPLAIN_HERE_RX: perfil fraco (não vende / só físico / só TikTok / começando) e pedido de explicação por aqui #R-048 #R-044", () => {
  for (const t of ["Na vdd só trabalhamos com loja física", "No momento ainda não estou vendendo", "Eu vendo por enquanto na Shoppe e no Tik Tok estou iniciando", "Apenas pelo Instagram, Facebook", "Quero começar", "Pretendo começar no ML mês que vem", "sou analfabeto digital"]) assert.equal(WEAK_PROFILE_RX.test(plainReply(t)), true, t);
  for (const t of ["Sim vendo no ML", "hoje nao", "Conta jurídica", "vendo na Shopee e no Mercado Livre"]) assert.equal(WEAK_PROFILE_RX.test(plainReply(t)), false, t);
  for (const t of ["Consegue me explicar por áudio por aqui ?", "Pode ser por aqui mesmo?", "Pode me passar por aqui mesmo", "nao tem pdf explicando", "Eu queria ver preços e só receber mensagem,nada ao vivo.", "Consegue enviar uma apresentação, para a reunião ser mais produtiva?", "Vcs podem enviar áudios"]) assert.equal(EXPLAIN_HERE_RX.test(plainReply(t)), true, t);
  for (const t of ["Vc pode me explicar como funciona?", "Pode ser quarta?", "Como funciona a clonagem?"]) assert.equal(EXPLAIN_HERE_RX.test(plainReply(t)), false, t);
});

test("29/10: 'muito'/'exato' engajam; 'não tenho mais de uma' não é desinteresse; 'estou em viagem' é adiamento; liberação de cadastro e reclamação do robô têm régua própria #R-011 #R-083 #R-084 #R-090 #R-001", async () => {
  const { POSTPONE_RX, ONBOARDING_RX, COMPLAINT_RX, SHORT_YES_RX } = await import("../src/sdr/sdr-intents.js");
  for (const t of ["Muito", "Exato", "Demais!", "Com certeza", "Isso mesmo"]) assert.equal(leadEngaged([{ direction: "in", text: t }]), true, t);
  assert.equal(SHORT_YES_RX.test(plainReply("muito caro pra mim")), false);
  assert.equal(statedPainOf("Compro estoque obsoleto"), null, "estoque sozinho não é dor de multi-contas");
  assert.equal(statedPainOf("preciso sincronizar o estoque entre as contas"), "ads");
  assert.equal(NO_INTEREST_RX.test(plainReply("Eu creio que seja isso porque eu tenho uma conta só hoje, não tenho mais de uma")), false);
  assert.equal(NO_INTEREST_RX.test(plainReply("não tenho mais interesse, obrigado")), true);
  for (const t of ["Estou em viagem", "to viajando essa semana", "quando eu voltar te chamo"]) assert.equal(POSTPONE_RX.test(plainReply(t)), true, t);
  assert.equal(ONBOARDING_RX.test("Olá! Quero solicitar a liberação do meu cadastro na LeverAds. Email: comercial@x.com.br"), true);
  assert.equal(ONBOARDING_RX.test("Oi, me chamo Rafael e quero saber mais sobre a LeverAds"), false);
  assert.equal(COMPLAINT_RX.test(plainReply("Seu robô ta com defeito .... Por isso odeio esses atendimentos automatizados")), true);
  assert.equal(COMPLAINT_RX.test(plainReply("To falando com Ia?")), false, "perguntar se é robô segue na R-001 do prompt, não é reclamação");
});
