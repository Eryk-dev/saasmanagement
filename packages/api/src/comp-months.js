// Carimbo mensal da remuneração: o registro do que o mês fechou.
//
// O placar é sempre AO VIVO, e é assim que ele tem que ser: o número do mês
// corrente muda o dia inteiro. Só que folha não se paga em número que muda. Um
// pagamento MP espelhado em outubro mexe na receita de setembro; um wonAt
// corrigido mexe nos contratos; e ninguém fica sabendo que o valor pago não
// bate mais com a tela.
//
// Aqui, no dia seguinte ao fim do mês, o resultado de cada pessoa é CONGELADO:
// contratos e receita contra a meta que valia pra ela naquele mês, se bateu
// 100%, e se o bônus de time saiu. É o extrato da folha e a matéria-prima do
// critério de promoção (3 meses seguidos a 100%), que não pode depender de
// recalcular o passado a cada abertura de tela.

import { computeScoreboard, teamBonusStatus } from "./routes.scoreboard.js";
import { teamBonusOf, compLevelOf } from "./comp-plan.js";
import { brtToday } from "./tasks-core.js";

const STATE_DOC = "comp_months";
const MAX_BACKFILL = 3; // meses fechados que a primeira execução carimba

export const monthKey = (at) => new Date(at).toISOString().slice(0, 7);
export const monthHeaderId = (saas, month) => `cm_${saas}_${month}`;
export const monthPersonId = (saas, month, uid, role) => `cm_${saas}_${month}_${uid}_${role}`;

const firstDay = (month) => `${month}-01`;
const lastDay = (month) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
const prevMonth = (month) => {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

// Meta do mês de uma pessoa a partir do card do placar. O card já resolveu a
// cadeia inteira (ajuste por pessoa > nível do plano > vaga > derivado) e diz
// por qual delas: o carimbo guarda o número que a pessoa foi cobrada, não o do
// plano em abstrato.
const targetOf = (card, metric) => {
  const g = card?.goals?.[metric];
  const t = Number(g?.target);
  return Number.isFinite(t) && t > 0 ? t : null;
};

const EPS = 1e-9;
export const hit100 = (valor, meta) => meta != null && Number(valor) >= meta - EPS;

// Carimba um mês. Sobrescreve se já existir (é o "recalcular mês" da tela).
export async function stampCompMonth(repo, product, month, { now = new Date(), by = "system", users = null } = {}) {
  const since = firstDay(month);
  const until = lastDay(month);
  const board = await computeScoreboard(repo, product, { since, until }, { now: () => now });
  const team = await teamBonusStatus(repo, product, until, { now }).catch(() => null);
  const compDocs = await repo.list("comp_plans").catch(() => []);
  const todos = users || await repo.list("users").catch(() => []);
  const userById = new Map(todos.map((u) => [u.id, u]));

  const header = {
    id: monthHeaderId(product.id, month),
    kind: "month", saas: product.id, month,
    stampedAt: new Date(now).toISOString(), by,
    teamBonus: team || { applies: false },
  };
  await repo.remove("comp_months", header.id).catch(() => {});
  await repo.create("comp_months", header);

  const pago = !!team?.applies && !!team?.ok;
  let pessoas = 0;
  for (const role of ["sdr", "closer", "cs", "social"]) {
    for (const card of board[role] || []) {
      const uid = card.user;
      if (!uid) continue;
      const level = compLevelOf(userById.get(uid));
      const valorTime = pago ? teamBonusOf(compDocs, role === "cs" ? "integrator" : role, level) : 0;
      const wonTarget = targetOf(card, "won");
      const revenueTarget = targetOf(card, "revenue");
      const won = Number(card.won) || 0;
      const revenue = Number(card.revenue) || 0;
      const id = monthPersonId(product.id, month, uid, role);
      await repo.remove("comp_months", id).catch(() => {});
      await repo.create("comp_months", {
        id, kind: "person", saas: product.id, month, uid, role, level,
        won, wonTarget, revenue, revenueTarget,
        contractsAtt: wonTarget ? Math.round((won / wonTarget) * 1000) / 1000 : null,
        revenueAtt: revenueTarget ? Math.round((revenue / revenueTarget) * 1000) / 1000 : null,
        // 100% do mês só existe pra quem tem as DUAS pernas (SDR e closer). CS e
        // mídia social não são vagas com nível, então o campo fica null em vez
        // de um `false` que pareceria "não bateu".
        hit100: (role === "sdr" || role === "closer") && wonTarget != null && revenueTarget != null
          ? hit100(won, wonTarget) && hit100(revenue, revenueTarget)
          : null,
        teamBonusValue: valorTime,
        teamBonusPaid: pago,
      });
      pessoas++;
    }
  }
  return { month, pessoas, teamBonusPaid: pago };
}

// Meses FECHADOS ainda sem carimbo, do mais antigo pro mais novo, no teto do
// backfill (a primeira execução não reescreve a história inteira da base).
export async function pendingMonths(repo, product, { now = new Date(), max = MAX_BACKFILL } = {}) {
  const hoje = brtToday(now);
  const feitos = new Set((await repo.list("comp_months").catch(() => []))
    .filter((d) => d.kind === "month" && d.saas === product.id)
    .map((d) => d.month));
  const meses = [];
  let m = prevMonth(monthKey(hoje));
  for (let i = 0; i < max; i++) {
    if (!feitos.has(m)) meses.push(m);
    m = prevMonth(m);
  }
  return meses.reverse();
}

export function startCompMonthClose(repo, {
  log, hour = Number(process.env.COMP_CLOSE_HOUR || 6), intervalMs = 10 * 60 * 1000, now = () => new Date(),
} = {}) {
  let running = false;

  async function tick(at = now()) {
    const spHour = new Date(at.getTime() - 3 * 3600 * 1000).getUTCHours(); // SP = UTC-3 fixo
    if (spHour < hour) return null;
    const hoje = brtToday(at);
    const state = await repo.get("app_config", STATE_DOC).catch(() => null);
    if (state?.lastRunDay === hoje) return null;

    const products = await repo.list("products").catch(() => []);
    const users = await repo.list("users").catch(() => []);
    let carimbados = 0;
    for (const product of products) {
      for (const month of await pendingMonths(repo, product, { now: at })) {
        await stampCompMonth(repo, product, month, { now: at, by: "runner", users });
        carimbados++;
      }
    }
    if (state) await repo.update("app_config", STATE_DOC, { lastRunDay: hoje }, { silent: true });
    else await repo.create("app_config", { id: STATE_DOC, lastRunDay: hoje });
    return { carimbados };
  }

  const run = async () => {
    if (running) return null;
    running = true;
    try { return await tick(); }
    catch (err) { log?.warn?.(`comp month close: ${err.message}`); return null; }
    finally { running = false; }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  const first = setTimeout(run, 130_000);
  first.unref?.();
  return { tick, run, stop: () => { clearInterval(timer); clearTimeout(first); } };
}
