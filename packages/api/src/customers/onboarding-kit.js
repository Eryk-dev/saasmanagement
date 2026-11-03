// Kit da integração (03/11/2026, "Modo integração"): tudo que o operador precisa
// na call, numa leitura só. Antes ficava em quatro lugares: o formulário de
// integração (tela própria, coleção `integration_forms`), o resumo da venda (a
// atividade `integration_brief` do lead), as pendências do cliente (carimbo
// `lead.clientPending`) e os guias do checklist.
//
// Só leitura. Devolve também `missing`: o que falta ANTES de começar
// (formulário não respondido, sistema sem conta, pendência do cliente aberta),
// para o aviso do topo do modo integração.

import { contactsOf } from "./lifecycle.js";
import { productsSummary } from "./customer-status.js";
import { progressOf } from "./onboardings.js";
import { GUIDES } from "../guides/guides.js";

const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const PRODUCT = { leverads: "LeverAds", leverprice: "LeverPrice" };

const valueText = (v) => (typeof v === "boolean" ? (v ? "✓ Sim" : "✕ Não") : String(v ?? "").trim() || "—");

// Respostas do formulário pelo SNAPSHOT gravado no envio (doc.sections), na
// ordem das seções; pergunta de lista vira uma linha por item.
export function formSections(doc) {
  const answers = doc?.answers || {};
  return (doc?.sections || []).map((sec) => ({
    title: sec.title || "",
    items: (sec.questions || []).filter((q) => answers[q.key] !== undefined).map((q) => {
      const v = answers[q.key];
      if (Array.isArray(v)) {
        return {
          label: q.label || q.key,
          rows: v.map((row) => (q.fields || []).map((f) => `${f.label}: ${valueText(row?.[f.key])}`).join(" · ")),
        };
      }
      return { label: q.label || q.key, value: valueText(v) };
    }),
  })).filter((sec) => sec.items.length);
}

const isIntegrationForm = (d) => (d.kind || "integracao") === "integracao";

async function formOf(repo, customer, lead) {
  const [byCustomer, byLead] = await Promise.all([
    repo.listWhere("integration_forms", { customerId: customer.id }),
    lead ? repo.listWhere("integration_forms", { leadId: lead.id }) : [],
  ]);
  const all = [...new Map([...byCustomer, ...byLead].map((d) => [d.id, d])).values()].filter(isIntegrationForm);
  if (!all.length) return null;
  // O respondido mais recente vence; sem resposta, o pedido mais recente.
  const answered = all.filter((d) => d.status === "respondido").sort((a, b) => String(b.respondedAt).localeCompare(String(a.respondedAt)));
  const doc = answered[0] || all.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  return { id: doc.id, status: doc.status || "pendente", respondedAt: doc.respondedAt || "", createdAt: doc.createdAt || "", sections: doc.status === "respondido" ? formSections(doc) : [] };
}

async function briefOf(repo, lead) {
  if (!lead) return null;
  const acts = await repo.listWhere("activities", { lead: lead.id });
  const b = acts.filter((a) => a.meta?.event === "integration_brief" && a.meta?.brief)
    .sort((a, b2) => String(b2.at).localeCompare(String(a.at)))[0];
  return b ? { at: b.at, ...b.meta.brief } : null;
}

export function missingOf({ form, products, clientPending, onboarding }) {
  const out = [];
  if (!form) out.push({ key: "form", tone: "neg", text: "O formulário de integração ainda não foi enviado ao cliente." });
  else if (form.status !== "respondido") out.push({ key: "form", tone: "neg", text: "O cliente ainda não respondeu o formulário de integração." });
  for (const p of products) {
    if (p.account === false) out.push({ key: `conta:${p.id}`, tone: "warn", text: `O cliente ainda não tem conta no ${PRODUCT[p.id] || p.id}: mande o link de cadastro pelo card.` });
  }
  if (clientPending?.open) {
    out.push({ key: "pendencias", tone: clientPending.overdue ? "neg" : "warn", text: `${clientPending.open} ${clientPending.open === 1 ? "pendência do cliente em aberto" : "pendências do cliente em aberto"}${clientPending.overdue ? ` (${clientPending.overdue} ${clientPending.overdue === 1 ? "atrasada" : "atrasadas"})` : ""}.` });
  }
  if (!onboarding.integrator) out.push({ key: "integrador", tone: "warn", text: "A integração está sem integrador." });
  return out;
}

export async function onboardingKit(repo, id, { editor = false } = {}) {
  const o = await repo.get("onboardings", id);
  if (!o) throw fail(404, "Integração não encontrada.");
  const customer = await repo.get("customers", o.customer);
  if (!customer) throw fail(404, "Cliente da integração não encontrado.");
  const leadId = o.lead || customer.leadId || "";
  const lead = leadId ? await repo.get("leads", leadId) : null;
  const guideIds = [...new Set((o.items || []).map((it) => it.guide?.id).filter(Boolean))];
  const [form, brief, plans, guides] = await Promise.all([
    formOf(repo, customer, lead),
    briefOf(repo, lead),
    repo.listWhere("plans", { saas: customer.saas || "" }),
    Promise.all(guideIds.map((gid) => repo.get(GUIDES, gid))),
  ]);
  const products = productsSummary(customer, plans);
  const clientPending = lead?.clientPending || null;
  return {
    onboarding: { ...o, progress: progressOf(o) },
    customer: {
      id: customer.id, name: customer.name || "", plan: customer.plan || "", owner: customer.owner || "",
      products, contacts: contactsOf(customer, lead),
    },
    // Escopo do que foi vendido, sem dinheiro: o integrador não fala de pagamento.
    deal: lead ? { id: lead.id, closer: lead.closer || "", dealProduct: lead.dealProduct || "", integrationAt: lead.integrationAt || "", integrationCallUrl: lead.integrationCallUrl || "" } : null,
    form, brief, clientPending,
    guides: Object.fromEntries(guides.filter((g) => g && (editor || g.status === "publicado")).map((g) => [g.id, g])),
    missing: missingOf({ form, products, clientPending, onboarding: o }),
  };
}
