// Poller do motor de billing — fecha a pendência do PLANO-REWORK ("rodar
// POST /api/billing/run periodicamente"): renovações, dunning e pendingChange
// agendado agora andam sozinhos, sem depender de alguém chamar a rota.
// O tick é o MESMO runBilling da rota (idempotente e barato); o aviso de
// dunning no Discord segue a regra da rota: só quando ESTE tick marcou algo
// novo, listando o estoque vencido inteiro pra ação.

import { runBilling } from "./billing.js";
import { discord as defaultDiscord } from "./discord.js";

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1h — rollover/dunning é diário por natureza

// Carência do dunning (dias após o vencimento até a fatura virar overdue).
// Sem env válido, vale o default do motor (3).
function graceOpts() {
  const graceDays = Number(process.env.BILLING_GRACE_DAYS);
  return Number.isFinite(graceDays) && graceDays >= 0 ? { graceDays } : {};
}

export async function billingTick(repo, { log, discordClient = defaultDiscord } = {}) {
  const report = await runBilling(repo, graceOpts());
  const moved = report.applied || report.renewed || report.overdue || report.pastDue || report.recovered;
  if (moved) log?.info({ report }, "billing: tick moveu registros");
  if ((report.overdue > 0 || report.pastDue > 0) && discordClient?.configured()) {
    const lines = [];
    for (const inv of (await repo.list("invoices")).filter((i) => i.status === "overdue")) {
      const c = inv.customer ? await repo.get("customers", inv.customer) : null;
      lines.push(`• ${c?.name || inv.customer || "?"} — R$ ${Number(inv.amount) || 0} (${inv.saas || "?"})`);
    }
    await discordClient.billingAlert({ report, lines });
  }
  return report;
}

export function startBilling(repo, { log, intervalMs, discordClient } = {}) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await billingTick(repo, { log, discordClient }); }
    catch (err) { log?.warn({ err: err.message }, "billing: tick falhou"); }
    finally { running = false; }
  };
  tick();
  const timer = setInterval(tick, intervalMs || DEFAULT_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
