// Pesquisa de satisfação da integração (12/11/2026): recurso do time de CS.
//
// Uma pesquisa por integração (`onboardings`), enviada À MÃO pelo card da
// integração (decisão de 12/11/2026: sem envio automático por enquanto). O
// botão gera o link (o mesmo enquanto não houver resposta) e o CS escolhe o
// canal: copiar, abrir o WhatsApp dele com a mensagem pronta ou mandar por
// e-mail pela conta conectada. Não usa o WhatsApp da API: fora da janela de 24h
// texto livre falha (131047) e não há template de pós-venda aprovado.
//
// Três perguntas, uma tela, uns 30 segundos:
//   · nota de 1 a 5 da integração (CSAT; gravada no clique, como no NPS);
//   · "já consegue usar sozinho?" sim | parcial | nao (a mais acionável);
//   · o que poderia ter sido melhor (opcional).
//
// Nota até 3 ou "ainda não" abre UM acompanhamento de CS pro dono da conta
// (prazo no dia seguinte). A nota NÃO entra no health score (decisão de
// 12/11/2026): fica no card da integração, na Carteira e na Análise de
// Integração (por integrador) pra o CS avaliar depois.

import { randomUUID } from "node:crypto";
import { appendTimeline } from "../events/timeline.js";
import { createFollowup } from "./cs-followups.js";

export const SURVEYS = "integration_surveys";
export const READY = ["sim", "parcial", "nao"];
export const READY_LABEL = { sim: "já usa sozinho", parcial: "usa em parte", nao: "ainda não usa sozinho" };
export const LOW_SCORE = 3; // nota até 3 de 5 pede contato
const CHANNELS = new Set(["link", "whatsapp", "email"]);
const DAY = 86_400_000;
const SCORE_EDIT_MS = 15 * 60_000;
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });

export const surveyToken = () => randomUUID().replaceAll("-", "");
export const surveyLink = (baseUrl, token) => `${String(baseUrl || "").replace(/\/+$/, "")}/public/pesquisa/${token}`;

// Nota válida: inteiro de 1 a 5. Vazio não é nota ruim, é ausência de nota.
export function cleanScore(v) {
  if (v === "" || v === null || v === undefined || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

export function surveyText(customer, link, { canal = "whatsapp" } = {}) {
  const quem = customer?.contact || customer?.name || "";
  const oi = quem ? `Oi, ${quem}` : "Oi";
  if (canal === "email") {
    return [
      `${oi}.`,
      "",
      "Queremos saber como foi a sua integração com a Lever. São 3 perguntas rápidas, leva uns 30 segundos:",
      "",
      link,
      "",
      "Sua resposta vai direto pra quem cuida da sua conta.",
    ].join("\n");
  }
  return `${oi}! Queremos saber como foi a sua integração com a Lever. São 3 perguntas rápidas, leva uns 30 segundos: ${link}`;
}

// O que a tela recebe (sem nada além do necessário).
export function surveyView(doc, baseUrl = "") {
  if (!doc) return null;
  return {
    id: doc.id, onboarding: doc.onboarding, customer: doc.customer, integrator: doc.integrator || "",
    status: doc.status, channel: doc.channel || "", sentAt: doc.sentAt || "", createdAt: doc.createdAt || "",
    answeredAt: doc.answeredAt || "", score: doc.score ?? null, ready: doc.ready || "", comment: doc.comment || "",
    followup: doc.followup || "", link: surveyLink(baseUrl, doc.token),
  };
}

const latest = (rows) => [...rows].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0] || null;

export async function surveyOf(repo, onboardingId) {
  return latest(await repo.listWhere(SURVEYS, { onboarding: onboardingId }).catch(() => []));
}

// Cria (ou reaproveita, se ainda sem resposta) a pesquisa da integração e
// registra o canal. `email` manda pela conta conectada; os outros só anotam
// (o CS copia ou abre o WhatsApp dele). Respondida = 409: a resposta é do
// momento e não se pede de novo pelo mesmo card.
export async function askIntegrationSurvey(repo, onboardingId, {
  channel = "link", baseUrl = "", mailer = null, by = "", now = () => new Date(),
} = {}) {
  if (!CHANNELS.has(channel)) throw fail(400, `Canal inválido: ${channel}`);
  const onboarding = await repo.get("onboardings", onboardingId);
  if (!onboarding) throw fail(404, "Integração não encontrada.");
  if (onboarding.stage === "cancelada") throw fail(409, "Integração cancelada não tem pesquisa.");
  const customer = await repo.get("customers", onboarding.customer);
  if (!customer) throw fail(404, "Cliente não encontrado.");
  const at = now().toISOString();

  let doc = await surveyOf(repo, onboarding.id);
  if (doc?.status === "answered") throw fail(409, "O cliente já respondeu a pesquisa desta integração.");
  if (!doc) {
    doc = await repo.create(SURVEYS, {
      id: "is_" + randomUUID(),
      saas: customer.saas || onboarding.saas || "",
      customer: customer.id, onboarding: onboarding.id, kind: onboarding.kind || "",
      integrator: onboarding.integrator || "", owner: customer.owner || "",
      token: surveyToken(), status: "sent", channel: "", sentAt: "",
      createdAt: at, createdBy: by,
      answeredAt: "", score: null, ready: "", comment: "", followup: "",
    });
  }
  const link = surveyLink(baseUrl, doc.token);

  if (channel === "email") {
    if (!customer.email) throw fail(409, "O cliente não tem e-mail no cadastro. Copie o link ou mande pelo WhatsApp.");
    if (!mailer || !(await mailer.ready().catch(() => false))) throw fail(409, "Nenhuma conta de e-mail conectada. Copie o link ou mande pelo WhatsApp.");
    await mailer.send({ to: customer.email, subject: "Como foi sua integração com a Lever?", text: surveyText(customer, link, { canal: "email" }) });
  }
  const channels = new Set(String(doc.channel || "").split("+").filter(Boolean));
  channels.add(channel);
  doc = await repo.update(SURVEYS, doc.id, { channel: [...channels].join("+"), sentAt: doc.sentAt || at });
  if (doc.sentAt === at) { // só o primeiro envio vai pra linha do tempo
    await appendTimeline(repo, {
      id: `tl:integration_survey.sent:${doc.id}`, kind: "integration_survey.sent", source: "cockpit", at,
      customer: customer.id, lead: onboarding.lead || "", data: { onboarding: onboarding.id, survey: doc.id, channel },
    }).catch(() => {});
  }
  return { survey: doc, link, text: surveyText(customer, link), customer };
}

// Resposta do cliente. A nota chega no clique ({ score }); a prontidão e o
// comentário podem vir junto ou depois. Nota baixa ou "ainda não" abre um
// acompanhamento de CS, uma vez só.
export async function answerIntegrationSurvey(repo, doc, body = {}, { now = () => new Date() } = {}) {
  const at = now();
  const patch = {};
  const score = cleanScore(body.score);
  if (doc.status !== "answered") {
    if (score == null) throw fail(400, "A nota precisa ser um número de 1 a 5.");
    Object.assign(patch, { status: "answered", answeredAt: at.toISOString(), score });
  } else if (score != null && score !== doc.score) {
    // Trocar a nota logo depois do clique vale (mudou de ideia na mesma tela);
    // depois disso a resposta é do momento e não se reescreve.
    if (at.getTime() - Date.parse(doc.answeredAt || 0) > SCORE_EDIT_MS) throw fail(409, "Esta pesquisa já foi respondida.");
    patch.score = score;
  }
  if (READY.includes(body.ready)) patch.ready = body.ready;
  if (typeof body.comment === "string" && body.comment.trim()) patch.comment = body.comment.trim().slice(0, 2000);
  if (!Object.keys(patch).length) return doc;
  let saved = await repo.update(SURVEYS, doc.id, patch);

  if (patch.status === "answered") {
    await appendTimeline(repo, {
      id: `tl:integration_survey.answered:${doc.id}`, kind: "integration_survey.answered", source: "cockpit", at: at.toISOString(),
      customer: doc.customer, lead: "", data: { onboarding: doc.onboarding, survey: doc.id, score },
    }).catch(() => {});
  }
  const needsCall = saved.score != null && (saved.score <= LOW_SCORE || saved.ready === "nao");
  if (needsCall && !saved.followup) {
    const customer = await repo.get("customers", doc.customer).catch(() => null);
    if (customer) {
      const f = await createFollowup(repo, {
        customer: customer.id, kind: "check_in",
        title: saved.score <= LOW_SCORE ? `Pesquisa da integração: nota ${saved.score} de 5` : "Pesquisa da integração: ainda não usa sozinho",
        owner: customer.owner || doc.integrator || "",
        dueAt: new Date(at.getTime() + DAY).toISOString(),
        notes: followupNotes(customer, saved),
        source: "pesquisa_integracao",
      }, { by: "system", now: at });
      saved = await repo.update(SURVEYS, doc.id, { followup: f.id });
    }
  } else if (saved.followup && patch.comment) {
    // Comentário que chegou depois do acompanhamento: entra nas notas dele.
    const f = await repo.get("cs_followups", saved.followup).catch(() => null);
    if (f && f.status === "aberto") await repo.update("cs_followups", f.id, { notes: `${f.notes || ""}\n\nComentário que chegou depois: "${saved.comment.slice(0, 800)}"` });
  }
  return saved;
}

function followupNotes(customer, s) {
  return [
    `${customer.name || "O cliente"} respondeu a pesquisa da integração:`,
    `· nota ${s.score} de 5`,
    s.ready ? `· ${READY_LABEL[s.ready]}` : "",
    s.comment ? `· "${s.comment.slice(0, 800)}"` : "",
    s.integrator ? `· integração feita por ${s.integrator}` : "",
  ].filter(Boolean).concat(["", "Ligue antes de mandar mensagem: entender o que faltou na integração agora evita churn depois."]).join("\n");
}

// Agregado para a Análise de Integração: enviadas, respondidas, média e
// prontidão, no total e por integrador, mais as últimas respostas.
export function surveyStats(rows) {
  const answered = rows.filter((r) => r.status === "answered" && r.score != null);
  const sum = (list) => {
    const a = list.filter((r) => r.status === "answered" && r.score != null);
    return {
      sent: list.length, answered: a.length,
      avg: a.length ? Math.round((a.reduce((n, r) => n + Number(r.score), 0) / a.length) * 10) / 10 : null,
      low: a.filter((r) => r.score <= LOW_SCORE).length,
      ready: { sim: a.filter((r) => r.ready === "sim").length, parcial: a.filter((r) => r.ready === "parcial").length, nao: a.filter((r) => r.ready === "nao").length },
    };
  };
  const by = new Map();
  for (const r of rows) {
    const k = r.integrator || "";
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(r);
  }
  return {
    ...sum(rows),
    byIntegrator: [...by.entries()].map(([id, list]) => ({ id, ...sum(list) })).sort((a, b) => b.sent - a.sent),
    recent: answered.sort((a, b) => String(b.answeredAt).localeCompare(String(a.answeredAt))).slice(0, 10)
      .map((r) => ({ id: r.id, customer: r.customer, onboarding: r.onboarding, integrator: r.integrator || "", score: r.score, ready: r.ready || "", comment: r.comment || "", answeredAt: r.answeredAt })),
  };
}
