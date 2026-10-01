import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { stripAdDeletionClause, ensureContractsNoAdDeletionClause } from "../src/migrations.js";

// Leo, 01/10/2026: fora a cláusula que autorizava excluir os anúncios do lead
// em caso de encerramento sem quitação (9.5 / 10.5), e as remissões a ela.
const BODY = `<h2>Cláusula 9ª · Vigência</h2>
<p><strong>9.4.</strong> Encerrado o contrato por qualquer motivo, a LEVERADS desativará os acessos. Os anúncios publicados permanecem nas respectivas contas, que são de sua titularidade, observado o disposto na Cláusula 9.5.</p>
<p><strong>9.5.</strong> Exclusão dos anúncios clonados em caso de encerramento sem quitação: em exceção à Cláusula 9.4, se o contrato for encerrado por rescisão imotivada do CONTRATANTE (Cláusula 9.2) ou por justa causa a ele imputável, incluindo inadimplência (Cláusula 7.3), o CONTRATANTE desde já autoriza a LEVERADS a excluir, das contas de marketplace conectadas, os anúncios criados por meio da plataforma. Quitados os valores, os anúncios permanecem, na forma da Cláusula 9.4.</p>
<h2>Cláusula 13ª · Dados</h2>
<p><strong>13.2.</strong> Os conteúdos permanecem de sua titularidade.</p>`;
const BODY_OEM = `<p><strong>10.4.</strong> Os anúncios permanecem nas contas, observado o disposto na Cláusula 10.5.</p>
<p><strong>10.5.</strong> Exclusão dos anúncios gerados em caso de encerramento sem quitação: o CONTRATANTE desde já autoriza a LEVERADS a excluir, das contas conectadas, os anúncios montados a partir de códigos OEM.</p>
<p><strong>14.2.</strong> As fichas técnicas são disponibilizadas para uso nos anúncios do CONTRATANTE, observada a Cláusula 10.5. A LEVERADS poderá utilizar dados agregados.</p>`;
// Lever Price tem um 10.5 que NÃO é de exclusão de anúncios: fica.
const BODY_PRICE = `<p><strong>10.4.</strong> Os anúncios permanecem com os preços vigentes.</p>
<p><strong>10.5.</strong> Suspensão ou encerramento por inadimplência: a interrupção da precificação automática não gera direito a indenização, permanecendo os anúncios com os últimos preços aplicados, na forma da Cláusula 10.4.</p>`;

test("stripAdDeletionClause tira só o parágrafo de exclusão e as remissões a ele; o resto fica igual", () => {
  const out = stripAdDeletionClause(BODY);
  assert.doesNotMatch(out, /9\.5\./);
  assert.doesNotMatch(out, /autoriza a LEVERADS a excluir/);
  assert.match(out, /que são de sua titularidade\.<\/p>/, "remissão da 9.4 saiu e a frase fechou");
  assert.match(out, /<p><strong>13\.2\.<\/strong> Os conteúdos permanecem de sua titularidade\.<\/p>$/);
  assert.equal(stripAdDeletionClause(out), out, "idempotente");
  const oem = stripAdDeletionClause(BODY_OEM);
  assert.doesNotMatch(oem, /Cláusula 10\.5/);
  assert.match(oem, /uso nos anúncios do CONTRATANTE\. A LEVERADS poderá/);
  assert.equal(stripAdDeletionClause(BODY_PRICE), BODY_PRICE, "10.5 do Lever Price não é de exclusão: intocado");
});

test("ensureContractsNoAdDeletionClause atualiza só os modelos com a cláusula", async () => {
  const repo = makeMemRepo();
  await repo.create("contracts", { id: "co_assinatura_leverads", body: BODY });
  await repo.create("contracts", { id: "co_oem_avulso", body: BODY_OEM });
  await repo.create("contracts", { id: "co_assinatura_leverprice", body: BODY_PRICE });
  assert.equal(await ensureContractsNoAdDeletionClause(repo), 2);
  assert.doesNotMatch((await repo.get("contracts", "co_assinatura_leverads")).body, /9\.5/);
  assert.ok((await repo.get("contracts", "co_assinatura_leverads")).updatedAt);
  assert.equal((await repo.get("contracts", "co_assinatura_leverprice")).body, BODY_PRICE);
  assert.equal(await ensureContractsNoAdDeletionClause(repo), 0);
});
