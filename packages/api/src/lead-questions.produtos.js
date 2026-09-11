// Perguntas de qualificação no CARD do lead, por linha de produto.
//
// DERIVADAS dos formulários públicos (forms-v2.leverads.js) em vez de escritas
// de novo aqui. Eram duas listas paralelas e elas divergiram na primeira vez
// que os formulários mudaram — o card ficaria pedindo campo que o formulário
// não pergunta mais. Uma fonte só resolve isso por construção.
//
// O que fica de fora: nome, telefone e e-mail. Esses já são campos próprios do
// lead (via `mapping`), não respostas de qualificação — repeti-los no card
// mostraria o telefone duas vezes.

import { FORMS_V2, formV2 } from "./forms-v2.leverads.js";

const CONTATO_KEYS = new Set(["nome", "whatsapp", "email"]);

// O asterisco é ênfase da PÁGINA do formulário ("você *já vende*?"); no card
// ele apareceria cru. Mesma limpeza que mergeLeadQuestions faz.
const limpa = (label) => String(label || "").replace(/\*/g, "").trim();

function daPergunta(q) {
  const out = { key: q.key, label: limpa(q.label), type: q.type === "textarea" ? "text" : q.type, required: !!q.required };
  if (q.options?.length) out.options = q.options.map((o) => ({ value: o.value, label: o.label || o.value }));
  return out;
}

export const PRODUTOS = ["oem", "ads", "price"];

export function questionsFor(produto) {
  return (formV2(produto).questions || []).filter((q) => !CONTATO_KEYS.has(q.key)).map(daPergunta);
}

export const LEAD_QUESTIONS_POR_PRODUTO = Object.fromEntries(
  PRODUTOS.map((p) => [p, questionsFor(p)])
);

// União das três, na ordem em que aparecem — é o que a migração leva pro
// `products.leverads.leadQuestions`, já que o pipeline é um só.
export const LEAD_QUESTIONS_UNIAO = (() => {
  const vistas = new Set();
  const out = [];
  for (const f of FORMS_V2) {
    for (const q of f.questions) {
      if (CONTATO_KEYS.has(q.key) || vistas.has(q.key)) continue;
      vistas.add(q.key);
      out.push(daPergunta(q));
    }
  }
  return out;
})();
