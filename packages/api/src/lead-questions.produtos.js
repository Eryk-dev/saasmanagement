// Formulários de qualificação por PRODUTO (OEM · Ads · Price).
//
// Estrutura: um NÚCLEO COMUM idêntico nos três + 2 perguntas específicas de
// cada linha. O núcleo não é redundância — é o que torna os leads comparáveis
// entre produtos e o que permite detectar porta errada: o lead preenche o
// formulário do anúncio que clicou, não o do produto de que precisa, então um
// autopeças que clica no criativo de Ads cai no form de Ads. Sem núcleo comum
// o SDR pitcha o produto errado sem nunca saber.
//
// O que NÃO está aqui, de propósito: decisor, orçamento e prazo. Com SDR
// humano no fluxo, essas três são dele — no formulário assustam e envelhecem
// mal (o lead responde "sou eu que decido" e na call aparece o sócio).
//
// Ordem das perguntas: cliques baratos primeiro, as duas abertas no meio
// (depois que a pessoa já investiu quatro cliques) e volume por último, que é
// a mais sensível das sete.

import {
  ACCOUNTS_OPTIONS, LISTINGS_OPTIONS, ORDERS_OPTIONS, TICKET_OPTIONS, SKUS_OPTIONS,
} from "./classificacao.js";

const NUCLEO = [
  {
    key: "niche", label: "Qual seu principal nicho?", type: "select", required: true, allowCustom: true,
    options: [
      { value: "autopecas", label: "Autopeças" },
      { value: "eletronicos", label: "Eletrônicos" },
      { value: "moda", label: "Moda" },
      { value: "casa", label: "Casa & Decoração" },
      { value: "beleza", label: "Beleza" },
      { value: "outros", label: "Outros" },
    ],
  },
  {
    key: "channel", label: "Você vende só online ou também tem loja física?", type: "select", required: true,
    options: [
      { value: "online", label: "Só online" },
      { value: "online-fisico", label: "Online + loja física" },
    ],
  },
  {
    // Condicional de `channel`. Loja física é ICP de porte próprio: o driver
    // dela é SKU, não anúncio ativo — ela está "patinando no online" por
    // definição, então volume baixo é o sintoma, não a desqualificação.
    key: "stores", label: "Quantas unidades?", type: "select", required: false,
    showIf: { key: "channel", equals: "online-fisico" },
    options: [
      { value: "1", label: "1 loja" },
      { value: "2-3", label: "2 a 3 lojas" },
      { value: "4+", label: "4 ou mais" },
    ],
  },
  { key: "accounts", label: "Quantas contas de anúncio você opera?", type: "select", required: true, options: ACCOUNTS_OPTIONS },
  { key: "listings", label: "Quantos anúncios ativos ao todo?", type: "select", required: true, options: LISTINGS_OPTIONS },
  {
    // Gatilho. É o melhor preditor de urgência que cabe num formulário, e a
    // resposta vira a abertura da conversa do SDR nas palavras do próprio lead.
    key: "trigger", label: "O que fez você procurar uma solução agora?", type: "text", required: true,
  },
  {
    // "Já tentou e apanhou". Quem já pagou por solução compra de novo, e
    // nomear a ferramenta entrega o concorrente pro SDR entrar sabendo contra
    // quem fala.
    key: "tried", label: "O que você já tentou pra resolver isso?", type: "multi", required: false, allowCustom: true,
    options: [
      { value: "nada", label: "Nada ainda" },
      { value: "manual", label: "Faço na mão" },
      { value: "erp", label: "Uso ERP (Bling, Tiny…)" },
      { value: "outra-ferramenta", label: "Uso outra ferramenta de anúncio" },
      { value: "agencia", label: "Contratei agência ou freelancer" },
    ],
  },
  { key: "orders", label: "Quantos pedidos por mês, aproximadamente?", type: "select", required: true, options: ORDERS_OPTIONS },
  { key: "ticket", label: "Qual seu ticket médio?", type: "select", required: true, options: TICKET_OPTIONS },
];

const ESPECIFICAS = {
  oem: [
    {
      key: "partsType", label: "Você trabalha com peça nova, usada, ou as duas?", type: "select", required: true,
      options: [
        { value: "nova", label: "Nova" },
        { value: "usada", label: "Usada" },
        { value: "ambas", label: "As duas" },
      ],
    },
    { key: "skus", label: "Quantos SKUs cadastrados no seu estoque ou ERP?", type: "select", required: true, options: SKUS_OPTIONS },
  ],
  ads: [
    {
      key: "marketplaces", label: "Em quais marketplaces você já vende?", type: "multi", required: true,
      options: [
        { value: "ml", label: "Mercado Livre" },
        { value: "shopee", label: "Shopee" },
        { value: "amazon", label: "Amazon" },
        { value: "magalu", label: "Magalu" },
        { value: "outro", label: "Outro" },
      ],
    },
    {
      key: "replicaHoje", label: "Você replica anúncio entre contas hoje?", type: "select", required: true, allowCustom: true,
      options: [
        { value: "nao", label: "Não replico" },
        { value: "manual", label: "Faço na mão" },
        { value: "ferramenta", label: "Uso ferramenta" },
      ],
    },
  ],
  price: [
    {
      key: "repriceFreq", label: "Com que frequência você ajusta preço?", type: "select", required: true,
      options: [
        { value: "nunca", label: "Não ajusto" },
        { value: "as-vezes", label: "Quando lembro" },
        { value: "semanal", label: "Semanal" },
        { value: "diario", label: "Diário" },
        { value: "varias-dia", label: "Várias vezes ao dia" },
      ],
    },
    {
      key: "repriceTool", label: "Já usa ferramenta de precificação?", type: "select", required: false, allowCustom: true,
      options: [
        { value: "nao", label: "Não" },
        { value: "sim", label: "Sim" },
      ],
    },
  ],
};

export const PRODUTOS = ["oem", "ads", "price"];

// `formProduct` viaja junto pra que a classificação saiba por qual porta o
// lead entrou e possa marcar divergência (ver `portaErrada` em classificacao).
export function questionsFor(produto) {
  const extra = ESPECIFICAS[produto] || [];
  return [...NUCLEO.map((q) => ({ ...q })), ...extra.map((q) => ({ ...q }))];
}

export const LEAD_QUESTIONS_POR_PRODUTO = Object.fromEntries(
  PRODUTOS.map((p) => [p, questionsFor(p)])
);
