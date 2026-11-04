// Grupos de WhatsApp registrados pelo Hermes: vínculo com o cliente pelo
// telefone, escolha à mão, tickets antigos preenchidos e o cliente do ticket
// novo pelo jid do card.
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { createTicket } from "../src/support/tickets-core.js";
import { ticketFromIssue } from "../src/support/ticket-linear.js";
import { phoneKey, groupOfDescription, registerGroups, setGroupCustomer, listGroups } from "../src/support/whatsapp-groups.js";
import { registerWhatsappGroupRoutes } from "../src/support/routes.whatsapp-groups.js";

const G1 = "120363000000000001@g.us";
const G2 = "120363000000000002@g.us";

async function setup() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("leads", { id: "l1", name: "Dono", phone: "+55 (21) 99876-5432" });
  await repo.create("customers", { id: "c1", saas: "leverads", name: "Rodão Peças", phone: "(11) 98765-4321" });
  await repo.create("customers", { id: "c2", saas: "leverads", name: "Young", leadId: "l1" });
  await repo.create("customers", { id: "c3", saas: "leverads", name: "Outra", contacts: [{ name: "Ana", phone: "11 3333-4444" }] });
  return repo;
}

test("telefone comparável ignora máscara e o nono dígito", () => {
  assert.equal(phoneKey("(11) 98765-4321"), "551187654321");
  assert.equal(phoneKey("551187654321"), "551187654321");
  assert.equal(phoneKey("5511987654321"), "551187654321");
  assert.equal(phoneKey("12"), "");
  assert.equal(groupOfDescription("**Cliente:** Rodão <> LeverAds\n**Grupo:** `" + G1 + "`\n\nx"), G1);
});

test("grupo liga ao único cliente com telefone no grupo; dois clientes ou nenhum não ligam", async () => {
  const repo = await setup();
  const report = await registerGroups(repo, [
    { jid: G1, name: "Rodão <> LeverAds", phones: ["551187654321", "5511900000000"] },          // c1
    { jid: G2, name: "Grupo misto <> LeverAds", phones: ["5521998765432", "551133334444"] },    // c2 e c3
    { jid: "120363000000000003@g.us", name: "Sem par <> LeverAds", phones: ["5511911112222"] },
  ]);
  assert.deepEqual([report.linked, report.ambiguous, report.unmatched, report.created], [1, 1, 1, 3]);
  const groups = await listGroups(repo);
  const g1 = groups.find((g) => g.jid === G1);
  assert.deepEqual([g1.customerId, g1.customerName, g1.linkedBy], ["c1", "Rodão Peças", "telefone"]);
  assert.equal("phones" in g1 && typeof g1.phones, "number"); // a tela não recebe os números
  assert.deepEqual(groups.find((g) => g.jid === G2).candidates.map((c) => c.id), ["c2", "c3"]);
});

test("escolha à mão vale até voltar ao automático", async () => {
  const repo = await setup();
  await registerGroups(repo, [{ jid: G2, name: "Grupo misto", phones: ["5521998765432", "551133334444"] }]);
  await setGroupCustomer(repo, G2, "c3");
  await registerGroups(repo, [{ jid: G2, name: "Grupo misto", phones: ["5521998765432"] }]);
  assert.deepEqual([(await repo.get("whatsapp_groups", G2)).customerId, (await repo.get("whatsapp_groups", G2)).linkedBy], ["c3", "manual"]);
  await setGroupCustomer(repo, G2, "");
  await registerGroups(repo, [{ jid: G2, name: "Grupo misto", phones: ["5521998765432"] }]);
  assert.deepEqual([(await repo.get("whatsapp_groups", G2)).customerId, (await repo.get("whatsapp_groups", G2)).linkedBy], ["c2", "telefone"]);
  await assert.rejects(() => setGroupCustomer(repo, G2, "nao-existe"), /cliente não encontrado/);
});

test("ligar o grupo preenche os tickets do Hermes sem cliente, pelo jid ou pelo nome do grupo", async () => {
  const repo = await setup();
  const antigo = await createTicket(repo, { saas: "leverads", subject: "Card antigo", requester: { name: "Rodão <> LeverAds" } });
  await repo.update("tickets", antigo.id, { linearIssueId: "i1" });
  const novo = await createTicket(repo, { saas: "leverads", subject: "Card novo", requester: { name: "outro nome" } });
  await repo.update("tickets", novo.id, { linearIssueId: "i2", whatsappGroup: G1 });
  const manual = await createTicket(repo, { saas: "leverads", subject: "Aberto à mão", requester: { name: "Rodão <> LeverAds" } });
  const report = await registerGroups(repo, [{ jid: G1, name: "Rodão <> LeverAds", phones: ["551187654321"] }]);
  assert.equal(report.tickets, 2);
  assert.equal((await repo.get("tickets", antigo.id)).customerId, "c1");
  assert.equal((await repo.get("tickets", novo.id)).customerId, "c1");
  assert.equal((await repo.get("tickets", manual.id)).customerId, ""); // sem Linear, não é card do Hermes
});

test("ticket novo do card pega o cliente pelo grupo ligado", () => {
  const customers = [{ id: "c1", saas: "leverads", name: "Rodão Peças" }];
  const groups = [{ id: G1, name: "Rodão <> LeverAds", customerId: "c1" }];
  const comJid = ticketFromIssue({ title: "Relatório não abre", description: `**Cliente:** Rodão <> LeverAds\n**Grupo:** \`${G1}\`\n\nx` }, { saas: "leverads", customers, groups });
  assert.equal(comJid.customer?.id, "c1"); assert.equal(comJid.group, G1);
  const antigo = ticketFromIssue({ title: "x", description: "**Cliente:** Rodão <> LeverAds\n\nx" }, { saas: "leverads", customers, groups });
  assert.equal(antigo.customer?.id, "c1");
  const semLink = ticketFromIssue({ title: "x", description: `**Cliente:** Rodão <> LeverAds\n**Grupo:** \`${G2}\`` }, { saas: "leverads", customers, groups });
  assert.equal(semLink.customer, null);
});

test("registro do Hermes exige a chave; a lista não expõe telefones", async () => {
  const repo = await setup();
  const app = Fastify();
  registerWhatsappGroupRoutes(app, repo);
  const before = process.env.HERMES_SERVICE_KEY;
  process.env.HERMES_SERVICE_KEY = "segredo-de-teste";
  try {
    const body = { groups: [{ jid: G1, name: "Rodão <> LeverAds", phones: ["5511987654321"] }, { jid: "invalido", name: "x", phones: [] }] };
    assert.equal((await app.inject({ method: "POST", url: "/public/hermes/whatsapp-groups", payload: body })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: "/public/hermes/whatsapp-groups", headers: { "x-cockpit-service-key": "errada-de-teste" }, payload: body })).statusCode, 401);
    const ok = await app.inject({ method: "POST", url: "/public/hermes/whatsapp-groups", headers: { "x-cockpit-service-key": "segredo-de-teste" }, payload: body });
    assert.equal(ok.statusCode, 200); assert.equal(ok.json().groups, 1); assert.equal(ok.json().linked, 1);
    const list = await app.inject({ method: "GET", url: "/api/support/whatsapp-groups" });
    assert.ok(!list.body.includes("87654321"));
    const patch = await app.inject({ method: "PATCH", url: `/api/support/whatsapp-groups/${G1}`, payload: { customerId: "c3" } });
    assert.deepEqual(patch.json(), { jid: G1, customerId: "c3", linkedBy: "manual" });
  } finally {
    if (before === undefined) delete process.env.HERMES_SERVICE_KEY; else process.env.HERMES_SERVICE_KEY = before;
    await app.close();
  }
});
