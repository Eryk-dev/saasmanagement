// Ações do guia do Hermes feitas pelo cockpit: aprovar, pedir ajuste, recusar,
// responder pergunta, desistir da aprovação, reverter, passar para o time e
// entregar um ticket ao Hermes. Tudo vira o que o Hermes já lê no card —
// mudança de coluna ou comentário com o comando na primeira linha — usando a
// chave única do Linear (LINEAR_API_KEY). Quem PODE agir é decidido aqui:
// aprovadores do produto (ticket_settings.linear.hermes.approvers); entregar
// ao Hermes, qualquer um que atende o produto.
//
// A rede roda fora do lock do ticket; o lock `hermes:<id>` só impede o clique
// duplo de mandar dois comentários. O resultado volta ao doc pelo mesmo
// caminho do webhook (applyLinearIssue), sem esperar a entrega do Linear.

import { withTaskLock } from "../tasks/tasks-core.js";
import { canHandleSaas } from "../auth/support-scope.js";
import { httpError, loadSettings, recordTicketEvents, STATUS_KIND } from "./tickets-core.js";
import { applyLinearIssue, rememberPosted, syncTicketToLinear, teamStates } from "./ticket-linear.js";
import { commentFor, hermesView, stateForPhase } from "./ticket-hermes.js";

export const HERMES_ACTIONS = ["aprovar", "ajuste", "recusar", "responder", "perguntar", "desistir", "reverter", "passar_time", "entregar"];
const NEEDS_TEXT = new Set(["ajuste", "recusar", "responder", "perguntar", "reverter"]);
const nowIso = () => new Date().toISOString();

// Em que retrato cada ação faz sentido (guia, página 5). `h` = ticket.hermes.
export function actionAllowed(action, h = {}, cfg = {}) {
  const ativo = !!h.active;
  switch (action) {
    case "aprovar": case "ajuste": case "recusar": return ativo && h.phase === "validar";
    case "responder": return ativo && h.phase === "pergunta";
    case "perguntar": case "passar_time": return !!h.holding;
    case "desistir": return ativo && h.phase === "aprovado" && cfg.publishWindow === "noite";
    case "reverter": return ativo && (h.phase === "no_ar" || (h.phase === "aprovado" && cfg.publishWindow === "imediato"));
    case "entregar": return !ativo && !h.requested;
    default: return false;
  }
}

// O que a tela precisa pra desenhar os botões (sem chamar o Linear).
export function hermesPermissions(ticket, cfg, user) {
  const master = !user;
  const approver = master || (cfg?.approvers || []).includes(user.id);
  const handles = master || canHandleSaas(user, ticket.saas);
  const h = ticket.hermes || {};
  const open = STATUS_KIND[ticket.status] !== "done";
  const on = !!(cfg?.enabled && cfg?.actions);
  const allowed = {};
  for (const a of HERMES_ACTIONS) {
    const quem = a === "entregar" ? handles : approver;
    allowed[a] = on && quem && actionAllowed(a, h, cfg) && (a !== "entregar" || open);
  }
  return { enabled: !!cfg?.enabled, actions: on, approver, publishWindow: cfg?.publishWindow || "noite", allowed };
}

export async function runHermesAction(repo, ticketId, body = {}, { linear, user = null, now = nowIso(), log } = {}) {
  const action = String(body.action || "");
  if (!HERMES_ACTIONS.includes(action)) throw httpError(400, `ação desconhecida (${HERMES_ACTIONS.join(", ")})`, "action_unknown");
  const text = String(body.text ?? "").trim().slice(0, 4000);
  if (NEEDS_TEXT.has(action) && !text) throw httpError(400, "escreva o que o Hermes deve saber", "text_required");
  if (!linear?.configured?.()) throw httpError(409, "Linear não configurado (LINEAR_API_KEY)", "linear_not_configured");

  return withTaskLock(`hermes:${ticketId}`, async () => {
    let ticket = await repo.get("tickets", ticketId);
    if (!ticket) return null;
    const settings = await loadSettings(repo, ticket.saas);
    const lcfg = settings.linear;
    const cfg = lcfg.hermes;
    const perm = hermesPermissions(ticket, cfg, user);
    if (!perm.enabled) throw httpError(409, "o acompanhamento do Hermes está desligado neste produto", "hermes_off");
    if (!perm.actions) throw httpError(409, "as ações do Hermes pelo cockpit estão desligadas neste produto", "hermes_actions_off");
    if (action === "entregar") {
      if (user && !canHandleSaas(user, ticket.saas)) throw httpError(403, "você não atende tickets deste produto", "saas_out_of_scope");
    } else if (!perm.approver) {
      throw httpError(403, "só os aprovadores do Hermes neste produto fazem isso", "not_hermes_approver");
    }
    if (!actionAllowed(action, ticket.hermes || {}, cfg)) throw httpError(409, "essa ação não vale na fase atual do card", "wrong_phase");
    if (action === "entregar" && STATUS_KIND[ticket.status] === "done") throw httpError(409, "ticket concluído não vai para o Hermes", "ticket_done");

    const name = user?.name || user?.id || "Equipe";
    const by = user?.id || "api";

    // Entregar: garante a issue (o espelho cria) antes de qualquer coisa.
    if (action === "entregar" && !ticket.linear?.issueId) {
      if (!lcfg.enabled || !lcfg.teamId) throw httpError(409, "ligue o espelho com o Linear neste produto para entregar ao Hermes", "linear_mirror_off");
      await syncTicketToLinear(repo, ticketId, { linear, now, log });
      ticket = await repo.get("tickets", ticketId);
    }
    const issueId = ticket.linear?.issueId;
    if (!issueId) throw httpError(409, "o ticket não tem card no Linear", "linear_unlinked");

    const states = async () => teamStates(linear, ticket.linear?.teamId || lcfg.teamId);
    const moveTo = async (phase) => {
      const st = stateForPhase(phase, await states(), cfg);
      if (!st) throw httpError(409, `não achei a coluna de "${phase}" no Linear — ajuste o de-para do Hermes`, "hermes_state_missing");
      return linear.updateIssue(issueId, { stateId: st.id });
    };

    let version = Number(ticket.hermes?.version) || 0;
    let issue = null;
    if (action === "aprovar") {
      // Regra 2 do guia: a aprovação vale para a versão LIDA. Relê o card e
      // compara com a versão que a tela mostrou.
      const full = await linear.issueWithComments(issueId);
      const view = hermesView(ticket, full?.comments || [], cfg);
      version = view.card?.version || version;
      const lida = Number(body.version) || 0;
      if (version && lida !== version) throw httpError(409, `saiu uma versão nova (v${version}); leia antes de aprovar`, "version_changed");
      issue = await moveTo("aprovado");
    } else if (action === "desistir") {
      issue = await moveTo("validar");
    } else if (action === "passar_time") {
      const assigneeId = String(body.assignee || "").trim();
      if (!assigneeId) throw httpError(400, "escolha quem do time assume o card", "assignee_required");
      issue = await linear.updateIssue(issueId, { assigneeId });
    } else if (action === "entregar" && ticket.linear) {
      // Regra 4 do Hermes: card com alguém atribuído fica com o time.
      const atual = await linear.issue(issueId);
      if (atual?.assignee) issue = await linear.updateIssue(issueId, { assigneeId: null });
    }

    const nomeTime = action === "passar_time" ? (issue?.assignee?.name || "") : "";
    const comment = await linear.createComment(issueId, commentFor(action, { text: action === "passar_time" ? nomeTime : text, name, version }));
    if (comment?.id) await rememberPosted(repo, ticketId, comment.id);

    // Pedido de entrega gravado ANTES do retrato: é ele que faz o card (ainda
    // sem etiqueta) ser acompanhado até o Hermes aceitar ou recusar.
    const marcar = (patch) => withTaskLock(`ticket:${ticketId}`, async () => {
      const cur = await repo.get("tickets", ticketId);
      return repo.update("tickets", ticketId, { hermes: { ...(cur.hermes || {}), ...patch } });
    });
    if (action === "entregar") await marcar({ requested: { at: now, by } });
    // O doc anda já, pelo mesmo caminho da volta do Linear (sem esperar webhook).
    if (issue) await applyLinearIssue(repo, issue, { now, log, linear }).catch((err) => log?.warn?.(`hermes: retrato após ${action}: ${err.message}`));
    const saved = await marcar({
      lastAction: { action, version, by, at: now },
      ...(action === "aprovar" ? { approvedBy: by, approvedVersion: version } : {}),
    });
    await recordTicketEvents(repo, saved, [{ type: "hermes_action", data: { action, version, excerpt: text.slice(0, 140) } }], { by, now });
    log?.info?.(`hermes: ${action} em ${ticket.linear?.identifier || issueId} por ${name}`);
    return { ticket: saved, comment: comment?.id || "" };
  });
}
