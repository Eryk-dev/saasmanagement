// Vigia do SLA dos tickets: a fila mostra o relógio, mas quem não está com a
// tela aberta precisa saber que o prazo está acabando. A cada tick:
//   · aviso a `warnAt` (80% por padrão) e estouro de cada relógio (1ª resposta
//     e resolução) viram notificação do responsável — ou, sem responsável, dos
//     atendentes do produto;
//   · estouro fica gravado no ticket (`sla.breached`), com evento na atividade;
//   · ticket resolvido há `autoCloseResolvedDays` dias fecha sozinho.
//
// Mesmo espírito do wa-waiting-reminder: best-effort, nunca derruba o servidor.
// Dedup por chave (ticket + relógio + estado + prazo + pessoa): mudar a
// prioridade gera prazo novo e, portanto, aviso novo. Avisos só no expediente
// do produto; o estouro é gravado a qualquer hora.

import { upsertNotification, withTaskLock } from "./tasks-core.js";
import { STATUS_KIND, loadSettings, patchTicket, recordTicketEvents, agentsOf, ticketTitle } from "./tickets-core.js";
import { slaState, isWithinHours } from "./tickets-sla.js";
import { canHandleSaas } from "./support-scope.js";

const DAY = 86_400_000;
const CLOCKS = { firstResponse: { due: "firstResponseDue", label: "1ª resposta" }, resolution: { due: "resolutionDue", label: "resolução" } };
const FMT = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function startTicketSla(repo, { log, intervalMs = 5 * 60 * 1000, now = () => new Date(), autoStart = true } = {}) {
  let running = false;

  async function tick(at = now()) {
    const nowIso = at.toISOString();
    const [tickets, users] = await Promise.all([repo.list("tickets").catch(() => []), repo.list("users").catch(() => [])]);
    const settingsCache = new Map();
    const settingsOf = async (saas) => {
      if (!settingsCache.has(saas)) settingsCache.set(saas, await loadSettings(repo, saas));
      return settingsCache.get(saas);
    };
    const out = { warned: 0, breached: 0, closed: 0 };

    for (const t of tickets) {
      const settings = await settingsOf(t.saas);
      const kind = STATUS_KIND[t.status];

      if (kind === "done") {
        const days = settings.autoCloseResolvedDays;
        const resolvedAt = new Date(t.sla?.resolvedAt || 0).getTime();
        if (t.status === "resolved" && days > 0 && resolvedAt && at.getTime() - resolvedAt >= days * DAY) {
          await patchTicket(repo, t.id, { status: "closed" }, { by: "api", now: nowIso });
          out.closed++;
        }
        continue;
      }

      const state = slaState(t, nowIso, { warnAt: settings.warnAt });
      const title = ticketTitle(t);
      const inHours = isWithinHours(at, settings.businessHours);
      for (const [clock, meta] of Object.entries(CLOCKS)) {
        const st = state[clock];
        if (st !== "warning" && st !== "breached") continue;
        const due = t.sla?.[meta.due] || "";

        if (st === "breached" && !t.sla?.breached?.[clock]) {
          await withTaskLock(`ticket:${t.id}`, async () => {
            const cur = await repo.get("tickets", t.id);
            if (!cur || cur.sla?.breached?.[clock]) return;
            const sla = { ...(cur.sla || {}), breached: { ...(cur.sla?.breached || {}), [clock]: true } };
            await repo.update("tickets", t.id, { sla });
            await recordTicketEvents(repo, cur, [{ type: "sla_breached", data: { clock, due } }], { by: "api", now: nowIso });
          });
          out.breached++;
        }

        if (!inHours) continue;
        const recipients = (t.assignee ? users.filter((u) => u.id === t.assignee) : agentsOf(users, t.saas))
          .filter((u) => canHandleSaas(u, t.saas));
        for (const u of recipients) {
          const key = `ticket-sla:${t.id}:${clock}:${st}:${due}:${u.id}`;
          if ((await repo.listWhere("notifications", { key }, { fields: [] })).length) continue;
          const text = st === "warning"
            ? `O prazo de ${meta.label} de ${title} vence ${FMT.format(new Date(due))}`
            : `SLA estourado: ${title} passou do prazo de ${meta.label}`;
          await upsertNotification(repo, {
            user: u.id, type: st === "warning" ? "ticket_sla_warning" : "ticket_sla_breach",
            task: t.id, taskTitle: title, saas: t.saas, by: "api", key, text,
            link: { screen: "tickets", thread: t.id },
          }, { now: nowIso });
          if (st === "warning") out.warned++;
        }
      }
    }
    return out;
  }

  const run = async () => {
    if (running) return null;
    running = true;
    try { return await tick(); }
    catch (err) { log?.warn?.(`ticket sla: ${err.message}`); return null; }
    finally { running = false; }
  };
  let timer = null, first = null;
  if (autoStart) {
    timer = setInterval(run, intervalMs);
    timer.unref?.();
    first = setTimeout(run, 50_000); // depois das migrações e dos outros lembretes
    first.unref?.();
  }
  return { tick, run, stop: () => { clearInterval(timer); clearTimeout(first); } };
}
