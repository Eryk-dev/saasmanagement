// O rulebook do robô SDR (src/sdr/sdr-rules.js) é a fonte única das regras.
// Este meta-teste garante que ele seja íntegro, que toda regra ativa tenha
// pelo menos um teste ou cena com a tag "#R-nnn" no título, e que o playbook
// em docs/ seja o gerado do registro (não pode desviar).

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RULES, STATES, SCRIPTS, LAYERS, CATEGORIES, activeRules, ruleById, rulesFor, promptBlockFor, renderPlaybook } from "../src/sdr/sdr-rules.js";

const TEST_DIR = fileURLToPath(new URL("./", import.meta.url));
const DOC = fileURLToPath(new URL("../../../docs/SDR-PLAYBOOK-LEVERADS.md", import.meta.url));
const SELF = "sdr-rulebook.test.js";

// Regras ativas que AINDA não têm teste nem cena. Cada entrada precisa de um
// motivo e do PR que vai cobrir. Regra com tag em teste não pode ficar aqui.
const PENDING_COVERAGE = {
  "R-002": "estilo da Manuela: regra de prompt, coberta pelo teste de prompt por estado (PR6)",
  "R-012": "'não sei' abre qualificação: cena do corpus (PR3) com a IA fake",
  "R-014": "estoque por SKU: regra de prompt, teste de prompt por estado (PR6)",
  "R-015": "dúvida técnica vira demo: regra de prompt, teste de prompt por estado (PR6)",
  "R-018": "objeções com resposta oficial: regra de prompt, teste de prompt por estado (PR6)",
  "R-019": "ponte antes da primeira oferta: cena do corpus (PR3) + métrica bridgeBeforeSlots do replay",
};

function tagsInTests() {
  const found = new Map(); // id -> [arquivo]
  const files = readdirSync(TEST_DIR, { recursive: true })
    .filter((f) => f.endsWith(".js") && !f.endsWith(SELF) && !f.startsWith("helpers"))
    .map((f) => join(TEST_DIR, f));
  for (const abs of files) {
    const code = readFileSync(abs, "utf8");
    for (const m of code.matchAll(/#(R-\d{3})\b/g)) {
      const list = found.get(m[1]) || [];
      list.push(abs.slice(TEST_DIR.length));
      found.set(m[1], list);
    }
  }
  return found;
}

test("rulebook: ids únicos no formato R-nnn, campos obrigatórios e vocabulário fechado", () => {
  const ids = RULES.map((r) => r.id);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], "id repetido");
  const cats = new Set(CATEGORIES.map(([c]) => c));
  for (const r of RULES) {
    assert.match(r.id, /^R-\d{3}$/, `${r.id}: formato`);
    assert.ok(r.title && r.statement, `${r.id}: título e enunciado obrigatórios`);
    assert.ok(r.origin?.date && r.origin?.by, `${r.id}: origem com data e autor`);
    assert.match(r.origin.date, /^\d{4}-\d{2}-\d{2}$/, `${r.id}: data da origem em ISO`);
    assert.ok(cats.has(r.cat), `${r.id}: categoria desconhecida ${r.cat}`);
    assert.ok(["active", "revoked"].includes(r.status), `${r.id}: status`);
    assert.ok(r.states === "*" || (Array.isArray(r.states) && r.states.length && r.states.every((s) => STATES.includes(s))), `${r.id}: estados`);
    assert.ok(r.scripts === "*" || (Array.isArray(r.scripts) && r.scripts.length && r.scripts.every((s) => SCRIPTS.includes(s))), `${r.id}: roteiros`);
    assert.ok(Array.isArray(r.layers) && r.layers.length && r.layers.every((l) => LAYERS.includes(l)), `${r.id}: camadas`);
    if (r.guard) assert.ok(r.layers.includes("guard"), `${r.id}: guard sem camada guard`);
    for (const e of r.except) assert.ok(ruleById(e.rule) && e.scope, `${r.id}: exceção aponta regra inexistente ou sem escopo (${e.rule})`);
    for (const c of r.conflicts) assert.ok(ruleById(c.rule) && c.decision, `${r.id}: conflito sem regra ou sem decisão (${c.rule})`);
    if (r.status === "revoked") {
      assert.ok(r.revoked?.date && r.revoked?.by && r.revoked?.why, `${r.id}: revogada sem data/por/motivo`);
      assert.ok(ruleById(r.revoked.by)?.status === "active", `${r.id}: revogada por regra que não existe ou não está ativa`);
      assert.equal(r.guard, undefined, `${r.id}: regra revogada não pode ter validador`);
    }
  }
});

test("rulebook: toda regra ativa tem teste ou cena com a tag #R-nnn (ou está na lista de pendências com motivo)", () => {
  const found = tagsInTests();
  const semCobertura = activeRules().filter((r) => !found.has(r.id) && !PENDING_COVERAGE[r.id]).map((r) => `${r.id} ${r.title}`);
  assert.deepEqual(semCobertura, [], `regra ativa sem teste: marque um teste com a tag ou registre em PENDING_COVERAGE com o PR que cobre:\n${semCobertura.join("\n")}`);
  const desconhecidas = [...found.keys()].filter((id) => !ruleById(id)).map((id) => `${id} em ${found.get(id).join(", ")}`);
  assert.deepEqual(desconhecidas, [], `tag de regra que não existe no rulebook:\n${desconhecidas.join("\n")}`);
  const revogadasComTag = [...found.keys()].filter((id) => ruleById(id)?.status === "revoked");
  assert.deepEqual(revogadasComTag, [], `teste marcado com regra revogada (atualize a tag): ${revogadasComTag.join(", ")}`);
  const pendentesCobertas = Object.keys(PENDING_COVERAGE).filter((id) => found.has(id) || ruleById(id)?.status !== "active");
  assert.deepEqual(pendentesCobertas, [], `já tem cobertura (ou não está ativa), tire de PENDING_COVERAGE: ${pendentesCobertas.join(", ")}`);
});

test("rulebook: o playbook em docs/ é o gerado do registro", () => {
  assert.ok(existsSync(DOC), "docs/SDR-PLAYBOOK-LEVERADS.md não existe: rode node src/sdr/sdr-rules.js --write");
  assert.equal(readFileSync(DOC, "utf8"), renderPlaybook(), "playbook desatualizado: rode node src/sdr/sdr-rules.js --write (em packages/api)");
});

test("rulebook: rulesFor filtra por estado, roteiro e camada; promptBlockFor só traz regras de prompt do estado", () => {
  assert.ok(rulesFor({ state: "oferta_feita" }).some((r) => r.id === "R-027"), "R-027 vale em oferta_feita");
  assert.ok(!rulesFor({ state: "novo" }).some((r) => r.id === "R-027"), "R-027 não vale em novo");
  assert.ok(rulesFor({ script: "oem" }).some((r) => r.id === "R-070") && !rulesFor({ script: "clone" }).some((r) => r.id === "R-070"), "R-070 só no OEM");
  assert.ok(rulesFor({ layer: "guard" }).every((r) => r.layers.includes("guard")));
  assert.ok(!rulesFor({}).some((r) => r.status === "revoked"), "revogadas não entram");
  const bloco = promptBlockFor("call_marcada", "clone");
  assert.ok(bloco.includes(ruleById("R-038").statement), "objeção depois de marcar entra no bloco de call_marcada");
  assert.ok(!bloco.includes(ruleById("R-027").statement), "número solto (oferta_feita) não entra em call_marcada");
  assert.ok(!bloco.includes(ruleById("R-070").statement), "roteiro OEM não entra no clone");
});
