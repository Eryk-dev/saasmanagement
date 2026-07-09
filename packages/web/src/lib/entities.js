// Field configuration for the 6 user-managed entities. One source of truth that
// drives the create/edit form (EntityForm) for every screen. The backend already
// fills safe defaults on create, so only a handful of fields are `required`.
//
// Field types:
//   text · textarea · number · money · pct (stored as a fraction, edited in %) ·
//   select · tags (comma-separated → array) · bool · funnel (ordered stage list)
//
// `options` may be an array or a function (formValues) => array, evaluated at
// render time so dynamic lists (products, people) reflect the live window.SEED.

// ── dynamic option helpers ──────────────────────────────────────────────────
const saasOptions = () => (window.SEED?.SAAS || []).map((s) => ({ value: s.id, label: s.name }));
const peopleOptions = () => Object.values(window.SEED?.PEOPLE || {}).map((p) => ({ value: p.id, label: p.name }));
const stageOptions = (v) => {
  const s = (window.SEED?.SAAS || []).find((x) => x.id === v.saas);
  return (s?.funnel || []).map((f) => ({ value: f.stage, label: f.stage }));
};

// Perguntas de qualificação específicas do pipeline selecionado, viradas em campos
// extras do formulário de lead. Mesmo padrão dinâmico de stageOptions (lê window.SEED
// em tempo de render). Renderizadas/validadas/enviadas pela EntityForm como campos comuns.
export function leadQuestionFields(saasId) {
  const s = (window.SEED?.SAAS || []).find((x) => x.id === saasId);
  return (s?.leadQuestions || []).map((q) => ({
    key: q.key,
    label: q.label,
    required: !!q.required,
    full: true,
    type: q.type === "multiselect" ? "multiselect" : q.type === "select" ? "select" : (q.type || "text"),
    options: q.options,
    allowCustom: !!q.allowCustom, // select com "Outro (digitar)…" → resposta livre
    _dynamic: true,
  }));
}
// Campos custom por entidade definidos em Ajustes (product.customFields.{deals|
// customers|leads}) — mesmo padrão dinâmico de leadQuestionFields: viram campos
// comuns do EntityForm do registro daquele SaaS.
export function customEntityFields(collection, saasId) {
  const s = (window.SEED?.SAAS || []).find((x) => x.id === saasId);
  const list = s?.customFields?.[collection] || [];
  return list.filter((f) => f.key && f.label).map((f) => ({
    key: f.key,
    label: f.label,
    type: ["textarea", "number", "money", "select"].includes(f.type) ? f.type : "text",
    options: (f.options || []).map((o) => (typeof o === "string" ? { value: o, label: o } : o)),
    _dynamic: true,
  }));
}

// ── billing (fase 5): opções dinâmicas por SaaS do formulário ───────────────
const customerOptions = (v) => (window.SEED?.CUSTOMERS || [])
  .filter((c) => !v.saas || c.saas === v.saas)
  .map((c) => ({ value: c.id, label: c.name }));
const planOptions = (v) => (window.PLANS_CACHE || [])
  .filter((p) => !v.saas || p.saas === v.saas)
  .map((p) => ({ value: p.id, label: `${p.name} · ${window.fmt.money(p.price || 0)}/${{ monthly: "mês", quarterly: "tri", semiannual: "sem", annual: "ano" }[p.cycle] || p.cycle}` }));
const CYCLE_OPTS = [
  { value: "monthly", label: "Mensal" },
  { value: "quarterly", label: "Trimestral" },
  { value: "semiannual", label: "Semestral" },
  { value: "annual", label: "Anual" },
];

const SCORE_OPTS = [{ value: "hot", label: "Quente" }, { value: "warm", label: "Morno" }, { value: "cold", label: "Frio" }];
const ACCENT_OPTS = [
  { value: 240, label: "Azul" }, { value: 277, label: "Índigo" }, { value: 300, label: "Violeta" },
  { value: 165, label: "Teal" }, { value: 33, label: "Laranja" }, { value: 12, label: "Vermelho" },
];

export const ENTITIES = {
  products: {
    collection: "products",
    singular: "SaaS",
    titleField: "name",
    fields: [
      { key: "name", label: "Nome", type: "text", required: true },
      { key: "tag", label: "Descrição curta", type: "text" },
      { key: "accent", label: "Cor", type: "select", options: ACCENT_OPTS, default: 240 },
      { key: "plan", label: "Plano", type: "text", placeholder: "Enterprise" },
      { key: "motion", label: "Motion", type: "text", placeholder: "Liderado por vendas" },
      // Métricas (receita, saúde, win rate, NRR, churn, NPS, ciclo…) não são editáveis: o
      // cockpit funciona automaticamente — receita/clientes derivam da coleção de clientes e o
      // resto é empurrado pelos SaaS via API/MCP. Aqui o humano só define identidade + funil.
      { key: "funnel", label: "Funil · estágios", type: "funnel", full: true, help: "Conversão (%) por estágio (a partir do 2º) alimenta a Previsão do pipeline" },
      { key: "leadQuestions", label: "Perguntas de qualificação do lead", type: "questions", full: true, help: "Renderizadas no formulário de novo lead deste pipeline; as obrigatórias travam o cadastro" },
    ],
  },

  deals: {
    collection: "deals",
    singular: "Deal",
    titleField: "title",
    fields: [
      { key: "title", label: "Título", type: "text", required: true },
      { key: "saas", label: "Produto", type: "select", options: saasOptions, required: true },
      { key: "company", label: "Empresa", type: "text" },
      { key: "amount", label: "Valor", type: "money" },
      { key: "stage", label: "Estágio", type: "select", options: stageOptions, blankLabel: "(primeiro estágio)" },
      { key: "owner", label: "Dono", type: "select", options: peopleOptions, blankLabel: "—" },
      { key: "score", label: "Score", type: "select", options: SCORE_OPTS, default: "warm" },
      { key: "source", label: "Origem", type: "text", placeholder: "Outbound" },
      { key: "age", label: "Idade (dias)", type: "number" },
      { key: "flag", label: "Travado?", type: "select", options: [{ value: "stuck", label: "Travado" }], blankLabel: "Não" },
    ],
  },

  customers: {
    collection: "customers",
    singular: "Cliente",
    titleField: "name",
    fields: [
      { key: "name", label: "Conta", type: "text", required: true },
      { key: "saas", label: "Produto", type: "select", options: saasOptions, required: true },
      { key: "email", label: "E-mail", type: "text", help: "payer do Mercado Pago nas assinaturas" },
      { key: "plan", label: "Plano", type: "text" },
      { key: "arr", label: "ARR", type: "money" },
      { key: "startedAt", label: "Cliente desde", type: "date", help: "base da linha do tempo de marcos" },
      { key: "csm", label: "CSM", type: "select", options: peopleOptions, blankLabel: "—" },
      { key: "flags", label: "Flags", type: "tags", help: "separadas por vírgula" },
    ],
  },

  leads: {
    collection: "leads",
    singular: "Lead",
    titleField: "name",
    fields: [
      { key: "name", label: "Nome", type: "text", required: true },
      { key: "saas", label: "Produto", type: "select", options: saasOptions, required: true },
      { key: "company", label: "Empresa", type: "text" },
      { key: "email", label: "E-mail", type: "text" },
      { key: "phone", label: "Telefone", type: "text" },
      { key: "value", label: "Faixa", type: "text", placeholder: "Ent / Mid / SMB" },
      { key: "amount", label: "Valor", type: "money" },
      { key: "owner", label: "Dono", type: "select", options: peopleOptions, blankLabel: "—" },
      { key: "priority", label: "Prioridade", type: "select", options: [{ value: "P0", label: "P0" }, { value: "P1", label: "P1" }, { value: "P2", label: "P2" }], default: "P2" },
      { key: "source", label: "Origem", type: "text", placeholder: "Form · /pricing" },
      { key: "stage", label: "Estágio", type: "select", options: stageOptions, blankLabel: "(primeiro estágio)" },
      { key: "reason", label: "Motivo", type: "textarea", full: true },
      { key: "proposalUrl", label: "URL da proposta", type: "text", full: true },
    ],
  },

  // Forms/propostas têm editor próprio (screens/forms.jsx, screens/proposals.jsx)
  // — estas entradas existem só pro ConfirmDelete compartilhado; não passe essas
  // chaves pro openForm/EntityForm.
  forms: {
    collection: "forms",
    singular: "Form",
    titleField: "name",
    fields: [],
  },
  proposal_templates: {
    collection: "proposal_templates",
    singular: "Template de proposta",
    titleField: "name",
    fields: [],
  },
  proposals: {
    collection: "proposals",
    singular: "Proposta",
    titleField: "name",
    fields: [],
  },

  plans: {
    collection: "plans",
    singular: "Plano",
    titleField: "name",
    fields: [
      { key: "saas", label: "Produto", type: "select", options: saasOptions, required: true },
      { key: "name", label: "Nome", type: "text", required: true },
      { key: "price", label: "Preço por ciclo", type: "money", required: true },
      { key: "cycle", label: "Ciclo", type: "select", options: CYCLE_OPTS, default: "monthly" },
    ],
  },

  subscriptions: {
    collection: "subscriptions",
    singular: "Assinatura",
    titleField: "id",
    fields: [
      { key: "saas", label: "Produto", type: "select", options: saasOptions, required: true },
      { key: "customer", label: "Cliente", type: "select", options: customerOptions, required: true },
      { key: "plan", label: "Plano", type: "select", options: planOptions, blankLabel: "(sem plano — preço avulso)" },
      { key: "price", label: "Preço por ciclo", type: "money", required: true, help: "valor cobrado a cada ciclo; o ARR do cliente é derivado disto" },
      { key: "cycle", label: "Ciclo", type: "select", options: CYCLE_OPTS, default: "monthly" },
    ],
  },

  invoices: {
    collection: "invoices",
    singular: "Fatura",
    titleField: "id",
    fields: [],
  },

  // Tarefas têm editor próprio (screens/tasks.jsx) — entrada só pro ConfirmDelete.
  tasks: {
    collection: "tasks",
    singular: "Tarefa",
    titleField: "title",
    fields: [],
  },

};
