// Dados fictícios da prancha 7d. Só o preview importa este arquivo.
import { SECTIONS, TERM_TEXT } from "../../api/src/integration-form.js";
import { FISCAL_SECTIONS, FISCAL_TERM_TEXT } from "../../api/src/fiscal-form.js";
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
  { id: "fi-demo-5", saas: "leverads", kind: "nota_fiscal", customerName: "Zpack Embalagens", customerId: "c1", phone: "5541999990001", status: "pendente", createdAt: daysAgo(3), author: "leo" },
  { id: "fi-demo-6", saas: "leverads", kind: "nota_fiscal", customerName: "RN Distribuidora", customerId: "c4", status: "respondido", createdAt: daysAgo(6), respondedAt: daysAgo(5), author: "lucas", sections: FISCAL_SECTIONS, term: FISCAL_TERM_TEXT,
    answers: { nome: "Ricardo Nunes", funcao: "Sócio", whatsapp: "41999990004", email: "financeiro@rn.example", tipo: "Pessoa jurídica (CNPJ)", razao_social: "RN Distribuidora de Ferramentas LTDA", nome_fantasia: "RN Distribuidora", cnpj: "12.345.678/0001-90", inscricao_estadual: "Isento", regime: "Simples Nacional", cep: "80010-000", logradouro: "Rua XV de Novembro", numero: "100", bairro: "Centro", cidade: "Curitiba", uf: "PR", email_nf: "financeiro@rn.example", momento: "Depois do pagamento (padrão)", confere_receita: true, confere_mudanca: true, termo_aceite: true, assinatura: "Ricardo Nunes", assinatura_doc: "123.456.789-00" },
    respondent: { name: "Ricardo Nunes", doc: "123.456.789-00", at: daysAgo(5), ip: "192.0.2.1" } },
  { id: "fi-demo-elo", saas: "elo", customerName: "Cliente de outro workspace", status: "pendente", createdAt: daysAgo(12), author: "leo" },
];
export const integrationFormsMock = {
  questions: kind => ({kind, sections: kind === "nota_fiscal" ? FISCAL_SECTIONS : SECTIONS}),
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
