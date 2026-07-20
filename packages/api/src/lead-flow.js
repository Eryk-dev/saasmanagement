// Núcleo do processo comercial: timeline (activities) + movimento de estágio.
// TODA mudança de estágio de lead passa por applyStageMove (PATCH genérico e
// aceite de proposta) — é o que garante histórico consistente (activity `stage`),
// motivo de perda preenchido e o "GPS" (nextActionAt) re-agendado pela cadência
// do estágio. TODO toque registrado (activities TOUCH) re-agenda o próximo passo
// sozinho via onActivityCreated.

import { randomUUID } from "node:crypto";
import { kindOf, cadenceOf, firstStage, stageByKind, LOSS_KINDS, TOUCH_TYPES } from "./stages.js";

const HOUR = 3_600_000;
const DAY = 86_400_000;

// O funil trabalha de segunda a sexta: agendamento do GPS que cair em sáb/dom
// rola pra segunda às 08:00 no fuso do negócio (America/Sao_Paulo, UTC-3 fixo,
// mesma convenção do marketing). Dia útil passa intacto.
const BRT = 3 * HOUR;
export function rollToBusinessDay(date) {
  const d = new Date(date);
  const clock = new Date(d.getTime() - BRT); // campos UTC = relógio de Brasília
  const dow = clock.getUTCDay();
  if (dow !== 0 && dow !== 6) return d;
  clock.setUTCDate(clock.getUTCDate() + (dow === 6 ? 2 : 1));
  clock.setUTCHours(8, 0, 0, 0); // "primeiros horários de segunda"
  return new Date(clock.getTime() + BRT);
}

// Dono automático de um lead novo sem responsável: o ÚNICO usuário com papel
// "sdr" do produto vira o dono (owner) — todo card entra com um SDR responsável.
// Com 0 ou 2+ SDRs ninguém é escolhido (o time decide na mão). Espelha o
// auto-integrador do applyStageMove.
export async function autoLeadOwner(repo, saas) {
  try {
    const users = await repo.list("users");
    const sdrs = users.filter((u) => Array.isArray(u.roles) && u.roles.includes("sdr") && (!u.saas || u.saas === saas));
    return sdrs.length === 1 ? sdrs[0].id : null;
  } catch { return null; }
}

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
// Fim de semana rola pra segunda (cadastro de sábado é prioridade de segunda cedo;
// a Nutrição usa firstTouchHours: 168 = 7 dias e cai sempre em dia útil).
export function initialNextActionAt(product, stage, now = new Date()) {
  const cad = cadenceOf(product, stage || firstStage(product));
  const ms = cad.firstTouchHours ? cad.firstTouchHours * HOUR : cad.retryDays ? cad.retryDays * DAY : 0;
  return ms ? rollToBusinessDay(new Date(now.getTime() + ms)).toISOString() : "";
}

// `callAt`/`integrationAt` são hora de Brasília SEM fuso ("YYYY-MM-DDTHH:MM"),
// do jeito que o <input type="datetime-local"> entrega. Vira ISO UTC.
export function brtToIso(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  const withZone = /[Zz]|[+-]\d{2}:\d{2}$/.test(v) ? v : `${v.length === 16 ? `${v}:00` : v}-03:00`;
  const d = new Date(withZone);
  return Number.isFinite(d.getTime()) ? d.toISOString() : "";
}

// COMPROMISSO MARCADO MANDA NO GPS. O lead tem hora combinada com o cliente
// (call de venda ou reunião de integração), e o "próximo passo" tem que ser ela:
// mostrar outro horário no card faz o time ler a hora errada do compromisso.
//
// Só vale pro compromisso DA ETAPA (call na etapa de call, integração na
// entrega) e só se ainda está no futuro — compromisso que já passou não é
// próximo passo, aí o toque volta a sair da cadência ou do resumo da call.
export function appointmentAt(product, lead, stage = lead?.stage, now = new Date()) {
  const kind = kindOf(product, stage);
  const raw = kind === "call" ? lead?.callAt
    : (kind === "integracao" || kind === "posvenda") ? lead?.integrationAt
      : "";
  const iso = brtToIso(raw);
  return iso && new Date(iso).getTime() > now.getTime() ? iso : "";
}

// Calcula os campos derivados de um movimento de estágio e loga a activity
// `stage` (o histórico real do funil). Retorna o patch a MESCLAR no PATCH do
// cliente — campos explícitos do cliente sempre vencem (stageSince do optimistic
// move, lostReason do modal de perda, nextActionAt manual).
// Pré-condição do chamador: lead.stage !== toStage.
export async function applyStageMove(repo, { lead, toStage, patch = {}, author = "api", now = new Date() }) {
  const product = lead.saas ? await repo.get("products", lead.saas) : null;
  const kind = kindOf(product, toStage);
  // Etapa de call EXIGE horário. Card em etapa de call sem hora não aparece na
  // Agenda, não gera Meet, não ocupa slot do closer e não conta como call
  // agendada em lugar nenhum — vira um fantasma que só aparece no kanban.
  // A trava mora aqui porque TODA mudança de etapa passa por applyStageMove:
  // tela, MCP, API externa e aceite de proposta.
  if (kind === "call") {
    const at = patch.callAt != null ? patch.callAt : lead.callAt;
    if (!String(at || "").trim()) {
      const err = new Error(`A etapa "${toStage}" exige data e hora da call — mande callAt junto da mudança de etapa.`);
      err.statusCode = 422;
      err.code = "CALL_SEM_HORARIO";
      throw err;
    }
  }
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
    // Lead descartado ENCERRA a conversa de WhatsApp junto (sai da lista viva
    // do inbox); mensagem nova do lead reabre sozinha (recordMessage).
    try {
      const { findThreadByPhone } = await import("./wa-store.js");
      const t = lead.phone ? await findThreadByPhone(repo, lead.phone) : null;
      if (t && (t.status || "open") !== "closed") {
        await repo.update("wa_threads", t.id, { status: "closed", closedAt: now.toISOString(), closedBy: author, closeReason: `lead ${kind}` });
      }
    } catch { /* conversa não trava o movimento do card */ }
  } else {
    // Revival (saiu de perdido/ganho pra estágio ativo) limpa a perda antiga,
    // a menos que o cliente mande outra no mesmo PATCH.
    if (patch.lostReason == null && lead.lostReason) { out.lostReason = ""; out.lostNote = ""; }
    if (kind === "ganho") {
      out.nextActionAt = "";
      out.nextActionNote = "";
    } else if (patch.nextActionAt == null) {
      // Compromisso da etapa (call/integração já marcada) vence a cadência: o
      // próximo passo é a hora combinada com o cliente, não um prazo genérico.
      const merged = { ...lead, ...patch };
      out.nextActionAt = appointmentAt(product, merged, toStage, now)
        || initialNextActionAt(product, toStage, now);
    }
    // Entrega e pós-venda: card entrando em integração/CS/ganho sem integrador
    // definido, o ÚNICO usuário com papel integrator do produto assume sozinho
    // ("a integração é responsabilidade do Eryk"). O closer da venda fica
    // intacto no campo dele. Com 0 ou 2+ integradores, ninguém chuta.
    if (["integracao", "posvenda", "ganho"].includes(kind) && !lead.integrator && patch.integrator == null) {
      try {
        const users = await repo.list("users");
        const integrators = users.filter((u) =>
          Array.isArray(u.roles) && u.roles.includes("integrator") && (!u.saas || u.saas === lead.saas));
        if (integrators.length === 1) out.integrator = integrators[0].id;
      } catch { /* atribuição é conveniência: nunca bloqueia o movimento */ }
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
    const stage = lead.stage || firstStage(product);
    const cad = cadenceOf(product, stage);
    if (cad.retryDays) {
      const base = new Date(activity.at || Date.now()).getTime();
      patch.nextActionAt = rollToBusinessDay(new Date(base + cad.retryDays * DAY)).toISOString();
    }
    // 1º ato do SDR feito num estágio "novo": por definição o lead deixou de ser
    // novo — segue sozinho pra qualificação (o processo continua lá amanhã). O
    // movimento canônico (applyStageMove) zera tentativas, loga o histórico e
    // re-agenda o GPS pela cadência do estágio de destino.
    if (kindOf(product, stage) === "novo") {
      const target = stageByKind(product, "qualificacao") || stageByKind(product, "contato");
      if (target && target.stage !== stage) {
        const movePatch = await applyStageMove(repo, {
          lead, toStage: target.stage,
          author: activity.author || "system",
          now: new Date(activity.at || Date.now()),
        });
        return repo.update("leads", lead.id, { ...patch, ...movePatch, stage: target.stage });
      }
    }
  }
  return repo.update("leads", lead.id, patch);
}
