// NPS dos clientes: a pergunta, o link público e o que acontece com a resposta.
//
// O placar de CS já tinha meta de NPS e o plano de remuneração já pagava bônus
// com NPS >= 80 (remuneracao.jsx), mas NADA no cockpit perguntava: a coleção
// `nps` estava vazia desde que nasceu e o bônus nunca pôde ser pago. Aqui a
// pergunta sai sozinha na régua do pós-venda (mês 1, mês 3 e de 90 em 90 dias),
// o cliente responde numa página pública de 10 segundos e a nota volta pro card
// do CS.
//
// ÍNDICE, não média (decisão de 13/09/2026): `nps.score` guarda a nota de 0 a 10
// de cada resposta e o placar calcula o NPS clássico (promotores menos
// detratores, de -100 a 100). É o único jeito de "NPS 80" do plano de
// remuneração querer dizer o que o mercado chama de NPS 80; média das notas
// daria 8, outra régua.
//
// Entrega: e-mail sozinho (conta Google conectada) e WhatsApp só dentro da
// janela de 24h; fora dela vira TAREFA com o texto pronto pro dono da conta
// mandar pelo celular, porque não existe template de pós-venda aprovado na Meta
// e texto livre fora da janela falha no webhook (131047).

import { randomUUID } from "node:crypto";
import { createTask } from "./tasks-core.js";
import { inMilestoneRuler } from "./customer-milestones.js";
import { threadId } from "./wa-store.js";
import { digits } from "./whatsapp.js";

const DAY = 86_400_000;

// Dia 30 (check-in de mês 1), dia 90 (revisão de mês 3) e de 90 em 90 depois.
export const NPS_FIRST_DAYS = 30;
export const NPS_CYCLE_DAYS = 90;
export const NPS_MIN_GAP_DAYS = 60; // nunca perguntar de novo antes disso

// Nota devida hoje? Devolve o "motivo" (a chave do marco) ou null.
export function npsDue(customer, { now = Date.now(), lastAskedAt = "" } = {}) {
  if (!customer?.startedAt) return null;
  const start = new Date(customer.startedAt).getTime();
  if (!Number.isFinite(start)) return null;
  const idade = Math.floor((now - start) / DAY);
  if (idade < NPS_FIRST_DAYS) return null;
  if (lastAskedAt) {
    const last = new Date(lastAskedAt).getTime();
    if (Number.isFinite(last) && now - last < NPS_MIN_GAP_DAYS * DAY) return null;
  }
  if (idade < NPS_CYCLE_DAYS) return "checkin_m1";
  if (idade < NPS_CYCLE_DAYS + NPS_CYCLE_DAYS) return "revisao_m3";
  return "ciclo";
}

export const npsToken = () => randomUUID().replaceAll("-", "");

// Classificação de uma nota: 9-10 promotor · 7-8 neutro · 0-6 detrator.
export const npsBucket = (score) => {
  // Guarda contra `Number("")` e `Number(null)`, que são 0 e virariam detrator:
  // nota em branco não é nota ruim, é ausência de nota.
  if (score === "" || score === null || score === undefined || typeof score === "boolean") return "";
  const n = Number(score);
  if (!Number.isFinite(n) || n < 0 || n > 10) return "";
  if (n >= 9) return "promotor";
  if (n >= 7) return "neutro";
  return "detrator";
};

export const npsLink = (baseUrl, token) => `${String(baseUrl || "").replace(/\/+$/, "")}/public/nps/${token}`;

export function npsAskText(customer, link, { canal = "whatsapp" } = {}) {
  const quem = customer.contact || customer.name || "tudo bem";
  if (canal === "email") {
    return [
      `Oi, ${quem}.`,
      "",
      "Uma pergunta rápida pra gente melhorar o serviço: de 0 a 10, quanto você indicaria a Lever pra outro lojista?",
      "",
      `Leva 10 segundos: ${link}`,
      "",
      "Sua resposta vai direto pra quem cuida da sua conta.",
    ].join("\n");
  }
  return `Oi ${quem}, uma pergunta rápida pra gente melhorar o serviço: de 0 a 10, quanto você indicaria a Lever pra outro lojista? Leva 10 segundos: ${link}`;
}

// A conversa está dentro da janela de 24h da Meta? (o cliente falou por último,
// ou qualquer entrada nas últimas 24h). Texto livre fora dela é reprovado no
// webhook, então só mandamos dentro.
export async function waWindowOpen(repo, phone, { now = Date.now() } = {}) {
  const id = threadId(phone);
  if (!id) return false;
  const t = await repo.get("wa_threads", id).catch(() => null);
  if (!t || !t.lastAt) return false;
  const at = new Date(t.lastAt).getTime();
  if (!Number.isFinite(at) || now - at >= 24 * 3600 * 1000) return false;
  return t.lastDir === "in" || !!t.hasIn;
}

// Cria o pedido (doc `nps` em status "asked") e tenta entregar. Nunca lança:
// entrega é best-effort, o pedido fica gravado de qualquer jeito.
export async function askNps(repo, customer, {
  reason = "manual", baseUrl = "", mailer = null, whatsapp = null, now = () => new Date(), by = "system",
} = {}) {
  const at = now();
  const token = npsToken();
  const doc = await repo.create("nps", {
    saas: customer.saas || "",
    customer: customer.id,
    owner: customer.owner || "",
    status: "asked",
    token,
    askedAt: at.toISOString(),
    answeredAt: "",
    score: null,
    reason: "",
    milestoneKey: reason,
    channel: "",
    tags: [],
  });
  const link = npsLink(baseUrl, token);
  let channel = "";

  if (customer.email && mailer) {
    try {
      if (await mailer.ready()) {
        await mailer.send({
          to: customer.email,
          subject: "Uma pergunta rápida: de 0 a 10?",
          text: npsAskText(customer, link, { canal: "email" }),
        });
        channel = "email";
      }
    } catch { /* fail-open: o WhatsApp ou a tarefa cobrem */ }
  }

  const texto = npsAskText(customer, link);
  if (customer.phone && whatsapp?.sendText && await waWindowOpen(repo, customer.phone, { now: at.getTime() })) {
    try {
      await whatsapp.sendText(customer.phone, texto);
      channel = channel ? `${channel}+whatsapp` : "whatsapp";
    } catch { /* fail-open */ }
  }

  if (!channel) {
    // Nada saiu sozinho: vira trabalho de gente, com o texto pronto e o link.
    await createTask(repo, {
      saas: customer.saas || "",
      title: `Pedir o NPS de ${customer.name || "cliente"}`,
      description: [
        "A conversa está fora da janela de 24 horas do WhatsApp (ou o cliente não tem e-mail conectado), então o pedido não saiu sozinho.",
        "",
        "Mensagem pronta:",
        texto,
        "",
        customer.phone ? `WhatsApp: https://wa.me/${digits(customer.phone)}` : "Cliente sem WhatsApp no cadastro.",
      ].join("\n"),
      labels: ["pos-venda", "nps"],
      ...(customer.owner ? { assignees: [customer.owner] } : {}),
    }, { by });
    channel = "task";
  }

  await repo.update("nps", doc.id, { channel });
  return { ...doc, channel, link };
}

// Resposta do cliente. Nota baixa abre tarefa pro dono da conta: é o telefonema
// que salva a conta, e ele tem que estar na fila de alguém.
export async function answerNps(repo, doc, { score, reason = "", now = () => new Date(), customer = null } = {}) {
  const at = now();
  const saved = await repo.update("nps", doc.id, {
    status: "answered",
    answeredAt: at.toISOString(),
    score: Number(score),
    reason: String(reason || "").slice(0, 2000),
  });
  const c = customer || await repo.get("customers", doc.customer).catch(() => null);
  const bucket = npsBucket(score);
  if (c && bucket === "detrator") {
    await createTask(repo, {
      saas: c.saas || "",
      title: `Ligar pra ${c.name || "cliente"}: nota ${Number(score)} no NPS`,
      description: [
        `${c.name || "O cliente"} deu nota ${Number(score)} de 10 na pergunta de indicação.`,
        reason ? `\nO que ele escreveu:\n"${String(reason).slice(0, 800)}"` : "\nEle não escreveu o motivo.",
        "",
        "Nota até 6 é detrator: ligue (não mande mensagem) antes que vire churn.",
      ].join("\n"),
      priority: "P1",
      labels: ["pos-venda", "nps"],
      ...(c.owner ? { assignees: [c.owner] } : {}),
    }, { by: "system" });
  }
  return saved;
}

// Runner: varre os clientes da régua e pergunta a quem está na hora.
export function startNpsAsks(repo, {
  log, mailer = null, whatsapp = null, baseUrl = process.env.PUBLIC_BASE_URL || "",
  intervalMs = 6 * 3600 * 1000, now = () => new Date(),
} = {}) {
  let running = false;

  async function tick(at = now()) {
    const ms = at.getTime();
    const [customers, asks] = await Promise.all([
      repo.list("customers").catch(() => []),
      repo.list("nps").catch(() => []),
    ]);
    const lastByCustomer = new Map();
    for (const a of asks) {
      if (!a.customer || !a.askedAt) continue;
      const cur = lastByCustomer.get(a.customer);
      if (!cur || a.askedAt > cur) lastByCustomer.set(a.customer, a.askedAt);
    }
    let asked = 0;
    for (const c of customers) {
      if (!inMilestoneRuler(c, ms)) continue;
      const reason = npsDue(c, { now: ms, lastAskedAt: lastByCustomer.get(c.id) || "" });
      if (!reason) continue;
      await askNps(repo, c, { reason, baseUrl, mailer, whatsapp, now: () => at });
      asked++;
    }
    return { asked };
  }

  const run = async () => {
    if (running) return null;
    running = true;
    try { return await tick(); }
    catch (err) { log?.warn?.(`nps asks: ${err.message}`); return null; }
    finally { running = false; }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  const first = setTimeout(run, 70_000);
  first.unref?.();
  return { tick, run, stop: () => { clearInterval(timer); clearTimeout(first); } };
}
