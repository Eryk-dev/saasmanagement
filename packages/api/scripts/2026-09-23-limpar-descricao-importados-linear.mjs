// Limpa a descrição dos tickets importados do Linear (2026-09-23).
//
// POR QUE ISSO EXISTE: a importação de 23/09 (2026-09-21-importar-cs-suporte-
// linear.mjs) copiou a descrição da issue + "Importado do Linear: …" para a
// descrição do ticket, e a aba Conversa mostra essa descrição como o "pedido"
// do cliente. A Conversa é só o atendimento; o relato da issue já aparece na
// aba Linear, lido de lá. ticketFromIssue passou a criar com descrição vazia;
// este script acerta os que já tinham sido criados.
//
// Só mexe em ticket VINCULADO e ADOTADO (issue aberta no Linear) cuja descrição
// termina com a marca da importação daquela mesma issue — descrição escrita a
// mão no cockpit não é tocada. Vínculo adotado nunca sobe descrição pro Linear,
// então a issue fica intacta. Grava direto (sem evento nem aviso no sino).
//
// Roda da RAIZ do repo (ou /app no container), com COCKPIT_DB_URL no ambiente.
// Dry-run por padrão (não escreve nada):
//   node packages/api/scripts/2026-09-23-limpar-descricao-importados-linear.mjs
//   node packages/api/scripts/2026-09-23-limpar-descricao-importados-linear.mjs --apply
//
// Idempotente: ticket já limpo não casa mais com a marca.
import "dotenv/config";
import { repo } from "../src/db.js";

const APPLY = process.argv.includes("--apply");
const marca = (t) => `Importado do Linear: ${t.linear?.identifier || ""} · `;

// Marca no fim da descrição OU ticket nascido da importação (só importLinearIssue
// cria ticket com o ator `linear`): descrição longa passa do MAX_TEXT e o corte
// leva a marca junto.
const comMarca = (t) => String(t.description || "").split("\n").some((l) => l.startsWith(marca(t)));
const importado = (t) => t.createdBy === "linear" && (t.tags || []).includes("linear");
const tickets = await repo.list("tickets");
const alvo = tickets.filter((t) => t.linear?.issueId && t.linear?.adopted && t.linear?.identifier
  && String(t.description || "") && (comMarca(t) || importado(t)));

console.log(`${tickets.length} tickets · ${alvo.length} importados com a descrição copiada\n`);
for (const t of alvo) console.log(`  #${String(t.number).padEnd(4)} ${t.linear.identifier.padEnd(8)} ${comMarca(t) ? "     " : "corte"} ${String(t.subject || "").slice(0, 70)}`);

if (!APPLY) { console.log("\nDry-run: nada foi gravado. Rode com --apply para limpar."); process.exit(0); }

let feitos = 0;
for (const t of alvo) {
  await repo.update("tickets", t.id, { description: "" });
  feitos++;
}
console.log(`\n${feitos} descrições limpas`);
process.exit(0);
