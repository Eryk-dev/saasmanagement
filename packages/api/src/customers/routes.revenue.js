// Receita da carteira, health e alertas do CRM (lógica em revenue.js,
// health.js e crm-alerts.js). Sob /api/customers: guard de Clientes.
//
//   GET  /api/customers/revenue?from=&to=&saas=   movimentos de MRR, renovações 7/15/30/60 e aging
//   POST /api/customers/health/run                recalcula o health de todos agora (o job roda a cada 6 h)
//   POST /api/customers/alerts/run                roda os alertas agora (o job roda de hora em hora)

import { revenueReport } from "./revenue.js";
import { runHealthSweep } from "./health.js";
import { runCrmAlerts } from "./crm-alerts.js";

const day = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || "")) ? String(v).slice(0, 10) : "");

export function registerRevenueRoutes(app, repo) {
  app.get("/api/customers/revenue", async (req) => revenueReport(repo, {
    from: day(req.query?.from), to: day(req.query?.to), saas: String(req.query?.saas || ""),
  }));
  app.post("/api/customers/health/run", async () => runHealthSweep(repo));
  app.post("/api/customers/alerts/run", async () => runCrmAlerts(repo));
}
