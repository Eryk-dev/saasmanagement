// Resultados do cliente na ficha: o número vivo (o mesmo que vai no relatório
// mensal) e o envio manual. O bloco existe pra quem cuida da conta abrir a ficha
// na call e ter a evidência de serviço na mão, sem depender do relatório do mês.

import { orgSnapshot } from "./leverads-results.js";
import { sendCustomerReport, reportBlocker, reportWhatsApp } from "./customer-reports.js";

export function registerCustomerResultsRoutes(app, repo, { mailer = null, whatsapp = null, snapshot = orgSnapshot } = {}) {
  // Retrato vivo + os últimos relatórios enviados.
  app.get("/api/customers/:id/results", async (req, reply) => {
    const customer = await repo.get("customers", req.params.id);
    if (!customer) return reply.code(404).send({ error: "Cliente não encontrado." });
    const reports = (await repo.list("customer_reports").catch(() => []))
      .filter((r) => r.customer === customer.id)
      .sort((a, b) => String(b.periodEnd || "").localeCompare(String(a.periodEnd || "")))
      .slice(0, 6);
    if (!customer.leveradsOrgId) {
      return { hasOrg: false, snapshot: null, reports, blocker: "sem org da LeverAds no cadastro" };
    }
    const map = await snapshot([customer.leveradsOrgId]);
    const snap = map.get(String(customer.leveradsOrgId)) || null;
    return {
      hasOrg: true,
      snapshot: snap,
      reports,
      blocker: reportBlocker(customer, { lastAt: reports[0]?.periodEnd || "" }),
      preview: snap ? reportWhatsApp(customer, snap) : "",
    };
  });

  // Envio manual pela ficha ("enviar relatório agora").
  app.post("/api/customers/:id/report/send", async (req, reply) => {
    const customer = await repo.get("customers", req.params.id);
    if (!customer) return reply.code(404).send({ error: "Cliente não encontrado." });
    if (!customer.leveradsOrgId) {
      // 4xx e não 5xx de propósito: o EasyPanel transforma 5xx em "Service is
      // not reachable" e o time perde a mensagem que explica o que fazer.
      return reply.code(422).send({ error: "Vincule a org da LeverAds no cadastro do cliente pra ter o número.", code: "no_org" });
    }
    const map = await snapshot([customer.leveradsOrgId]);
    const snap = map.get(String(customer.leveradsOrgId));
    if (!snap) return reply.code(424).send({ error: "Não consegui falar com o banco do produto agora. Tente de novo em instantes.", code: "no_results" });
    const doc = await sendCustomerReport(repo, customer, snap, { mailer, whatsapp, by: req.authUser?.id || "api" });
    return reply.code(201).send({ id: doc.id, status: doc.status, email: doc.email, whatsapp: doc.whatsapp, taskId: doc.taskId, reason: doc.reason || "" });
  });
}
