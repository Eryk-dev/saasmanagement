import { SECTIONS, TERM_TEXT } from "../../api/src/integration-form.js";
import {
  FISCAL_SECTIONS,
  FISCAL_TERM_TEXT,
} from "../../api/src/fiscal-form.js";
const params = new URLSearchParams(location.search);
export const intformReview = params.get("review") === "intform";
let forms = [];
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
const failed = new Set();
function failOnce(method) {
  if (params.get("failOnce") === method && !failed.has(method)) {
    failed.add(method);
    throw new Error("Falha simulada. Tente novamente.");
  }
}
export function setupIntformReview(seed) {
  seed.USERS.push({ id: "vitor", name: "Vitor Nunes", roles: ["cs"] });
  const data = [
    ["Studio Kern", "integracao", null, 2],
    ["Clínica Arbo", "integracao", null, 7],
    ["Mercado Ponto", "nota_fiscal", null, 9],
    ["Grupo Vante", "integracao", 6],
    ["Menezes Auto", "nota_fiscal", 5],
    ["Padaria Dovale", "integracao", 3],
    ["Instituto Rima", "nota_fiscal", 1],
    ["Nutri Vitta", "integracao", null, 14],
  ];
  seed.CUSTOMERS = data.map(([name], i) => ({
    id: `int-c${i}`,
    name,
    saas: "leverads",
    phone: "5511999990001",
  }));
  seed.LEADS = [
    {
      id: "int-l1",
      name: "Ana",
      company: "Unique Baby",
      saas: "leverads",
      phone: "5511999990002",
      stage: "Ganho",
    },
  ];
  forms = data.map(([name, kind, waiting, response], i) => ({
    id: `fi-${i}`,
    saas: "leverads",
    kind,
    customerId: `int-c${i}`,
    customerName: name,
    phone: i === 6 ? "" : "5511999990001",
    author: kind === "integracao" ? "vitor" : "leo",
    createdAt: ago(waiting ?? response + 2),
    status: waiting === null ? "respondido" : "pendente",
    respondedAt: waiting === null ? ago(response) : null,
    sections:
      waiting === null
        ? kind === "nota_fiscal"
          ? FISCAL_SECTIONS
          : SECTIONS
        : undefined,
    term:
      waiting === null
        ? kind === "nota_fiscal"
          ? FISCAL_TERM_TEXT
          : TERM_TEXT
        : undefined,
    answers:
      waiting === null
        ? kind === "nota_fiscal"
          ? {
              tipo: "Pessoa jurídica (CNPJ)",
              razao_social: "Mercado Ponto Comércio de Alimentos LTDA",
              cnpj: "28.114.907/0001-33",
              regime: "Simples Nacional",
              cidade: "São Paulo",
              uf: "SP",
              termo_aceite: true,
            }
          : {
              nome: name,
              contas: [
                {
                  marketplace: "Mercado Livre",
                  apelido: `${name} ML`,
                  papel: "Conta-mãe",
                },
                {
                  marketplace: "Shopee",
                  apelido: `${name} Shopee`,
                  papel: "Recebe os anúncios",
                },
              ],
              rotas: [
                {
                  origem: `${name} ML`,
                  destino: `${name} Shopee`,
                  oque: "Todo o catálogo",
                },
              ],
              erp: "Bling",
              sync: "Sim",
              termo: true,
            }
        : {},
    respondent:
      waiting === null
        ? {
            name: `Responsável de ${name}`,
            doc: "Documento fictício",
            at: ago(response),
            ip: "192.0.2.1",
          }
        : undefined,
  }));
  if (params.get("state") === "empty") forms = [];
  if (params.get("state") === "many")
    forms.push(
      ...Array.from({ length: 55 }, (_, i) => ({
        ...forms[3],
        id: `extra-${i}`,
        customerName: `Cliente ${i}`,
      })),
    );
  if (params.has("long"))
    forms[0].answers.nome = "Nome com uma resposta extensa ".repeat(25);
  window.__reviewMutations = [];
  window.__reviewReads = [];
  if (params.has("clipboardFail"))
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => {
          throw new Error("Clipboard bloqueado");
        },
      },
    });
}
export const intformReviewMock = {
  list: async (col, query) => {
    window.__reviewReads.push({ method: "list", col, query });
    if (col === "integration_forms" && params.has("holdList"))
      await new Promise((resolve) => {
        window.__releaseList = resolve;
      });
    return col === "integration_forms"
      ? structuredClone(
          forms.filter((doc) => !query?.saas || doc.saas === query.saas),
        )
      : window.SEED[col.toUpperCase()] || [];
  },
  create: async (col, data) => {
    if (params.has("holdCreate"))
      await new Promise((resolve) => {
        window.__releaseCreate = resolve;
      });
    const doc = {
      ...data,
      id: `new-${forms.length}`,
      status: "pendente",
      createdAt: ago(0),
      author: "leo",
    };
    forms.unshift(doc);
    window.__reviewMutations.push({ method: "create", col, data });
    return doc;
  },
  remove: async (col, id) => {
    if (params.has("holdRemove"))
      await new Promise((resolve) => {
        window.__releaseRemove = resolve;
      });
    forms = forms.filter((doc) => doc.id !== id);
    window.__reviewMutations.push({ method: "remove", col, id });
    return { ok: true };
  },
  integrationFormQuestions: async (kind) => {
    window.__reviewReads.push({ method: "questions", kind });
    failOnce("questions");
    return {
      kind,
      sections: kind === "nota_fiscal" ? FISCAL_SECTIONS : SECTIONS,
    };
  },
};
