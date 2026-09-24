// Motor do espelho com o Linear: a fila de saída (linear_outbox), o drenar com
// backoff e a reconciliação periódica.
//
// Por que fila, e não chamada direta na rota: o atendente não pode esperar o
// Linear responder pra ver a resposta dele gravada, e uma instabilidade lá não
// pode derrubar o atendimento aqui. O gancho de tickets-core (setTicketSink) só
// MARCA o ticket como sujo; o drenar recalcula o espelho inteiro a partir do
// doc do ticket, então uma passada perdida se resolve na seguinte.
//
// A reconciliação é a rede de segurança do webhook: de tempos em tempos lê as
// issues do projeto mudadas desde o último cursor e aplica estado e comentários
// que não chegaram (deploy no meio da entrega, instabilidade, webhook não
// cadastrado). Sem LINEAR_API_KEY, tudo isto fica dormente.

import { ACTOR_LINEAR, loadSettings, setTicketSink } from "./tickets-core.js";
import { OUTBOX, syncTicketToLinear, applyLinearIssue, applyLinearComment, importLinearIssue } from "./ticket-linear.js";
import { defaultLinear } from "./linear.js";

const MAX_ATTEMPTS = 10;
const CURSOR = (saas) => `linear_cursor_${saas}`;
const rowId = (ticketId) => `lq_${ticketId}`;
const backoffMs = (attempts) => Math.min(30 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));

// Upsert por ticket: dez mensagens seguidas num ticket viram UMA linha na fila
// (o espelho é calculado pelo estado, não por evento). `nextAt` vai pra mais
// cedo, nunca pra mais tarde — o pedido novo não fica preso no backoff do erro.
export async function enqueueTicketSync(repo, ticketId, { saas = "", at = new Date().toISOString(), reset = false } = {}) {
  const id = rowId(ticketId);
  const cur = await repo.get(OUTBOX, id).catch(() => null);
  if (!cur) return repo.create(OUTBOX, { id, ticket: String(ticketId), saas, attempts: 0, nextAt: at, at, lastError: "" });
  const nextAt = reset || !cur.nextAt || at < cur.nextAt ? at : cur.nextAt;
  return repo.update(OUTBOX, id, {
    nextAt, at, saas: saas || cur.saas,
    ...(reset ? { attempts: 0, dead: false, lastError: "" } : {}),
  }, { silent: true });
}

export function startLinearSync(repo, {
  linear = defaultLinear, log = console, baseUrl = process.env.COCKPIT_PUBLIC_URL || process.env.PUBLIC_BASE_URL || "",
  intervalMs = 30_000, reconcileMs = 10 * 60_000, autoStart = true,
} = {}) {
  if (!linear?.configured?.()) {
    log?.info?.("linear: sem LINEAR_API_KEY — espelho de tickets desligado");
    return { stop: () => {}, drain: async () => ({ done: 0, failed: 0 }), reconcile: async () => ({ issues: 0 }), enabled: false };
  }

  // Cache curto de "este produto espelha?": o gancho roda em TODA escrita de
  // ticket e não pode pagar duas leituras de configuração por mensagem.
  const enabledCache = new Map();
  const mirrors = async (saas, ttlMs = 30_000) => {
    const hit = enabledCache.get(saas);
    if (hit && Date.now() - hit.at < ttlMs) return hit.on;
    const s = await loadSettings(repo, saas).catch(() => null);
    const on = !!(s?.linear?.enabled && s.linear.teamId);
    enabledCache.set(saas, { on, at: Date.now() });
    return on;
  };

  // O que ENTROU do Linear não volta pro Linear (anti-ping-pong).
  const unsubscribe = setTicketSink(async (r, ticket, events, ctx) => {
    if (ctx?.by === ACTOR_LINEAR) return;
    if (!(await mirrors(ticket.saas))) return;
    await enqueueTicketSync(r, ticket.id, { saas: ticket.saas, at: ctx?.now || new Date().toISOString() });
  });

  async function drain({ now = new Date().toISOString(), cap = 50 } = {}) {
    const rows = (await repo.list(OUTBOX).catch(() => []))
      .filter((r) => !r.dead && String(r.nextAt || "") <= now)
      .slice(0, cap);
    const out = { done: 0, failed: 0 };
    for (const row of rows) {
      try {
        await syncTicketToLinear(repo, row.ticket, { linear, baseUrl, log });
        await repo.remove(OUTBOX, row.id);
        out.done++;
      } catch (err) {
        const attempts = (Number(row.attempts) || 0) + 1;
        const dead = attempts >= MAX_ATTEMPTS;
        await repo.update(OUTBOX, row.id, {
          attempts, dead,
          nextAt: new Date(Date.now() + backoffMs(attempts)).toISOString(),
          lastError: String(err?.message || err).slice(0, 300),
        }, { silent: true });
        // Desistiu: o erro fica no ticket pra tela mostrar "não sincronizou".
        if (dead) {
          const t = await repo.get("tickets", row.ticket).catch(() => null);
          if (t) await repo.update("tickets", t.id, { linear: { ...(t.linear || {}), error: String(err?.message || err).slice(0, 300) } }, { silent: true });
          log?.warn?.(`linear: desisti do ticket ${row.ticket} após ${attempts} tentativas — ${err.message}`);
        }
        out.failed++;
      }
    }
    return out;
  }

  // Issues mudadas desde o último cursor, por produto que espelha. O cursor
  // anda pelo maior updatedAt visto (não pelo relógio local), pra não pular
  // nada por diferença de horário entre o Linear e a máquina.
  async function reconcile({ now = new Date() } = {}) {
    const out = { issues: 0, comments: 0, imported: 0 };
    const products = await repo.list("products").catch(() => []);
    for (const p of products) {
      const settings = await loadSettings(repo, p.id).catch(() => null);
      const cfg = settings?.linear;
      if (!cfg?.enabled || !cfg.teamId) continue;
      const doc = await repo.get("app_config", CURSOR(p.id)).catch(() => null);
      const since = doc?.value || new Date(now.getTime() - 24 * 3600_000).toISOString();
      let issues = [];
      try {
        issues = await linear.issuesUpdatedSince(since, { teamId: cfg.teamId, projectId: cfg.projectId });
      } catch (err) { log?.warn?.(`linear reconcilia (${p.id}): ${err.message}`); continue; }
      let cursor = since;
      for (const issue of issues) {
        try {
          const applied = await applyLinearIssue(repo, issue, { log, linear });
          if (!applied) {
            // Card aberto direto no projeto do suporte: vira ticket aqui (se o
            // webhook já não tiver criado).
            const projectId = issue.project?.id || "";
            if (cfg.projectId && projectId === cfg.projectId) {
              const r = await importLinearIssue(repo, issue, { saas: p.id, log, linear });
              if (r?.created) out.imported++;
            }
          } else {
            out.issues++;
            for (const c of issue.comments?.nodes || []) {
              const r = await applyLinearComment(repo, { issueId: issue.id, comment: c, log });
              if (r?.comment) out.comments++;
            }
          }
        } catch (err) { log?.warn?.(`linear reconcilia issue ${issue.identifier || issue.id}: ${err.message}`); }
        if (issue.updatedAt && issue.updatedAt > cursor) cursor = issue.updatedAt;
      }
      if (cursor !== since) {
        if (doc) await repo.update("app_config", CURSOR(p.id), { value: cursor }, { silent: true });
        else await repo.create("app_config", { id: CURSOR(p.id), value: cursor });
      }
    }
    return out;
  }

  let draining = false, reconciling = false;
  const runDrain = async () => {
    if (draining) return null;
    draining = true;
    try { return await drain(); }
    catch (err) { log?.warn?.(`linear drenar: ${err.message}`); return null; }
    finally { draining = false; }
  };
  const runReconcile = async () => {
    if (reconciling) return null;
    reconciling = true;
    try { return await reconcile(); }
    catch (err) { log?.warn?.(`linear reconciliar: ${err.message}`); return null; }
    finally { reconciling = false; }
  };

  let t1 = null, t2 = null, first = null;
  if (autoStart) {
    t1 = setInterval(runDrain, intervalMs); t1.unref?.();
    t2 = setInterval(runReconcile, reconcileMs); t2.unref?.();
    first = setTimeout(runReconcile, 55_000); first.unref?.(); // depois das migrações
  }
  return {
    enabled: true, drain, reconcile, runDrain, runReconcile,
    stop: () => { unsubscribe(); clearInterval(t1); clearInterval(t2); clearTimeout(first); },
  };
}
