// Liga ao cliente os tickets vindos do Linear que entraram SEM cliente
// (2026-10-27). Até hoje a importação só olhava o "[Cliente]" do título, e o
// card do Hermes começa com "[WhatsApp]": todo ticket do bot nascia sem
// cliente, com "WhatsApp" no solicitante, e ficava fora do histórico de
// suporte da empresa.
//
// Usa a MESMA regra da importação (ticketFromIssue em
// src/support/ticket-linear.js), sempre com par ÚNICO no cadastro do produto:
//   1. a linha "**Org <produto>:** `<id>`" da descrição (Hermes novo);
//   2. o "[Cliente]" do título (padrão do CS), ignorando "[WhatsApp]";
//   3. a linha "**Cliente:**" da descrição, sem o produto
//      ("Safehouse <> LeverAds" → "Safehouse").
// Só grava `customerId` (ator `linear`: nada volta pro Linear). Ticket com
// cliente já escolhido não é tocado. Ticket com etiqueta de OUTRO produto só é
// listado (mudar de produto é decisão do CS).
//
// Roda da RAIZ do repo (ou /app no container), com COCKPIT_DB_URL e
// LINEAR_API_KEY no ambiente. Dry-run por padrão (não escreve nada):
//   node packages/api/scripts/2026-10-27-cliente-dos-tickets-do-linear.mjs
//   node packages/api/scripts/2026-10-27-cliente-dos-tickets-do-linear.mjs --apply
// Opções: --saas=leverads (padrão: todos os produtos com espelho ligado)
//         --only=LEV-73806,LEV-73807
// Reversível: a saída lista ticket → cliente de cada vínculo.
import "dotenv/config";
import { repo } from "../src/platform/db.js";
import { defaultLinear as linear } from "../src/support/linear.js";
import { ACTOR_LINEAR, loadSettings, patchTicket } from "../src/support/tickets-core.js";
import { issueLabelNames, nomeChave, ticketFromIssue } from "../src/support/ticket-linear.js";

const arg = (name, def = "") => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const APPLY = process.argv.includes("--apply");
const SAAS = arg("saas");
const ONLY = new Set(arg("only").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));

if (!linear.configured()) { console.error("LINEAR_API_KEY ausente."); process.exit(1); }

const products = await repo.list("products");
const produtos = [];
for (const p of products) {
  if (SAAS && p.id !== SAAS) continue;
  if ((await loadSettings(repo, p.id)).linear?.enabled) produtos.push(p);
}
if (!produtos.length) { console.error("Nenhum produto com o espelho do Linear ligado."); process.exit(1); }
const [customers, users] = await Promise.all([repo.list("customers"), repo.list("users")]);

const plano = [];
for (const p of produtos) {
  const tickets = (await repo.listWhere("tickets", { saas: p.id }))
    .filter((t) => t.linearIssueId && !t.customerId)
    .filter((t) => !ONLY.size || ONLY.has(String(t.linear?.identifier || "").toUpperCase()));
  console.log(`${p.id}: ${tickets.length} tickets do Linear sem cliente`);
  for (const t of tickets) {
    let issue = null;
    try { issue = await linear.issue(t.linearIssueId); } catch (err) { plano.push({ t, erro: err.message }); continue; }
    if (!issue) { plano.push({ t, erro: "issue não encontrada no Linear" }); continue; }
    const r = ticketFromIssue(issue, { saas: p.id, customers, users });
    const labels = issueLabelNames(issue).map(nomeChave);
    const outro = products.find((x) => x.id !== p.id && (labels.includes(nomeChave(x.id)) || labels.includes(nomeChave(x.name))));
    plano.push({ t, issue, customer: r.customer, ambiguo: r.ambiguo, nome: r.nome, outro });
  }
}

const ligar = plano.filter((x) => x.customer);
console.log(`\n${plano.length} analisados · ${ligar.length} com cliente encontrado\n`);
for (const x of plano) {
  const id = String(x.t.linear?.identifier || x.t.linearIssueId).padEnd(10);
  const linha = `${id} #${String(x.t.number).padEnd(5)} ${String(x.t.subject || "").slice(0, 60)}`;
  if (x.erro) { console.log(`  ✗ ${linha}  (${x.erro})`); continue; }
  const aviso = x.outro ? `  ⚠ etiqueta de ${x.outro.name}: ticket está em ${x.t.saas}` : "";
  if (x.customer) console.log(`  + ${linha}\n             → ${x.customer.name} (${x.customer.id})${aviso}`);
  else console.log(`  · ${linha}\n             ${x.ambiguo ? "AMBÍGUO" : "sem par"} "${x.nome || "—"}"${aviso}`);
}

if (!APPLY) { console.log("\nDry-run: nada foi gravado. Rode com --apply para vincular."); process.exit(0); }

let feitos = 0, falhas = 0;
for (const x of ligar) {
  try {
    const r = await patchTicket(repo, x.t.id, { customerId: x.customer.id }, { by: ACTOR_LINEAR });
    if (!r) { console.log(`  = #${x.t.number}: ticket sumiu`); continue; }
    console.log(`  ✓ #${x.t.number} → ${x.customer.name}`);
    feitos++;
  } catch (err) {
    console.log(`  ✗ #${x.t.number}: ${err.message}`);
    falhas++;
  }
}
console.log(`\n${feitos} vinculados · ${falhas} falhas`);
process.exit(falhas ? 1 : 0);
