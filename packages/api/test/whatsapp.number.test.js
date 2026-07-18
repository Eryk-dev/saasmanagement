// Cliente da Cloud API — confirmação do número conectado. O caso que importa é
// o id trocado: pôr o id da CONTA (WABA) no WHATSAPP_PHONE_NUMBER_ID faz a
// Graph responder "(#100) Tried accessing nonexisting field", erro que não diz
// nada pra quem configurou. numberInfo traduz isso perguntando à conta quais
// são os números dela. fetch fake responde por padrão de URL.

import test from "node:test";
import assert from "node:assert/strict";

const { makeWhatsapp } = await import("../src/whatsapp.js");

function fakeFetch(routes) {
  const calls = [];
  return Object.assign(async (url) => {
    const u = String(url);
    calls.push(u);
    for (const [match, status, body] of routes) {
      if (u.includes(match)) return { status, text: async () => JSON.stringify(body) };
    }
    return { status: 404, text: async () => JSON.stringify({ error: { message: "rota fake não mapeada", code: 803 } }) };
  }, { calls });
}

const NO_FIELD = { error: { message: "(#100) Tried accessing nonexisting field (display_phone_number) on node type (WhatsAppBusinessAccount)", code: 100 } };

test("numberInfo: id certo devolve número, nome e qualidade", async () => {
  const f = fakeFetch([["/PN1?", 200, { display_phone_number: "+55 41 99251-6545", verified_name: "LeverAds", quality_rating: "GREEN" }]]);
  const wa = makeWhatsapp({ fetch: f, token: "t", phoneNumberId: "PN1" });
  assert.deepEqual(await wa.numberInfo(), {
    phoneNumberId: "PN1", display: "+55 41 99251-6545", name: "LeverAds", quality: "GREEN",
    tier: "", throughput: "", platform: "", // conta que não expõe limite/vazão
  });
  assert.equal(f.calls.length, 1); // sem diagnóstico quando deu certo
});

test("numberInfo: id da CONTA → erro traz o id do número pra trocar no env", async () => {
  const f = fakeFetch([
    ["/WABA1/phone_numbers", 200, { data: [{ id: "PN7", display_phone_number: "+55 41 99251-6545", verified_name: "LeverAds" }] }],
    ["/WABA1?", 400, NO_FIELD],
  ]);
  const wa = makeWhatsapp({ fetch: f, token: "t", phoneNumberId: "WABA1" });
  const err = await wa.numberInfo().then(() => null, (e) => e);
  assert.ok(err, "deveria falhar");
  assert.equal(err.wrongId, true);
  assert.deepEqual(err.numbers, [{ id: "PN7", display: "+55 41 99251-6545", name: "LeverAds" }]);
  assert.match(err.message, /id da CONTA/);
  assert.match(err.message, /PN7 \(\+55 41 99251-6545\)/); // o que copiar pro env
  assert.ok(!/nonexisting field/.test(err.message));       // erro cru da Graph não vaza pra UI
});

test("numberInfo: id que não é conta nem número → instrução de onde achar o certo", async () => {
  const f = fakeFetch([
    ["/X9/phone_numbers", 400, { error: { message: "Unsupported get request", code: 100 } }],
    ["/X9?", 400, NO_FIELD],
  ]);
  const wa = makeWhatsapp({ fetch: f, token: "t", phoneNumberId: "X9" });
  const err = await wa.numberInfo().then(() => null, (e) => e);
  assert.equal(err.wrongId, true);
  assert.deepEqual(err.numbers, []);
  assert.match(err.message, /API Setup/);
});

test("numberInfo: erro de credencial passa direto (não vira diagnóstico de id)", async () => {
  const f = fakeFetch([["/PN1?", 401, { error: { message: "Invalid OAuth access token", code: 190 } }]]);
  const wa = makeWhatsapp({ fetch: f, token: "velho", phoneNumberId: "PN1" });
  const err = await wa.numberInfo().then(() => null, (e) => e);
  assert.ok(!err.wrongId);
  assert.match(err.message, /Invalid OAuth access token/);
  assert.equal(f.calls.length, 1); // não foi atrás de phone_numbers à toa
});

test("numberInfo: sem configuração nem chama a Meta", async () => {
  const f = fakeFetch([]);
  const wa = makeWhatsapp({ fetch: f, token: "", phoneNumberId: "" });
  await assert.rejects(() => wa.numberInfo(), /não configurado/);
  assert.equal(f.calls.length, 0);
});

test("numberInfo: traz limite de envio e vazão quando a versão da Graph tem os campos", async () => {
  const f = fakeFetch([["/PN1?", 200, {
    display_phone_number: "+55 41 93618-3835", verified_name: "UniqueBox Notifica", quality_rating: "GREEN",
    whatsapp_business_manager_messaging_limit: "TIER_1K", throughput: { level: "STANDARD" }, platform_type: "CLOUD_API",
  }]]);
  const wa = makeWhatsapp({ fetch: f, token: "t", phoneNumberId: "PN1" });
  const r = await wa.numberInfo();
  assert.equal(r.tier, "TIER_1K");
  assert.equal(r.throughput, "STANDARD");
  assert.equal(r.quality, "GREEN");
  assert.equal(f.calls.length, 1); // conjunto completo passou de primeira
});

test("numberInfo: campo que a versão não conhece cai pro conjunto menor, sem virar 'id errado'", async () => {
  let n = 0;
  const f = async (url) => {
    n++;
    // Só o conjunto MÍNIMO é aceito; os maiores levam #100 de campo inexistente.
    if (/messaging_limit|throughput/.test(String(url))) {
      return { status: 400, text: async () => JSON.stringify(NO_FIELD) };
    }
    return { status: 200, text: async () => JSON.stringify({ display_phone_number: "+55 41 93618-3835", verified_name: "UniqueBox Notifica", quality_rating: "YELLOW" }) };
  };
  const wa = makeWhatsapp({ fetch: f, token: "t", phoneNumberId: "PN1" });
  const r = await wa.numberInfo();
  assert.equal(r.display, "+55 41 93618-3835"); // confirmação do número nunca quebra
  assert.equal(r.quality, "YELLOW");
  assert.equal(r.tier, "");                     // sem limite quando a Graph não expõe
  assert.equal(r.throughput, "");
  assert.equal(n, 3);                           // dois conjuntos recusados + o mínimo
});
