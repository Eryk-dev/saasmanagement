// Passa a Em atendimento os tickets importados cujo card está em andamento no
// Linear (2026-09-23).
//
// POR QUE ISSO EXISTE: ticket nasce Novo e só vira Em atendimento com
// responsável; o de-para da volta não cobre In Progress (Novo e Em atendimento
// são o mesmo kind). Os cards em andamento sem responsável casado ficaram Novo.
// applyLinearIssue passou a tirar do Novo quando a issue está `started`; este
// script acerta os que já existiam, pelo estado carimbado no vínculo.
//
// Só mexe em ticket VINCULADO e ADOTADO, com status Novo e issue `started`.
//
// Roda da RAIZ do repo (ou /app no container), com COCKPIT_DB_URL no ambiente.
// Dry-run por padrão (não escreve nada):
//   node packages/api/scripts/2026-09-23-em-andamento-importados-linear.mjs
//   node packages/api/scripts/2026-09-23-em-andamento-importados-linear.mjs --apply
import "dotenv/config";
import { repo } from "../src/db.js";
import { patchTicket } from "../src/tickets-core.js";

const APPLY = process.argv.includes("--apply");
const alvo = (await repo.list("tickets")).filter((t) => t.linear?.issueId && t.linear?.adopted
  && t.status === "new" && t.linear?.stateType === "started");

console.log(`${alvo.length} tickets Novo com o card em andamento no Linear\n`);
for (const t of alvo) console.log(`  #${String(t.number).padEnd(4)} ${String(t.linear.identifier).padEnd(8)} ${String(t.linear.stateName).padEnd(12)} ${String(t.subject || "").slice(0, 60)}`);

if (!APPLY) { console.log("\nDry-run: nada foi gravado. Rode com --apply para gravar."); process.exit(0); }

let feitos = 0;
for (const t of alvo) {
  await patchTicket(repo, t.id, { status: "open" }, { by: "linear" });
  feitos++;
}
console.log(`\n${feitos} tickets em atendimento`);
process.exit(0);
