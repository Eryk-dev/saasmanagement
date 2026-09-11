// Split A/B de formulário: 20% do tráfego pago de cada tipo de campanha vai
// pros formulários v2. O que os testes protegem é a VALIDADE do experimento —
// aderência estável, proporção correta e nenhum vazamento de tráfego.

import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { pickForm, bucketFor, seedFrom, readAbCookie, abCookieHeader, FORM_AB_FLAG } = await import("../src/form-ab.js");
const { FORMS_V2, FORM_IDS, formV2 } = await import("../src/forms-v2.leverads.js");
const { ensureFormsV2 } = await import("../src/migrations.js");
const { validateAnswers, publicForm } = await import("../src/forms.js");
const { QUESTION_TYPES } = await import("../src/forms.js");

const CFG = {
  enabled: true, pct: 20, onlyForms: ["fo_diagnostico_leverads"],
  byPain: { OEM: FORM_IDS.oem }, fallback: FORM_IDS.ads,
};
const CONTROLE = "fo_diagnostico_leverads";

test("o mesmo visitante cai sempre do mesmo lado", () => {
  const seed = "fbclid-abc-123";
  const primeira = pickForm({ cfg: CFG, pain: "OEM", seed, currentId: CONTROLE });
  for (let i = 0; i < 50; i++) {
    assert.equal(pickForm({ cfg: CFG, pain: "OEM", seed, currentId: CONTROLE }), primeira);
  }
});

test("a proporção fica perto dos 20% pedidos", () => {
  let variante = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    if (pickForm({ cfg: CFG, pain: "", seed: `clique-${i}`, currentId: CONTROLE })) variante += 1;
  }
  const pct = (variante / N) * 100;
  assert.ok(pct > 18 && pct < 22, `split saiu em ${pct.toFixed(1)}%, esperado ~20%`);
});

test("campanha de OEM vai pro form de OEM; as demais pro de Ads", () => {
  // Procura uma semente que caia na variante pra checar o DESTINO.
  const naVariante = (pain) => {
    for (let i = 0; i < 5000; i++) {
      const r = pickForm({ cfg: CFG, pain, seed: `s${i}`, currentId: CONTROLE });
      if (r) return r;
    }
    return null;
  };
  assert.equal(naVariante("OEM"), FORM_IDS.oem);
  for (const dor of ["A", "B", "C", "D", "E", ""]) {
    assert.equal(naVariante(dor), FORM_IDS.ads, `dor ${dor || "(sem código)"} não caiu no form de Ads`);
  }
});

test("desligado, nada sai do controle", () => {
  for (let i = 0; i < 500; i++) {
    assert.equal(pickForm({ cfg: { ...CFG, enabled: false }, pain: "OEM", seed: `s${i}`, currentId: CONTROLE }), null);
  }
  assert.equal(pickForm({ cfg: null, pain: "OEM", seed: "s", currentId: CONTROLE }), null);
  assert.equal(pickForm({ cfg: { ...CFG, pct: 0 }, pain: "OEM", seed: "s", currentId: CONTROLE }), null);
});

test("sem semente estável não sorteia — vai pro controle", () => {
  assert.equal(bucketFor(""), null);
  assert.equal(pickForm({ cfg: CFG, pain: "OEM", seed: "", currentId: CONTROLE }), null);
  assert.equal(seedFrom({}), "");
  assert.equal(seedFrom({ fbclid: "xyz" }), "xyz");
  assert.equal(seedFrom({ cookie: "antigo", fbclid: "novo" }), "antigo", "cookie tem que vencer o fbclid");
});

test("quem já está numa variante não é re-sorteado no meio do preenchimento", () => {
  for (const id of Object.values(FORM_IDS)) {
    assert.equal(pickForm({ cfg: CFG, pain: "OEM", seed: "s1", currentId: id }), null);
  }
});

test("cookie de adesão vai e volta", () => {
  const h = abCookieHeader("semente-1");
  assert.match(h, /SameSite=Lax/);
  assert.equal(readAbCookie(`outro=1; ${h.split(";")[0]}; mais=2`), "semente-1");
  assert.equal(readAbCookie(""), "");
});

test("os três formulários seguem o padrão do form atual", () => {
  for (const f of FORMS_V2) {
    assert.equal(f.saas, "leverads");
    assert.equal(f.status, "draft", `${f.id} não pode nascer publicado`);
    assert.deepEqual(f.mapping, { name: "nome", email: "email", phone: "whatsapp" });
    assert.equal(f.theme.accent, "#0F766E");
    assert.ok(f.thanks.whatsappPrefill.includes("{{nome}}"));
    // todo tipo de pergunta tem que ser um tipo que o builder conhece
    for (const q of f.questions) {
      assert.ok(QUESTION_TYPES.includes(q.type), `${f.id}: tipo ${q.type} não existe`);
      assert.ok(q.key && q.label, `${f.id}: pergunta sem key/label`);
    }
    // as chaves de contato precisam existir de fato, senão o mapping aponta pro vazio
    const chaves = new Set(f.questions.map((q) => q.key));
    for (const k of ["nome", "email", "whatsapp"]) assert.ok(chaves.has(k), `${f.id}: falta a pergunta ${k}`);
    // e as que a classificação lê
    for (const k of ["niche", "accounts", "listings", "trigger", "orders", "ticket"]) {
      assert.ok(chaves.has(k), `${f.id}: falta a pergunta ${k} usada na classificação`);
    }
  }
});

test("loja física só aparece no formulário de OEM", () => {
  const chaves = (l) => new Set(formV2(l).questions.map((q) => q.key));
  assert.ok(chaves("oem").has("channel") && chaves("oem").has("stores"));
  for (const l of ["ads", "price"]) {
    assert.ok(!chaves(l).has("channel"), `form de ${l} não deveria perguntar canal`);
    assert.ok(!chaves(l).has("stores"), `form de ${l} não deveria perguntar lojas`);
  }
});

test("os três formulários compartilham o mesmo núcleo, e só ele", () => {
  const nucleo = ["niche", "accounts", "listings", "trigger", "orders", "ticket", "nome", "whatsapp", "email"];
  for (const l of ["ads", "price"]) {
    assert.deepEqual(formV2(l).questions.map((q) => q.key), nucleo);
  }
  // OEM = núcleo + o bloco de loja física logo depois do nicho.
  assert.deepEqual(formV2("oem").questions.map((q) => q.key),
    ["niche", "channel", "stores", ...nucleo.slice(1)]);
});

test("o 'só online' pula a pergunta de unidades por branching", () => {
  const canal = formV2("oem").questions.find((q) => q.key === "channel");
  assert.equal(canal.options.find((o) => o.value === "online").to, "accounts");
  assert.equal(canal.options.find((o) => o.value === "online-fisico").to, undefined);
});

test("migração cria tudo em rascunho e com o split desligado", async () => {
  const repo = makeMemRepo();
  const n = await ensureFormsV2(repo);
  assert.equal(n, 4); // 3 formulários + a config

  for (const id of Object.values(FORM_IDS)) {
    assert.equal((await repo.get("forms", id)).status, "draft");
  }
  const cfg = await repo.get("app_config", FORM_AB_FLAG);
  assert.equal(cfg.enabled, false, "o split não pode nascer ligado");
  assert.equal(cfg.pct, 20);
  assert.deepEqual(cfg.onlyForms, ["fo_diagnostico_leverads"]);

  // idempotente
  assert.equal(await ensureFormsV2(repo), 0);
});

test("as opções de faixa batem com o que a classificação sabe ler", async () => {
  const { classificar } = await import("../src/classificacao.js");
  const oem = formV2("oem");
  // Preenche cada pergunta com a MAIOR faixa: se algum rótulo do formulário
  // divergir do que classificacao.js indexa, o porte sai nulo e o teste pega.
  const resp = Object.fromEntries(
    oem.questions.filter((q) => q.options?.length).map((q) => [q.key, q.options[q.options.length - 1].value])
  );
  const r = classificar({ ...resp, niche: "autopecas", formProduct: "oem" });
  assert.ok(r.porte, "a maior faixa de cada pergunta tem que produzir um porte");
  assert.equal(r.primario, "oem", "a linha vem do formulário preenchido");

  // Autopeças que entrou pelo formulário de Ads: a linha respeita o form (é o
  // que ele pediu), mas `portaErrada` avisa o SDR de que o pitch certo é OEM.
  const peloFormErrado = classificar({ ...resp, niche: "autopecas", formProduct: "ads" });
  assert.equal(peloFormErrado.primario, "ads");
  assert.equal(peloFormErrado.candidatoOem, true);
  assert.equal(peloFormErrado.portaErrada, true);
});
