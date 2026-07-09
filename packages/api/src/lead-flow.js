// Núcleo do processo comercial: timeline (activities) + movimento de estágio.
// TODA mudança de estágio de lead passa por applyStageMove (PATCH genérico e
// aceite de proposta) — é o que garante histórico consistente (activity `stage`),
// motivo de perda preenchido e o "GPS" (nextActionAt) re-agendado pela cadência
// do estágio. TODO toque registrado (activities TOUCH) re-agenda o próximo passo
// sozinho via onActivityCreated.

import { randomUUID } from "node:crypto";
import { kindOf, cadenceOf, firstStage, LOSS_KINDS, TOUCH_TYPES } from "./stages.js";

const HOUR = 3_600_000;
const DAY = 86_400_000;

export async function logActivity(repo, { saas = "", lead = "", type = "note", text = "", meta = {}, author = "system", at } = {}) {
  const now = new Date().toISOString();
  return repo.create("activities", {
    id: "ac_" + randomUUID(),
    saas, lead, type, text, meta, author,
    at: at || now,
    createdAt: now,
  });
}

// Próximo toque de um lead que ACABOU de entrar num estágio (create ou move):
// firstTouchHours (SLA de 1º contato) vence; senão retryDays; senão sem prazo.
export function initialNextActionAt(product, stage, now = new Date()) {
  const cad = cadenceOf(product, stage || firstStage(product));
  const ms = cad.firstTouchHours ? cad.firstTouchHours * HOUR : cad.retryDays ? cad.retryDays * DAY : 0;
  return ms ? new Date(now.getTime() + ms).toISOString() : "";
}

// Calcula os campos derivados de um movimento de estágio e loga a activity
// `stage` (o histórico real do funil). Retorna o patch a MESCLAR no PATCH do
// cliente — campos explícitos do cliente sempre vencem (stageSince do optimistic
// move, lostReason do modal de perda, nextActionAt manual).
// Pré-condição do chamador: lead.stage !== toStage.
export async function applyStageMove(repo, { lead, toStage, patch = {}, author = "api", now = new Date() }) {
  const product = lead.saas ? await repo.get("products", lead.saas) : null;
  const kind = kindOf(product, toStage);
  const out = {
    stageSince: patch.stageSince != null ? patch.stageSince : now.toISOString(),
    stageAttempts: 0, // contador de toques é POR estágio
  };
  let lostReason = "";
  if (kind && LOSS_KINDS.has(kind)) {
    // Perda estruturada: motivo do patch > motivo já gravado > "nao_informado"
    // (soft — API/MCP/espelho nunca tomam 422; o relatório expõe o buraco).
    lostReason = patch.lostReason || lead.lostReason || "nao_informado";
    out.lostReason = lostReason;
    out.nextActionAt = ""; // terminal sai da fila do GPS
    out.nextActionNote = "";
  } else {
    // Revival (saiu de perdido/ganho pra estágio ativo) limpa a perda antiga,
    // a menos que o cliente mande outra no mesmo PATCH.
    if (patch.lostReason == null && lead.lostReason) { out.lostReason = ""; out.lostNote = ""; }
    if (kind === "ganho") {
      out.nextActionAt = "";
      out.nextActionNote = "";
    } else if (patch.nextActionAt == null) {
      out.nextActionAt = initialNextActionAt(product, toStage, now);
    }
  }
  try {
    await logActivity(repo, {
      saas: lead.saas || "",
      lead: lead.id,
      type: "stage",
      meta: {
        from: lead.stage || firstStage(product),
        to: toStage,
        ...(lostReason ? { lostReason } : {}),
      },
      author,
      at: out.stageSince,
    });
  } catch { /* histórico é best-effort: nunca bloqueia o movimento */ }
  return out;
}

// Hook do POST genérico de activities: toque (whatsapp/call/email/meeting)
// atualiza as denormalizações do lead (últ. contato, tentativas no estágio) e
// re-agenda o próximo passo pela cadência do estágio atual — registrou o toque,
// o GPS já marca o próximo. Nota só atualiza o "últ. contato". `meta.reschedule
// === false` registra sem mexer na agenda (ex.: backfill de histórico).
export async function onActivityCreated(repo, activity) {
  if (!activity || !activity.lead) return null;
  const isTouch = TOUCH_TYPES.has(activity.type);
  if (!isTouch && activity.type !== "note") return null; // stage/system não são toque
  const lead = await repo.get("leads", activity.lead);
  if (!lead) return null;
  const patch = {
    lastActivityAt: activity.at || new Date().toISOString(),
    lastActivityType: activity.type,
  };
  if (isTouch && activity.meta?.reschedule !== false) {
    patch.stageAttempts = (Number(lead.stageAttempts) || 0) + 1;
    const product = lead.saas ? await repo.get("products", lead.saas) : null;
    const cad = cadenceOf(product, lead.stage || firstStage(product));
    if (cad.retryDays) {
      const base = new Date(activity.at || Date.now()).getTime();
      patch.nextActionAt = new Date(base + cad.retryDays * DAY).toISOString();
    }
  }
  return repo.update("leads", lead.id, patch);
}
