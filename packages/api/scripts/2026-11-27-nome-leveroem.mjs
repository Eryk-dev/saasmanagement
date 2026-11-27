// Planos da linha OEM com o nome novo em tudo que mostra o nome de hoje (Leo,
// 27/11/2026: "pode mudar o nome do produto no geral").
//
//   Ads Essencial + OEM   → LeverOEM Essencial
//   Ads Escala + OEM      → LeverOEM Escala
//   Ads Enterprise + OEM  → LeverOEM Enterprise (sob consulta; mesmo padrão)
//
// Quem troca é billing/plan-rename.js: o plano e a projeção dele nas
// apresentações, o retrato das assinaturas vivas e o cadastro do cliente
// (retrato e rótulo da coluna Plano). Os nomes anteriores a 02/10 ("Lever OEM ·
// Essencial") entram como apelido, porque ainda estão no rótulo de clientes.
// Histórico (plan_changes, faturas, propostas e links enviados) fica como está.
//
// Antes da primeira gravação, as linhas que vão mudar ficam copiadas em
// cockpit._bak_nome_leveroem_20261127_<coleção> (a cópia é feita uma vez só:
// rodar de novo não troca a cópia boa pela já renomeada). Desfazer é devolver
// o json das cópias. Idempotente: depois da troca, o ensaio diz que não há
// nada a mudar.
//
// Roda de DENTRO do container da API (precisa do COCKPIT_DB_URL e do código),
// com o código deste PR já publicado:
//   node --input-type=module - < packages/api/scripts/2026-11-27-nome-leveroem.mjs           # ensaio, não grava
//   APPLY=1 node --input-type=module - < packages/api/scripts/2026-11-27-nome-leveroem.mjs   # grava
import path from "node:path";
import { pathToFileURL } from "node:url";

const APPLY = process.argv.includes("--apply") || process.env.APPLY === "1";
// Import pela pasta de trabalho (raiz do repo): o script roda por stdin, onde
// não existe caminho do próprio arquivo.
const SRC = pathToFileURL(path.resolve(process.cwd(), "packages/api/src") + path.sep).href;
const { repo, rawQuery } = await import(SRC + "platform/db.js");
const { renamePlan } = await import(SRC + "billing/plan-rename.js");

const SAAS = "leverads";
const PLANOS = [
  { code: "oem_essencial", name: "LeverOEM Essencial", aliases: ["Ads Essencial + OEM", "Lever OEM · Essencial"] },
  { code: "oem_escala", name: "LeverOEM Escala", aliases: ["Ads Escala + OEM", "Lever OEM · Escala"] },
  { code: "oem_enterprise", name: "LeverOEM Enterprise", aliases: ["Ads Enterprise + OEM", "Lever OEM · Enterprise"] },
];
const BACKUP = "cockpit._bak_nome_leveroem_20261127_";

// Ensaio de tudo primeiro: o relatório sai antes de qualquer gravação.
const ensaios = [];
for (const p of PLANOS) ensaios.push({ ...p, report: await renamePlan(repo, { saas: SAAS, ...p, apply: false }) });

const resumo = (r) => `${r.plan}: "${r.from}" → "${r.to}"${r.planRenamed ? "" : " (o plano já tem o nome novo)"} · ${r.subscriptions.length} assinatura(s) viva(s) · ${r.customers.length} cliente(s)`;
for (const { report } of ensaios) {
  console.log(resumo(report));
  for (const c of report.customers) console.log(`   cliente ${c.id} · ${c.name}: "${c.from}" → "${c.to}"`);
  for (const k of report.labelsKept) console.log(`   rótulo escrito à mão, fica: ${k.id} · ${k.name}: "${k.plan}"`);
}

const ids = (col) => [...new Set(ensaios.flatMap(({ report }) => (col === "plans" ? (report.planRenamed ? [report.plan] : []) : report[col].map((x) => x.id))))];
const nada = ["plans", "subscriptions", "customers"].every((col) => !ids(col).length);

if (!APPLY || nada) {
  console.log(nada ? "nada a mudar: os planos, as assinaturas e os clientes já estão com o nome novo" : "ENSAIO (nada foi gravado; rode com APPLY=1)");
  process.exit(0);
}

for (const col of ["plans", "subscriptions", "customers", "proposal_templates"]) {
  const alvo = col === "proposal_templates" ? ["pt_leverads", "pt_leverads_slides"] : ids(col);
  if (!alvo.length) continue;
  const tabela = BACKUP + col;
  await rawQuery(`CREATE TABLE IF NOT EXISTS ${tabela} (id text PRIMARY KEY, json jsonb NOT NULL, updated_at timestamptz)`);
  await rawQuery(`INSERT INTO ${tabela} (id, json, updated_at) SELECT id, json, updated_at FROM cockpit."${col}" WHERE id = ANY($1::text[]) ON CONFLICT (id) DO NOTHING`, [alvo]);
  const [{ n }] = await rawQuery(`SELECT count(*)::int AS n FROM ${tabela}`);
  console.log(`cópia em ${tabela}: ${n} linha(s)`);
}

for (const p of PLANOS) console.log("GRAVADO · " + resumo(await renamePlan(repo, { saas: SAAS, ...p, apply: true, by: "script:2026-11-27-nome-leveroem" })));
process.exit(0);
