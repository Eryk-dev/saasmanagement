// Contrato v2 da IA (sdr-prompt.js): schema com enum de ids, lista com ids e
// a normalização que aceita v1 e v2 no mesmo shape pro cérebro.
import test from "node:test";
import assert from "node:assert/strict";
import { schemaV2, slotIdsOf, slotLinesV2, draftFromAi, ACTIONS } from "../src/sdr/sdr-prompt.js";
import { makeAnthropic } from "../src/integrations/anthropic.js";

const SLOTS = slotIdsOf([{ at: "2026-08-20T09:00", label: "amanhã às 9h" }, { at: "2026-08-20T11:00", label: "amanhã às 11h" }, { at: "2026-08-20T14:00", label: "amanhã às 14h" }]);

test("schema v2: strict, todas as chaves obrigatórias, slotIds com enum dos ids (sem enum quando a lista é vazia) #R-020", () => {
  const sc = schemaV2(SLOTS.map((s) => s.id));
  assert.equal(sc.additionalProperties, false);
  assert.deepEqual(sc.required, ["acao", "partes", "oferecer", "slotIds", "email", "motivoHumano"]);
  assert.deepEqual(sc.properties.slotIds.items.enum, ["s1", "s2", "s3"]);
  assert.deepEqual(sc.properties.acao.enum, ACTIONS);
  assert.equal(schemaV2([]).properties.slotIds.items.enum, undefined, "lista vazia não leva enum vazio");
  assert.match(sc.properties.partes.description, /SEM dia nem hora/);
});

test("lista com ids: s1..sN na ordem da lista #R-021", () => {
  assert.equal(slotLinesV2(SLOTS), "- s1 · 2026-08-20T09:00 · amanhã às 9h\n- s2 · 2026-08-20T11:00 · amanhã às 11h\n- s3 · 2026-08-20T14:00 · amanhã às 14h");
});

test("draftFromAi v1: igual ao que o sdrDecide devolvia (mensagens, horario em ISO, ação inválida vira humano) #R-020", () => {
  const d = draftFromAi({ acao: "agendar", mensagens: [" ok ", ""], horario: "2026-08-20T09:00", email: "a@b.co" }, { contract: "v1", slots: SLOTS });
  assert.deepEqual(d, { acao: "agendar", mensagens: ["ok"], mensagem: "ok", horario: "2026-08-20T09:00", oferecer: false, slotIds: [], slots: [], email: "a@b.co", motivoHumano: "" });
  assert.equal(draftFromAi({ acao: "xx", mensagem: "oi" }).acao, "humano");
  assert.deepEqual(draftFromAi({ acao: "responder", mensagens: ["a", "b", "c", "d"] }).mensagens, ["a", "b", "c"]);
});

test("draftFromAi v2: slotIds viram horário e slots; id fora da lista cai; oferecer só em responder; compat com mensagens/horario #R-020 #R-026", () => {
  const ag = draftFromAi({ acao: "agendar", partes: [], oferecer: false, slotIds: ["s2"], email: "", motivoHumano: "" }, { contract: "v2", slots: SLOTS });
  assert.equal(ag.horario, "2026-08-20T11:00");
  assert.deepEqual(ag.slots.map((s) => s.at), ["2026-08-20T11:00"]);
  const bad = draftFromAi({ acao: "agendar", partes: [], oferecer: false, slotIds: ["s9"], email: "", motivoHumano: "" }, { contract: "v2", slots: SLOTS });
  assert.equal(bad.horario, "", "id inválido não vira horário (o motor re-oferta)");
  const of = draftFromAi({ acao: "responder", partes: ["Que bom"], oferecer: true, slotIds: ["s1", "s3", "s2"], email: "", motivoHumano: "" }, { contract: "v2", slots: SLOTS });
  assert.deepEqual(of.mensagens, ["Que bom"]);
  assert.equal(of.oferecer, true);
  assert.deepEqual(of.slotIds, ["s1", "s3"], "no máximo 2");
  assert.equal(draftFromAi({ acao: "humano", partes: ["x"], oferecer: true, slotIds: [], email: "", motivoHumano: "y" }, { contract: "v2", slots: SLOTS }).oferecer, false, "oferecer só em responder");
  const compat = draftFromAi({ acao: "remarcar", mensagens: [], horario: "2026-08-20T14:00" }, { contract: "v2", slots: SLOTS });
  assert.equal(compat.horario, "2026-08-20T14:00", "modelo que ainda devolve horario em ISO é aceito");
});

// O que vai pro provedor em cada contrato (fetch falso via OpenRouter).
function fakeRouter(reply) {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { status: 200, json: async () => ({ model: "openai/x", usage: {}, choices: [{ message: { content: JSON.stringify(reply) } }] }) }; };
  return { calls, ai: makeAnthropic({ fetch, apiKey: "sk-or-test", model: "openai/x" }) };
}
const CTX = { sdrName: "Manuela", lead: { name: "Rafael" }, nowLabel: "quarta, 19/08, 10h00 (hora de Brasília)", slots: SLOTS.map(({ id, ...s }) => s), suggestedPair: [SLOTS[0], SLOTS[1]].map(({ id, ...s }) => s), conversation: [{ who: "LEAD", text: "sim" }] };

test("sdrDecide v2: schema com enum, lista com ids, par sugerido por id, e a resposta volta normalizada #R-020 #R-021", async () => {
  const { calls, ai } = fakeRouter({ acao: "responder", partes: ["Que bom Rafael"], oferecer: true, slotIds: [], email: "", motivoHumano: "" });
  const d = await ai.sdrDecide({ ...CTX, contract: "v2" });
  const body = calls[0].body;
  assert.equal(body.response_format.json_schema.name, "sdr_decision_v2");
  assert.deepEqual(body.response_format.json_schema.schema.properties.slotIds.items.enum, ["s1", "s2", "s3"]);
  const user = body.messages[1].content;
  assert.ok(user.includes("- s1 · 2026-08-20T09:00 · amanhã às 9h"), "lista com ids");
  assert.ok(user.includes("PAR SUGERIDO pra quando você oferecer DUAS opções (já espaçado em 2h+): s1 (amanhã às 9h) ou s2 (amanhã às 11h)"), "par por id");
  assert.ok(user.includes("NUNCA escreva dia nem hora nas partes"));
  assert.deepEqual([d.acao, d.mensagens, d.oferecer, d.slotIds, d.horario], ["responder", ["Que bom Rafael"], true, [], ""]);
});

test("sdrDecide v1 segue byte a byte como antes (sem ids, schema antigo) #R-120", async () => {
  const { calls, ai } = fakeRouter({ acao: "agendar", mensagens: [], horario: "2026-08-20T09:00", email: "", motivoHumano: "" });
  const d = await ai.sdrDecide(CTX);
  const body = calls[0].body;
  assert.equal(body.response_format.json_schema.name, "sdr_decision");
  assert.equal(body.response_format.json_schema.schema.properties.slotIds, undefined);
  const user = body.messages[1].content;
  assert.ok(user.includes("- 2026-08-20T09:00 (amanhã às 9h)"));
  assert.ok(!user.includes("s1 ·"));
  assert.equal(d.horario, "2026-08-20T09:00");
});

// ── Prompt v2: núcleo + bloco por estado ─────────────────────────────────────
import { buildCoreV2, buildUserV2, STATE_DESC } from "../src/sdr/sdr-prompt.js";
import { promptBlockFor, ruleById } from "../src/sdr/sdr-rules.js";

test("prompt v2: o turno do usuário traz estado, fatos, regras do estado, agenda com ids e a conversa; remarcação pendente fica sem agenda #R-011 #R-025 #R-036", () => {
  const base = { sdrName: "Manuela", nowLabel: "quarta, 19/08, 10h00 (hora de Brasília)", lead: { name: "Rafael", niche: "autopecas" }, digest: "3 contas", pain: { code: "B", label: "Conta banida", mode: "clone" }, slots: SLOTS, suggestedPair: [SLOTS[0], SLOTS[1]], conversation: [{ who: "LEAD", text: "sim" }] };
  const u = buildUserV2({ ...base, state: "oferta_feita", facts: { demoOffered: true, slotsOffered: true, engaged: true, askingNow: false } });
  assert.ok(u.includes(`VOCÊ ESTÃ EM: oferta_feita`.replace("Ã", "Á")), "estado");
  assert.ok(u.includes("FATOS: pitch já feito sim · horários já oferecidos sim · lead engajou sim · pediu preço nesta mensagem não"));
  assert.ok(u.includes(ruleById("R-025").prompt) && !u.includes(ruleById("R-011").prompt), "regras do estado certo");
  assert.ok(u.includes("- s1 · 2026-08-20T09:00 · amanhã às 9h") && u.includes("PAR SUGERIDO (já espaçado em 2h+): s1 (amanhã às 9h) ou s2 (amanhã às 11h)."));
  assert.ok(u.includes("AUTOPEÇAS") && u.includes("LEAD: sim") && u.includes("Decida a ação e o texto."));
  const novo = buildUserV2({ ...base, state: "novo", canGreet: false, gapMin: 3, facts: {} });
  assert.ok(novo.includes("SAUDAÇÃO: liberada (primeira resposta sua)"), "estado novo sempre libera a saudação (C4)");
  assert.ok(novo.includes(ruleById("R-011").prompt));
  const rem = buildUserV2({ ...base, state: "remarcacao_pendente", facts: {} });
  assert.ok(!rem.includes("HORÁRIOS LIVRES") && !rem.includes("nenhum horário livre"), "remarcação pendente não recebe agenda (C5)");
  assert.ok(rem.includes(STATE_DESC.remarcacao_pendente));
  const price = buildUserV2({ ...base, state: "engajado", script: "price", facts: {} });
  assert.ok(price.includes("roteiro price") && price.includes(ruleById("R-071").prompt));
});

test("sdrDecide com promptVersion v2: system é o núcleo estável, user é o bloco por estado, contrato v2 forçado #R-120 #R-020", async () => {
  const { calls, ai } = fakeRouter({ acao: "responder", partes: ["Que bom Rafael"], oferecer: true, slotIds: [], email: "", motivoHumano: "" });
  const d = await ai.sdrDecide({ ...CTX, promptVersion: "v2", state: "engajado", script: "clone", facts: { demoOffered: true, engaged: true } });
  const body = calls[0].body;
  assert.equal(body.messages[0].content.replace("\nResponda SOMENTE com o JSON pedido, sem texto fora dele.", ""), buildCoreV2(), "system = núcleo");
  const user = body.messages[1].content;
  assert.ok(user.includes("VOCÊ ESTÁ EM: engajado") && user.includes(ruleById("R-019").prompt));
  assert.equal(body.response_format.json_schema.name, "sdr_decision_v2");
  assert.deepEqual([d.acao, d.oferecer, d.promptVersion], ["responder", true, "v2"]);
  const again = await ai.sdrDecide({ ...CTX, promptVersion: "v2", state: "oferta_feita", facts: {} });
  assert.equal(calls[1].body.messages[0].content, body.messages[0].content, "núcleo idêntico entre chamadas (cache)");
  assert.ok(calls[1].body.messages[1].content.includes("VOCÊ ESTÁ EM: oferta_feita"));
  assert.ok(again.model);
});

test("prompt v2 resolve as contradições do v1: sem duração, sem valor de exemplo, sem frase-reflexo, sem copy do roteiro #R-060 #R-050 #R-025 #R-070", () => {
  const core = buildCoreV2();
  assert.ok(!/20 minutos|30\/40 minutos|2\.000 no semestre|que te passei|Mantemos as 9h/.test(core));
  assert.ok(!core.includes("Maravilha Nome. Pelo que você me passou no formulário"), "copy do roteiro é do sistema, saiu do prompt");
  assert.ok(core.includes("Ah que pena, hoje não dá então"), "exemplo de dia sem hora corrigido");
  assert.ok(core.includes("CONTRATO DE SAÍDA"));
  for (const st of Object.keys(STATE_DESC)) assert.ok(!promptBlockFor(st).includes("que te passei"), st);
});

test("núcleo v2 carrega as regras de prompt escritas à mão: tom da Manuela, 'não sei', estoque, dúvida técnica, objeções, ponte #R-002 #R-012 #R-014 #R-015 #R-018 #R-019", () => {
  const core = buildCoreV2();
  assert.ok(core.includes("Oiii Nome, tudo bem?") && core.includes("nome SEM vírgula"), "R-002 tom da Manuela");
  assert.ok(promptBlockFor("descoberta", "clone").includes(ruleById("R-012").prompt) && promptBlockFor("novo", "clone").includes(ruleById("R-012").prompt), "R-012 'não sei' nos estados novo e descoberta");
  assert.ok(core.includes("SINCRONIZA o estoque entre os anúncios que têm o mesmo SKU"), "R-014 estoque");
  assert.ok(core.includes(ruleById("R-015").prompt), "R-015 dúvida técnica");
  assert.ok(core.includes("Já uso Bling/Upseller/ERP") && core.includes("Amazon/Magalu/TikTok"), "R-018 objeções");
  assert.ok(promptBlockFor("engajado", "clone").includes(ruleById("R-019").prompt), "R-019 ponte no estado engajado");
});

test("A/B de 15/10: com oferecer=true a pergunta é só a da oferta; lead não engajado recebe a ordem enfática de oferecer=false #R-003 #R-011", () => {
  assert.ok(buildCoreV2().includes("Com oferecer=true, NENHUMA parte termina em pergunta"));
  const base = { sdrName: "Manuela", nowLabel: "x", lead: { name: "Rafael" }, slots: SLOTS, suggestedPair: [SLOTS[0], SLOTS[1]], conversation: [] };
  assert.ok(buildUserV2({ ...base, state: "descoberta", facts: { engaged: false } }).includes("O LEAD AINDA NÃO ENGAJOU"));
  assert.ok(!buildUserV2({ ...base, state: "engajado", facts: { engaged: true } }).includes("O LEAD AINDA NÃO ENGAJOU"));
  assert.ok(!buildUserV2({ ...base, state: "call_marcada", callAt: "2026-08-20T10:00", facts: { engaged: false } }).includes("O LEAD AINDA NÃO ENGAJOU"));
});

test("API da Anthropic: o schema vai sem maxItems/minItems (recusados em output_config), OpenRouter segue com eles #R-120", async () => {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { status: 200, json: async () => ({ model: "claude-x", usage: {}, content: [{ type: "text", text: JSON.stringify({ acao: "responder", partes: ["oi"], oferecer: false, slotIds: [], email: "", motivoHumano: "" }) }] }) }; };
  const ai = makeAnthropic({ fetch, apiKey: "sk-ant-test", model: "claude-x" });
  const d = await ai.sdrDecide({ ...CTX, contract: "v2" });
  const schema = calls[0].body.output_config.format.schema;
  assert.equal(JSON.stringify(schema).includes("maxItems"), false);
  assert.deepEqual(schema.properties.slotIds.items.enum, ["s1", "s2", "s3"], "enum continua");
  assert.deepEqual(d.mensagens, ["oi"]);
  const { calls: rc, ai: router } = fakeRouter({ acao: "responder", partes: ["oi"], oferecer: false, slotIds: [], email: "", motivoHumano: "" });
  await router.sdrDecide({ ...CTX, contract: "v2" });
  assert.equal(rc[0].body.response_format.json_schema.schema.properties.partes.maxItems, 3, "OpenRouter mantém maxItems");
});

test("prompt v2: sem pitch na conversa, o bloco manda dizer em uma frase o que o produto faz antes da pergunta (29/10, Roberto/Ricardo) #R-005", async () => {
  const { buildUserV2 } = await import("../src/sdr/sdr-prompt.js");
  const base = { sdrName: "Manuela", nowLabel: "x", lead: { name: "Roberto" }, state: "descoberta", script: "price", conversation: [] };
  assert.match(buildUserV2({ ...base, facts: { demoOffered: false } }), /O PITCH AINDA NÃO SAIU[\s\S]*Lever Price faz/);
  assert.doesNotMatch(buildUserV2({ ...base, facts: { demoOffered: true } }), /O PITCH AINDA NÃO SAIU/);
});

// ── REVISOR (24/11) ─────────────────────────────────────────────────────────
test("revisor: mesmo núcleo como prefixo, contrato v2 + aprovado/problema, e a correção só vale se muda a decisão #R-124", async () => {
  const { buildReviewCore, buildCoreV2, reviewSchema, buildReviewUser, applyReview, draftFromAi, REVIEWABLE_ACTIONS, FORBIDDEN_IN_PROMPT } = await import("../src/sdr/sdr-prompt.js");
  const core = buildCoreV2(), rev = buildReviewCore();
  assert.ok(rev.startsWith(core), "o núcleo segue byte a byte na frente (prefixo cacheável e regras idênticas)");
  assert.match(rev.slice(core.length), /MODO REVISÃO[\s\S]*LEU TUDO[\s\S]*HORÁRIO[\s\S]*AVANÇO[\s\S]*GENTE SEM PRECISAR[\s\S]*SILÊNCIO SEM PRECISAR[\s\S]*COERÊNCIA[\s\S]*REPETIÇÃO[\s\S]*FORMA/);
  for (const f of FORBIDDEN_IN_PROMPT) assert.ok(!rev.slice(core.length).includes(f), f);
  const schema = reviewSchema(["s1", "s2"]);
  assert.deepEqual(schema.required.slice(0, 2), ["aprovado", "problema"]);
  assert.deepEqual(schema.properties.slotIds.items.enum, ["s1", "s2"], "o revisor também só escolhe id da lista");
  assert.deepEqual(REVIEWABLE_ACTIONS, ["responder", "humano", "silencio"]);
  const slots = [{ id: "s1", at: "2026-08-20T09:00" }, { id: "s2", at: "2026-08-20T11:00" }];
  const first = { ...draftFromAi({ acao: "responder", partes: ["Perfeito Rafael"], oferecer: true, slotIds: [] }, { contract: "v2", slots }), model: "m", usage: { in: 1, out: 1 } };
  assert.match(buildReviewUser("CONVERSA…", first), /RASCUNHO DA OUTRA SDR[\s\S]*"acao":"responder","partes":\["Perfeito Rafael"\],"oferecer":true/);
  // Aprovado: nada muda.
  const ok = applyReview(first, { aprovado: true, problema: "", acao: "responder", partes: ["outra coisa"], oferecer: false, slotIds: [] }, { mode: "enforce", slots });
  assert.deepEqual([ok.acao, ok.mensagens, ok.review.approved, ok.review.applied], ["responder", ["Perfeito Rafael"], true, false]);
  // Reprovado em enforce: a decisão corrigida sai (o lead tinha escolhido as 9h).
  const fix = { aprovado: false, problema: "item 2: ele escolheu as 9h, que está na lista", acao: "agendar", partes: [], oferecer: false, slotIds: ["s1"], email: "", motivoHumano: "" };
  const enforced = applyReview(first, fix, { mode: "enforce", slots });
  assert.deepEqual([enforced.acao, enforced.horario, enforced.review.applied, enforced.review.approved], ["agendar", "2026-08-20T09:00", true, false]);
  assert.deepEqual(enforced.review.original.partes, ["Perfeito Rafael"]);
  assert.equal(enforced.model, "m", "modelo e uso da 1ª decisão seguem no carimbo");
  // Em audit a original sai e a correção fica só no registro.
  const audited = applyReview(first, fix, { mode: "audit", slots });
  assert.deepEqual([audited.acao, audited.review.applied, audited.review.approved, audited.review.fixed.acao], ["responder", false, false, "agendar"]);
  // Reprovação sem correção de verdade (igual ao rascunho, ou responder vazio) não troca nada.
  assert.equal(applyReview(first, { aprovado: false, problema: "x", acao: "responder", partes: ["Perfeito Rafael"], oferecer: true, slotIds: [] }, { mode: "enforce", slots }).review.approved, true);
  assert.equal(applyReview(first, { aprovado: false, problema: "x", acao: "responder", partes: [], oferecer: false, slotIds: [] }, { mode: "enforce", slots }).review.applied, false);
  // Id fora da lista na correção cai (mesma normalização da 1ª decisão).
  assert.equal(applyReview(first, { ...fix, slotIds: ["s9"] }, { mode: "enforce", slots }).horario, "");
});

test("revisor: sdrDecide faz a segunda chamada só em audit/enforce e só pra responder/humano/silencio; falha do revisor não segura a resposta #R-124", async () => {
  const { makeAnthropic } = await import("../src/integrations/anthropic.js");
  const reply = (obj) => ({ status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(obj) }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } }) });
  const sysOf = (b) => (typeof b?.system === "string" ? b.system : (Array.isArray(b?.system) ? b.system.map((x) => x?.text || "").join("\n") : ""));
  const run = async (review, answers) => {
    const bodies = []; const queue = [...answers];
    const fetch = async (url, init) => { bodies.push(JSON.parse(init.body)); const a = queue.shift(); if (a instanceof Error) throw a; return reply(a); };
    const ai = makeAnthropic({ fetch, apiKey: "k" });
    const d = await ai.sdrDecide({ lead: { name: "Rafael" }, conversation: [{ who: "LEAD", text: "pode ser às 9h" }], slots: [{ at: "2026-08-20T09:00", label: "amanhã às 9h" }], promptVersion: "v2", state: "oferta_feita", facts: { engaged: true }, review });
    return { d, bodies };
  };
  const draft = { acao: "responder", partes: ["Perfeito Rafael"], oferecer: true, slotIds: [], email: "", motivoHumano: "" };
  const fix = { aprovado: false, problema: "item 2: escolheu as 9h", acao: "agendar", partes: [], oferecer: false, slotIds: ["s1"], email: "", motivoHumano: "" };
  const off = await run("off", [draft]);
  assert.equal(off.bodies.length, 1); assert.equal(off.d.review, undefined);
  const enf = await run("enforce", [draft, fix]);
  assert.equal(enf.bodies.length, 2);
  assert.match(sysOf(enf.bodies[1]), /MODO REVISÃO/);
  assert.match(JSON.stringify(enf.bodies[1].messages), /RASCUNHO DA OUTRA SDR/);
  assert.deepEqual([enf.d.acao, enf.d.horario, enf.d.review.applied], ["agendar", "2026-08-20T09:00", true]);
  const aud = await run("audit", [draft, fix]);
  assert.deepEqual([aud.d.acao, aud.d.review.applied, aud.d.review.fixed.acao], ["responder", false, "agendar"]);
  // Marcar não passa pelo revisor.
  const booked = await run("enforce", [{ ...draft, acao: "agendar", partes: [], oferecer: false, slotIds: ["s1"] }]);
  assert.equal(booked.bodies.length, 1);
  // Revisor fora do ar: a original sai, com o erro no registro.
  const down = await run("enforce", [draft, new Error("timeout"), new Error("timeout"), new Error("timeout"), new Error("timeout")]);
  assert.deepEqual([down.d.acao, down.d.review.applied, down.d.review.approved, !!down.d.review.error], ["responder", false, true, true]);
});
