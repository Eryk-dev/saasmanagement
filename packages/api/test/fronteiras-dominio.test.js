// Fronteiras da organização por domínio (packages/api/src/<domínio>/).
// Rota só registra endpoints: o que outro módulo precisa mora num módulo do
// domínio, nunca dentro de um routes.<x>.js. E shared/ é empacotado pelo web
// (Vite), então não pode depender de Node nem de nada fora da própria pasta.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const files = readdirSync(SRC, { recursive: true }).filter((f) => f.endsWith(".js")).map((f) => join(SRC, f));
const rel = (abs) => relative(SRC, abs).split(sep).join("/");

// import estático e dinâmico com string literal
function importsOf(abs) {
  const code = readFileSync(abs, "utf8");
  return [...code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm)].map((m) => m[1]);
}

const pasta = (r) => (r.includes("/") ? r.slice(0, r.lastIndexOf("/")) : "");

test("um routes.<x>.js só é importado pelo index.js do próprio domínio", () => {
  const ofensores = [];
  for (const abs of files) {
    const quem = rel(abs);
    for (const spec of importsOf(abs)) {
      if (!spec.startsWith(".")) continue;
      const alvo = rel(resolve(dirname(abs), spec));
      if (!/(^|\/)routes\.[a-z0-9-]+\.js$/.test(alvo)) continue;
      const indexDoDominio = quem === `${pasta(alvo)}/index.js`;
      if (!indexDoDominio) ofensores.push(`${quem} → ${alvo}`);
    }
  }
  assert.deepEqual(ofensores, [], `mova o helper para um módulo do domínio:\n${ofensores.join("\n")}`);
});

test("o index.js de um domínio só é importado pelo domains.js", () => {
  const ofensores = [];
  for (const abs of files) {
    if (rel(abs) === "domains.js") continue;
    for (const spec of importsOf(abs)) {
      if (!spec.startsWith(".")) continue;
      const alvo = rel(resolve(dirname(abs), spec));
      if (/^[a-z-]+\/index\.js$/.test(alvo)) ofensores.push(`${rel(abs)} → ${alvo}`);
    }
  }
  assert.deepEqual(ofensores, [], `importe o módulo do domínio, não o index.js dele:\n${ofensores.join("\n")}`);
});

test("todo domínio com rota tem index.js e está na lista do domains.js", async () => {
  const comRota = new Set(files.map(rel).filter((r) => /\/routes\.[a-z0-9-]+\.js$/.test(r)).map(pasta));
  const lista = readFileSync(join(SRC, "domains.js"), "utf8");
  const faltando = [...comRota].filter((d) => !files.map(rel).includes(`${d}/index.js`) || !lista.includes(`"./${d}/index.js"`));
  assert.deepEqual(faltando, [], `domínio sem index.js ou fora do domains.js: ${faltando.join(", ")}`);
});

// Fora de produção as rotinas ficam desligadas (app-env.js): toda chamada de
// rotina no start de um domínio precisa passar pelo jobOn, senão roda no dev
// contra integrações reais.
test("toda rotina no start de um domínio passa pelo jobOn", () => {
  const ofensores = [];
  for (const abs of files.filter((f) => /^[a-z-]+\/index\.js$/.test(rel(f)))) {
    const code = readFileSync(abs, "utf8");
    const corpo = code.slice(code.indexOf("export function start("));
    if (!code.includes("export function start(")) continue;
    corpo.split("\n").forEach((linha) => {
      const chamada = linha.match(/^\s*(?:if \(jobOn\("[a-zA-Z]+"\)\) )?(start[A-Z]\w*|refreshResults)\(/);
      if (chamada && !/^\s*if \(jobOn\("[a-zA-Z]+"\)\)/.test(linha) && !/^\s+refreshResults\(\)/.test(linha)) ofensores.push(`${rel(abs)}: ${linha.trim()}`);
    });
    if (corpo.includes("refreshResults()") && !corpo.includes('if (jobOn("refreshResults"))')) ofensores.push(`${rel(abs)}: refreshResults sem jobOn`);
  }
  assert.deepEqual(ofensores, [], ofensores.join("\n"));
});

test("o orquestrador routes.js só é importado pelo index.js", () => {
  const ofensores = [];
  for (const abs of files) {
    if (rel(abs) === "index.js") continue;
    for (const spec of importsOf(abs)) {
      if (spec.startsWith(".") && rel(resolve(dirname(abs), spec)) === "routes.js") ofensores.push(rel(abs));
    }
  }
  assert.deepEqual(ofensores, [], `o que esses módulos usam do routes.js precisa morar num módulo de domínio:\n${ofensores.join("\n")}`);
});

test("shared/ só usa módulos da própria pasta (o web empacota esses arquivos)", () => {
  const ofensores = [];
  for (const abs of files.filter((f) => rel(f).startsWith("shared/"))) {
    for (const spec of importsOf(abs)) {
      const dentro = spec.startsWith(".") && rel(resolve(dirname(abs), spec)).startsWith("shared/");
      if (!dentro) ofensores.push(`${rel(abs)} → ${spec}`);
    }
  }
  assert.deepEqual(ofensores, [], ofensores.join("\n"));
});
