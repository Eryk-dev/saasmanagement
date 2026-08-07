// Rotas de billing (fase 5) — mudança de plano com pró-rata, baixa de fatura e o
// tick do motor. CRUD cru de plans/subscriptions/invoices fica no CRUD genérico
// (routes.js), que já sincroniza o ARR nas mutações de assinatura.

import { computeChange, runBilling, syncCustomerArr } from "./billing.js";
import { kindOf, stageByKind, firstStage } from "./stages.js";
import { applyStageMove, revertWonLead } from "./lead-flow.js";

export function registerBillingRoutes(app, repo, { mp, discord } = {}) {
  // Desfazer um FECHAMENTO ERRADO direto da tela de Clientes (Leo, 07/08 —
  // caso New Gift: avançou sem querer, puxou o card de volta, mas o cliente/
  // assinatura/fatura ficaram vivos contando MRR, caixa e ganho do mês). O
  // caminho natural (puxar o card) já desfaz via applyStageMove→revertWonLead;
  // este botão cobre o resto: card que já voltou com o carimbo preso, cliente
  // sem lead vinculado, ou o gestor agindo direto daqui. Métricas descontam
  // SOZINHAS: tudo deriva dos registros removidos (winsIn/MRR/caixa).
  // Trava de dinheiro REAL (mesma do revertWonLead): preapproval/pagamento do
  // Mercado Pago bloqueia com 409 explícito (EasyPanel engole 5xx).
  app.post("/api/customers/:id/revert-win", async (req, reply) => {
    const customer = await repo.get("customers", req.params.id);
    if (!customer) return reply.code(404).send({ error: "cliente não encontrado" });
    const subs = (await repo.list("subscriptions")).filter((s) => s.customer === customer.id);
    const invoices = (await repo.list("invoices")).filter((i) =>
      i.customer === customer.id || subs.some((s) => s.id === i.subscription));
    if (subs.some((s) => s.mpPreapprovalId) || invoices.some((i) => i.mpPaymentId)) {
      return reply.code(409).send({ error: "esse cliente tem cobrança/pagamento REAL do Mercado Pago — o dinheiro existiu, desfaça pelo Financeiro na mão" });
    }
    const author = req.authUser?.id || "revert-cliente";
    const lead = customer.leadId ? await repo.get("leads", customer.leadId) : null;
    if (lead) {
      const product = lead.saas ? await repo.get("products", lead.saas) : null;
      const kind = kindOf(product, lead.stage);
      if (kind === "ganho" || kind === "integracao" || kind === "posvenda") {
        // Card ainda na região de venda: puxa pra uma etapa ABERTA — o
        // applyStageMove limpa o carimbo e chama o revertWonLead sozinho.
        const back = stageByKind(product, "followup")?.stage
          || stageByKind(product, "qualificacao")?.stage || firstStage(product);
        const patch = await applyStageMove(repo, { lead, toStage: back, author });
        await repo.update("leads", lead.id, { ...patch, stage: back });
      } else {
        // Card já voltou pro funil (o carimbo ficou preso): só a limpeza.
        await revertWonLead(repo, lead, { author });
        await repo.update("leads", lead.id, { customerId: "", wonAt: "" });
      }
      if (await repo.get("customers", customer.id)) {
        return reply.code(409).send({ error: "não consegui remover o cliente (o vínculo com o lead não bate) — confira o registro" });
      }
      return { ok: true, leadId: lead.id, stage: (await repo.get("leads", lead.id))?.stage || "" };
    }
    // Cliente sem lead vinculado: remove os registros direto (trava do MP já passou).
    for (const i of invoices) await repo.remove("invoices", i.id);
    for (const s of subs) await repo.remove("subscriptions", s.id);
    await repo.remove("customers", customer.id);
    return { ok: true, leadId: "" };
  });
  // Mudança de plano/preço/ciclo. Upgrade aplica já (+ fatura pró-rata do diff
  // restante do ciclo); downgrade e troca de ciclo agendam pro fim do ciclo.
  app.post("/api/subscriptions/:id/change", async (req, reply) => {
    const sub = await repo.get("subscriptions", req.params.id);
    if (!sub) return reply.code(404).send({ error: "Not found" });
    const body = req.body || {};
    const now = new Date();
    const result = computeChange(sub, body, now);

    if (result.changeType === "no_op") return { ok: false, ...result };

    if (result.changeType === "upgrade_mid_cycle") {
      const updated = await repo.update("subscriptions", sub.id, {
        price: body.price != null && body.price !== "" ? Number(body.price) : sub.price,
        plan: body.plan ?? sub.plan,
        pendingChange: null,
      });
      if (result.prorata > 0) {
        await repo.create("invoices", {
          subscription: sub.id, customer: sub.customer, saas: sub.saas,
          amount: result.prorata, kind: "prorata", status: "open",
          dueDate: now.toISOString(), createdAt: now.toISOString(),
        });
      }
      await syncCustomerArr(repo, sub.customer);
      // Assinatura cobrada via MP: PUT só do valor — próxima recorrência sai no
      // preço novo na data original (best-effort; pró-rata já foi faturado aqui).
      let mpSync;
      if (mp?.configured() && sub.mpPreapprovalId) {
        try { await mp.updatePreapprovalAmount(sub.mpPreapprovalId, updated.price); mpSync = "ok"; }
        catch (err) {
          req.log.warn({ sub: sub.id, err: err.message }, "MP: falha ao atualizar valor do preapproval");
          mpSync = "failed";
        }
      }
      return { ok: true, ...result, subscription: updated, ...(mpSync ? { mpSync } : {}) };
    }

    // downgrade_mid_cycle | cycle_change → pendingChange aplicado pelo runBilling
    const updated = await repo.update("subscriptions", sub.id, {
      pendingChange: {
        price: body.price != null && body.price !== "" ? Number(body.price) : sub.price,
        cycle: body.cycle || sub.cycle,
        plan: body.plan ?? sub.plan,
        applyAt: result.applyAt,
      },
    });
    return { ok: true, ...result, subscription: updated };
  });

  // Baixa de fatura (o pagamento em si acontece no MP/app — fase 4). Se a
  // assinatura estava past_due e não sobrou fatura vencida, volta a active.
  app.post("/api/invoices/:id/pay", async (req, reply) => {
    const inv = await repo.get("invoices", req.params.id);
    if (!inv) return reply.code(404).send({ error: "Not found" });
    const paid = await repo.update("invoices", inv.id, { status: "paid", paidAt: new Date().toISOString() });
    if (inv.subscription) {
      const stillOverdue = (await repo.list("invoices"))
        .some((i) => i.subscription === inv.subscription && i.id !== inv.id && i.status === "overdue");
      const sub = await repo.get("subscriptions", inv.subscription);
      if (sub && sub.status === "past_due" && !stillOverdue) {
        await repo.update("subscriptions", sub.id, { status: "active" });
        await syncCustomerArr(repo, sub.customer);
      }
    }
    // Aviso no Discord (fail-open) — baixa manual também é dinheiro entrando.
    if (discord?.configured()) {
      const customer = paid.customer ? await repo.get("customers", paid.customer) : null;
      await discord.invoicePaid({ invoice: paid, customerName: customer?.name, via: "baixa manual" });
    }
    return paid;
  });

  // Tick do motor: mudanças agendadas + renovações + dunning + sync de ARR.
  app.post("/api/billing/run", async (req) => {
    const graceDays = req.body?.graceDays != null ? Number(req.body.graceDays) : undefined;
    const report = await runBilling(repo, graceDays != null && !Number.isNaN(graceDays) ? { graceDays } : {});
    // Dunning avisa no Discord só quando ESTE tick marcou algo novo (overdue/
    // pastDue do report são transições, não estoque); a lista mostra o estoque
    // vencido inteiro pra ação.
    if ((report.overdue > 0 || report.pastDue > 0) && discord?.configured()) {
      const lines = [];
      for (const inv of (await repo.list("invoices")).filter((i) => i.status === "overdue")) {
        const c = inv.customer ? await repo.get("customers", inv.customer) : null;
        lines.push(`• ${c?.name || inv.customer || "?"} — R$ ${Number(inv.amount) || 0} (${inv.saas || "?"})`);
      }
      await discord.billingAlert({ report, lines });
    }
    return report;
  });
}
