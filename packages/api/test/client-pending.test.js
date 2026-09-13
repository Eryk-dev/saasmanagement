// Compromissos do cliente na integração: o que vira tarefa, com que prazo, pra
// quem, e como o carimbo do card acompanha o quadro.
import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import {
  syncClientPending, restampClientPending, dueFor, pendingKey, isClientItem, lateOurs,
  CLIENT_PENDING_LABEL,
} from "../src/client-pending.js";
import { completeTask, patchTask } from "../src/tasks-core.js";

// Terça, 08/09/2026, 13h UTC (10h de São Paulo).
const TER = new Date(Date.UTC(2026, 8, 8, 13));
// Sexta, 11/09/2026.
const SEX = new Date(Date.UTC(2026, 8, 11, 13));

const resumo = (pendencias, extra = {}) => ({
  pendencias,
  followup: { whatsapp: "Oi! Ficou faltando só o acesso pra eu subir os anúncios.", nota: "", quando: "" },
  ...extra,
});

async function base({ lead = {} } = {}) {
  const repo = makeMemRepo();
  await repo.create("users", { id: "eryk", roles: ["integrator"] });
  const l = await repo.create("leads", {
    id: "ld_1", saas: "leverads", name: "Ana", company: "Lupa Auto Peças",
    phone: "5541999990000", integrator: "eryk", stage: "Integração", ...lead,
  });
  return { repo, lead: l };
}

// ── Régua ─────────────────────────────────────────────────────────────────
test("isClientItem: só o que é do cliente entra", () => {
  assert.equal(isClientItem({ item: "x", responsavel: "cliente" }), true);
  assert.equal(isClientItem({ item: "x", responsavel: "Cliente (Ana)" }), true);
  assert.equal(isClientItem({ item: "x", responsavel: "equipe" }), false);
  assert.equal(isClientItem({ item: "x", responsavel: "" }), false);
  assert.equal(isClientItem("texto solto"), false);
});

test("dueFor: 2 dias úteis, e sexta cai na terça (não no domingo)", () => {
  assert.equal(dueFor(TER), "2026-09-10"); // ter → qui
  assert.equal(dueFor(SEX), "2026-09-15"); // sex → ter
});

test("pendingKey: mesma frase com caixa e espaço diferentes dá a mesma chave", () => {
  assert.equal(pendingKey("ld_1", "Conectar a conta"), pendingKey("ld_1", "  CONECTAR A CONTA "));
  assert.notEqual(pendingKey("ld_1", "Conectar a conta"), pendingKey("ld_2", "Conectar a conta"));
});

test("lateOurs: compromisso da etapa vencido é atraso NOSSO", () => {
  const agora = TER.getTime();
  assert.equal(lateOurs({ integrationAt: new Date(agora - 3600_000).toISOString() }, agora), true);
  assert.equal(lateOurs({ integrationAt: new Date(agora + 3600_000).toISOString() }, agora), false);
  assert.equal(lateOurs({}, agora), false);
});

// ── Criação ───────────────────────────────────────────────────────────────
test("cria uma tarefa por compromisso do cliente, com prazo, dono e mensagem pronta", async () => {
  const { repo, lead } = await base();
  const r = await syncClientPending(repo, lead, resumo([
    { item: "Conectar a conta 2 do Mercado Livre", responsavel: "cliente" },
    { item: "Subir as fotos novas", responsavel: "cliente" },
    { item: "Revisar as regras de preço", responsavel: "equipe" },
  ]), { now: () => TER });
  assert.equal(r.created, 2);
  const tasks = await repo.list("tasks");
  assert.equal(tasks.length, 2);
  const t = tasks.find((x) => x.title.includes("Conectar"));
  assert.equal(t.title, "Cliente: Conectar a conta 2 do Mercado Livre");
  assert.deepEqual(t.labels, [CLIENT_PENDING_LABEL]);
  assert.equal(t.dueDate, "2026-09-10");
  assert.deepEqual(t.assignees, ["eryk"]);
  assert.equal(t.lead, "ld_1");
  assert.match(t.description, /Lupa Auto Peças ficou de conectar/);
  assert.match(t.description, /Ficou faltando só o acesso/);
  assert.match(t.description, /wa\.me\/5541999990000/);
});

test("re-resumir a mesma call não duplica as tarefas", async () => {
  const { repo, lead } = await base();
  const pend = [{ item: "Conectar a conta 2", responsavel: "cliente" }];
  await syncClientPending(repo, lead, resumo(pend), { now: () => TER });
  const r2 = await syncClientPending(repo, lead, resumo(pend), { now: () => TER });
  assert.equal(r2.created, 0);
  assert.equal((await repo.list("tasks")).length, 1);
});

test("sem integrador no lead, o dono da conta assume", async () => {
  const { repo, lead } = await base({ lead: { integrator: "" } });
  await syncClientPending(repo, lead, resumo([{ item: "Mandar o catálogo", responsavel: "cliente" }]), {
    now: () => TER, customer: { owner: "vitor" },
  });
  assert.deepEqual((await repo.list("tasks"))[0].assignees, ["vitor"]);
});

test("resumo sem compromisso do cliente não cria nada nem carimba", async () => {
  const { repo, lead } = await base();
  const r = await syncClientPending(repo, lead, resumo([{ item: "Ajustar título", responsavel: "equipe" }]), { now: () => TER });
  assert.equal(r.created, 0);
  assert.equal((await repo.list("tasks")).length, 0);
  assert.equal((await repo.get("leads", "ld_1")).clientPending, undefined);
});

// ── Carimbo ───────────────────────────────────────────────────────────────
test("carimbo do lead: contagem, atrasadas e o próximo vencimento", async () => {
  const { repo, lead } = await base();
  await syncClientPending(repo, lead, resumo([
    { item: "Conectar a conta 2", responsavel: "cliente" },
    { item: "Subir as fotos", responsavel: "cliente" },
  ]), { now: () => TER });
  const pend = (await repo.get("leads", "ld_1")).clientPending;
  assert.equal(pend.open, 2);
  assert.equal(pend.overdue, 0);
  assert.equal(pend.nextDue, "2026-09-10");
  assert.equal(pend.items.length, 2);
  // Uma semana depois, as duas estão vencidas.
  const depois = await restampClientPending(repo, "ld_1", { now: () => new Date(Date.UTC(2026, 8, 18, 13)) });
  assert.equal(depois.overdue, 2);
});

test("concluir a tarefa no quadro tira o chip do card; reabrir traz de volta", async () => {
  const { repo, lead } = await base();
  await syncClientPending(repo, lead, resumo([{ item: "Conectar a conta 2", responsavel: "cliente" }]), { now: () => TER });
  const t = (await repo.list("tasks"))[0];
  await completeTask(repo, t.id, true, { by: "eryk" });
  assert.equal((await repo.get("leads", "ld_1")).clientPending, null);
  await completeTask(repo, t.id, false, { by: "eryk" });
  assert.equal((await repo.get("leads", "ld_1")).clientPending.open, 1);
});

test("conclusão por qualquer caminho (PATCH da tarefa) também recarimba", async () => {
  const { repo, lead } = await base();
  await syncClientPending(repo, lead, resumo([{ item: "Subir as fotos", responsavel: "cliente" }]), { now: () => TER });
  const t = (await repo.list("tasks"))[0];
  await patchTask(repo, t.id, { completed: true }, { by: "eryk" });
  assert.equal((await repo.get("leads", "ld_1")).clientPending, null);
});

test("tarefa comum do lead não mexe no carimbo de compromissos do cliente", async () => {
  const { repo, lead } = await base();
  await syncClientPending(repo, lead, resumo([{ item: "Conectar a conta 2", responsavel: "cliente" }]), { now: () => TER });
  const { createTask } = await import("../src/tasks-core.js");
  const outra = await createTask(repo, { saas: "leverads", title: "Ligar pro cliente", lead: "ld_1" }, { by: "eryk" });
  await completeTask(repo, outra.id, true, { by: "eryk" });
  assert.equal((await repo.get("leads", "ld_1")).clientPending.open, 1);
});
