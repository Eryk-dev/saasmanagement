// Aba Robô da Inbox: IA do robô por produto (provedor + modelo), ajustes
// avançados do sdrBot e o uso da IA, tudo só para admin.
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeAuthHook, hashPassword } from "../src/auth/auth.js";
import { makeScreenGuardHook } from "../src/auth/screens.js";
import { makeSdrAi } from "../src/sdr/sdr-ai.js";
import { sanitizeSdrAdmin, sdrAdminKeysChanged } from "../src/sdr/sdr-admin-config.js";
import { sdrBotConfig } from "../src/sdr/sdr-flow.js";

const { registerRoutes } = await import("../src/routes.js");

// Cliente de IA falso no molde do makeAnthropic: provider pela chave, clone troca o modelo.
const fakeClient = ({ apiKey = "", model = "" } = {}) => {
  const provider = apiKey.startsWith("sk-or-") ? "openrouter" : "anthropic";
  const id = model || (provider === "openrouter" ? "openai/gpt-padrao" : "claude-padrao");
  return { configured: () => !!apiKey, provider, model: id, clone: ({ model: m }) => fakeClient({ apiKey, model: m || id }) };
};

function catalogFetch() {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {} });
    const u = String(url);
    if (u.startsWith("https://openrouter.ai/api/v1/models")) {
      return { status: 200, json: async () => ({ data: [
        { id: "anthropic/claude-x", name: "Claude X", context_length: 200000, pricing: { prompt: "0.000003", completion: "0.000015" }, supported_parameters: ["structured_outputs"] },
        { id: "sem/schema", name: "Sem schema", pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"] },
      ] }) };
    }
    if (u.includes("after_id=m2")) return { status: 200, json: async () => ({ data: [{ id: "claude-c", display_name: "Claude C" }], has_more: false }) };
    return { status: 200, json: async () => ({ data: [{ id: "claude-a", display_name: "Claude A", max_input_tokens: 1000000 }, { id: "claude-b", display_name: "Claude B" }], has_more: true, last_id: "m2" }) };
  };
  f.calls = calls;
  return f;
}

test("sdr-ai: escolha vazia usa o padrão; provedor com chave troca o cliente; sem chave cai no padrão com aviso", () => {
  const base = fakeClient({ apiKey: "sk-or-1" });
  const ai = makeSdrAi({ base, openrouterKey: "sk-or-1", anthropicKey: "", makeClient: fakeClient });
  assert.equal(ai.resolve({}).client, base);
  assert.equal(ai.resolve({ model: "google/gemini-x" }).model, "google/gemini-x");
  const or = ai.resolve({ provider: "openrouter", model: "anthropic/claude-x" });
  assert.equal(or.provider, "openrouter");
  assert.equal(or.model, "anthropic/claude-x");
  const semChave = ai.resolve({ provider: "anthropic", model: "claude-a" });
  assert.equal(semChave.client, base);
  assert.match(semChave.fallback, /ANTHROPIC_API_KEY/);
  assert.deepEqual(ai.providers(), { openrouter: true, anthropic: false });
});

test("sdr-ai: catálogo do OpenRouter só com saída estruturada e preço por 1M; Anthropic pagina por after_id", async () => {
  const f = catalogFetch();
  const ai = makeSdrAi({ base: fakeClient({ apiKey: "sk-or-1" }), fetch: f, openrouterKey: "sk-or-1", anthropicKey: "sk-ant-1", makeClient: fakeClient });
  const or = await ai.listModels("openrouter");
  assert.deepEqual(or.map((m) => m.id), ["anthropic/claude-x"]);
  assert.equal(or[0].priceIn, 3);
  assert.equal(or[0].priceOut, 15);
  const an = await ai.listModels("anthropic");
  assert.deepEqual(an.map((m) => m.id), ["claude-a", "claude-b", "claude-c"]);
  const first = f.calls.find((c) => c.url.startsWith("https://api.anthropic.com/v1/models"));
  assert.equal(first.headers["x-api-key"], "sk-ant-1");
  assert.equal(first.headers["anthropic-version"], "2023-06-01");
  // Cache de 1h: a segunda leitura não vai ao provedor.
  const before = f.calls.length;
  await ai.listModels("openrouter");
  assert.equal(f.calls.length, before);
});

test("sanitize: aceita só faixas válidas; ai com provedor conhecido; detecta chave de admin alterada ou removida", () => {
  assert.deepEqual(sanitizeSdrAdmin({ debounceSec: 30, ladderWarmDays: [2, 6, 10], guardsMode: "enforce", ai: { provider: "anthropic", model: "claude-a" } }).patch,
    { debounceSec: 30, ladderWarmDays: [2, 6, 10], guardsMode: "enforce", ai: { provider: "anthropic", model: "claude-a" } });
  assert.match(sanitizeSdrAdmin({ debounceSec: 1 }).error, /debounceSec/);
  assert.match(sanitizeSdrAdmin({ ladderWarmDays: [8, 3] }).error, /crescentes/);
  assert.match(sanitizeSdrAdmin({ promptVersion: "v3" }).error, /v1 ou v2/);
  assert.match(sanitizeSdrAdmin({ ai: { provider: "gemini" } }).error, /ai.provider/);
  const prev = { enabled: true, debounceSec: 20, ai: { provider: "", model: "x/y" } };
  assert.deepEqual(sdrAdminKeysChanged(prev, { ...prev, enabled: false }), []);
  assert.deepEqual(sdrAdminKeysChanged(prev, { ...prev, debounceSec: 40 }), ["debounceSec"]);
  assert.deepEqual(sdrAdminKeysChanged(prev, { enabled: true, debounceSec: 20 }), ["ai"]);
});

test("sdrBotConfig repassa a escolha de IA (vazia por padrão)", () => {
  assert.deepEqual(sdrBotConfig({ sdrBot: { enabled: true } }).ai, { provider: "", model: "" });
  assert.deepEqual(sdrBotConfig({ sdrBot: { enabled: true, ai: { provider: "anthropic", model: "claude-a" } } }).ai, { provider: "anthropic", model: "claude-a" });
});

function providedKey(req) {
  const h = req.headers["x-api-key"];
  return h ? (Array.isArray(h) ? h[0] : h) : "";
}
async function world() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [], sdrBot: { enabled: true, conversation: true, debounceSec: 20 } });
  for (const u of [
    { id: "chefe", roles: ["admin"], screens: [] },
    { id: "ajustes", roles: ["sdr"], screens: ["settings", "whatsapp"] },
  ]) await repo.create("users", { ...u, name: u.id, passwordHash: hashPassword("1234") });
  await repo.create("app_config", { id: "sdr_ai_usage_leverads_2026-10-22", saas: "leverads", day: "2026-10-22", calls: 3, in: 900, out: 120, byModel: { "openai/gpt-padrao": { calls: 3, in: 900, out: 120 } } });
  const app = Fastify();
  app.addHook("onRequest", makeAuthHook({ apiKey: "test-key", repo, openPaths: new Set(["/api/auth/login"]), openPrefixes: [], providedKey }));
  app.addHook("onRequest", makeScreenGuardHook());
  const base = fakeClient({ apiKey: "sk-or-1" });
  registerRoutes(app, repo, { anthropic: base, sdrAi: makeSdrAi({ base, fetch: catalogFetch(), openrouterKey: "sk-or-1", anthropicKey: "sk-ant-1", makeClient: fakeClient }) });
  await app.ready();
  const login = async (username) => ({ "x-api-key": (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password: "1234" } })).json().token });
  return { repo, app, admin: await login("chefe"), other: await login("ajustes") };
}

test("rotas da aba Robô: admin lê, salva e lista modelos; quem não é admin leva 403", async () => {
  const { repo, app, admin, other } = await world();
  const get = await app.inject({ method: "GET", url: "/api/sdr/config?saas=leverads", headers: admin });
  assert.equal(get.statusCode, 200);
  const view = get.json();
  assert.equal(view.values.debounceSec, 20);
  assert.equal(view.values.ladderPerDay, 60);
  assert.deepEqual(view.ai, { provider: "", model: "" });
  assert.equal(view.effective.model, "openai/gpt-padrao");
  assert.deepEqual(view.providers, { openrouter: true, anthropic: true });

  const saved = await app.inject({ method: "PATCH", url: "/api/sdr/config/leverads", headers: admin, payload: { ai: { provider: "anthropic", model: "claude-a" }, debounceSec: 30 } });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().effective.model, "claude-a");
  assert.equal(saved.json().effective.provider, "anthropic");
  const stored = (await repo.get("products", "leverads")).sdrBot;
  assert.equal(stored.debounceSec, 30);
  assert.equal(stored.conversation, true); // o resto do sdrBot fica
  assert.equal((await app.inject({ method: "PATCH", url: "/api/sdr/config/leverads", headers: admin, payload: { debounceSec: 0 } })).statusCode, 400);

  const models = await app.inject({ method: "GET", url: "/api/sdr/models?provider=openrouter", headers: admin });
  assert.deepEqual(models.json().models.map((m) => m.id), ["anthropic/claude-x"]);
  assert.equal((await app.inject({ method: "GET", url: "/api/sdr/models?provider=gemini", headers: admin })).statusCode, 422);
  assert.equal((await app.inject({ method: "GET", url: "/api/sdr/ai-usage?saas=leverads&days=90", headers: admin })).json().total.calls, 3);

  for (const [method, url] of [["GET", "/api/sdr/config?saas=leverads"], ["PATCH", "/api/sdr/config/leverads"], ["GET", "/api/sdr/models?provider=openrouter"], ["GET", "/api/sdr/ai-usage?saas=leverads"], ["GET", "/api/sdr/audit?saas=leverads"]]) {
    const r = await app.inject({ method, url, headers: other, ...(method === "PATCH" ? { payload: { debounceSec: 40 } } : {}) });
    assert.equal(r.statusCode, 403, `${method} ${url}`);
  }
  // O card da aba Automações continua aberto pra quem tem a tela (status).
  assert.equal((await app.inject({ method: "GET", url: "/api/sdr/status?saas=leverads", headers: other })).statusCode, 200);
  await app.close();
});

test("CRUD de produto: quem não é admin salva o card do robô, mas não muda a IA nem os ajustes avançados", async () => {
  const { repo, app, admin, other } = await world();
  await app.inject({ method: "PATCH", url: "/api/sdr/config/leverads", headers: admin, payload: { ai: { provider: "openrouter", model: "anthropic/claude-x" } } });
  const cur = (await repo.get("products", "leverads")).sdrBot;
  // Card da aba Automações: manda o sdrBot inteiro com o que já estava.
  const card = await app.inject({ method: "PATCH", url: "/api/products/leverads", headers: other, payload: { sdrBot: { ...cur, firstTouch: false } } });
  assert.equal(card.statusCode, 200);
  const trocaIa = await app.inject({ method: "PATCH", url: "/api/products/leverads", headers: other, payload: { sdrBot: { ...cur, ai: { provider: "", model: "" } } } });
  assert.equal(trocaIa.statusCode, 403);
  assert.match(trocaIa.json().error, /ai/);
  const semChave = await app.inject({ method: "PATCH", url: "/api/products/leverads", headers: other, payload: { sdrBot: { enabled: true } } });
  assert.equal(semChave.statusCode, 403);
  assert.equal((await app.inject({ method: "PATCH", url: "/api/products/leverads", headers: admin, payload: { sdrBot: { ...cur, debounceSec: 45 } } })).statusCode, 200);
  await app.close();
});

test("replay com provedor: só admin; provedor desconhecido vira 400", async () => {
  const { app, other, admin } = await world();
  assert.equal((await app.inject({ method: "POST", url: "/api/sdr/replay", headers: other, payload: { saas: "leverads", provider: "anthropic" } })).statusCode, 403);
  assert.equal((await app.inject({ method: "POST", url: "/api/sdr/replay", headers: admin, payload: { saas: "leverads", provider: "gemini" } })).statusCode, 400);
  await app.close();
});
