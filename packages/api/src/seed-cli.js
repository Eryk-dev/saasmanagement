// Gerencia os dados do banco.
//   npm run seed          -> garante as tabelas (seed padrão = vazio, se vazias)
//   npm run seed:clear    -> ZERA tudo (instância limpa)         [= --force/--clear]
//   npm run seed:demo     -> carrega os 3 SaaS de demonstração   [= --demo]
import { initDb, seedAll, seedExternal } from "./db.js";

const args = process.argv.slice(2);
const demo = args.includes("--demo");
const force = demo || args.includes("--force") || args.includes("--clear");

initDb(); // cria as tabelas (e seed padrão vazio, se vazias)

let report;
if (demo) {
  const data = await import("./seed-data.demo.js");
  report = seedExternal(data.COLLECTIONS, { force: true });
  console.log("Dados de DEMONSTRAÇÃO carregados:");
} else {
  report = seedAll({ force });
  console.log(force ? "Banco ZERADO (instância limpa):" : "Tabelas garantidas (seed vazio):");
}
for (const [name, n] of Object.entries(report)) console.log(`  ${name.padEnd(18)} ${n} linhas`);
process.exit(0);
