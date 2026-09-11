// Servidor da tela "Links de pagamento" (id `offers`): o HISTÓRICO dos links
// gerados no nome de um lead ou cliente (pelo card, pela tela ou pela ficha),
// agrupado por CLIENTE com o saldo pago × em aberto, e a baixa manual de um
// link (dinheiro que entrou por fora e alguém marcou à mão).
//
// Os links FIXOS das ofertas (mpago.la iguais pra todo mundo) saíram em
// 10/09/2026: todo link agora nasce no nome de alguém, senão o pagamento não
// casa. A collection `offers` fica no banco como histórico, sem rota.
//
// O status do dinheiro vem do espelho do Mercado Pago (payment-links.js);
// a baixa manual só muda o status do LINK e os tiles da tela: não cria
// fatura, não mexe no arr nem no status de pagamento do cliente (esses têm
// as portas deles: ficha do cliente e Financeiro).

import { enrichPaymentLinks, filterPaymentLinks, groupPaymentLinks, validateManualPaid, GROUP_TABS } from "./payment-links.js";
import { logActivity } from "./lead-flow.js";

const brl = (v) => `R$ ${(Math.round((Number(v) || 0) * 100) / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
const MANUAL_LABEL = { pix: "PIX", boleto: "boleto", cartao: "cartão", transferencia: "transferência", dinheiro: "dinheiro", outro: "outro meio" };

export function registerOfferRoutes(app, repo) {
  // Lead da timeline de um link: o próprio lead, ou o lead de origem do cliente.
  async function leadOfLink(link) {
    if (link.lead) return link.lead;
    if (!link.customer) return "";
    const c = await repo.get("customers", link.customer).catch(() => null);
    return c?.leadId || "";
  }
  async function note(link, text, meta, author) {
    try {
      const lead = await leadOfLink(link);
      if (!lead) return;
      await logActivity(repo, { saas: link.saas || "", lead, type: "system", text, meta, author });
    } catch { /* timeline é registro, nunca derruba a baixa */ }
  }
  async function enrichOne(link) {
    const [payments, invoices] = await Promise.all([repo.list("mp_payments"), repo.list("invoices")]);
    return enrichPaymentLinks([link], payments, invoices)[0];
  }

  // Histórico agrupado por cliente. O enriquecimento roda sobre o histórico
  // INTEIRO do produto antes do recorte de data: "substituído" e o casamento
  // de pagamento dependem do todo (um link antigo não pode virar "aguardando"
  // só porque o novo ficou fora do período). `since/until` = dia do negócio
  // (BRT), o mesmo filtro de período do topo do cockpit; `by` = quem gerou.
  app.get("/api/payment-links", async (req) => {
    const q = req.query || {};
    const saas = String(q.saas || "");
    const since = String(q.since || "").slice(0, 10);
    const until = String(q.until || "").slice(0, 10);
    const by = String(q.by || "");
    const status = String(q.status || "todos");
    const [all, payments, invoices, leads, customers, users] = await Promise.all([
      repo.list("payment_links"), repo.list("mp_payments"), repo.list("invoices"),
      repo.list("leads"), repo.list("customers"), repo.list("users").catch(() => []),
    ]);
    const enrichedAll = enrichPaymentLinks(filterPaymentLinks(all, { saas }), payments, invoices);
    const scoped = filterPaymentLinks(enrichedAll, { since, until, by });
    const grouped = groupPaymentLinks(scoped, { leads, customers, users });
    const tab = GROUP_TABS[status] || GROUP_TABS.todos;
    // Em aberto de ANTES do período: o padrão do topo é 30 dias e esconderia
    // um link velho que ainda espera pagamento. A tela avisa numa linha.
    const before = since
      ? filterPaymentLinks(enrichedAll, { by }).filter((l) => l.status !== "paid" && l.status !== "superseded"
        && !["rejected", "cancelled", "refunded", "charged_back"].includes(l.status) && String(l.createdAt || "").slice(0, 10) < since)
      : [];
    return {
      ...grouped,
      groups: grouped.groups.filter(tab),
      links: scoped,
      period: { since, until },
      backlog: { count: before.length, waiting: Math.round(before.reduce((a, l) => a + (Number(l.amount) || 0), 0) * 100) / 100 },
    };
  });

  // Baixa manual: o dinheiro entrou por fora do link. Espelho do pay/unpay da
  // fatura (routes.billing.js): 409 quando o MP já pagou (não existe "marcar"
  // o que é fato) e quando o link tem fatura (a baixa é da fatura, na ficha
  // do cliente, senão o mesmo dinheiro vira dois registros).
  app.post("/api/payment-links/:id/pay", async (req, reply) => {
    const link = await repo.get("payment_links", req.params.id);
    if (!link) return reply.code(404).send({ error: "Not found" });
    const { error, value } = validateManualPaid(req.body || {});
    if (error) return reply.code(400).send({ error });
    if (link.invoice) return reply.code(409).send({ error: "esse link tem fatura: dê baixa na fatura pela ficha do cliente" });
    const cur = await enrichOne(link);
    if (cur.paidBy === "mp") return reply.code(409).send({ error: "esse link já foi pago pelo Mercado Pago" });
    const author = req.authUser?.id || "";
    const updated = await repo.update("payment_links", link.id, {
      manualPaid: { ...value, by: author, markedAt: new Date().toISOString() },
    });
    await note(updated, `Link de pagamento marcado como pago à mão: ${brl(link.amount)} (${MANUAL_LABEL[value.method] || value.method})${value.note ? ` · ${value.note}` : ""}`,
      { event: "link_manual_paid", linkId: link.id, amount: link.amount, method: value.method, at: value.at }, author || "api");
    return { ok: true, link: await enrichOne(updated) };
  });

  app.post("/api/payment-links/:id/unpay", async (req, reply) => {
    const link = await repo.get("payment_links", req.params.id);
    if (!link) return reply.code(404).send({ error: "Not found" });
    if (!link.manualPaid) return { ok: true, link: await enrichOne(link) };
    const author = req.authUser?.id || "";
    const updated = await repo.update("payment_links", link.id, { manualPaid: null });
    await note(updated, `Baixa manual desfeita no link de pagamento: ${brl(link.amount)}`,
      { event: "link_manual_unpaid", linkId: link.id, amount: link.amount }, author || "api");
    return { ok: true, link: await enrichOne(updated) };
  });
}
