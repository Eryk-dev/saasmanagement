// Formulário de dados pra NOTA FISCAL — o segundo tipo de formulário da tela
// "Formulário de Integração" (Leo, 17/09/2026). Mesma máquina do questionário
// de integração (definição em código, link opaco /fi/:id, envio único, snapshot
// das perguntas no documento, termo assinado): muda só o CONTEÚDO, que aqui é
// o cadastro do tomador que o financeiro precisa pra emitir a NFS-e sem ficar
// pedindo CNPJ e endereço no WhatsApp.
//
// O que se coleta: quem responde pelo financeiro, o tomador (PJ ou PF, com os
// dados do cartão CNPJ), o endereço fiscal, o regime tributário (define
// retenção), pra onde a nota vai e o que precisa constar nela. Tudo obrigatório
// menos o que é de fato opcional (nome fantasia, inscrição municipal, e-mail de
// cópia, complemento, informação extra pra nota).
//
// Os tipos de pergunta e as condicionais são os de integration-form.js. A única
// novidade é `digits: N`: campo de texto que precisa ter exatamente N dígitos
// (CNPJ 14, CPF 11, CEP 8), validado no servidor e na página.

export const FISCAL_FORM_VERSION = 1;

export const FISCAL_TERM_TEXT = [
  "Declaro que os dados fiscais informados neste formulário são verdadeiros, completos e conferem com o cadastro do tomador na Receita Federal e na prefeitura.",
  "Estou ciente de que a LeverAds emite a nota fiscal de serviço exatamente com os dados informados aqui, e que dado errado ou faltando gera nota com informação incorreta, que só pode ser corrigida por cancelamento e nova emissão, dentro do prazo permitido pela legislação municipal.",
  "Assumo a responsabilidade por essas informações e me comprometo a avisar a LeverAds, por escrito, sempre que qualquer uma delas mudar (razão social, endereço, regime tributário, e-mail de recebimento).",
  "Autorizo a LeverAds a usar esses dados para a emissão de notas fiscais, cobranças e demais obrigações fiscais decorrentes do contrato.",
];

const PJ = "Pessoa jurídica (CNPJ)";
const PF = "Pessoa física (CPF)";

export const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];

export const FISCAL_SECTIONS = [
  {
    key: "responsavel",
    title: "Quem responde pelo financeiro",
    intro: "É com essa pessoa que a gente fala sobre nota, boleto e qualquer ajuste de cadastro.",
    questions: [
      { key: "nome", label: "Seu nome completo", type: "text" },
      { key: "funcao", label: "Sua função na empresa (ex.: sócio, financeiro, contador)", type: "text" },
      { key: "whatsapp", label: "WhatsApp do financeiro", type: "phone" },
      { key: "email", label: "E-mail do financeiro", type: "email" },
    ],
  },

  {
    key: "tomador",
    title: "Em nome de quem sai a nota",
    intro: "Copie os dados exatamente como estão no cartão CNPJ (ou no seu CPF). A nota é emitida com o que estiver escrito aqui.",
    questions: [
      { key: "tipo", label: "A nota sai para", type: "select", options: [PJ, PF] },

      { key: "razao_social", type: "text", showIf: { key: "tipo", in: [PJ] }, label: "Razão social (como está no cartão CNPJ)" },
      { key: "nome_fantasia", type: "text", optional: true, showIf: { key: "tipo", in: [PJ] }, label: "Nome fantasia (opcional)" },
      { key: "cnpj", type: "text", digits: 14, showIf: { key: "tipo", in: [PJ] }, label: "CNPJ", help: "Só os números ou no formato 00.000.000/0000-00." },
      {
        key: "inscricao_estadual", type: "text", showIf: { key: "tipo", in: [PJ] },
        label: "Inscrição Estadual", help: "Se a empresa não tem ou é isenta, escreva: Isento.",
      },
      { key: "inscricao_municipal", type: "text", optional: true, showIf: { key: "tipo", in: [PJ] }, label: "Inscrição Municipal (opcional)" },
      {
        key: "regime", type: "select", showIf: { key: "tipo", in: [PJ] },
        label: "Regime tributário da empresa",
        options: ["Simples Nacional", "MEI", "Lucro Presumido", "Lucro Real", "Não sei, confirmo com o contador"],
        help: "Define se a nota sai com retenção de impostos. Na dúvida, pergunte ao seu contador antes de responder.",
      },

      { key: "nome_pf", type: "text", showIf: { key: "tipo", in: [PF] }, label: "Nome completo (como está no CPF)" },
      { key: "cpf", type: "text", digits: 11, showIf: { key: "tipo", in: [PF] }, label: "CPF", help: "Só os números ou no formato 000.000.000-00." },
    ],
  },

  {
    key: "endereco",
    title: "Endereço fiscal",
    intro: "O endereço do cadastro na Receita Federal, não o do depósito nem o de entrega.",
    questions: [
      { key: "cep", type: "text", digits: 8, label: "CEP" },
      { key: "logradouro", type: "text", label: "Rua / avenida" },
      { key: "numero", type: "text", label: "Número" },
      { key: "complemento", type: "text", optional: true, label: "Complemento (opcional)" },
      { key: "bairro", type: "text", label: "Bairro" },
      { key: "cidade", type: "text", label: "Cidade" },
      { key: "uf", type: "select", label: "Estado", options: UFS },
    ],
  },

  {
    key: "envio",
    title: "Como você quer receber a nota",
    intro: "A nota e o boleto vão por e-mail. Se o financeiro é terceirizado (contabilidade, BPO), coloque o e-mail de lá em cópia.",
    questions: [
      { key: "email_nf", type: "email", label: "E-mail que recebe a nota fiscal" },
      { key: "email_copia", type: "email", optional: true, label: "E-mail em cópia (opcional)" },
      {
        key: "momento", type: "select",
        label: "Quando a nota deve ser emitida?",
        options: ["Depois do pagamento (padrão)", "Preciso da nota antes de pagar (compras / financeiro exige)"],
      },
      {
        key: "constar", type: "textarea", optional: true,
        label: "Alguma informação que precisa constar na nota? (opcional)",
        help: "Número de pedido de compra, centro de custo, contrato, nome do responsável. Se não precisa de nada, deixe em branco.",
      },
    ],
  },

  {
    key: "conferencia",
    title: "Conferência",
    intro: "Marque cada item. É o que evita nota cancelada e reemitida.",
    questions: [
      {
        key: "confere_receita", type: "ack",
        label: "Confirmo que os dados acima são os mesmos do cadastro na Receita Federal (e na prefeitura, quando houver inscrição municipal). A nota sai exatamente com eles.",
      },
      {
        key: "confere_mudanca", type: "ack",
        label: "Se algum dado mudar (razão social, endereço, regime, e-mail), eu aviso a LeverAds antes da próxima emissão. Até avisar, a nota segue o que está escrito aqui.",
      },
    ],
  },

  {
    key: "termo",
    title: "Termo de veracidade e responsabilidade",
    term: true,
    questions: [
      { key: "termo_aceite", type: "ack", label: "Li o termo acima, concordo com ele e confirmo que as informações que preenchi são verdadeiras." },
      { key: "assinatura", type: "text", label: "Assinatura: digite seu nome completo", help: "Vale como assinatura eletrônica deste formulário." },
      { key: "assinatura_doc", type: "text", digits: 11, label: "CPF de quem está assinando" },
    ],
  },
];

const onlyDigits = (v) => String(v || "").replace(/\D/g, "");
export const fmtCnpj = (v) => { const d = onlyDigits(v); return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : String(v || ""); };
export const fmtCpf = (v) => { const d = onlyDigits(v); return d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4") : String(v || ""); };

// O tomador como o financeiro quer ver: nome + documento.
export function fiscalTomador(answers = {}) {
  const pj = String(answers.tipo || "") === PJ;
  return {
    tipo: pj ? "PJ" : "PF",
    nome: String(pj ? answers.razao_social : answers.nome_pf || "").trim(),
    documento: pj ? fmtCnpj(answers.cnpj) : fmtCpf(answers.cpf),
  };
}

// Resumo de uma linha pro cockpit (lista da tela, timeline do lead, Discord).
export function fiscalSummary(answers = {}) {
  const t = fiscalTomador(answers);
  const partes = [];
  if (t.nome) partes.push(t.nome);
  if (t.documento) partes.push(t.documento);
  if (answers.cidade || answers.uf) partes.push([answers.cidade, answers.uf].filter(Boolean).join("/"));
  if (t.tipo === "PJ" && answers.regime) partes.push(answers.regime);
  return partes.join(" · ");
}

// O que vai pra FICHA do cliente (customer.fiscal): o cadastro limpo, pronto
// pro financeiro copiar na emissão. Snapshot do que o cliente assinou; se
// mudar, ele responde outro formulário e o bloco é substituído.
export function fiscalRecord(answers = {}, { formId = "", at = "" } = {}) {
  const t = fiscalTomador(answers);
  return {
    tipo: t.tipo,
    nome: t.nome,
    documento: t.documento,
    nomeFantasia: String(answers.nome_fantasia || "").trim(),
    inscricaoEstadual: String(answers.inscricao_estadual || "").trim(),
    inscricaoMunicipal: String(answers.inscricao_municipal || "").trim(),
    regime: String(answers.regime || "").trim(),
    endereco: {
      cep: onlyDigits(answers.cep).replace(/^(\d{5})(\d{3})$/, "$1-$2"),
      logradouro: String(answers.logradouro || "").trim(),
      numero: String(answers.numero || "").trim(),
      complemento: String(answers.complemento || "").trim(),
      bairro: String(answers.bairro || "").trim(),
      cidade: String(answers.cidade || "").trim(),
      uf: String(answers.uf || "").trim(),
    },
    emailNf: String(answers.email_nf || "").trim(),
    emailCopia: String(answers.email_copia || "").trim(),
    momento: String(answers.momento || "").trim(),
    constar: String(answers.constar || "").trim(),
    financeiro: {
      nome: String(answers.nome || "").trim(),
      funcao: String(answers.funcao || "").trim(),
      whatsapp: String(answers.whatsapp || "").trim(),
      email: String(answers.email || "").trim(),
    },
    formId,
    at,
  };
}
