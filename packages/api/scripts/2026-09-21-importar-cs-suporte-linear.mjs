// Importa os cards do projeto do Linear (CS - Suporte) como tickets de suporte
// (2026-09-21): cada issue do projeto que ainda não tem ticket vira um ticket
// do produto, já VINCULADO à issue — daí em diante o espelho normal
// (webhook + reconciliação) cuida de status, título e comentários.
//
// POR QUE ISSO EXISTE: o espelho só andava no sentido ticket → issue (ticket
// novo cria issue) e, na volta, só atualizava ticket que JÁ estava vinculado.
// Os cards que o CS abriu direto no Linear nunca tinham chegado ao cockpit.
// Desde 22/09 o webhook e a reconciliação criam o ticket sozinhos para card
// NOVO (importLinearIssue em src/ticket-linear.js, a mesma função usada aqui);
// este script só traz o que já existia antes disso.
//
// Como cada ticket nasce (ver importLinearIssue/ticketFromIssue):
// - vínculo por `linkTicketToIssue` (adopted: a descrição da issue é de lá e
//   não é reescrita; só mudança POSTERIOR no ticket sobe);
// - status pelo mesmo de-para da reconciliação (`applyLinearIssue`), então
//   Done vira Resolvido e Canceled vira Fechado, como no resto do espelho;
// - ator `linear` em tudo (anti-ping-pong: nada daqui volta pro Linear);
// - os comentários que JÁ existem na issue entram em `linear.seenComments`,
//   senão a primeira reconciliação avisaria no sino um histórico inteiro;
// - cliente: o "[Cliente]" do título casado com o cadastro do produto por nome
//   normalizado idêntico e ÚNICO. Nome sem casamento não chuta: o ticket nasce
//   sem cliente e o nome vai no solicitante, pro CS vincular na ficha;
// - responsável: o da issue, se houver usuário do cockpit com o mesmo nome que
//   atende o produto; senão fica sem responsável.
//
// Roda da RAIZ do repo (ou /app no container), com COCKPIT_DB_URL e
// LINEAR_API_KEY no ambiente. Dry-run por padrão (não escreve nada):
//   node packages/api/scripts/2026-09-21-importar-cs-suporte-linear.mjs
//   node packages/api/scripts/2026-09-21-importar-cs-suporte-linear.mjs --apply
// Opções: --saas=leverads  --project="CS - Suporte"  --only=LEV-454,LEV-453
//
// Idempotente: issue que já tem ticket é pulada. Reversível: a saída lista
// ticket ↔ issue de cada criação.
import "dotenv/config";
import { repo } from "../src/db.js";
import { defaultLinear as linear } from "../src/linear.js";
import { loadSettings, agentsOf } from "../src/tickets-core.js";
import { findTicketByIssue, importLinearIssue, ticketFromIssue } from "../src/ticket-linear.js";

const arg = (name, def = "") => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const APPLY = process.argv.includes("--apply");
const SAAS = arg("saas", "leverads");
const PROJECT = arg("project", "CS - Suporte");
const ONLY = new Set(arg("only").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));

if (!linear.configured()) { console.error("LINEAR_API_KEY ausente."); process.exit(1); }

// ── Projeto: o configurado no espelho do produto, ou o nome passado ─────────
const settings = await loadSettings(repo, SAAS);
const cfg = settings.linear || {};
const catalog = await linear.catalog({ projects: 100 });
const projetos = catalog.flatMap((t) => (t.projects || []).map((p) => ({ ...p, teamId: t.id })));
const projeto = projetos.find((p) => p.name === PROJECT) || projetos.find((p) => p.id === cfg.projectId);
if (!projeto) { console.error(`Projeto "${PROJECT}" não encontrado no Linear.`); process.exit(1); }
console.log(`produto: ${SAAS} · projeto: ${projeto.name} (${projeto.id})`);
console.log(`espelho do produto: ${cfg.enabled ? "ligado" : "DESLIGADO"} · projeto configurado: ${cfg.projectId || "(nenhum)"}`);
if (!cfg.enabled || cfg.projectId !== projeto.id) {
  console.log("  ⚠ sem o espelho ligado NESTE projeto, card novo não vira ticket e a reconciliação não acompanha os importados.");
}

const issues = (await linear.issuesUpdatedSince("2000-01-01T00:00:00.000Z", { projectId: projeto.id, first: 250, comments: 100 }))
  .filter((i) => !ONLY.size || ONLY.has(String(i.identifier).toUpperCase()));
const [customers, users] = await Promise.all([repo.list("customers"), repo.list("users")]);
const agentes = agentsOf(users, SAAS);

const plano = [];
for (const issue of issues) {
  if (await findTicketByIssue(repo, issue.id)) { plano.push({ issue, skip: "já tem ticket" }); continue; }
  plano.push({ issue, ...ticketFromIssue(issue, { saas: SAAS, customers, users }) });
}

console.log(`\n${issues.length} issues · ${plano.filter((p) => !p.skip).length} a importar · ${plano.filter((p) => p.skip).length} já vinculadas\n`);
for (const p of plano) {
  const i = p.issue;
  const linha = `${String(i.identifier).padEnd(8)} ${String(i.state?.name || "").padEnd(12)} ${i.title.slice(0, 70)}`;
  if (p.skip) { console.log(`  = ${linha}  (${p.skip})`); continue; }
  const cli = p.customer ? `cliente ${p.customer.name}` : p.ambiguo ? `cliente AMBÍGUO "${p.nome}"` : `cliente ? "${p.nome}"`;
  const resp = p.assignee ? `resp. ${p.assignee.name}` : `sem resp.${i.assignee?.name ? ` (${i.assignee.name} não casou)` : ""}`;
  console.log(`  + ${linha}\n             ${cli} · ${resp}`);
}
if (!agentes.length) console.log("\n  ⚠ nenhum atendente com etiqueta support no produto.");

if (!APPLY) { console.log("\nDry-run: nada foi gravado. Rode com --apply para criar."); process.exit(0); }

let criados = 0, falhas = 0;
for (const p of plano.filter((x) => !x.skip)) {
  const i = p.issue;
  try {
    const r = await importLinearIssue(repo, i, { saas: SAAS });
    if (!r) { console.log(`  = ${i.identifier}: pulada (já tem ticket ou foi criada pelo cockpit)`); continue; }
    const fim = await repo.get("tickets", r.ticket);
    const semResp = p.assignee && !fim.assignee ? ` · ${p.assignee.name} não atende ${SAAS}, sem responsável` : "";
    console.log(`  ✓ ${i.identifier} → ticket #${fim.number} (${fim.id}) status ${fim.status}${semResp}`);
    criados++;
  } catch (err) {
    console.log(`  ✗ ${i.identifier}: ${err.message}`);
    falhas++;
  }
}
console.log(`\n${criados} criados · ${falhas} falhas`);
process.exit(falhas ? 1 : 0);
