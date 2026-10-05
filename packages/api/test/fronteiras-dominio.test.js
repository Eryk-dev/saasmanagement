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

test("nenhum módulo importa um routes.<domínio>.js, só o orquestrador routes.js", () => {
  const ofensores = [];
  for (const abs of files) {
    if (rel(abs) === "routes.js") continue;
    for (const spec of importsOf(abs)) {
      if (!spec.startsWith(".")) continue;
      const alvo = rel(resolve(dirname(abs), spec));
      if (/(^|\/)routes\.[a-z0-9-]+\.js$/.test(alvo)) ofensores.push(`${rel(abs)} → ${alvo}`);
    }
  }
  assert.deepEqual(ofensores, [], `mova o helper para um módulo do domínio:\n${ofensores.join("\n")}`);
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
