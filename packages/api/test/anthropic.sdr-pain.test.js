// Foco do sdrDecide quando o lead NÃO tem dor de origem (veio direto do form):
// autopeças ouve o pitch multi-contas E o OEM como segundo benefício; os demais
// nichos seguem só na apresentação geral. Caso visto 31/08: lead de autopeças
// do form ouviu só a clonagem.

import test from "node:test";
import assert from "node:assert/strict";

const { makeAnthropic } = await import("../src/anthropic.js");

const DECISION = {
  status: 200,
  json: async () => ({
    content: [{ type: "text", text: JSON.stringify({ acao: "responder", mensagens: ["ok"] }) }],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 20 },
  }),
};

async function decideWith(lead) {
  let sentBody = null;
  const fetch = async (url, init) => { sentBody = JSON.parse(init.body); return DECISION; };
  const ai = makeAnthropic({ fetch, apiKey: "test-key" });
  await ai.sdrDecide({ lead, pain: null, conversation: [{ who: "lead", text: "quero saber mais" }] });
  const userMsg = sentBody.messages.find((m) => m.role === "user").content;
  return { userMsg, system: sentBody.system || "" };
}

test("sdrDecide sem dor: lead de autopeças recebe a instrução do OEM como segundo benefício", async () => {
  const { userMsg, system } = await decideWith({ name: "Cyro", niche: "autopecas" });
  assert.match(userMsg, /Sem dor de origem registrada, mas o lead é de AUTOPEÇAS/);
  assert.match(userMsg, /OEM como segundo benefício/);
  // o system também estende a exceção pro caso sem dor
  assert.match(system, /Sem dor registrada.*EXCEÇÃO AUTOPEÇAS vale aqui também/s);
});

test("sdrDecide sem dor: outro nicho segue na apresentação geral, sem puxar o OEM", async () => {
  const { userMsg } = await decideWith({ name: "Bia", niche: "moda" });
  assert.match(userMsg, /Sem dor de origem registrada: apresentação geral da plataforma\./);
  assert.doesNotMatch(userMsg, /segundo benefício/);
});
