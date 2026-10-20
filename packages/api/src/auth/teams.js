// Times — Fase 2 do plano do Lever CRM. Um time é um grupo de pessoas de um
// produto com uma função (SDR, closer, integração, CS, suporte), um gestor e
// os membros. Serve de recorte nas telas (Funcionários filtra por time) e é a
// base para fila e distribuição por time mais tarde; a distribuição de leads
// segue como está (crm/lead-flow.js, autoLeadOwner).
//
// Uma pessoa pode estar em mais de um time (ex.: closer que também faz CS).

import { randomUUID } from "node:crypto";

export const TEAMS = "teams";
export const TEAM_KINDS = ["sdr", "closer", "integracao", "cs", "suporte", "outro"];
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const s = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function cleanTeam(repo, body, cur = null) {
  const src = { ...(cur || {}), ...(body || {}) };
  const name = s(src.name, 60);
  if (!name) throw fail(400, "Dê um nome ao time.");
  const users = new Set((await repo.list("users")).map((u) => u.id));
  const members = [...new Set((Array.isArray(src.members) ? src.members : []).map((m) => s(m, 60)).filter(Boolean))];
  const unknown = members.filter((m) => !users.has(m));
  if (unknown.length) throw fail(400, `Pessoa não encontrada: ${unknown.join(", ")}.`);
  const manager = s(src.manager, 60);
  if (manager && !users.has(manager)) throw fail(400, "Gestor não encontrado.");
  return {
    name, saas: s(src.saas, 40), kind: TEAM_KINDS.includes(src.kind) ? src.kind : "outro",
    // O gestor faz parte do time: entra na lista se não estiver.
    members: manager && !members.includes(manager) ? [manager, ...members] : members,
    manager, status: src.status === "archived" ? "archived" : "active",
  };
}

export async function createTeam(repo, body, { now = new Date() } = {}) {
  return repo.create(TEAMS, { id: "tm_" + randomUUID(), ...(await cleanTeam(repo, body)), createdAt: now.toISOString() });
}

export async function updateTeam(repo, id, body) {
  const cur = await repo.get(TEAMS, id);
  if (!cur) throw fail(404, "Time não encontrado.");
  return repo.update(TEAMS, id, await cleanTeam(repo, body, cur));
}

// Os times ativos de um produto (ou todos), com os de todos os produtos
// (saas vazio) junto.
export async function listTeams(repo, { saas = "", all = false } = {}) {
  return (await repo.list(TEAMS))
    .filter((t) => (all || t.status !== "archived") && (!saas || !t.saas || t.saas === saas))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"));
}
