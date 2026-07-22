// O proxy do EasyPanel troca o corpo de QUALQUER 5xx pela página dele. Toda vez
// que uma rota responde 5xx com o motivo em JSON, quem está na tela vê
// "Service is not reachable" e o time fica achando que o cockpit caiu — foi o
// que aconteceu quando a Meta limitou as chamadas da conta. Erro de dependência
// externa sai como 4xx; 5xx fica só pra bug nosso (o handler padrão do Fastify).

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = new URL("../src/", import.meta.url).pathname;

test("nenhuma rota responde 5xx de propósito (o proxy engole o corpo)", () => {
  const ofensores = [];
  for (const file of readdirSync(SRC).filter((f) => f.endsWith(".js"))) {
    const linhas = readFileSync(join(SRC, file), "utf8").split("\n");
    linhas.forEach((linha, i) => {
      if (/\.code\(\s*5\d\d\s*\)/.test(linha)) ofensores.push(`${file}:${i + 1} → ${linha.trim()}`);
    });
  }
  assert.deepEqual(ofensores, [], `use UPSTREAM_FAILED/NOT_CONFIGURED de http-status.js:\n${ofensores.join("\n")}`);
});

test("os códigos exportados são 4xx (atravessam o proxy)", async () => {
  const { UPSTREAM_FAILED, NOT_CONFIGURED } = await import("../src/http-status.js");
  for (const c of [UPSTREAM_FAILED, NOT_CONFIGURED]) {
    assert.ok(c >= 400 && c < 500, `${c} precisa ser 4xx`);
  }
});
