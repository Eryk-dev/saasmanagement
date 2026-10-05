import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { ensureWaMessagesLeadId, ensureFormPrefillV2 } from "../src/platform/migrations.js";
import { PREFILL, FORM_IDS } from "../src/forms/forms-v2.leverads.js";

// Migrações do raio-x do SDR de 30/09/2026.

test("ensureWaMessagesLeadId: mensagem sem leadId em thread vinculada herda o lead; roda uma vez", async () => {
  const repo = makeMemRepo();
  await repo.create("wa_threads", { id: "551143213413", phone: "551143213413", leadId: "L1", saas: "leverads" });
  await repo.create("wa_threads", { id: "5541999990000", phone: "5541999990000", leadId: null, saas: "leverads" });
  await repo.create("wa_messages", { id: "a", thread: "551143213413", leadId: null, saas: "", direction: "in", text: "x", at: "2026-09-28T10:00:00.000Z" });
  await repo.create("wa_messages", { id: "b", thread: "551143213413", leadId: "L1", saas: "leverads", direction: "out", text: "y", at: "2026-09-28T10:01:00.000Z" });
  await repo.create("wa_messages", { id: "c", thread: "5541999990000", leadId: null, saas: "leverads", direction: "in", text: "z", at: "2026-09-28T10:02:00.000Z" });
  assert.equal(await ensureWaMessagesLeadId(repo), 1);
  assert.equal((await repo.get("wa_messages", "a")).leadId, "L1");
  assert.equal((await repo.get("wa_messages", "a")).saas, "leverads");
  assert.equal((await repo.get("wa_messages", "c")).leadId, null);
  assert.equal(await ensureWaMessagesLeadId(repo), 0);
});

test("ensureFormPrefillV2: OEM sem a pergunta niche e Ads com '{{accounts}} contas' recebem o prefill novo; texto editado na mão sem o defeito fica", async () => {
  const repo = makeMemRepo();
  await repo.create("forms", { id: FORM_IDS.oem, questions: [{ key: "channel" }, { key: "accounts" }, { key: "listings" }], thanks: { whatsapp: "5541936183835", whatsappPrefill: "Oi, me chamo {{nome}} e quero saber mais sobre o Lever OEM. Minha operação: {{niche}}, {{accounts}} contas, {{listings}} anúncios ativos." } });
  await repo.create("forms", { id: FORM_IDS.ads, questions: [{ key: "niche" }, { key: "accounts" }], thanks: { whatsappPrefill: "Oi, me chamo {{nome}} e quero saber mais sobre o Lever Ads. Minha operação: {{niche}}, {{accounts}} contas, {{listings}} anúncios ativos." } });
  await repo.create("forms", { id: FORM_IDS.price, questions: [{ key: "niche" }], thanks: { whatsappPrefill: "texto editado na mão pelo Leo com {{niche}}" } });
  assert.equal(await ensureFormPrefillV2(repo), 2);
  const oem = await repo.get("forms", FORM_IDS.oem);
  assert.equal(oem.thanks.whatsappPrefill, PREFILL.oem);
  assert.equal(oem.thanks.whatsapp, "5541936183835");
  assert.doesNotMatch(PREFILL.oem, /\{\{niche\}\}|\}\} contas/);
  assert.equal((await repo.get("forms", FORM_IDS.ads)).thanks.whatsappPrefill, PREFILL.ads);
  assert.equal((await repo.get("forms", FORM_IDS.price)).thanks.whatsappPrefill, "texto editado na mão pelo Leo com {{niche}}");
  assert.equal(await ensureFormPrefillV2(repo), 0);
});
