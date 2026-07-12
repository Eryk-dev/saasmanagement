// CAPI multi-produto: o pixel pode vir POR CHAMADA (product.metaPixelId) e é
// sanitizado pra dígitos igual à página pública (form-page.js) — valor
// malformado degrada pro pixel do env nos DOIS lados, preservando o dedup.

import test from "node:test";
import assert from "node:assert/strict";
import { makeMetaCapi } from "../src/meta-capi.js";

function capture() {
  const urls = [];
  const fetch = async (url) => {
    urls.push(url);
    return { status: 200, text: async () => "{}" };
  };
  return { urls, fetch };
}

test("sendLead usa o pixel override quando informado; sem override cai no pixel do env", async () => {
  const { urls, fetch } = capture();
  const capi = makeMetaCapi({ fetch, pixelId: "111", accessToken: "tok" });

  await capi.sendLead({ eventId: "e1", leadId: "l1", pixelId: "222333444" });
  assert.match(urls[0], /\/222333444\/events/);

  await capi.sendLead({ eventId: "e2", leadId: "l2" });
  assert.match(urls[1], /\/111\/events/);
});

test("pixel override malformado é sanitizado; sem nenhum dígito, cai no env", async () => {
  const { urls, fetch } = capture();
  const capi = makeMetaCapi({ fetch, pixelId: "111", accessToken: "tok" });

  await capi.sendLead({ eventId: "e1", leadId: "l1", pixelId: "px: 222 333" });
  assert.match(urls[0], /\/222333\/events/); // só dígitos

  await capi.sendLead({ eventId: "e2", leadId: "l2", pixelId: "abc" });
  assert.match(urls[1], /\/111\/events/); // degrada pro env

  assert.equal(capi.configured("abc"), true); // env cobre o fallback
});

test("sem env e sem override válido, sendEvent é no-op ({skipped})", async () => {
  const { urls, fetch } = capture();
  const capi = makeMetaCapi({ fetch, pixelId: "", accessToken: "tok" });

  assert.equal(capi.configured(), false);
  assert.equal(capi.configured("abc"), false);
  const r = await capi.sendLead({ eventId: "e1", leadId: "l1", pixelId: "abc" });
  assert.deepEqual(r, { skipped: true });
  assert.equal(urls.length, 0);

  assert.equal(capi.configured("999"), true); // override válido dispensa o env
  await capi.sendLead({ eventId: "e2", leadId: "l2", pixelId: "999" });
  assert.match(urls[0], /\/999\/events/);
});

test("sendPurchase: Purchase com valor/moeda, action_source system_generated e PII hasheada", async () => {
  const bodies = [];
  const fetch = async (url, init) => { bodies.push(JSON.parse(init.body)); return { status: 200, text: async () => "{}" }; };
  const capi = makeMetaCapi({ fetch, pixelId: "111", accessToken: "tok" });

  await capi.sendPurchase({ eventId: "won:l1", leadId: "l1", email: "Ana@X.com", value: "599.9" });
  const ev = bodies[0].data[0];
  assert.equal(ev.event_name, "Purchase");
  assert.equal(ev.event_id, "won:l1");
  assert.equal(ev.action_source, "system_generated");
  assert.deepEqual(ev.custom_data, { value: 599.9, currency: "BRL" });
  assert.equal(ev.user_data.em[0].length, 64);          // sha-256 hex
  assert.equal(ev.user_data.external_id[0].length, 64); // lead.id hasheado

  // valor ausente/inválido vira 0 — ganho sem valor ainda conta como conversão
  await capi.sendPurchase({ eventId: "won:l2", leadId: "l2" });
  assert.deepEqual(bodies[1].data[0].custom_data, { value: 0, currency: "BRL" });
});
