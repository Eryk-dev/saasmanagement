// Re-seed the database from the design data.
//   npm run seed            -> seed only empty collections
//   npm run seed -- --force -> wipe + reseed every collection (destructive)
import { initDb, seedAll } from "./db.js";

const force = process.argv.includes("--force");
initDb();
const report = seedAll({ force });
console.log(`Seed complete (force=${force}):`);
for (const [name, n] of Object.entries(report)) console.log(`  ${name.padEnd(18)} ${n} rows`);
process.exit(0);
