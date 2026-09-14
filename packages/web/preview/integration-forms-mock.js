// Dados fictícios da prancha 7d. Só o preview importa este arquivo.
import { SECTIONS, TERM_TEXT } from "../../api/src/integration-form.js";
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const mode = new URLSearchParams(globalThis.location?.search || "").get("intform");
let failOnce = mode === "error";
let forms = mode === "empty" ? [] : [
  { id: "fi-demo-1", saas: "leverads", customerName: "Zpack Embalagens", customerId: "c1", phone: "5541999990001", status: "pendente", createdAt: daysAgo(9), author: "leo" },
  { id: "fi-demo-2", saas: "leverads", customerName: "Galante Comércio", customerId: "c2", phone: "5541999990002", status: "pendente", createdAt: daysAgo(4), author: "lucas" },
  { id: "fi-demo-3", saas: "leverads", customerName: "Braga Ferramentas", customerId: "c3", phone: "", status: "pendente", createdAt: daysAgo(1), author: "leo" },
  { id: "fi-demo-4", saas: "leverads", customerName: "RN Distribuidora", customerId: "c4", status: "respondido", createdAt: daysAgo(7), respondedAt: daysAgo(2), author: "lucas", sections: SECTIONS, term: TERM_TEXT,
    answers: { nome: "Ricardo Nunes", empresa: "RN Distribuidora", contas: [{ marketplace: "Mercado Livre", apelido: "RN Matriz", papel: "É a conta-mãe (é dela que saem os anúncios)", conectada: "Já está conectada", envio: "Full", setor: "Ferramentas", oficial: "Não" }, { marketplace: "Shopee", apelido: "RN Shopee", papel: "Recebe os anúncios clonados", conectada: "Ainda não conectei", envio: "Agência ou Correios", setor: "Ferramentas", oficial: "Não" }], rotas: [{ origem: "RN Matriz", destino: "RN Shopee", oque: "O catálogo inteiro" }], erp: "Bling", sync: "Sim", termo: true },
    respondent: { name: "Ricardo Nunes", doc: "Documento fictício", at: daysAgo(2), ip: "192.0.2.1" } },
  { id: "fi-demo-elo", saas: "elo", customerName: "Cliente de outro workspace", status: "pendente", createdAt: daysAgo(12), author: "leo" },
];
export const integrationFormsMock = {
  list: (query = {}) => {
    if (failOnce) { failOnce = false; throw new Error("Falha simulada da prévia"); }
    return forms.filter((f) => !query.saas || f.saas === query.saas).map((f) => ({ ...f }));
  },
  create: (data) => {
    const row = { ...data, id: `fi-demo-${Date.now()}`, status: "pendente", createdAt: new Date().toISOString(), author: "leo" };
    forms.push(row);
    return { ...row };
  },
  remove: (id) => { forms = forms.filter((f) => f.id !== id); return { ok: true }; },
};
