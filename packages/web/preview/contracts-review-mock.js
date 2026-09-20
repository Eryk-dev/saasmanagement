const params = new URLSearchParams(location.search);
export const contractsReview = params.get("review") === "contracts";
let models = [],
  issues = [];
const fields = [
  {
    key: "razao_social",
    label: "Razão social / Nome",
    placeholder: "quem assina",
  },
  { key: "cnpj_cpf", label: "CNPJ / CPF", placeholder: "só números" },
  { key: "valor_total", label: "Valor total", placeholder: "ex.: 7.188,00" },
  {
    key: "forma_pagamento",
    label: "Forma de pagamento",
    placeholder: "ex.: 12x de 599 no cartão",
  },
  { key: "vigencia", label: "Vigência", placeholder: "ex.: 12 meses" },
];
const body =
  '<h1>Contrato de revisão</h1><table class="quadro"><tr><th>Contratada</th><td>LEVER ADS SOFTWARE HOUSE LTDA · CNPJ 67.931.740/0001-12</td></tr><tr><th>Contratante</th><td>{{razao_social}} · {{cnpj_cpf}}</td></tr><tr><th>Investimento</th><td>R$ {{valor_total}} · {{forma_pagamento}}</td></tr><tr><th>Vigência</th><td>{{vigencia}}</td></tr></table>';
export function setupContractsReview(seed) {
  models = [
    [
      "Lever Ads · assinatura anual",
      "assinatura",
      "plano cheio, 12x de 599 ou à vista no Pix",
    ],
    [
      "Lever OEM · assinatura semestral",
      "assinatura",
      "meia entrada da escada",
    ],
    ["Lever Price · Enterprise", "enterprise", "conta grande, valor negociado"],
    [
      "Serviço único · réplica de catálogo",
      "serviço",
      "último degrau da escada, sem recorrência",
    ],
  ].map(([name, tag, note], i) => ({
    id: `m${i + 1}`,
    saas: "leverads",
    name,
    tag,
    note,
    body,
    fields,
  }));
  seed.CUSTOMERS = [
    "Galante Holding",
    "Studio Kern",
    "Clínica Arbo",
    "Nutri Vitta",
    "Oficina Prado",
    "Mercado Ponto",
    "Grupo Vante",
    "Instituto Rima",
    "Padaria Dovale",
    "Unique Baby",
    "Menezes Auto",
  ].map((name, i) => ({
    id: `c${i}`,
    name,
    saas: "leverads",
    email: "cliente@example.test",
    contact: "Contato",
    phone: "11999998888",
  }));
  seed.USERS.push(
    { id: "rafael", name: "Rafael Moura", roles: ["closer"] },
    { id: "bruno", name: "Bruno Alencar", roles: ["closer"] },
    { id: "manuela", name: "Manuela Costa", roles: ["closer"] },
  );
  issues = [
    ["m1", "Studio Kern", "rafael", 2],
    ["m4", "Nutri Vitta", "rafael", 3],
    ["m2", "Oficina Prado", "bruno", 4],
    ["m1", "Clínica Arbo", "rafael", 8],
    ["m2", "Mercado Ponto", "manuela", 10],
    ["m2", "Grupo Vante", "bruno", 15],
    ["m3", "Galante Holding", "rafael", 34],
    ["m1", "Instituto Rima", "rafael", 22],
  ].map(([contract, customerName, author, days], i) => ({
    ...models.find((m) => m.id === contract),
    id: `i${i}`,
    contract,
    customerName,
    customerId: seed.CUSTOMERS.find((c) => c.name === customerName).id,
    author,
    createdAt: new Date(Date.now() - days * 86400000).toISOString(),
    values: {
      razao_social: customerName,
      cnpj_cpf: "12345678901",
      valor_total: "7.188,00",
      forma_pagamento: "12x no cartão",
      vigencia: "12 meses",
    },
  }));
  if (params.get("state") === "many")
    issues.push(
      ...Array.from({ length: 20 }, (_, i) => ({
        ...issues[0],
        id: `extra-${i}`,
        customerName: `Cliente ${i}`,
      })),
    );
  if (params.get("state") === "empty") {
    models = [];
    issues = [];
  }
  window.__reviewMutations = [];
  window.__reviewPrints = [];
  window.__reviewReads = [];
  window.open = () =>
    params.has("blockedPrint")
      ? null
      : {
          document: {
            write: (html) => window.__reviewPrints.push(html),
            close() {},
          },
          focus() {},
          print() {},
        };
  if (params.has("clipboardFail"))
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => {
          throw new Error("Não foi possível copiar o contrato.");
        },
      },
    });
}
const failures = new Set();
function failOnce(method) {
  if (params.get("failOnce") === method && !failures.has(method)) {
    failures.add(method);
    throw new Error("Não foi possível concluir. Tente novamente.");
  }
}
let failed = false;
export const contractsReviewMock = {
  list: async (col, args) => {
    window.__reviewReads.push({ col, args });
    failOnce(`list:${col}`);
    if (col === "contract_issues" && params.has("historyFail") && !failed) {
      failed = true;
      throw new Error("Falha simulada no histórico");
    }
    if (col === "contract_issues" && params.has("holdHistory"))
      await new Promise((resolve) => {
        window.__releaseHistory = resolve;
      });
    return col === "contracts"
      ? structuredClone(models)
      : col === "contract_issues"
        ? structuredClone(issues)
        : window.SEED[col.toUpperCase()] || [];
  },
  create: async (col, data) => {
    failOnce(`create:${col}`);
    if (params.has("holdSave"))
      await new Promise((resolve) => {
        window.__releaseSave = resolve;
      });
    const list = col === "contracts" ? models : issues,
      item = { ...data, id: `new-${list.length}` };
    list.push(item);
    window.__reviewMutations.push({ method: "create", col, data });
    return item;
  },
  update: async (col, id, data) => {
    failOnce(`update:${col}`);
    Object.assign(
      models.find((m) => m.id === id),
      data,
    );
    window.__reviewMutations.push({ method: "update", col, id, data });
    return { id, ...data };
  },
  remove: async (col, id) => {
    failOnce(`remove:${col}`);
    if (col === "contracts") models = models.filter((m) => m.id !== id);
    else issues = issues.filter((i) => i.id !== id);
    window.__reviewMutations.push({ method: "remove", col, id });
    return { ok: true };
  },
};
