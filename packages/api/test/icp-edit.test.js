// Régua de nota/ICP editável (docs/PLANO-ICP-CONFIGURAVEL.md, fase 2):
// validação, permissão "Editar ICP", gravação versionada, prévia e recálculo.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeAuthHook, hashPassword } from "../src/auth/auth.js";
import { seedTestAdmins } from "./helpers/seed-admins.js";
import { makeScreenGuardHook, canEditIcp } from "../src/auth/screens.js";
import { validateIcpRules } from "../src/shared/icp-rules.js";
import { LEVERADS_RULES, MATRIX_RULES } from "../src/shared/lead-grade.js";
import { regradePatch } from "../src/crm/classificacao.js";
import { ensureRevenueClassification } from "../src/platform/migrations.js";

const { registerRoutes } = await import("../src/routes.js");

function providedKey(req) {
  const h = req.headers["x-api-key"];
  return h ? (Array.isArray(h) ? h[0] : h) : "";
}
function buildApp(repo) {
  const app = Fastify();
  app.addHook("onRequest", makeAuthHook({ apiKey: "test-key", repo, openPaths: new Set(["/api/auth/login"]), openPrefixes: [], providedKey }));
  app.addHook("onRequest", makeScreenGuardHook());
  registerRoutes(app, repo);
  return app;
}
const login = async (app, username) => ({ "x-api-key": (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password: "1234" } })).json().token });

// Régua do LeverAds só com S de ICP e o corte do B subindo pra R$ 300 mil.
const stricter = () => ({
  ...LEVERADS_RULES,
  methods: LEVERADS_RULES.methods.map((m) => (m.id === "faturamento" ? { ...m, bands: m.bands.map((b) => (b.grade === "B" ? { ...b, min: 300000 } : b)) } : m)),
  icpGrades: ["S"],
});

test("validação: as réguas padrão passam; erros claros para faixa, nota e grade", () => {
  assert.equal(validateIcpRules(LEVERADS_RULES).ok, true);
  assert.equal(validateIcpRules(MATRIX_RULES).ok, true);
  const bad = (rules) => validateIcpRules(rules).errors.join(" | ");
  assert.match(bad({ methods: [], icpGrades: ["S"] }), /ao menos um método/);
  assert.match(bad({ ...LEVERADS_RULES, icpGrades: [] }), /ICP/);
  const inverted = { methods: [{ id: "x", type: "produto", axes: [{ key: "orders", values: { a: 1 } }], bands: [{ grade: "S", min: 10 }, { grade: "A", min: 50 }] }], icpGrades: ["S"] };
  assert.match(bad(inverted), /nota S precisa de mínimo maior que a A/);
  const dup = { methods: [{ id: "x", type: "soma", axes: [{ key: "a", values: { s: 1 } }], bands: [{ grade: "B", min: 1 }, { grade: "B", min: 2 }] }], icpGrades: ["B"] };
  assert.match(bad(dup), /aparece em mais de uma faixa/);
  const grid = { methods: [{ id: "m", type: "matriz", rows: { key: "a", index: { x: 3 } }, cols: { key: "b", index: { y: 0 } }, grid: [["A"]] }], icpGrades: ["A"] };
  assert.match(bad(grid), /linha apontando para fora/);
  assert.match(bad({ methods: [{ id: "m", type: "outro" }], icpGrades: ["A"] }), /produto, soma ou matriz/);
});

test("permissão: lista em branco e tela Ajustes não editam; etiqueta Editor de ICP e admin editam; ler é aberto", async (t) => {
  const repo = makeMemRepo();
  await seedTestAdmins(repo);
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [] });
  for (const u of [
    { id: "livre", screens: [] }, { id: "ajustes", screens: ["settings"] },
    { id: "icpista", screens: ["today"], roles: ["sdr", "icp"] }, { id: "restrito", screens: ["today"] },
  ]) await repo.create("users", { roles: ["sdr"], ...u, name: u.id, passwordHash: hashPassword("1234") });
  const app = buildApp(repo);
  t.after(() => app.close());
  const put = async (who) => (await app.inject({ method: "PUT", url: "/api/products/leverads/icp", headers: await login(app, who), payload: { text: { pill: `de ${who}` } } })).statusCode;
  assert.equal(await put("livre"), 403);
  assert.equal(await put("ajustes"), 403);
  assert.equal(await put("icpista"), 200, "a etiqueta edita mesmo sem a tela Ajustes");
  const preview = await app.inject({ method: "POST", url: "/api/products/leverads/icp/preview", headers: await login(app, "restrito"), payload: { rules: LEVERADS_RULES } });
  assert.equal(preview.statusCode, 403);
  const read = await app.inject({ url: "/api/products/leverads/icp", headers: await login(app, "restrito") });
  assert.equal(read.statusCode, 200);
  assert.equal(read.json().text.pill, "de icpista");
  // O CRUD genérico não serve de atalho.
  const crud = await app.inject({ method: "PATCH", url: "/api/products/leverads", headers: await login(app, "livre"), payload: { icp: { rules: stricter() } } });
  assert.equal(crud.statusCode, 403);
  assert.equal((await app.inject({ url: "/api/icp_versions", headers: { "x-api-key": "test-key" } })).statusCode, 404);
  assert.equal(canEditIcp({ roles: ["admin"], screens: ["today"] }), true);
  assert.equal(canEditIcp({ roles: ["sdr"], screens: [] }), false);
  assert.equal(canEditIcp(undefined), true); // key mestre
});

async function seeded() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [], icp: { pill: "S/A/B · R$ 200 mil+/mês", headline: "Operação grande" } });
  // 1000-2000 (1.500) × 150-300 (225) = R$ 337.500 → B; 2000+ (3.000) × 70-150 (110) = R$ 330.000 → B;
  // 2000+ × 600+ (800) = R$ 2,4 mi → S; 1000-2000 × 70-150 = R$ 165.000 → C.
  await repo.create("leads", { id: "b1", saas: "leverads", orders: "1000-2000", ticket: "150-300", createdAt: new Date().toISOString(), callAt: "2999-01-01T10:00", closer: "pl",
    classificacao: { porte: "B", intencaoMedida: true, intencao: "alta", qualificacao: 80, acao: "ligar-hoje", cadencia: "prioritario", mql: true, custom: "fica" } });
  await repo.create("leads", { id: "b2", saas: "leverads", orders: "2000+", ticket: "70-150", createdAt: new Date().toISOString(), classificacao: { porte: "B", intencaoMedida: false, intencao: "nao-medida" } });
  await repo.create("leads", { id: "s1", saas: "leverads", orders: "2000+", ticket: "600+", createdAt: new Date().toISOString(), classificacao: { porte: "S", intencaoMedida: false, intencao: "nao-medida", acao: "ligar-hoje", mql: null } });
  await repo.create("leads", { id: "c1", saas: "leverads", orders: "1000-2000", ticket: "70-150", createdAt: new Date().toISOString(), stage: "Ganho", owner: "leo" });
  return repo;
}

test("prévia: mudança de nota, entradas/saídas do ICP e calls que trocam de pool", async (t) => {
  const repo = await seeded();
  const app = Fastify();
  registerRoutes(app, repo);
  t.after(() => app.close());
  const r = (await app.inject({ method: "POST", url: "/api/products/leverads/icp/preview", payload: { rules: stricter() } })).json();
  // b1: R$ 337.500 segue B (≥300 mil) mas sai do ICP (só S); b2: 3.000 × 110 = R$ 330 mil, B → sai.
  assert.equal(r.recent.leads, 4);
  assert.equal(r.recent.icpBefore, 3);
  assert.equal(r.recent.icpAfter, 1);
  assert.equal(r.recent.icpOut, 2);
  assert.equal(r.callsChanging, 1);
  assert.equal(r.calls[0].id, "b1");
  assert.equal(r.calls[0].pool, "junior");
  const bad = await app.inject({ method: "POST", url: "/api/products/leverads/icp/preview", payload: { rules: { methods: [] } } });
  assert.equal(bad.statusCode, 400);
});

test("gravar: versão nova, histórico, recálculo só de quem mudou de nota, trava otimista", async (t) => {
  const repo = await seeded();
  const app = Fastify();
  registerRoutes(app, repo);
  t.after(() => app.close());
  const rules = stricter();
  rules.methods[0].bands = rules.methods[0].bands.map((b) => (b.grade === "B" ? { ...b, min: 340000 } : b)); // b1 (337.500) cai pra C
  const res = await app.inject({ method: "PUT", url: "/api/products/leverads/icp", payload: { rules, baseVersion: 0, note: "B a partir de 340 mil" } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.version, 1);
  assert.equal(body.custom, true);
  // b1 e b2 caem de B pra C; c1 (pedidos × ticket, sem classificação) ganha a dele; s1 fica.
  assert.equal(body.recalculated, 3);
  const b1 = await repo.get("leads", "b1");
  assert.equal(b1.classificacao.porte, "C");
  assert.equal(b1.classificacao.intencao, "alta", "a intenção medida pelo formulário fica");
  assert.equal(b1.classificacao.acao, "ligar-hoje"); // B/C × alta
  assert.equal(b1.classificacao.custom, "fica");
  assert.equal(b1.classificacao.rulesVersion, 1);
  assert.equal(b1.callAt, "2999-01-01T10:00", "agenda intocada");
  assert.equal((await repo.get("leads", "c1")).classificacao.porte, "C");
  assert.equal((await repo.get("leads", "c1")).stage, "Ganho", "etapa intocada");
  assert.equal((await repo.get("leads", "s1")).classificacao.rulesVersion, undefined, "nota igual não regrava");
  const product = await repo.get("products", "leverads");
  assert.equal(product.icp.headline, "Operação grande", "texto preservado ao mudar só a régua");
  assert.equal(product.icp.rules.note, "B a partir de 340 mil");
  const versions = (await app.inject({ url: "/api/products/leverads/icp/versions" })).json().versions;
  assert.equal(versions.length, 1);
  assert.equal(versions[0].version, 1);
  assert.deepEqual(versions[0].rules.icpGrades, ["S"]);

  const stale = await app.inject({ method: "PUT", url: "/api/products/leverads/icp", payload: { rules: LEVERADS_RULES, baseVersion: 0 } });
  assert.equal(stale.statusCode, 409);
  const invalid = await app.inject({ method: "PUT", url: "/api/products/leverads/icp", payload: { rules: { ...rules, icpGrades: [] }, baseVersion: 1 } });
  assert.equal(invalid.statusCode, 400);
  assert.ok(invalid.json().errors.length);
  const same = (await app.inject({ method: "PUT", url: "/api/products/leverads/icp", payload: { rules, baseVersion: 1 } })).json();
  assert.equal(same.changed, false);
  assert.equal(same.version, 1);

  // Restaurar a régua padrão é uma versão nova (2), e o B volta.
  const back = (await app.inject({ method: "PUT", url: "/api/products/leverads/icp", payload: { rules: LEVERADS_RULES, baseVersion: 1 } })).json();
  assert.equal(back.version, 2);
  assert.equal((await repo.get("leads", "b1")).classificacao.porte, "B");
});

test("texto editado não é sobrescrito pela migração de boot", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [] });
  const app = Fastify();
  registerRoutes(app, repo);
  await app.inject({ method: "PUT", url: "/api/products/leverads/icp", payload: { text: { pill: "Nosso ICP", profile: ["Faturamento alto"] } } });
  await app.close();
  await ensureRevenueClassification(repo);
  const p = await repo.get("products", "leverads");
  assert.equal(p.icp.pill, "Nosso ICP");
  assert.deepEqual(p.icp.profile, ["Faturamento alto"]);
});

test("regradePatch: sem mudança de nota não regrava; sem intenção gravada refaz por inteiro", () => {
  const lead = { saas: "leverads", orders: "2000+", ticket: "600+", classificacao: { porte: "S", intencaoMedida: false, acao: "ligar-hoje", mql: null } };
  assert.equal(regradePatch(lead, LEVERADS_RULES), null);
  const old = regradePatch({ ...lead, classificacao: { porte: "D" } }, LEVERADS_RULES);
  assert.equal(old.classificacao.porte, "S");
  assert.ok("intencaoMedida" in old.classificacao);
});

test("fase 4: ação e MQL da régua, recálculo quando só a ação muda, prévia e evolução", async (t) => {
  const repo = await seeded();
  const app = Fastify();
  registerRoutes(app, repo);
  t.after(() => app.close());
  // B com intenção alta deixa de ligar: vai pra nutrição. MQL passa a exigir nota B.
  const rules = { ...LEVERADS_RULES, actions: { ...LEVERADS_RULES.actions, B: { alta: "nutrir", media: "nutrir", baixa: "nutrir" } }, mql: { minGrade: "B", minQualificacao: 40 } };
  const preview = (await app.inject({ method: "POST", url: "/api/products/leverads/icp/preview", payload: { rules } })).json();
  assert.equal(preview.recent.changed, 0, "a nota não muda");
  assert.equal(preview.recent.actionChanged, 2, "b1 (B, alta) e b2 (B, sem intenção → média) mudam de ação");
  const saved = (await app.inject({ method: "PUT", url: "/api/products/leverads/icp", payload: { rules, baseVersion: 0 } })).json();
  assert.equal(saved.version, 1);
  const b1 = (await repo.get("leads", "b1")).classificacao;
  assert.equal(b1.porte, "B");
  assert.equal(b1.acao, "nutrir");
  assert.equal(b1.cadencia, "leve");
  assert.equal(b1.mql, true, "B com qualificação 80 segue MQL com mínimo B");
  assert.equal((await repo.get("leads", "s1")).classificacao.acao, "ligar-hoje", "S não muda");
  const bad = validateIcpRules({ ...LEVERADS_RULES, actions: { ...LEVERADS_RULES.actions, S: { alta: "voar" } }, mql: { minGrade: "Z", minQualificacao: 120 } });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(" | "), /Ação inválida para nota S/);
  assert.match(bad.errors.join(" | "), /Nota mínima do MQL/);
  assert.match(bad.errors.join(" | "), /entre 0 e 100/);
  const trend = (await app.inject({ url: "/api/products/leverads/icp/trend" })).json();
  assert.equal(trend.version, 1);
  assert.equal(trend.months.at(-1).leads, 4);
  assert.equal(trend.months.at(-1).icp, 3);
  assert.equal(trend.markers.length, 1);
  assert.equal(trend.markers[0].version, 1);
});

test("base da nota: quantos leads cada método avaliou", async () => {
  const { gradeBasis } = await import("../src/shared/lead-grade.js");
  const b = gradeBasis([
    { saas: "leverads", orders: "2000+", ticket: "600+" },
    { saas: "leverads", accounts: "3-5", listings: "100-500" },
    { saas: "leverads" },
  ]);
  assert.deepEqual(b, { methods: { "pedidos × ticket médio": 1, "Legado (contas × anúncios)": 1 }, ungraded: 1, total: 3 });
});

test("perguntas da régua: cadastro + formulários publicados, opções somadas", async () => {
  const { icpQuestions } = await import("../src/crm/icp.js");
  const product = { id: "uniquekids", leadQuestions: [{ key: "idade", label: "Idade do filho", options: ["2-3", "4-6"] }, { key: "tentou", label: "O que já tentou", type: "text" }] };
  const forms = [
    { id: "f1", name: "Diagnóstico", saas: "uniquekids", status: "published", questions: [{ key: "idade", label: "Qual a *idade*?", options: [{ value: "4-6" }, { value: "7-9", label: "7 a 9" }] }, { key: "momento", label: "Quando quer *começar*?", options: [{ value: "agora", label: "Agora" }] }] },
    { id: "f2", saas: "uniquekids", status: "draft", questions: [{ key: "rascunho", options: [{ value: "x" }] }] },
  ];
  const qs = icpQuestions(product, forms);
  assert.deepEqual(qs.map((q) => q.key), ["idade", "momento"]);
  assert.equal(qs[0].label, "Idade do filho");
  assert.deepEqual(qs[0].options.map((o) => o.value), ["2-3", "4-6", "7-9"]);
  assert.equal(qs[1].label, "Quando quer começar?");
});
