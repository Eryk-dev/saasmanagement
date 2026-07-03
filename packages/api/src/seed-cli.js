// Gerencia os dados do banco.
//   npm run seed                    -> garante as tabelas (seed padrão = vazio, se vazias)
//   npm run seed:clear              -> ZERA tudo (instância limpa)         [= --force/--clear]
//   npm run seed:leverads-questions -> grava as perguntas do pipeline LeverAds (idempotente)
import { initDb, seedAll, repo } from "./db.js";
import { LEVERADS_LEAD_QUESTIONS } from "./lead-questions.leverads.js";

const args = process.argv.slice(2);
const leveradsQuestions = args.includes("--leverads-questions");
const force = args.includes("--force") || args.includes("--clear");

await initDb(); // cria as tabelas (e seed padrão vazio, se vazias)

// Grava (idempotente) as perguntas de qualificação no produto LeverAds. Create-if-missing:
// se o produto já existe, só atualiza leadQuestions; senão, cria o mínimo. Não toca outros produtos.
if (leveradsQuestions) {
  const existing = await repo.get("products", "leverads");
  if (existing) {
    await repo.update("products", "leverads", { leadQuestions: LEVERADS_LEAD_QUESTIONS });
    console.log(`Produto 'leverads' atualizado com ${LEVERADS_LEAD_QUESTIONS.length} perguntas.`);
  } else {
    await repo.create("products", { id: "leverads", name: "LeverAds", leadQuestions: LEVERADS_LEAD_QUESTIONS });
    console.log(`Produto 'leverads' criado com ${LEVERADS_LEAD_QUESTIONS.length} perguntas.`);
  }
  process.exit(0);
}

const report = await seedAll({ force });
console.log(force ? "Banco ZERADO (instância limpa):" : "Tabelas garantidas (seed vazio):");
for (const [name, n] of Object.entries(report)) console.log(`  ${name.padEnd(18)} ${n} linhas`);
process.exit(0);
