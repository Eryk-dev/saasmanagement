// Higiene do Financeiro (12/10/2026) — o que o banco de produção mostrou antes
// da reorganização: espelho do MP sem classificação (dinheiro da própria casa
// somando como venda), CNPJ do próprio Mercado Pago gravado como "pagador",
// custo percentual duplicado, meio de pagamento em texto livre, descrição de
// conta recorrente com o mês do template, fatura paga sem dizer POR QUE está
// paga. Cada migração é idempotente (roda 2x = mesmo estado) e NÃO muda valor,
// status nem número de nada — só carimba o que as réguas novas vão ler.

import { classifyMpPayment, scrubMpOwnDoc, HOUSE_DOCS, MP_OWN_DOC } from "../payments/mp-classify.js";

const digits = (v) => String(v || "").replace(/\D+/g, "");
const norm = (v) => String(v || "").trim().toLowerCase().replace(/\s+/g, " ");

// Lançamento percentual duplicado (mesmo nome, % e base, mesmo produto):
// fica UM — o recorrente mais antigo (o que vale todo mês); os outros saem.
// Em produção: "Checkout" 2x e "Imposto" 2x em jul/2026, ambos contando em dobro.
export async function dedupeExpensePct(repo) {
  const rows = (await repo.list("expenses")).filter((e) => Number(e.pct) > 0);
  const groups = new Map();
  for (const e of rows) {
    const key = [e.saas || "", norm(e.name).replace(/\s*mercado ?pago$/, ""), Number(e.pct), e.base || "won"].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  let removed = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => (b.recurring === true) - (a.recurring === true) || String(a.month || "").localeCompare(String(b.month || "")) || String(a.id).localeCompare(String(b.id)));
    for (const dup of list.slice(1)) { await repo.remove("expenses", dup.id); removed++; }
  }
  return removed;
}

// Pré-classificação do espelho SEM a API (heurística do próprio doc): sai do
// zero já no boot; o poller troca pela classificação forte (classV) conforme
// re-busca cada pagamento. Só toca doc sem `kind`. Também tira o CNPJ do MP
// do campo payerDoc (não é identidade de pagador).
export async function prestampMpPaymentKinds(repo) {
  let n = 0;
  for (const p of await repo.list("mp_payments")) {
    const patch = {};
    if (!p.kind) Object.assign(patch, classifyMpPayment(p, {}), { classV: 0 });
    const scrub = scrubMpOwnDoc(p);
    if (scrub) Object.assign(patch, scrub);
    if (!Object.keys(patch).length) continue;
    await repo.update("mp_payments", p.id, patch, { silent: true });
    n++;
  }
  return n;
}

// Pagamento vinculado a cliente/lead/fatura mas com `saas` vazio entra em
// TODOS os produtos do portfólio (espelho, base de taxa). Herda o produto do
// vínculo; sem vínculo continua vazio (só a Conciliação mostra).
export async function stampMpPaymentSaas(repo) {
  const [mps, customers, leads, invoices] = await Promise.all([
    repo.list("mp_payments"), repo.list("customers"), repo.list("leads"), repo.list("invoices"),
  ]);
  const cs = new Map(customers.map((c) => [c.id, c.saas || ""]));
  const ls = new Map(leads.map((l) => [l.id, l.saas || ""]));
  const is = new Map(invoices.map((i) => [i.id, i.saas || ""]));
  let n = 0;
  for (const p of mps) {
    if (p.saas) continue;
    const saas = (p.customer && cs.get(p.customer)) || (p.lead && ls.get(p.lead)) || (p.invoice && is.get(p.invoice)) || "";
    if (!saas) continue;
    await repo.update("mp_payments", p.id, { saas }, { silent: true });
    n++;
  }
  return n;
}

// Meio de pagamento em TEXTO LIVRE ("6 mil cartao e 12 mil 12x no boleto",
// vindo do "Personalizado" do gate) gravado como id: vira `custom` + o texto
// em paymentTerms. As réguas (à vista × no recebimento) já tratam qualquer
// id fora da lista como "no recebimento", então o valor contado não muda.
export const PAYMENT_METHOD_IDS = new Set(["pix", "boleto_vista", "cartao12x", "boleto", "pix_parcelado", "cartao_recorrente", "custom", ""]);
export async function migratePaymentMethodCustom(repo) {
  let n = 0;
  for (const coll of ["leads", "customers"]) {
    for (const d of await repo.list(coll)) {
      const m = String(d.paymentMethod ?? "");
      if (PAYMENT_METHOD_IDS.has(m)) continue;
      await repo.update(coll, d.id, { paymentMethod: "custom", paymentTerms: d.paymentTerms || m }, { silent: true });
      n++;
    }
  }
  return n;
}

// Instância recorrente herdou da descrição do template o mês em que ele foi
// criado ("Salário set" em outubro). Tira o sufixo de mês da descrição das
// instâncias E do template (a instância é o que a Folha mostra).
const MONTH_SUFFIX = /\s+(de\s+)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)(eiro|ereiro|ço|il|o|ho|sto|embro|ubro)?(\s*\/?\s*\d{2,4})?\s*$/i;
export async function fixPayableDescriptions(repo) {
  let n = 0;
  for (const p of await repo.list("payables")) {
    if (!p.recurring && !p.templateId) continue;
    const desc = String(p.description || "");
    const fixed = desc.replace(MONTH_SUFFIX, "").trim();
    if (!fixed || fixed === desc) continue;
    await repo.update("payables", p.id, { description: fixed }, { silent: true });
    n++;
  }
  return n;
}

// Toda fatura PAGA ganha `paidProof` — por que ela está paga:
//   mp            baixada por pagamento aprovado do Mercado Pago (mpPaymentId)
//   closing       nasceu paga no fechamento (paidAt === periodStart) — PRESUMIDO
//   manual_legacy baixa na mão de antes da prova obrigatória (sem autor/data)
// Não muda status, valor nem data. É o carimbo que a régua de caixa vai ler.
export async function stampInvoicePaidProof(repo) {
  let n = 0;
  for (const i of await repo.list("invoices")) {
    if (i.status !== "paid" || i.paidProof) continue;
    const kind = i.mpPaymentId ? "mp" : (i.periodStart && i.paidAt === i.periodStart) ? "closing" : "manual_legacy";
    await repo.update("invoices", i.id, { paidProof: { kind, at: i.paidAt || "", stamped: "migration" } }, { silent: true });
    n++;
  }
  return n;
}

// Regra de conciliação por documento do próprio MP ou da casa casaria todo
// PIX da conta (ou toda reserva interna) com um cliente. Fora.
export async function purgeBadFinRules(repo) {
  let n = 0;
  for (const r of await repo.list("fin_rules")) {
    if (r.matchField !== "payerDoc") continue;
    const v = digits(r.matchValue);
    if (v !== MP_OWN_DOC && !HOUSE_DOCS.includes(v)) continue;
    await repo.remove("fin_rules", r.id);
    n++;
  }
  return n;
}

// Lançamento "Checkout" (12% sobre o cartão) passa a ler a taxa REAL do MP
// (base taxa_real); o % fica como fallback de pagamento sem líquido.
export async function migrateCheckoutToRealFee(repo) {
  let n = 0;
  for (const e of await repo.list("expenses")) {
    if (!(Number(e.pct) > 0) || e.base !== "cartao12x") continue;
    if (!/checkout|taxa|mercado ?pago|\bmp\b/i.test(String(e.name || ""))) continue;
    await repo.update("expenses", e.id, { base: "taxa_real" }, { silent: true });
    n++;
  }
  return n;
}

// Clientes de SERVIÇO ÚNICO (ciclo "unico") estavam no ARR/MRR como receita
// recorrente (6 em prod, R$ 22 mil) e sem fatura nenhuma. Zera o arr, guarda
// o valor em oneOffAmount e cria a fatura avulsa: paga com prova do MP quando
// há pagamento de cliente do mesmo valor vinculado; presumida (paga, closing)
// no à vista; aberta no resto. Carimbo `oneOffMigrated` = roda uma vez.
export async function migrateOneOffCustomers(repo) {
  const [customers, leads, invoices, mps] = await Promise.all([
    repo.list("customers"), repo.list("leads"), repo.list("invoices"), repo.list("mp_payments"),
  ]);
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const UPFRONT = new Set(["pix", "boleto_vista", "cartao12x", ""]);
  let n = 0;
  for (const c of customers) {
    if (c.oneOffMigrated) continue;
    const lead = leadById.get(c.leadId);
    const isOneOff = c.planCycle === "unico" || lead?.planClosed === "unico";
    if (!isOneOff) continue;
    const amount = Number(c.arr) > 0 ? Number(c.arr) : Number(lead?.amount) || 0;
    const patch = { oneOffMigrated: true, arr: 0, oneOffAmount: Math.round(amount * 100) / 100 };
    const has = invoices.some((i) => i.customer === c.id && (i.oneOff || i.kind === "installment" || Number(i.amount) === amount));
    if (amount > 0 && !has) {
      const at = c.startedAt || new Date().toISOString();
      const pay = mps.find((p) => p.status === "approved" && (!p.kind || p.kind === "venda" || p.kind === "maquininha")
        && (p.customer === c.id || (lead && p.lead === lead.id)) && Math.abs((Number(p.amount) || 0) - amount) < 0.01
        && !invoices.some((i) => i.mpPaymentId === p.mpId));
      const method = c.paymentMethod || lead?.paymentMethod || "";
      const base = { customer: c.id, saas: c.saas || "", amount, kind: "manual", title: c.plan || "Serviço único", oneOff: true, dueDate: at, createdAt: new Date().toISOString() };
      if (pay) {
        await repo.create("invoices", { ...base, status: "paid", paidAt: pay.dateApproved || at, mpPaymentId: pay.mpId, paidMethod: pay.method || "", paidMethodType: pay.methodType || "", paidProof: { kind: "mp", at: pay.dateApproved || at, mpPaymentId: pay.mpId, stamped: "migration" } });
        await repo.update("mp_payments", pay.id, { invoice: "", customer: c.id, saas: c.saas || pay.saas || "" }, { silent: true });
      } else if (UPFRONT.has(String(method))) {
        await repo.create("invoices", { ...base, status: "paid", paidAt: at, paidProof: { kind: "closing", at, stamped: "migration" } });
      } else {
        await repo.create("invoices", { ...base, status: "open" });
      }
    }
    await repo.update("customers", c.id, patch, { silent: true });
    n++;
  }
  return n;
}

// Cadastro da FOLHA confirmado pelo Leo em 12/10/2026 (uma vez; carimbo
// payrollSeedV1 no usuário). Quem já tem o campo não é tocado.
//   Manuela SDR júnior · Vitor closer júnior (CLT) · Yudi CS júnior · Igor mídia
//   social/videomaker com fixo R$ 4.500 · Eryk, Jonan, Jonathan, Leonardo =
//   retirada não definida (entram só por lançamento) · o resto fora da folha.
const PAYROLL_SEED = {
  sdr: { payrollRole: "sdr", compLevel: 1, payrollRegime: "clt" },
  us_mrqkn2tm03: { payrollRole: "closer", compLevel: 1, payrollRegime: "clt" },
  us_mu1iysva01: { payrollRole: "cs", compLevel: 1 },
  igor: { payrollRole: "social", payrollFixed: 4500, payrollNote: "videomaker" },
  eryk: { payrollRole: "manual" }, jonan: { payrollRole: "manual" }, jonathan: { payrollRole: "manual" }, leonardo: { payrollRole: "manual" },
};
export async function seedPayrollSetup(repo) {
  let n = 0;
  for (const u of await repo.list("users")) {
    if (u.payrollSeedV1) continue;
    const seed = PAYROLL_SEED[u.id] || { payrollRole: "none" };
    const patch = { payrollSeedV1: true };
    for (const [k, v] of Object.entries(seed)) if (u[k] == null || u[k] === "") patch[k] = v;
    await repo.update("users", u.id, patch, { silent: true });
    n++;
  }
  return n;
}

export const FIN_MIGRATIONS = [
  ["dedupeExpensePct", dedupeExpensePct, "lançamento(s) percentual(is) duplicado(s) removido(s)"],
  ["migrateCheckoutToRealFee", migrateCheckoutToRealFee, "lançamento(s) de checkout lendo a taxa real do MP"],
  ["prestampMpPaymentKinds", prestampMpPaymentKinds, "pagamento(s) do espelho MP pré-classificado(s)"],
  ["stampMpPaymentSaas", stampMpPaymentSaas, "pagamento(s) do espelho MP com produto herdado do vínculo"],
  ["migratePaymentMethodCustom", migratePaymentMethodCustom, "meio(s) de pagamento em texto livre → custom"],
  ["fixPayableDescriptions", fixPayableDescriptions, "conta(s) a pagar com mês tirado da descrição"],
  ["stampInvoicePaidProof", stampInvoicePaidProof, "fatura(s) paga(s) com paidProof carimbado"],
  ["purgeBadFinRules", purgeBadFinRules, "regra(s) de conciliação por documento da casa/MP removida(s)"],
  ["migrateOneOffCustomers", migrateOneOffCustomers, "cliente(s) de serviço único fora do ARR, com fatura avulsa"],
  ["seedPayrollSetup", seedPayrollSetup, "usuário(s) com o cadastro da folha carimbado"],
];

export async function runFinMigrations(repo, { log = console } = {}) {
  const out = {};
  for (const [name, fn, label] of FIN_MIGRATIONS) {
    try {
      const n = await fn(repo);
      out[name] = n;
      if (n) log.log?.(`[migration] ${n} ${label}`);
    } catch (err) {
      out[name] = null;
      log.error?.(`[migration] ${name} falhou:`, err?.message || err);
    }
  }
  return out;
}
