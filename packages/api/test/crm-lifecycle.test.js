// Ciclo de vida do cliente (customers/lifecycle.js): empresa e contatos
// derivados do que o cockpit já tem, estágio de vida e status financeiro com
// histórico na timeline, e os workspaces de cada produto.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { companyOf, contactsOf, financialStatusOf, lifecycleOf, refreshLifecycle, runLifecycleSweep } from "../src/customers/lifecycle.js";
import { registerLifecycleRoutes } from "../src/customers/routes.lifecycle.js";
import { processEvent, EVENTS } from "../src/events/events-core.js";
import { TIMELINE } from "../src/events/timeline.js";

test("empresa vem do cadastro fiscal e o domínio do e-mail corporativo", () => {
  const customer = { name: "Loja X", email: "ana@gmail.com", fiscal: { tipo: "PJ", nome: "Loja X LTDA", documento: "12.345.678/0001-90", nomeFantasia: "Loja X" } };
  const lead = { name: "Bruno", email: "bruno@lojax.com.br", phone: "11999990000", leverId: "lid-9" };
  const contacts = contactsOf(customer, lead);
  assert.deepEqual(contacts.map((c) => [c.email, c.primary, c.leverId]), [["ana@gmail.com", true, ""], ["bruno@lojax.com.br", false, "lid-9"]]);
  assert.deepEqual(companyOf(customer, contacts), { legalName: "Loja X LTDA", cnpj: "12.345.678/0001-90", tradeName: "Loja X", domain: "lojax.com.br" });
  assert.equal(companyOf({ fiscal: { tipo: "PF", nome: "Ana", documento: "123.456.789-00" } }).cnpj, "", "PF não é empresa");
});

test("status financeiro: aguardando, adimplente, inadimplente", () => {
  assert.equal(financialStatusOf([], []), "");
  assert.equal(financialStatusOf([{ status: "active" }], [{ status: "open" }]), "aguardando_pagamento");
  assert.equal(financialStatusOf([{ status: "active" }], [{ status: "paid" }, { status: "open" }]), "adimplente");
  assert.equal(financialStatusOf([{ status: "active" }], [{ status: "paid" }, { status: "overdue" }]), "inadimplente");
  assert.equal(financialStatusOf([{ status: "past_due" }], [{ status: "paid" }]), "inadimplente");
});

test("estágio de vida: churn, integração, risco e ativo", () => {
  const base = { subs: [{ status: "active" }], onboardings: [], financialStatus: "adimplente" };
  assert.equal(lifecycleOf({}, base), "ativo");
  assert.equal(lifecycleOf({ endedAt: "2026-10-01" }, base), "churn");
  assert.equal(lifecycleOf({}, { ...base, subs: [{ status: "canceled" }] }), "churn");
  assert.equal(lifecycleOf({}, { ...base, onboardings: [{ stage: "configuracao" }] }), "integracao");
  assert.equal(lifecycleOf({}, { ...base, onboardings: [{ stage: "concluida" }] }), "ativo");
  assert.equal(lifecycleOf({}, { ...base, financialStatus: "inadimplente" }), "risco");
  assert.equal(lifecycleOf({ health: 30 }, base), "risco");
  assert.equal(lifecycleOf({ health: 0 }, base), "ativo", "health 0 = ainda não calculado");
});

test("mudança de estágio grava no cliente e vira item datado da timeline; sem mudança não grava", async () => {
  const repo = makeMemRepo();
  const c = await repo.create("customers", { name: "Loja" });
  await repo.create("subscriptions", { customer: c.id, status: "active" });
  await repo.create("invoices", { customer: c.id, status: "open" });
  const now = new Date("2026-10-20T12:00:00Z");
  const saved = await refreshLifecycle(repo, c, { now });
  assert.equal(saved.lifecycle, "ativo");
  assert.equal(saved.financialStatus, "aguardando_pagamento");
  assert.equal((await repo.list(TIMELINE)).length, 2);

  const again = await refreshLifecycle(repo, saved, { now });
  assert.equal(again, saved, "nada mudou, nada gravado");
  assert.equal((await repo.list(TIMELINE)).length, 2);

  const inv = (await repo.list("invoices"))[0];
  await repo.update("invoices", inv.id, { status: "overdue" });
  const later = await refreshLifecycle(repo, saved, { now: new Date("2026-10-21T12:00:00Z") });
  assert.equal(later.financialStatus, "inadimplente");
  assert.equal(later.lifecycle, "risco");
  const tl = (await repo.list(TIMELINE)).filter((t) => t.at === "2026-10-21T12:00:00.000Z");
  assert.deepEqual(tl.map((t) => [t.kind, t.data.from, t.data.to]).sort(), [
    ["customer.financial_status_changed", "aguardando_pagamento", "inadimplente"],
    ["customer.lifecycle_changed", "ativo", "risco"],
  ]);
});

test("workspaces saem do vínculo do cliente e das orgs do LeverAds, inclusive as sem cliente", async () => {
  const repo = makeMemRepo();
  const c = await repo.create("customers", { name: "Loja", leveradsOrgId: "ORG-A", leverpriceOrgId: "lp-1" });
  await repo.create("leverads_orgs", { id: "org-a", name: "Loja", customerId: c.id });
  await repo.create("leverads_orgs", { id: "org-b", name: "Grátis", customerId: "" });
  await repo.create("leverads_orgs", { id: "org-c", name: "Sumiu", gone: true });
  const r = await runLifecycleSweep(repo);
  assert.equal(r.workspaces, 3);
  const ws = Object.fromEntries((await repo.list("workspaces")).map((w) => [w.id, w.customer]));
  assert.deepEqual(ws, { "leverads:org-a": c.id, "leverads:org-b": "", "leverprice:lp-1": c.id });
  assert.equal((await runLifecycleSweep(repo)).written, 0, "segunda passada não regrava");
});

test("evento com lever_id grava o LeverId no lead e no contato que casou pelo e-mail, sem trocar o que já existe", async () => {
  const repo = makeMemRepo();
  const lead = await repo.create("leads", { name: "Ana", saas: "leverads", email: "ana@loja.test" });
  const c = await repo.create("customers", { name: "Loja", leadId: lead.id, contacts: [{ name: "Ana", email: "ana@loja.test" }, { name: "Bia", email: "bia@loja.test", leverId: "lid-velho" }] });
  await repo.update("leads", lead.id, { customerId: c.id });
  const ev = await repo.create(EVENTS, { id: "leverid:evt-0001", source: "leverid", type: "user.signed_up", occurredAt: "2026-10-20T00:00:00Z", leverId: "lid-ana", subject: { email: "ana@loja.test" }, payload: {}, status: "pending", attempts: 0 });
  assert.equal((await processEvent(repo, ev)).status, "processed");
  assert.equal((await repo.get("leads", lead.id)).leverId, "lid-ana");
  const contacts = (await repo.get("customers", c.id)).contacts;
  assert.deepEqual(contacts.map((x) => x.leverId), ["lid-ana", "lid-velho"]);
});

test("perfil do cliente e edição de contatos com validação", async () => {
  const repo = makeMemRepo();
  const c = await repo.create("customers", { name: "Loja", email: "dono@loja.test", fiscal: { tipo: "PJ", nome: "Loja LTDA", documento: "12.345.678/0001-90" }, leveradsOrgId: "org-1" });
  await repo.create("workspaces", { id: "leverads:org-1", product: "leverads", tenantId: "org-1", customer: c.id });
  const app = Fastify();
  registerLifecycleRoutes(app, repo);
  await app.ready();
  const p = (await app.inject({ url: `/api/customers/${c.id}/profile` })).json();
  assert.equal(p.company.cnpj, "12.345.678/0001-90");
  assert.equal(p.company.domain, "loja.test");
  assert.equal(p.workspaces.length, 1);

  const bad = await app.inject({ method: "PUT", url: `/api/customers/${c.id}/contacts`, payload: { contacts: [{ name: "X", email: "naoemail" }] } });
  assert.equal(bad.statusCode, 400);
  const two = await app.inject({ method: "PUT", url: `/api/customers/${c.id}/contacts`, payload: { contacts: [{ name: "A", primary: true }, { name: "B", primary: true }] } });
  assert.equal(two.statusCode, 400);
  const ok = await app.inject({ method: "PUT", url: `/api/customers/${c.id}/contacts`, payload: { contacts: [{ name: "Fin", email: "FIN@loja.test", role: "financeiro", leverId: "forjado" }] } });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json().contacts, [{ name: "Fin", email: "fin@loja.test", phone: "", role: "financeiro", primary: false, leverId: "" }]);
});
