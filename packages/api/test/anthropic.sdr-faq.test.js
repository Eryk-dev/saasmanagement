// FAQ técnica no prompt do SDR (raio-x 30/09): o robô encerrou dois leads de
// +10.000 anúncios com peças usadas dizendo que "não resolve", e a Manuela no
// dia seguinte disse o contrário. As respostas curtas vivem no system prompt;
// este teste trava que elas estão lá e que a regra de ouro (dúvida nunca
// encerra o lead) também.
import test from "node:test";
import assert from "node:assert/strict";

const { makeAnthropic } = await import("../src/anthropic.js");
const sysOf = (b) => (typeof b?.system === "string" ? b.system : (Array.isArray(b?.system) ? b.system.map((x) => x?.text || "").join("\n") : ""));
const DECISION = { status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ acao: "responder", mensagens: ["ok"] }) }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }) };

test("system prompt do SDR traz a FAQ técnica e a regra de que dúvida nunca encerra o lead", async () => {
  let sentBody = null;
  const ai = makeAnthropic({ fetch: async (url, init) => { sentBody = JSON.parse(init.body); return DECISION; }, apiKey: "test-key" });
  await ai.sdrDecide({ lead: { name: "Emerson", niche: "autopecas" }, pain: null, conversation: [{ who: "lead", text: "trabalho com peças usadas, serve?" }] });
  const system = sysOf(sentBody);
  assert.match(system, /FAQ TÉCNICA/);
  assert.match(system, /PEÇA USADA ou MARCA INDEPENDENTE.*atende sim/s);
  assert.match(system, /ERP \(Bling, IBR, Upseller, Tiny, Olist\): sem integração direta/);
  assert.match(system, /ANÚNCIOS JÁ PUBLICADOS.*serviço à parte por anúncio/s);
  assert.match(system, /REGRA DE OURO: dúvida de cobertura NUNCA encerra o lead/);
  assert.match(system, /Pergunta técnica à noite NÃO vira acao humano/);
  assert.doesNotMatch(system, /R\$\s?\d/, "FAQ sem valor nenhum");
});
