// Tabela dos validadores de saída (sdr-guards.js): cada um dispara em texto
// sintético violador, corrige do jeito que a cadeia legada corrigia, e fica
// quieto em texto limpo. A equivalência com o cérebro real está nas cenas
// (sdr-brain.test.js / sdr-humanizacao.test.js, "sombra do validador").

import test from "node:test";
import assert from "node:assert/strict";
import { wallFromNaive } from "../src/crm/agenda-slots.js";
import { GUARDS, guardById, validateDraft, makeDraft, realOfferOf, PRICE_RX, stripDuration, stripDeviceAsk, sameSentence, alreadySaid } from "../src/sdr/sdr-guards.js";
import { offerLine, OFFER_STYLES, NO_SLOT_TEXT } from "../src/sdr/sdr-offer.js";
import { isOfferMsg, collapseSameDay, offeredSlotsIn } from "../src/sdr/sdr-signals.js";
import { RULES, ruleById } from "../src/sdr/sdr-rules.js";

const WNOW = wallFromNaive("2026-08-19T10:00");
const PAIR = [{ at: "2026-08-20T09:00", label: "amanhã às 9h" }, { at: "2026-08-20T11:00", label: "amanhã às 11h" }];
const SLOTS = [...PAIR, { at: "2026-08-20T14:00", label: "amanhã às 14h" }];
const OFFER = "Consigo amanhã às 9h ou às 11h, qual fica melhor pra você?";
// O que os validadores ESCREVEM sai com o dia nas duas horas; é o send() do
// cérebro que colapsa pra "amanhã às 9h ou às 11h" (collapseSameDay).
const OFFER_RAW = "Consigo amanhã às 9h ou amanhã às 11h, qual fica melhor pra você?";
const base = (over = {}) => ({
  nome: "Rafael", script: "clone", msgs: [], callAt: "", slotList: SLOTS, offerPool: SLOTS, suggestedPair: PAIR, requestedDate: false, offerDate: "", requestedEmpty: false,
  hourReply: false, engaged: true, slotsOffered: false, inCallWindow: false, lastInText: "sim", wnow: WNOW, discoveryQuestion: "Isso ajudaria na sua operação hoje?",
  dayLabelOf: (d) => (d === "2026-08-21" ? "sexta" : d), nowIso: "2026-08-19T13:00:00.000Z", inboundText: "sim", priceDeferral: "DESVIO OFICIAL", ...over,
});
const texts = (r) => r.draft.parts.map((p) => p.text);
const enforce = (parts, ctx = {}, kind = "ia") => validateDraft(makeDraft(parts, kind), base(ctx), { mode: "enforce" });
const audit = (parts, ctx = {}, kind = "ia") => validateDraft(makeDraft(parts, kind), base(ctx), { mode: "audit" });

test("guards: todo validador aponta pra uma regra ativa do rulebook, e toda regra com guard existe aqui #R-120", () => {
  for (const g of GUARDS) assert.equal(ruleById(g.rule)?.status, "active", `${g.id} → ${g.rule}`);
  for (const r of RULES.filter((r) => r.guard)) assert.ok(guardById(r.guard), `${r.id} aponta pro validador ${r.guard} que não existe`);
});

test("guards: texto limpo não dispara nada #R-003", () => {
  const r = enforce(["Perfeito Rafael, te explico rapidinho", OFFER]);
  assert.deepEqual(r.fired, []);
  assert.deepEqual(r.residual, []);
  assert.deepEqual(texts(r), ["Perfeito Rafael, te explico rapidinho", OFFER]);
});

// [guard, partes violadoras, ctx, texto esperado depois do fix (ou stop), efeitos esperados]
const CASES = [
  ["priceLeak", ["São 2 mil reais por mês, mas vale a pena"], {}, { stop: "preco-travado", parts: ["DESVIO OFICIAL"], stamps: ["priceGuardAt"] }],
  ["priceLeak", ["O plano Essencial resolve isso"], {}, { stop: "preco-travado" }],
  ["redirect", ["Fala com o time comercial em wa.me/5541999999999"], {}, { stop: "redirect-travado", parts: [], stamps: ["handoffAt", "redirectGuardAt"], alert: /outro número/ }],
  ["noRepeat", ["Primeiro a gente entende o seu cenário e aí te mostra os pontos que dá pra alavancar"], { msgs: [{ direction: "out", author: "sdr-bot", text: "Primeiro a gente entende o seu cenário, e aí te mostra os pontos que dá pra alavancar" }] }, { stop: "repeticao-humano", stamps: ["handoffAt", "repeatGuardAt"] }],
  ["noRepeat", ["Perfeito", "Primeiro a gente entende o seu cenário e aí te mostra os pontos que dá pra alavancar"], { msgs: [{ direction: "out", author: "sdr-bot", text: "Primeiro a gente entende o seu cenário, e aí te mostra os pontos que dá pra alavancar" }] }, { parts: ["Perfeito", OFFER_RAW] }],
  ["slotInList", ["Consigo sexta às 15h ou às 17h, qual fica melhor pra você?"], {}, { parts: [OFFER_RAW] }],
  ["slotInList", ["Consigo sexta às 15h ou às 17h, qual fica melhor pra você?"], { requestedEmpty: true, offerDate: "2026-08-21" }, { parts: ["Sexta já lotou, consigo amanhã às 9h ou amanhã às 11h, qual fica melhor pra você?"] }],
  ["noPromise", ["Deixa eu ver na agenda e te confirmo em minutos"], {}, { parts: [OFFER_RAW], stamps: ["promiseGuardAt"] }],
  ["noPromise", ["Deixa eu ver na agenda e te confirmo em minutos"], { suggestedPair: [] }, { parts: [NO_SLOT_TEXT["sem-vaga"]] }],
  ["apologyOnTakenSlot", ["Esse horário não consigo"], {}, { parts: ["Ahh Rafael, esse horário acabou de ser preenchido por outro cliente, me desculpa! " + OFFER_RAW], stamps: ["slotTakenGuardAt"] }],
  ["noPhantomOffer", ["Algum dos horários que te passei encaixa?"], {}, { parts: [OFFER_RAW], stamps: ["fakeOfferGuardAt"] }],
  ["noDuration", ["É uma conversa de 20 minutos com o especialista"], {}, { parts: ["É uma conversa com o especialista", OFFER_RAW] }],  // a cadeia segue: sem pergunta, a trava de beco emenda a oferta
  ["noDeviceAsk", ["Você vai entrar pelo celular ou pelo computador?", "Te espero então"], { lastInText: "vou pelo celular" }, { partsMatch: [/^Te espero então$/, /computador por perto/] }],
  ["noDeviceAsk", ["Pode sim, é só acessar o link", "Consegue entrar por ele?"], { lastInText: "vou pelo celular" }, { partsMatch: [/^Pode sim, é só acessar o link$/, /computador por perto/, /^Consegue entrar por ele\?$/] }],
  ["noOfferBeforeEngaged", ["Consigo amanhã às 9h ou às 11h, qual fica melhor pra você?"], { engaged: false }, { parts: ["Isso ajudaria na sua operação hoje?"] }],
  ["earliestFirst", ["Consigo amanhã às 11h ou às 14h, qual fica melhor pra você?"], {}, { parts: [OFFER_RAW], stamps: ["earliestGuardAt"] }],
  ["nextStep", ["Que bom que ajuda"], {}, { parts: ["Que bom que ajuda", OFFER_RAW] }],
  ["nextStep", ["Que bom que ajuda"], { slotsOffered: true }, { parts: ["Que bom que ajuda", "Fica melhor amanhã às 9h ou amanhã às 11h?"] }],
  // Dependência de ordem herdada (documentada em 15/10): "mais cedo primeiro"
  // confere a PRIMEIRA oferta e "uma oferta" fica com a ÚLTIMA; sobra a oferta
  // sem o mais cedo. O residual denuncia; a reordenação é o PR5.
  ["oneOfferPerReply", ["Consigo amanhã às 9h ou às 11h, qual fica melhor pra você?", "Consigo amanhã às 14h, fica bom pra você?", "Qual dia você prefere?"], {}, { parts: ["Consigo amanhã às 14h, fica bom pra você?"], residual: ["earliestFirst"] }],
];
for (const [id, parts, ctx, exp] of CASES) {
  const g = guardById(id);
  test(`guard ${id} (${g.rule}): "${parts[0].slice(0, 50)}" #${g.rule}`, () => {
    const a = audit(parts, ctx);
    assert.ok(a.fired.includes(id), `audit devia disparar ${id}; disparou ${a.fired.join(",")}`);
    assert.deepEqual(texts(a), parts, "audit não reescreve");
    const r = enforce(parts, ctx);
    assert.ok(r.fired.includes(id), `enforce devia disparar ${id}`);
    if (exp.stop) assert.equal(r.draft.stop?.result, exp.stop);
    if (exp.parts) assert.deepEqual(texts(r), exp.parts);
    if (exp.partsMatch) { assert.equal(texts(r).length, exp.partsMatch.length); exp.partsMatch.forEach((rx, i) => assert.match(texts(r)[i], rx)); }
    for (const s of exp.stamps || []) assert.ok(r.effects.some((e) => e.type === "stamp" && s in e.patch), `efeito stamp ${s}`);
    if (exp.alert) assert.ok(r.effects.some((e) => e.type === "alert" && exp.alert.test(e.text)), "efeito alert");
    if (!exp.stop) assert.deepEqual(r.residual.filter((v) => !v.exempt).map((v) => v.guard), exp.residual || [], "depois do fix não sobra violação");
  });
}

test("guard noDuration: a M3 do roteiro é isenta (R-070), conta mas não corrige #R-060 #R-070", () => {
  const r = enforce(["É uma conversa rápida, em torno de 30/40 minutos e o especialista vai te mostrar na prática"], {}, "roteiro");
  assert.ok(r.violations.some((v) => v.rule === "R-060" && v.exempt));
  assert.match(texts(r)[0], /30\/40 minutos/);
});

test("guards só de auditoria (call, uma pergunta, orçamento) contam e não mexem #R-006 #R-003", () => {
  const r = enforce(["Na nossa call de amanhã o especialista te mostra", "Fica bom? Posso contar com você?"]);
  assert.ok(r.fired.includes("noCallWord") && r.fired.includes("singleQuestion"));
  assert.deepEqual(texts(r)[0], "Na nossa call de amanhã o especialista te mostra");
  const big = enforce(["a".repeat(901), "b", "c", "d"]);
  assert.ok(big.fired.includes("budget"));
});

test("guards: a ordem é a da cadeia legada e o preço vence tudo #R-050 #R-009", () => {
  assert.deepEqual(GUARDS.slice(0, 4).map((g) => g.id), ["priceLeak", "redirect", "noRepeat", "slotInList"]);
  const r = enforce(["Custa R$ 299, deixa eu ver na agenda e te confirmo"]);
  assert.equal(r.draft.stop?.result, "preco-travado");
  assert.deepEqual(r.fired, ["priceLeak"]);
});

test("offerLine: toda variante é lida de volta como oferta pela régua compartilhada (isOfferMsg/offeredSlotsIn) #R-021 #R-026", () => {
  for (const style of OFFER_STYLES) {
    const line = collapseSameDay(offerLine(PAIR, { style, wnow: WNOW, nome: "Rafael", lotouDay: "sexta" }));
    // "Fica melhor X ou Y?" é repescagem de oferta JÁ feita, não oferta nova:
    // por desenho não conta como slotsOffered (sdr-signals.js).
    if (style === "fica-melhor") { assert.ok(!isOfferMsg(line), line); continue; }
    assert.ok(isOfferMsg(line), `${style}: ${line}`);
    const read = offeredSlotsIn([{ direction: "out", author: "sdr-bot", text: line, at: "2026-08-19T13:00:00Z" }]);
    assert.deepEqual(read.map((s) => s.at), PAIR.map((s) => s.at), `${style} lido de volta`);
  }
  assert.ok(isOfferMsg(offerLine([PAIR[0]], { wnow: WNOW })));
  assert.equal(offerLine([], { empty: "periodo" }), NO_SLOT_TEXT.periodo);
  assert.equal(realOfferOf(base()), "Consigo amanhã às 9h ou amanhã às 11h, qual fica melhor pra você?");
});

test("helpers de texto nosso: PRICE_RX, stripDuration, stripDeviceAsk, sameSentence, alreadySaid #R-050 #R-060 #R-061 #R-009", () => {
  assert.ok(PRICE_RX.test("a partir de R$ 497") && !PRICE_RX.test("500 anúncios em 5 minutos"));
  assert.equal(stripDuration("É uma conversa de 20 minutos"), "É uma conversa");
  assert.equal(stripDuration("publica em menos de 5 minutos"), "publica em menos de 5 minutos");
  assert.equal(stripDeviceAsk("Pode ser. Vai entrar pelo celular ou pelo computador? Te espero"), "Pode ser. Te espero");
  assert.ok(sameSentence("Qual fica melhor pra você, amanhã de manhã ou à tarde", "Qual fica melhor pra você: amanhã de manhã, ou à tarde?"));
  assert.ok(!sameSentence("Consigo amanhã às 10h ou às 14h", "Consigo hoje às 17h ou às 19h"), "oferta nova não é requentada");
  assert.ok(!alreadySaid("Perfeito", [{ direction: "out", author: "sdr-bot", text: "Perfeito" }]), "confirmação curta pode repetir");
});
