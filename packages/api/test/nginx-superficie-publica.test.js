// A superfície PÚBLICA da API (páginas hospedadas e endpoints anônimos) só
// chega no node se o nginx do container encaminhar o caminho. Prefixo novo em
// OPEN_PREFIXES que ninguém lembra de somar no proxy vira o pior sintoma
// possível: a rota responde 200 com o HTML do COCKPIT (try_files do SPA), então
// não parece erro, parece "a página abriu errada".
//
// Foi o que aconteceu em 26/08/2026 com o /fi/:id do Formulário de Integração
// (e antes disso, sem ninguém notar, com /m/:id do Manual da Família).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (rel) => readFile(new URL(rel, import.meta.url), "utf8");

// Primeiro segmento de cada prefixo aberto: "/public/forms/" → "public".
function openRoots(src) {
  const bloco = src.match(/const OPEN_PREFIXES\s*=\s*\[(.*?)\];/s);
  assert.ok(bloco, "OPEN_PREFIXES não encontrado em index.js");
  const prefixos = [...bloco[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(prefixos.length > 3, "lista de prefixos abertos veio vazia demais");
  return [...new Set(prefixos.map((p) => p.split("/")[1]).filter(Boolean))];
}

test("todo prefixo público da API está no proxy do nginx", async () => {
  const roots = openRoots(await read("../src/index.js"));
  const conf = await read("../../../deploy/nginx.allinone.conf");
  const loc = conf.match(/location ~ \^\/\(([^)]+)\)\(\/\|\$\)/);
  assert.ok(loc, "location da superfície pública não encontrada no nginx.allinone.conf");
  const proxied = new Set(loc[1].split("|"));

  for (const root of roots) {
    // /api/ e /api/webhooks/ têm location própria (location /api/).
    if (root === "api") continue;
    assert.ok(
      proxied.has(root),
      `"/${root}/" é rota pública da API mas não está no proxy do nginx: sem isso o caminho cai no try_files e devolve o HTML do cockpit em vez da página`,
    );
  }
});

test("o caminho do formulário de integração não é engolido pelo /f/ do form", () => {
  // A alternação precisa casar /fi/ inteiro. Com PCRE isso vale em qualquer
  // ordem (retrocede), mas o teste trava o comportamento, não a escrita.
  const re = /^\/(fi|f|p|u|m|public)(\/|$)/;
  assert.match("/fi/if_abc", re);
  assert.match("/f/fo_abc", re);
  assert.match("/public/integration-forms/if_abc", re);
  assert.doesNotMatch("/financeiro", re, "prefixo não pode vazar pra rota do SPA");
});
