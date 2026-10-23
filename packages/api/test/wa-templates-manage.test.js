// Modelos oficiais da Meta (docs/PLANO-DISPAROS.md, fase 2): listar com status
// e paginação, criar com cabeçalho/rodapé/botões, apagar; e variáveis iguais
// na prévia e no envio (shared/campaign-tokens.js).

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeWhatsapp } from "../src/whatsapp/whatsapp.js";
import { registerWhatsappRoutes } from "../src/whatsapp/routes.whatsapp.js";
import { campaignTokens, interpolate } from "../src/shared/campaign-tokens.js";

function seqFetch(responses) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", payload: init.body ? JSON.parse(init.body) : null });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    return { status: r.status || 200, text: async () => JSON.stringify(r.body) };
  };
  f.calls = calls;
  return f;
}

test("client: listAllTemplates traz todos os status, motivo, qualidade, componentes e segue a paginação", async () => {
  const f = seqFetch([
    { body: { data: [{ id: "1", name: "boas_vindas", language: "pt_BR", status: "APPROVED", category: "MARKETING", quality_score: { score: "GREEN" },
      components: [{ type: "HEADER", format: "TEXT", text: "Olá!" }, { type: "BODY", text: "Oi {{1}}, tudo bem? {{2}}" }, { type: "FOOTER", text: "LeverAds" }, { type: "BUTTONS", buttons: [{ type: "URL", text: "Ver", url: "https://x.com" }] }] }],
      paging: { next: "https://graph.facebook.com/v23.0/WABA1/message_templates?after=abc" } } },
    { body: { data: [{ id: "2", name: "promo", language: "pt_BR", status: "REJECTED", rejected_reason: "PROMOTIONAL", components: [{ type: "BODY", text: "Promo" }] }] } },
  ]);
  const wa = makeWhatsapp({ fetch: f, token: "t", phoneNumberId: "P" });
  const all = await wa.listAllTemplates("WABA1");
  assert.equal(all.length, 2);
  assert.deepEqual(all[0], { id: "1", name: "boas_vindas", language: "pt_BR", status: "APPROVED", category: "MARKETING", quality: "GREEN", rejectedReason: "",
    header: { format: "TEXT", text: "Olá!" }, body: "Oi {{1}}, tudo bem? {{2}}", params: 2, footer: "LeverAds", buttons: [{ type: "URL", text: "Ver", url: "https://x.com" }] });
  assert.equal(all[1].status, "REJECTED");
  assert.equal(all[1].rejectedReason, "PROMOTIONAL");
  assert.match(f.calls[1].url, /\/v23\.0\/WABA1\/message_templates\?after=abc$/, "a 2ª página usa o next sem duplicar a Graph");
});

test("client: createTemplate com cabeçalho de texto, rodapé e botões; deleteTemplate pelo nome", async () => {
  const f = seqFetch([{ body: { id: "tpl", status: "PENDING" } }, { body: { success: true } }]);
  const wa = makeWhatsapp({ fetch: f, token: "t", phoneNumberId: "P" });
  await wa.createTemplate("WABA1", { name: "oferta", category: "MARKETING", body: "Oi {{1}}", example: ["Ana"], headerText: "Novidade", footer: "Responda SAIR para sair",
    buttons: [{ type: "QUICK_REPLY", text: "Quero" }, { type: "URL", text: "Ver site", url: "https://lever.com.br" }, { type: "QUICK_REPLY", text: "  " }] });
  assert.deepEqual(f.calls[0].payload.components, [
    { type: "HEADER", format: "TEXT", text: "Novidade" },
    { type: "BODY", text: "Oi {{1}}", example: { body_text: [["Ana"]] } },
    { type: "FOOTER", text: "Responda SAIR para sair" },
    { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Quero" }, { type: "URL", text: "Ver site", url: "https://lever.com.br" }] },
  ]);
  const del = await wa.deleteTemplate("WABA1", "oferta");
  assert.equal(del.ok, true);
  assert.equal(f.calls[1].method, "DELETE");
  assert.match(f.calls[1].url, /WABA1\/message_templates\?name=oferta$/);
});

function fakeWa() {
  const created = [];
  const deleted = [];
  return {
    created, deleted,
    configured: () => true,
    tokenWabaIds: async () => ["WABA1"],
    createTemplate: async (wabaId, spec) => { created.push(spec); return { id: "t1", status: "PENDING", category: spec.category }; },
    listAllTemplates: async () => [{ name: "a", status: "PENDING" }, { name: "b", status: "REJECTED", rejectedReason: "INVALID_FORMAT" }],
    deleteTemplate: async (wabaId, name) => { deleted.push(name); return { ok: true }; },
    listTemplates: async () => [],
  };
}
async function appWith(wa) {
  const app = Fastify();
  await app.register((await import("@fastify/multipart")).default);
  registerWhatsappRoutes(app, makeMemRepo(), { whatsapp: wa });
  await app.ready();
  return app;
}

test("rotas: lista para gestão, apaga, e cria validando variáveis por número, rodapé e botões", async (t) => {
  const wa = fakeWa();
  const app = await appWith(wa);
  t.after(() => app.close());
  const all = (await app.inject({ url: "/api/whatsapp/templates/all" })).json();
  assert.deepEqual(all.templates.map((x) => x.status), ["PENDING", "REJECTED"]);

  assert.equal((await app.inject({ method: "DELETE", url: "/api/whatsapp/templates/b" })).statusCode, 200);
  assert.deepEqual(wa.deleted, ["b"]);
  assert.equal((await app.inject({ method: "DELETE", url: "/api/whatsapp/templates/Nome%20Ruim" })).statusCode, 400);

  const post = (payload) => app.inject({ method: "POST", url: "/api/whatsapp/templates", payload });
  // {{1}} repetido pede UM exemplo (antes contava ocorrência e exigia dois).
  assert.equal((await post({ name: "rep", body: "Oi {{1}}, {{1}} mesmo?", example: ["Ana"] })).statusCode, 200);
  assert.equal((await post({ name: "dois", body: "Oi {{1}} da {{2}}", example: ["Ana"] })).statusCode, 400);
  assert.equal((await post({ name: "rod", body: "Oi", footer: "x".repeat(61) })).statusCode, 400);
  assert.equal((await post({ name: "btn", body: "Oi", buttons: [{ type: "URL", text: "Ver", url: "http://inseguro" }] })).statusCode, 400);
  assert.equal((await post({ name: "btn4", body: "Oi", buttons: [1, 2, 3, 4].map((i) => ({ type: "QUICK_REPLY", text: `b${i}` })) })).statusCode, 400);
  const ok = await post({ name: "completo", category: "MARKETING", body: "Oi {{1}}", example: ["Ana"], headerText: "Novidade", footer: "LeverAds", buttons: [{ type: "QUICK_REPLY", text: "Quero" }] });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual({ h: wa.created.at(-1).headerText, f: wa.created.at(-1).footer, b: wa.created.at(-1).buttons.length }, { h: "Novidade", f: "LeverAds", b: 1 });
});

test("variáveis: prévia e envio usam o rótulo da resposta", () => {
  const product = { leadQuestions: [{ key: "accounts", options: [{ value: "2-3", label: "2 a 3 contas" }] }, { key: "niche", options: [{ value: "autopecas", label: "Autopeças" }] }] };
  const toks = campaignTokens({ name: "Ana Souza", company: "Loja", accounts: "2-3", niche: "autopecas", listings: "500-1000" }, product);
  assert.deepEqual(toks, { nome: "Ana", empresa: "Loja", nicho: "Autopeças", contas: "2 a 3 contas", anuncios: "500-1000" });
  assert.equal(interpolate("Oi {{nome}}, {{contas}} {{x}}", toks), "Oi Ana, 2 a 3 contas {{x}}");
});
