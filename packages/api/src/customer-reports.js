// Relatório mensal de resultado do cliente: a evidência de serviço.
//
// O cliente de SaaS cancela quando não enxerga o que a ferramenta fez por ele.
// O cockpit já sabia o número (a fila de indicação usa o influenciado de 30 dias
// por org desde set/2026), mas ele só aparecia PRA GENTE, numa aba interna.
// Aqui o número vira mensagem mensal pro cliente, e a ficha ganha o bloco
// Resultados pra quem cuida da conta abrir junto com ele na call.
//
// Regras que vêm da casa:
//   · número influenciado, nunca o GMV total da conta (a loja já vendia antes
//     da gente; inflar queima a prova na primeira conferência do cliente);
//   · mês sem venda nenhuma NÃO manda relatório (mandar "R$ 0" é pedir churn);
//     fica registrado como `skipped` e quem cuida da conta vê na ficha;
//   · cliente sem org vinculada não tem número: abre UMA tarefa de cadastro;
//   · e-mail sai sozinho; WhatsApp só dentro da janela de 24h, senão vira
//     tarefa com o texto pronto (mesma regra do NPS).

import { createTask } from "./tasks-core.js";
import { orgSnapshot } from "./leverads-results.js";
import { inMilestoneRuler } from "./customer-milestones.js";
import { waWindowOpen } from "./nps.js";
import { digits } from "./whatsapp.js";
import { isBusinessHours } from "./business-hours.js";
import { brtToday } from "./tasks-core.js";

const DAY = 86_400_000;
const STATE_DOC = "customer_reports";
export const REPORT_GAP_DAYS = 30;   // um relatório por cliente a cada 30 dias
export const REPORT_MIN_AGE_DAYS = 30; // só depois do primeiro mês de casa

const money = (n) => `R$ ${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)}`;

export function reportEmail(customer, snap) {
  const quem = customer.contact || customer.name || "tudo bem";
  const empresa = customer.name || "sua conta";
  const linhas = [
    `Oi, ${quem}.`,
    "",
    `Resumo dos últimos 30 dias na conta ${empresa}: ${money(snap.gmv30d)} vendidos pelos anúncios que a Lever criou${snap.orders30d ? ` (${snap.orders30d} ${snap.orders30d === 1 ? "pedido" : "pedidos"})` : ""}.`,
  ];
  if (snap.gmvTotal > snap.gmv30d) {
    linhas.push("", `Desde o começo já são ${money(snap.gmvTotal)}${snap.listings ? ` e ${new Intl.NumberFormat("pt-BR").format(snap.listings)} anúncios criados pela plataforma` : ""}.`);
  }
  linhas.push("", "Qualquer dúvida sobre esses números, responde este e-mail que a gente abre o painel junto.");
  return {
    subject: `Seus últimos 30 dias com a Lever: ${money(snap.gmv30d)} vendidos pelos anúncios`,
    text: linhas.join("\n"),
  };
}

export function reportWhatsApp(customer, snap) {
  const quem = customer.contact || customer.name || "tudo bem";
  const empresa = customer.name || "sua conta";
  const total = snap.gmvTotal > snap.gmv30d ? ` Desde o começo já são ${money(snap.gmvTotal)}.` : "";
  return `Oi ${quem}, resumo dos seus últimos 30 dias com a Lever: os anúncios que a gente criou venderam ${money(snap.gmv30d)} na conta ${empresa}${snap.orders30d ? ` (${snap.orders30d} ${snap.orders30d === 1 ? "pedido" : "pedidos"})` : ""}.${total} Quer que eu te mostre onde dá pra crescer mais?`;
}

// Cliente elegível ao relatório de hoje? Devolve o motivo da recusa (pra ficha
// poder explicar) ou "" quando pode mandar.
export function reportBlocker(customer, { now = Date.now(), lastAt = "" } = {}) {
  if (!inMilestoneRuler(customer, now)) return "fora da régua";
  const idade = Math.floor((now - new Date(customer.startedAt).getTime()) / DAY);
  if (idade < REPORT_MIN_AGE_DAYS) return "cliente há menos de 30 dias";
  if (!customer.leveradsOrgId) return "sem org da LeverAds no cadastro";
  if (lastAt && now - new Date(lastAt).getTime() < REPORT_GAP_DAYS * DAY) return "relatório enviado há menos de 30 dias";
  return "";
}

// Manda (ou registra o motivo de não ter mandado). Nunca lança.
export async function sendCustomerReport(repo, customer, snap, {
  mailer = null, whatsapp = null, now = () => new Date(), by = "system",
} = {}) {
  const at = now();
  const base = {
    saas: customer.saas || "", customer: customer.id, owner: customer.owner || "",
    periodEnd: at.toISOString().slice(0, 10),
    gmv30d: snap.gmv30d, orders30d: snap.orders30d, gmvTotal: snap.gmvTotal, listings: snap.listings,
    email: "skipped", whatsapp: "skipped", taskId: "", text: "",
  };

  // Mês sem venda: registra e não manda. "R$ 0" não é evidência de serviço, é
  // convite pro churn; quem cuida da conta trata isso com uma conversa.
  if (!(snap.gmv30d > 0)) {
    return repo.create("customer_reports", { ...base, status: "skipped", reason: "sem venda influenciada nos 30 dias" });
  }

  const mail = reportEmail(customer, snap);
  const texto = reportWhatsApp(customer, snap);
  const doc = { ...base, status: "sent", text: texto };

  if (customer.email && mailer) {
    try {
      if (await mailer.ready()) {
        await mailer.send({ to: customer.email, subject: mail.subject, text: mail.text });
        doc.email = "sent";
      }
    } catch { /* fail-open */ }
  }
  if (customer.phone && whatsapp?.sendText && await waWindowOpen(repo, customer.phone, { now: at.getTime() })) {
    try {
      await whatsapp.sendText(customer.phone, texto);
      doc.whatsapp = "sent";
    } catch { /* fail-open */ }
  }
  if (doc.email !== "sent" && doc.whatsapp !== "sent") {
    const t = await createTask(repo, {
      saas: customer.saas || "",
      title: `Mandar o resultado do mês pra ${customer.name || "cliente"}`,
      description: [
        "O relatório não saiu sozinho (conversa fora da janela de 24 horas do WhatsApp e sem e-mail no cadastro).",
        "",
        "Mensagem pronta:",
        texto,
        "",
        customer.phone ? `WhatsApp: https://wa.me/${digits(customer.phone)}` : "Cliente sem WhatsApp no cadastro.",
      ].join("\n"),
      labels: ["pos-venda", "relatorio"],
      ...(customer.owner ? { assignees: [customer.owner] } : {}),
    }, { by });
    doc.whatsapp = "task";
    doc.taskId = t.id;
  }
  return repo.create("customer_reports", doc);
}

// Runner diário: um relatório por cliente a cada 30 dias, em horário comercial.
export function startCustomerReports(repo, {
  log, mailer = null, whatsapp = null,
  hour = Number(process.env.CUSTOMER_REPORT_HOUR || 9),
  intervalMs = 30 * 60 * 1000,
  snapshot = orgSnapshot,
  now = () => new Date(),
} = {}) {
  let running = false;

  async function tick(at = now()) {
    const spHour = new Date(at.getTime() - 3 * 3600 * 1000).getUTCHours(); // SP = UTC-3 fixo
    if (spHour < hour) return null;
    const today = brtToday(at);
    const state = await repo.get("app_config", STATE_DOC).catch(() => null);
    if (state?.lastRunDay === today) return null;

    const [customers, reports, products] = await Promise.all([
      repo.list("customers").catch(() => []),
      repo.list("customer_reports").catch(() => []),
      repo.list("products").catch(() => []),
    ]);
    const prodById = new Map(products.map((p) => [p.id, p]));
    const lastByCustomer = new Map();
    for (const r of reports) {
      const cur = lastByCustomer.get(r.customer);
      const quando = r.periodEnd || r.createdAt || "";
      if (!cur || quando > cur) lastByCustomer.set(r.customer, quando);
    }

    const ms = at.getTime();
    const elegiveis = [];
    const semOrg = [];
    for (const c of customers) {
      if (!inMilestoneRuler(c, ms)) continue;
      const produto = prodById.get(c.saas);
      if (produto && !isBusinessHours(produto, at)) continue;
      const blocker = reportBlocker(c, { now: ms, lastAt: lastByCustomer.get(c.id) || "" });
      if (!blocker) { elegiveis.push(c); continue; }
      if (blocker === "sem org da LeverAds no cadastro") semOrg.push(c);
    }

    let sent = 0, skipped = 0, tasks = 0;
    if (elegiveis.length) {
      const snaps = await snapshot(elegiveis.map((c) => c.leveradsOrgId));
      for (const c of elegiveis) {
        const snap = snaps.get(String(c.leveradsOrgId)) || { gmv30d: 0, orders30d: 0, gmvTotal: 0, listings: 0 };
        const doc = await sendCustomerReport(repo, c, snap, { mailer, whatsapp, now: () => at });
        if (doc.status === "sent") sent++; else skipped++;
      }
    }

    // Gap de cadastro: sem org não existe número nenhum pra esse cliente. Uma
    // tarefa por cliente, pra sempre (a chave é o próprio cliente).
    for (const c of semOrg) {
      const key = `org:${c.id}`;
      const existe = await repo.listWhere("tasks", { customerId: c.id, milestoneKey: key }, { fields: [] }).catch(() => []);
      if (existe.length) continue;
      await createTask(repo, {
        saas: c.saas || "",
        title: `Vincular a org da LeverAds no cadastro de ${c.name || "cliente"}`,
        description: [
          "Sem a org vinculada o cockpit não sabe quanto os anúncios da Lever venderam na conta dele, então ele fica de fora do relatório mensal e da fila de indicação.",
          "",
          "Editar cliente, campo \"Org na LeverAds\".",
        ].join("\n"),
        labels: ["cadastro"],
        customerId: c.id,
        milestoneKey: key,
        ...(c.owner ? { assignees: [c.owner] } : {}),
      }, { by: "system" });
      tasks++;
    }

    // `update` de doc inexistente devolve null em vez de lançar (db.js:245), então
    // o create tem que vir do estado lido, não de um catch — senão o trinco do dia
    // nunca é gravado e o runner varre a base a cada tick.
    if (state) await repo.update("app_config", STATE_DOC, { lastRunDay: today }, { silent: true });
    else await repo.create("app_config", { id: STATE_DOC, lastRunDay: today });
    return { sent, skipped, tasks };
  }

  const run = async () => {
    if (running) return null;
    running = true;
    try { return await tick(); }
    catch (err) { log?.warn?.(`customer reports: ${err.message}`); return null; }
    finally { running = false; }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  const first = setTimeout(run, 90_000);
  first.unref?.();
  return { tick, run, stop: () => { clearInterval(timer); clearTimeout(first); } };
}
