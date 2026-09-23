// Preenche categoria e tags dos tickets importados do Linear (2026-09-23).
//
// POR QUE ISSO EXISTE: a importação de 23/09 não lia as etiquetas da issue e os
// tickets entraram sem categoria. A categoria passou a ser a combinação que o
// CS usa no projeto de suporte (Código · Bug/Feature/Improvement, Operação ·
// Produção, Operação) — categoryFromLabels em src/ticket-linear.js. Este script
// acerta os que já existiam. A regra está COPIADA aqui de propósito: ele roda
// no container antes do deploy do código novo; manter igual à de lá.
//
// Só mexe em ticket VINCULADO e ADOTADO (issue aberta no Linear) SEM categoria:
// categoria escolhida a mão no cockpit não é sobrescrita. As combinações que
// faltarem entram na lista de categorias do produto (as atuais ficam).
//
// Roda da RAIZ do repo (ou /app no container), com COCKPIT_DB_URL e
// LINEAR_API_KEY no ambiente. Dry-run por padrão (não escreve nada):
//   node packages/api/scripts/2026-09-23-categorias-importados-linear.mjs
//   node packages/api/scripts/2026-09-23-categorias-importados-linear.mjs --apply
// Opção: --saas=leverads
import "dotenv/config";
import { repo } from "../src/db.js";
import { defaultLinear as linear } from "../src/linear.js";
import { loadSettings, saveSettings } from "../src/tickets-core.js";

const APPLY = process.argv.includes("--apply");
const SAAS = (process.argv.find((a) => a.startsWith("--saas=")) || "--saas=leverads").slice(7);
if (!linear.configured()) { console.error("LINEAR_API_KEY ausente."); process.exit(1); }

const TIPOS = ["Bug", "Feature", "Improvement"];
function categoryFromLabels(names = []) {
  const k = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const tem = (n) => names.find((x) => k(x) === k(n));
  const tipo = TIPOS.find(tem);
  let usadas = [];
  if (tipo) usadas = [tem(tipo), tem("Código")].filter(Boolean);
  else if (tem("Operação") && tem("Produção")) usadas = [tem("Operação"), tem("Produção")];
  else if (tem("Operação")) usadas = [tem("Operação")];
  const category = tipo ? `Código · ${tipo}` : usadas.length === 2 ? "Operação · Produção" : usadas.length ? "Operação" : "";
  return { category, tags: names.filter((n) => !usadas.includes(n)) };
}

const tickets = (await repo.list("tickets")).filter((t) => t.saas === SAAS && t.linear?.issueId && t.linear?.adopted && !t.category);
console.log(`${tickets.length} tickets importados sem categoria em ${SAAS}\n`);

const plano = [];
for (const t of tickets) {
  const d = await linear.gql(`query($id: String!) { issue(id: $id) { labels { nodes { name } } } }`, { id: t.linear.issueId }).catch((e) => ({ erro: e.message }));
  if (d.erro || !d.issue) { console.log(`  ✗ #${t.number} ${t.linear.identifier}: ${d.erro || "issue não encontrada"}`); continue; }
  const nomes = [...new Set(d.issue.labels.nodes.map((l) => l.name))];
  const { category, tags } = categoryFromLabels(nomes);
  const novasTags = [...new Set([...(t.tags || []), ...tags])].slice(0, 20);
  plano.push({ t, category, tags: novasTags });
  console.log(`  #${String(t.number).padEnd(4)} ${t.linear.identifier.padEnd(8)} ${(category || "(sem categoria)").padEnd(22)} tags: ${novasTags.join(", ")}   ← ${nomes.join(" + ") || "sem etiquetas"}`);
}

const { categories = [] } = await loadSettings(repo, SAAS);
const faltam = [...new Set(plano.map((p) => p.category).filter((c) => c && !categories.includes(c)))];
console.log(`\ncategorias atuais: ${categories.join(" | ")}`);
console.log(`a acrescentar: ${faltam.join(" | ") || "(nenhuma)"}`);

if (!APPLY) { console.log("\nDry-run: nada foi gravado. Rode com --apply para gravar."); process.exit(0); }

if (faltam.length) await saveSettings(repo, SAAS, { categories: [...categories, ...faltam] }, { by: "linear" });
let feitos = 0;
for (const p of plano) {
  await repo.update("tickets", p.t.id, { category: p.category, tags: p.tags });
  feitos++;
}
console.log(`\n${faltam.length} categorias acrescentadas · ${feitos} tickets atualizados`);
process.exit(0);
