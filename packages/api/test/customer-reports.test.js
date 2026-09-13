// Relatório mensal de resultado: quem recebe, o que a mensagem diz e o que
// acontece quando o mês foi vazio ou o cliente não tem org vinculada.
import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import {
  reportBlocker, reportEmail, reportWhatsApp, sendCustomerReport, startCustomerReports,
} from "../src/customer-reports.js";

const DAY = 86_400_000;
// 10h de São Paulo (13h UTC) numa terça, pra passar no gate de hora e no expediente.
const HOJE = Date.UTC(2026, 8, 8, 13);
const desde = (d) => new Date(HOJE - d * DAY).toISOString();
const ORG = "11111111-1111-4111-8111-111111111111";

const snap = (over = {}) => ({ gmv30d: 12345.67, orders30d: 38, gmvTotal: 98765.43, listings: 420, ...over });

function fakeMailer(caixa) {
  return { ready: async () => true, send: async (m) => { caixa.push(m); return { id: "m1" }; } };
}

async function base({ customer = {} } = {}) {
  const repo = makeMemRepo();
  await repo.create("users", { id: "eryk", roles: ["integrator"] });
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  const c = await repo.create("customers", {
    id: "cu_1", saas: "leverads", name: "Lupa", contact: "Ana", owner: "eryk",
    startedAt: desde(60), email: "ana@lupa.com.br", phone: "5541999990000",
    leveradsOrgId: ORG, ...customer,
  });
  return { repo, c };
}

// ── Elegibilidade ─────────────────────────────────────────────────────────
test("reportBlocker: cliente novo, sem org, ou com relatório recente não recebe", () => {
  const ok = { saas: "leverads", startedAt: desde(60), leveradsOrgId: ORG };
  assert.equal(reportBlocker(ok, { now: HOJE }), "");
  assert.equal(reportBlocker({ ...ok, startedAt: desde(10) }, { now: HOJE }), "cliente há menos de 30 dias");
  assert.equal(reportBlocker({ ...ok, leveradsOrgId: "" }, { now: HOJE }), "sem org da LeverAds no cadastro");
  assert.equal(reportBlocker(ok, { now: HOJE, lastAt: new Date(HOJE - 10 * DAY).toISOString() }), "relatório enviado há menos de 30 dias");
  assert.equal(reportBlocker(ok, { now: HOJE, lastAt: new Date(HOJE - 40 * DAY).toISOString() }), "");
  assert.equal(reportBlocker({ ...ok, saas: "uniquekids" }, { now: HOJE }), "fora da régua");
  assert.equal(reportBlocker({ ...ok, endedAt: desde(2) }, { now: HOJE }), "fora da régua");
});

// ── Mensagem ──────────────────────────────────────────────────────────────
test("mensagem: fala do influenciado, cita pedidos e o acumulado", () => {
  const c = { name: "Lupa", contact: "Ana" };
  const mail = reportEmail(c, snap());
  assert.match(mail.subject, /R\$ 12\.345,67 vendidos pelos anúncios/);
  assert.match(mail.text, /^Oi, Ana\./);
  assert.match(mail.text, /38 pedidos/);
  assert.match(mail.text, /Desde o começo já são R\$ 98\.765,43 e 420 anúncios/);
  const wa = reportWhatsApp(c, snap());
  assert.match(wa, /^Oi Ana, resumo dos seus últimos 30 dias/);
  assert.match(wa, /na conta Lupa/);
  assert.ok(!wa.includes("—"), "copy não usa travessão");
});

test("mensagem: 1 pedido no singular e acumulado igual ao mês não repete a frase", () => {
  const wa = reportWhatsApp({ name: "Lupa" }, snap({ orders30d: 1, gmvTotal: 12345.67 }));
  assert.match(wa, /\(1 pedido\)/);
  assert.ok(!wa.includes("Desde o começo"));
});

// ── Envio ─────────────────────────────────────────────────────────────────
test("envio: e-mail sai sozinho e o relatório fica registrado", async () => {
  const caixa = [];
  const { repo, c } = await base();
  const doc = await sendCustomerReport(repo, c, snap(), { mailer: fakeMailer(caixa), now: () => new Date(HOJE) });
  assert.equal(doc.status, "sent");
  assert.equal(doc.email, "sent");
  assert.equal(doc.gmv30d, 12345.67);
  assert.equal(doc.periodEnd, "2026-09-08");
  assert.equal(caixa.length, 1);
  assert.equal((await repo.list("tasks")).length, 0);
});

test("envio: dentro da janela de 24h também sai pelo WhatsApp", async () => {
  const { repo, c } = await base({ customer: { email: "" } });
  await repo.create("wa_threads", { id: "5541999990000", lastDir: "in", lastAt: new Date(HOJE - 3600_000).toISOString() });
  const enviados = [];
  const doc = await sendCustomerReport(repo, c, snap(), {
    whatsapp: { sendText: async (to, text) => { enviados.push({ to, text }); return {}; } },
    now: () => new Date(HOJE),
  });
  assert.equal(doc.whatsapp, "sent");
  assert.equal(enviados.length, 1);
  assert.equal((await repo.list("tasks")).length, 0);
});

test("envio: sem canal nenhum vira tarefa com o texto pronto", async () => {
  const { repo, c } = await base({ customer: { email: "" } });
  const doc = await sendCustomerReport(repo, c, snap(), { now: () => new Date(HOJE) });
  assert.equal(doc.whatsapp, "task");
  const t = (await repo.list("tasks"))[0];
  assert.equal(t.title, "Mandar o resultado do mês pra Lupa");
  assert.deepEqual(t.assignees, ["eryk"]);
  assert.match(t.description, /wa\.me\/5541999990000/);
  assert.equal(doc.taskId, t.id);
});

test("envio: mês sem venda influenciada não manda nada, só registra", async () => {
  const caixa = [];
  const { repo, c } = await base();
  const doc = await sendCustomerReport(repo, c, snap({ gmv30d: 0 }), { mailer: fakeMailer(caixa), now: () => new Date(HOJE) });
  assert.equal(doc.status, "skipped");
  assert.match(doc.reason, /sem venda influenciada/);
  assert.equal(caixa.length, 0);
  assert.equal((await repo.list("tasks")).length, 0);
});

// ── Runner ────────────────────────────────────────────────────────────────
function runner(repo, caixa, over = {}) {
  return startCustomerReports(repo, {
    intervalMs: 1e9, mailer: fakeMailer(caixa), now: () => new Date(HOJE),
    snapshot: async (ids) => new Map(ids.filter(Boolean).map((id) => [String(id), snap()])),
    ...over,
  });
}

test("runner: manda uma vez no dia e não repete no mesmo dia", async () => {
  const caixa = [];
  const { repo } = await base();
  const r = runner(repo, caixa);
  assert.deepEqual(await r.tick(new Date(HOJE)), { sent: 1, skipped: 0, tasks: 0 });
  assert.equal(await r.tick(new Date(HOJE)), null); // trava do dia
  assert.equal(caixa.length, 1);
  r.stop();
});

test("runner: cliente sem org abre UMA tarefa de cadastro, pra sempre", async () => {
  const caixa = [];
  const { repo } = await base({ customer: { leveradsOrgId: "" } });
  const r = runner(repo, caixa);
  assert.deepEqual(await r.tick(new Date(HOJE)), { sent: 0, skipped: 0, tasks: 1 });
  const t = (await repo.list("tasks"))[0];
  assert.equal(t.title, "Vincular a org da LeverAds no cadastro de Lupa");
  // No dia seguinte, com a trava do dia liberada, não abre de novo.
  await repo.update("app_config", "customer_reports", { lastRunDay: "2026-09-07" });
  assert.deepEqual(await r.tick(new Date(HOJE)), { sent: 0, skipped: 0, tasks: 0 });
  assert.equal((await repo.list("tasks")).length, 1);
  r.stop();
});

test("runner: fora do horário do gate não faz nada", async () => {
  const caixa = [];
  const { repo } = await base();
  const r = runner(repo, caixa);
  assert.equal(await r.tick(new Date(Date.UTC(2026, 8, 8, 6))), null); // 3h de SP
  assert.equal(caixa.length, 0);
  r.stop();
});

test("runner: fora do expediente (fim de semana) não manda", async () => {
  const caixa = [];
  const { repo } = await base();
  const r = runner(repo, caixa);
  const sabado = new Date(Date.UTC(2026, 8, 12, 13));
  assert.deepEqual(await r.tick(sabado), { sent: 0, skipped: 0, tasks: 0 });
  assert.equal(caixa.length, 0);
  r.stop();
});
