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
