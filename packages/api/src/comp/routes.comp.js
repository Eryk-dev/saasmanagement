// Extrato mensal da remuneração: o que cada mês fechado registrou e o botão de
// recalcular. Admin-only (tem R$ por pessoa), no mesmo guard da tela
// Remuneração.

import { stampCompMonth } from "./comp-months.js";
import { computePayroll, generatePayroll } from "./payroll.js";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function registerCompRoutes(app, repo) {
  app.get("/api/comp/months/:saas", async (req, reply) => {
    const saas = String(req.params.saas || "");
    const limite = Math.min(Math.max(Number(req.query?.months) || 6, 1), 24);
    const todos = (await repo.list("comp_months").catch(() => [])).filter((d) => d.saas === saas);
    const meses = [...new Set(todos.filter((d) => d.kind === "month").map((d) => d.month))]
      .sort((a, b) => b.localeCompare(a))
      .slice(0, limite);
    if (!meses.length) return { saas, months: [] };
    const users = await repo.list("users").catch(() => []);
    const nameOf = (id) => users.find((u) => u.id === id)?.name || id;
    const months = meses.map((month) => {
      const header = todos.find((d) => d.kind === "month" && d.month === month) || {};
      const people = todos.filter((d) => d.kind === "person" && d.month === month)
        .map((d) => ({ ...d, name: nameOf(d.uid) }))
        .sort((a, b) => (b.teamBonusValue || 0) - (a.teamBonusValue || 0) || String(a.name).localeCompare(String(b.name)));
      return {
        month,
        stampedAt: header.stampedAt || "",
        by: header.by || "",
        teamBonus: header.teamBonus || { applies: false },
        total: people.reduce((a, p) => a + (Number(p.teamBonusValue) || 0), 0),
        people,
      };
    });
    return { saas, months };
  });

  // FOLHA do mês: o cálculo (fixo + pernas + time por pessoa) e o que já
  // existe em A pagar. `generate` cria/atualiza as contas (revisar antes de pagar).
  app.get("/api/comp/payroll/:saas/:month", async (req, reply) => {
    const month = String(req.params.month || "");
    if (!MONTH_RE.test(month)) return reply.code(400).send({ error: "Mês inválido (use AAAA-MM)." });
    const product = await repo.get("products", String(req.params.saas || ""));
    if (!product) return reply.code(404).send({ error: "Produto não encontrado." });
    return computePayroll(repo, product, month);
  });
  app.post("/api/comp/payroll/:saas/:month/generate", async (req, reply) => {
    const month = String(req.params.month || "");
    if (!MONTH_RE.test(month)) return reply.code(400).send({ error: "Mês inválido (use AAAA-MM)." });
    const product = await repo.get("products", String(req.params.saas || ""));
    if (!product) return reply.code(404).send({ error: "Produto não encontrado." });
    return reply.code(201).send(await generatePayroll(repo, product, month, { by: req.authUser?.id || "api" }));
  });

  app.post("/api/comp/months/:saas/:month/close", async (req, reply) => {
    const month = String(req.params.month || "");
    if (!MONTH_RE.test(month)) return reply.code(400).send({ error: "Mês inválido (use AAAA-MM)." });
    const product = await repo.get("products", String(req.params.saas || ""));
    if (!product) return reply.code(404).send({ error: "Produto não encontrado." });
    const r = await stampCompMonth(repo, product, month, { by: req.authUser?.id || "api" });
    return reply.code(201).send(r);
  });
}
