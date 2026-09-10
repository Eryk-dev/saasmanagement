// Testes do servidor MCP. Antes desta rework não existia nenhum, e o servidor
// só era exercitado por um humano no cliente — foi assim que rota inventada e
// resposta que estoura com coleção vazia passavam despercebidas.
//
// O teste sobe uma API falsa (formato real, dados vazios), conecta um cliente
// MCP de verdade por transporte em memória e CHAMA todas as tools de leitura
// que não exigem argumento. Coleção vazia é o caso mais comum em produção
// (produto novo, integração desligada) e é justamente onde as tools quebravam.

import test from "node:test";
import assert from "node:assert/strict";
import { startFakeApi } from "./helpers/fake-api.js";

const { server, vistos, inexistentes } = startFakeApi();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
// Antes de importar qualquer módulo do MCP: core/http.js lê a variável na carga.
process.env.COCKPIT_API_URL = `http://127.0.0.1:${server.address().port}`;
process.env.MCP_API_KEY = "";
process.env.COCKPIT_API_KEY = "";

const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
const { registerTools } = await import("../src/tools/index.js");

const server_mcp = new McpServer({ name: "cockpit-test", version: "1.0.0" });
registerTools(server_mcp);
const client = new Client({ name: "test", version: "1.0.0" });
const [a, b] = InMemoryTransport.createLinkedPair();
await Promise.all([server_mcp.connect(b), client.connect(a)]);

const { tools } = await client.listTools();

test.after(() => { server.close(); });

test("publica um catálogo grande, sem nome repetido", () => {
  assert.ok(tools.length >= 60, `esperava 60+ tools, veio ${tools.length}`);
  const nomes = tools.map((t) => t.name);
  const repetidos = nomes.filter((n, i) => nomes.indexOf(n) !== i);
  assert.deepEqual(repetidos, [], `nomes repetidos: ${repetidos.join(", ")}`);
});

test("toda tool se descreve e declara se escreve", () => {
  for (const t of tools) {
    assert.ok(t.description && t.description.length > 15, `${t.name}: descrição curta demais`);
    assert.ok(t.annotations, `${t.name}: sem annotations`);
    assert.equal(typeof t.annotations.readOnlyHint, "boolean", `${t.name}: readOnlyHint ausente`);
  }
});

// O catálogo inteiro entra no contexto de TODO cliente que conecta, a cada
// sessão. Descrição longa demais aqui custa em toda conversa e ainda piora a
// escolha da tool — por isso o tamanho é um teste, não um detalhe de estilo.
test("o catálogo cabe no contexto do cliente", () => {
  const bytes = JSON.stringify(tools).length;
  const media = Math.round(bytes / tools.length);
  assert.ok(bytes < 220_000, `catálogo com ${bytes} bytes (${tools.length} tools, ${media} B cada) — corte descrição ou junte tools irmãs`);
});

test("as tools que o MCP antigo publicava continuam existindo", () => {
  const antigas = [
    "portfolio_summary", "list_records", "get_record", "create_record", "update_record",
    "delete_record", "move_deal", "generate_proposal", "leaderboard", "api_overview",
    "connect_a_form", "lead_fields", "resource_schema", "list_endpoints", "openapi_spec",
  ];
  const nomes = new Set(tools.map((t) => t.name));
  const faltando = antigas.filter((n) => !nomes.has(n));
  assert.deepEqual(faltando, [], `sumiram do catálogo: ${faltando.join(", ")}`);
});

test("Meta Ads tem tools de primeira classe", () => {
  const nomes = new Set(tools.map((t) => t.name));
  for (const n of ["ads_report", "ads_objects", "ads_accounts", "ads_sync", "ads_set_status", "ads_set_budget"]) {
    assert.ok(nomes.has(n), `faltou ${n}`);
  }
});

test("toda tool que gasta dinheiro ou fala com gente está marcada", () => {
  const perigosas = ["ads_set_budget", "ads_set_status"];
  for (const n of perigosas) {
    const t = tools.find((x) => x.name === n);
    assert.equal(t.annotations.readOnlyHint, false, `${n} devia ser escrita`);
  }
});

// O coração do teste: chamar de verdade tudo que é leitura e não pede argumento.
const semArgumento = tools.filter((t) => {
  const req = t.inputSchema?.required || [];
  return t.annotations?.readOnlyHint !== false && req.length === 0;
});

// Uma tool pode legitimamente exigir uma escolha que o schema não consegue
// expressar ("`form` OU `draft`"). Recusar explicando é comportamento certo;
// o que o teste caça é a QUEBRA (undefined.map, rota inexistente, 500).
const pedidoDeArgumento = /informe |escolha |exige /i;

test("leituras sem argumento respondem com dado vazio, sem estourar", async (t) => {
  assert.ok(semArgumento.length >= 15, `poucas tools testáveis sem argumento: ${semArgumento.length}`);
  for (const tool of semArgumento) {
    await t.test(tool.name, async () => {
      const r = await client.callTool({ name: tool.name, arguments: {} });
      const texto = (r.content || []).map((c) => c.text || "").join("\n");
      assert.ok(texto.length > 0, `${tool.name}: resposta vazia`);
      if (r.isError) {
        assert.match(texto, pedidoDeArgumento, `${tool.name} quebrou em vez de responder: ${texto.slice(0, 300)}`);
      }
    });
  }
});

test("a resposta vem estruturada, com totais e fonte", async () => {
  const r = await client.callTool({ name: "report_portfolio", arguments: {} });
  const sc = r.structuredContent;
  assert.equal(sc.ok, true);
  assert.equal(sc.kind, "report.portfolio");
  assert.ok(sc.totals, "faltou totals");
  assert.ok(Array.isArray(sc.rows), "faltou rows");
  assert.ok(sc.units, "faltou units");
  const texto = r.content[0].text;
  assert.match(texto, /## Totais/);
  assert.match(texto, /\| id \|/, "as linhas deviam virar tabela markdown");
});

test("relatório de publicidade traz período, unidade e comparação", async () => {
  const r = await client.callTool({ name: "ads_report", arguments: { saas: "leverads", period: "last_month" } });
  const sc = r.structuredContent;
  assert.equal(sc.ok, true);
  assert.equal(sc.period.tz, "America/Sao_Paulo");
  assert.ok(sc.period.previous.until < sc.period.since, "a janela de comparação tem que terminar antes do início da atual");
  assert.equal(sc.units.spend, "BRL");
  assert.ok(sc.tables.comparativo, "faltou o comparativo com o período anterior");
  assert.ok(sc.notes.some((n) => /sync/i.test(n)), "devia avisar que não há insight sincronizado");
});

test("erro vira envelope legível, não exceção do transporte", async () => {
  const r = await client.callTool({ name: "ads_report", arguments: { saas: "produto-que-nao-existe" } });
  assert.equal(r.isError, true);
  const texto = r.content[0].text;
  assert.match(texto, /não existe/);
  assert.match(texto, /leverads/, "o erro devia listar os produtos disponíveis");
});

// Roda por último de propósito: só vale depois que as chamadas aconteceram.
test("nenhuma tool chamou rota que a API não tem", () => {
  assert.deepEqual([...new Set(inexistentes)], [], "rotas inventadas (a API real devolveria 404)");
  assert.ok(vistos.length > 20, "o teste mal chamou a API — algo não rodou");
});
