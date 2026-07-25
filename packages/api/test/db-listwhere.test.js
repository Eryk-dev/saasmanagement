// Contrato do repo.listWhere — o filtro que vai pro Postgres em vez de trazer a
// tabela inteira e filtrar em JS (foi o que estourou a cota de egress do Supabase
// em 25/07/2026 e derrubou o Levercopy, que divide o mesmo projeto).
//
// O que estes testes travam vale pras DUAS implementações (db.js/SQL e o duplo de
// memória): comparação sempre como TEXTO (é o que `json->>` faz), `fields: []` =
// só o id, e chave ausente vira null na projeção. O `fields: []` já nasceu errado
// uma vez — voltava o documento inteiro, calado.
import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";

async function seeded() {
  const repo = makeMemRepo();
  await repo.create("form_events", { id: "fe_1", form: "f1", saas: "leverads", event: "view", session: "s1", createdAt: "2026-07-10T10:00:00.000Z", ua: "x".repeat(300) });
  await repo.create("form_events", { id: "fe_2", form: "f1", saas: "leverads", event: "submit", session: "s2", createdAt: "2026-07-20T10:00:00.000Z", ua: "y".repeat(300) });
  await repo.create("form_events", { id: "fe_3", form: "f2", saas: "leverads", event: "view", session: "s3", createdAt: "2026-07-15T10:00:00.000Z" });
  await repo.create("form_events", { id: "fe_4", form: "f1", saas: "outro", event: "view", session: "s4" }); // sem createdAt
  return repo;
}

test("listWhere: igualdade por chave, e chave com valor vazio não filtra nada", async () => {
  const repo = await seeded();
  assert.deepEqual((await repo.listWhere("form_events", { form: "f1" })).map((r) => r.id), ["fe_1", "fe_2", "fe_4"]);
  assert.deepEqual((await repo.listWhere("form_events", { form: "f1", saas: "outro" })).map((r) => r.id), ["fe_4"]);
  // where vazio (ou só com valores vazios) = a coleção inteira, ordenada por id
  assert.equal((await repo.listWhere("form_events", { form: "" })).length, 4);
  assert.equal((await repo.listWhere("form_events")).length, 4);
});

test("listWhere: faixa gte/lte/lt compara como texto; linha sem a chave fica FORA", async () => {
  const repo = await seeded();
  const ids = (rows) => rows.map((r) => r.id);
  assert.deepEqual(ids(await repo.listWhere("form_events", { createdAt: { gte: "2026-07-11T00:00:00.000Z" } })), ["fe_2", "fe_3"]);
  assert.deepEqual(ids(await repo.listWhere("form_events", { createdAt: { gte: "2026-07-10", lte: "2026-07-16" } })), ["fe_1", "fe_3"]);
  assert.deepEqual(ids(await repo.listWhere("form_events", { createdAt: { lt: "2026-07-15" } })), ["fe_1"]);
  // fe_4 não tem createdAt: qualquer faixa exclui (mesmo comportamento do NULL no `->>`)
  assert.ok(!ids(await repo.listWhere("form_events", { createdAt: { gte: "2000-01-01" } })).includes("fe_4"));
  // limite vazio = sem limite (o chamador passa since/until opcionais direto)
  assert.equal((await repo.listWhere("form_events", { form: "f1", createdAt: { gte: "", lte: "" } })).length, 3);
});

test("listWhere: `fields: []` traz SÓ o id; sem `fields` traz o documento inteiro", async () => {
  const repo = await seeded();
  assert.deepEqual(await repo.listWhere("form_events", { id: "fe_1" }, { fields: [] }), [{ id: "fe_1" }]);
  assert.equal((await repo.listWhere("form_events", { id: "fe_1" }))[0].ua.length, 300);
});

test("listWhere: projeção sempre inclui id e devolve null pra chave ausente", async () => {
  const repo = await seeded();
  const [row] = await repo.listWhere("form_events", { id: "fe_3" }, { fields: ["event", "variant"] });
  assert.deepEqual(row, { id: "fe_3", event: "view", variant: null });
});
