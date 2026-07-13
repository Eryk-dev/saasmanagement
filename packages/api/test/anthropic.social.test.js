// Copy de post social pela IA — suggestSocialCopy monta o prompt com os campos
// e converte a LISTA de fields do modelo num mapa key→value pro cliente aplicar.

import test from "node:test";
import assert from "node:assert/strict";

const { makeAnthropic } = await import("../src/anthropic.js");

test("suggestSocialCopy: fields lista → mapa; manda dor/sugestão/campos no prompt", async () => {
  let sentBody = null;
  const fetch = async (url, init) => {
    sentBody = JSON.parse(init.body);
    // caminho Anthropic (apiKey não sk-or-): resposta em content[].text
    return {
      status: 200,
      json: async () => ({
        content: [{ type: "text", text: JSON.stringify({
          fields: [{ key: "title", value: "Pare de *perder tempo*" }, { key: "cta", value: "Chama no direct" }],
          caption: "legenda pronta pro post #leverads #mercadolivre",
        }) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    };
  };
  const ai = makeAnthropic({ fetch, apiKey: "test-key" });
  const r = await ai.suggestSocialCopy({
    dor: "Perde tempo subindo à mão",
    suggestion: "tom provocativo",
    formatLabel: "Story",
    templateName: "Chamada",
    fields: [{ key: "title", label: "Título", example: "Pare de subir um por um." }, { key: "cta", label: "CTA", example: "Fala com a gente" }],
  });
  assert.deepEqual(r.fields, { title: "Pare de *perder tempo*", cta: "Chama no direct" });
  assert.match(r.caption, /#leverads/);
  // o prompt levou a dor, a sugestão e os keys dos campos
  const userMsg = sentBody.messages[0].content;
  assert.match(userMsg, /Perde tempo subindo à mão/);
  assert.match(userMsg, /tom provocativo/);
  assert.match(userMsg, /key "title"/);
  assert.match(userMsg, /key "cta"/);
});

test("suggestSocialCopy: sem chave configurada, falha claro", async () => {
  const ai = makeAnthropic({ fetch: async () => ({}), apiKey: "" });
  await assert.rejects(() => ai.suggestSocialCopy({ fields: [{ key: "x", label: "X", example: "y" }] }), /IA não configurada/);
});

