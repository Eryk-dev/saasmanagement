// MCP tools — the integration surface for your other SaaS and any AI agent.
// Every tool is a thin wrapper over the Cockpit REST API (the single source of
// truth), so reads reflect live data and writes flow straight into the cockpit.

import { z } from "zod";
import { apiClient } from "./apiClient.js";

const ok = (data) => ({
  content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
});
const fail = (e) => ({ content: [{ type: "text", text: `Error: ${e.message || e}` }], isError: true });
const wrap = (fn) => async (args) => {
  try { return ok(await fn(args || {})); } catch (e) { return fail(e); }
};

export function registerTools(server) {
  // ── Overview ──────────────────────────────────────────────────────────────
  server.registerTool("portfolio_summary", {
    title: "Portfolio summary",
    description: "Portfolio-wide KPIs (MRR, ARR, net-new MRR, NRR, customers) plus a per-product snapshot. The fastest answer to 'how is my portfolio today?'.",
  }, wrap(async () => {
    const [portfolio, products] = await Promise.all([apiClient.portfolio(), apiClient.list("products")]);
    return {
      portfolio,
      products: products.map((p) => ({
        id: p.id, name: p.name, mrr: p.mrr, mrrDelta: p.mrrDelta,
        health: p.health, healthTrend: p.healthTrend, nrr: p.nrr, churnRate: p.churnRate,
      })),
    };
  }));

  server.registerTool("list_products", {
    title: "List products (SaaS)",
    description: "Every SaaS product in the portfolio with full metrics (MRR, ARR, NRR, GRR, funnel, churn, NPS, activation, NNM waterfall).",
  }, wrap(() => apiClient.list("products")));

  server.registerTool("get_product", {
    title: "Get one product",
    description: "Full record for a single SaaS by id (leverads | quill | mesa | …).",
    inputSchema: { id: z.string().describe("Product id, e.g. 'quill'") },
  }, wrap(({ id }) => apiClient.get("products", id)));

  server.registerTool("update_product_metrics", {
    title: "Update product metrics (ingest)",
    description: "Push/patch metrics for a product from an external SaaS (e.g. nightly job sends mrr, churnRate, activation). Merges fields onto the existing record.",
    inputSchema: {
      id: z.string().describe("Product id to update"),
      patch: z.record(z.any()).describe("Partial metrics object to merge, e.g. { mrr: 190000, churnRate: 0.01 }"),
    },
  }, wrap(({ id, patch }) => apiClient.update("products", id, patch)));

  // ── Attention queue ───────────────────────────────────────────────────────
  server.registerTool("list_attention", {
    title: "List attention signals",
    description: "Prioritized anomaly/opportunity queue (severity × age) — 'where do I need to act this week?'. Each item links to evidence.",
    inputSchema: { severity: z.enum(["critical", "high", "medium", "low"]).optional() },
  }, wrap(async ({ severity }) => {
    const items = await apiClient.list("attention");
    return severity ? items.filter((a) => a.severity === severity) : items;
  }));

  // ── Pipeline / deals ──────────────────────────────────────────────────────
  server.registerTool("list_deals", {
    title: "List deals",
    description: "Pipeline deals across products. Filter by saas, stage and/or owner.",
    inputSchema: {
      saas: z.string().optional().describe("Filter by product id"),
      stage: z.string().optional().describe("Filter by funnel stage, e.g. 'Discovery'"),
      owner: z.string().optional().describe("Filter by owner code, e.g. 'PR'"),
    },
  }, wrap((q) => apiClient.list("deals", q)));

  server.registerTool("move_deal", {
    title: "Move deal to stage",
    description: "Advance/move a deal to a different funnel stage. Reflects immediately in the cockpit pipeline.",
    inputSchema: { id: z.string(), stage: z.string().describe("Target stage name") },
  }, wrap(({ id, stage }) => apiClient.update("deals", id, { stage })));

  server.registerTool("create_deal", {
    title: "Create deal",
    description: "Create a pipeline deal (e.g. from an external form/CRM). Id is generated if omitted.",
    inputSchema: {
      saas: z.string().describe("Product id"),
      title: z.string(),
      company: z.string().optional(),
      amount: z.number().optional(),
      stage: z.string().optional(),
      owner: z.string().optional(),
      score: z.enum(["hot", "warm", "cold"]).optional(),
      source: z.string().optional(),
    },
  }, wrap((deal) => apiClient.create("deals", deal)));

  // ── Customers ─────────────────────────────────────────────────────────────
  server.registerTool("list_customers", {
    title: "List customers",
    description: "Customer accounts with health, ARR, usage, renewal and flags. Filter by health band (red/yellow/green) or saas — 'who needs me today?'.",
    inputSchema: {
      band: z.enum(["red", "yellow", "green"]).optional().describe("red <50, yellow 50-69, green >=70"),
      saas: z.string().optional(),
    },
  }, wrap((q) => apiClient.list("customers", q)));

  server.registerTool("get_customer", {
    title: "Get one customer",
    description: "Full record for a single customer account by id.",
    inputSchema: { id: z.string() },
  }, wrap(({ id }) => apiClient.get("customers", id)));

  // ── Leads ─────────────────────────────────────────────────────────────────
  server.registerTool("list_leads", {
    title: "List leads",
    description: "SDR worklist — prioritized leads. Filter by priority (P0/P1/P2).",
    inputSchema: { priority: z.enum(["P0", "P1", "P2"]).optional() },
  }, wrap((q) => apiClient.list("leads", q)));

  server.registerTool("create_lead", {
    title: "Create lead (ingest)",
    description: "Create a lead from an external form/funnel and drop it into the worklist for the right SaaS.",
    inputSchema: {
      name: z.string(),
      company: z.string(),
      saas: z.string().describe("Product id the lead belongs to"),
      priority: z.enum(["P0", "P1", "P2"]).optional(),
      score: z.number().optional(),
      reason: z.string().optional(),
      source: z.string().optional(),
      stage: z.string().optional(),
      value: z.string().optional(),
    },
  }, wrap((lead) => apiClient.create("leads", lead)));

  // ── NPS ───────────────────────────────────────────────────────────────────
  server.registerTool("list_nps", {
    title: "List NPS responses",
    description: "Raw NPS responses with score, role, tags and verbatim text. Filter by saas.",
    inputSchema: { saas: z.string().optional() },
  }, wrap((q) => apiClient.list("nps", q)));

  server.registerTool("create_nps", {
    title: "Create NPS response (ingest)",
    description: "Record an NPS response from a survey tool. Score 0-10; <=6 is a detractor.",
    inputSchema: {
      saas: z.string(),
      score: z.number().min(0).max(10),
      role: z.string().optional(),
      tags: z.array(z.string()).optional(),
      text: z.string().optional(),
    },
  }, wrap((n) => apiClient.create("nps", n)));

  // ── Goals & leaderboard ───────────────────────────────────────────────────
  server.registerTool("list_goals", {
    title: "List goals",
    description: "Pacing goals (target vs current vs projected) with green/yellow/red bands. Optional scope filter (Portfolio/LeverAds/Quill/Mesa).",
    inputSchema: { scope: z.string().optional() },
  }, wrap((q) => apiClient.list("goals", q)));

  server.registerTool("leaderboard", {
    title: "Leaderboard",
    description: "Sales/CS leaderboard. scope 'month' (resettable categories) or 'all' (career history).",
    inputSchema: { scope: z.enum(["month", "all"]).default("month") },
  }, wrap(({ scope }) => apiClient.leaderboard(scope || "month")));
}
