// Rotas de billing (fase 5) — mudança de plano com pró-rata, baixa de fatura e o
// tick do motor. CRUD cru de plans/subscriptions/invoices fica no CRUD genérico
// (routes.js), que já sincroniza o ARR nas mutações de assinatura.

import { computeChange, runBilling, syncCustomerArr } from "./billing.js";

export function registerBillingRoutes(app, repo, { mp, discord } = {}) {
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
