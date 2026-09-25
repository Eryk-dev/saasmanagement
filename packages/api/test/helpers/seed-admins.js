// Admins de teste (Eryk e Leonardo, senha "1234"): gravados direto no repo,
// com hash, porque a API não cria mais senha fixa nem senha curta. Só para os
// testes em memória.
import { hashPassword } from "../../src/auth.js";

export async function seedTestAdmins(repo) {
  if ((await repo.list("users")).length) return 0;
  for (const [id, name] of [["eryk", "Eryk"], ["leonardo", "Leonardo"]]) {
    await repo.create("users", { id, name, role: "admin", passwordHash: hashPassword("1234"), createdAt: new Date().toISOString() });
  }
  return 2;
}
