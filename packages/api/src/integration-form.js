// Formulário de Integração — o questionário que o cliente RECÉM-FECHADO preenche
// antes da call de integração. Não é captação (isso é o form builder, /f/:id):
// aqui a pessoa já comprou, e o que se coleta é a configuração da operação dela
// (contas, rotas de clonagem, preço, estoque, o que não pode sair), pra call de
// vídeo começar com o integrador sabendo tudo em vez de descobrir ao vivo.
//
// Modelo (collection `integration_forms`, um documento por cliente):
//   { id (TOKEN do link /fi/:id, opaco), saas, customerId, customerName, leadId,
//     status: "pendente"|"respondido", author, createdAt,
//     answers: { chave: valor }, sections: [...snapshot da versão respondida],
//     version, respondedAt, respondent: { nome, doc, ip, ua } }
//
// As perguntas moram AQUI, em código, e não num builder: elas são o checklist
// operacional da casa (mesma coisa pra todo cliente), e o valor está em serem
// iguais e completas. O que muda por cliente é a RESPOSTA. Ao responder, a
// definição inteira é copiada pro documento (`sections`) — o questionário pode
// evoluir sem que respostas antigas percam o rótulo com que foram feitas, mesma
// regra das propostas (snapshot).
//
// Tipos de pergunta:
//   text · textarea · email · phone · select · ack (declaração que precisa ser
//   marcada) · list (bloco que repete: uma linha por conta, por rota…)
//
// Condicional: `showIf: { key, in: [valores] }`. A regra vale nos DOIS lados —
// a página esconde, o servidor não exige o que está escondido (nem aceita como
// obrigatório o que não deveria aparecer).

export const INTEGRATION_FORM_VERSION = 2;

// Termo assinado no fim. Fica separado porque é a parte jurídica: o cliente
// declara que o que escreveu é verdade e assume a responsabilidade pelo que a
// gente vai configurar com base nisso.
export const TERM_TEXT = [
  "Declaro que as informações deste formulário são verdadeiras, completas e de minha responsabilidade.",
  "Estou ciente de que a LeverAds vai configurar a integração das minhas contas exatamente com base no que informei aqui, e que informação errada ou faltando pode gerar anúncio publicado na conta errada, preço errado, estoque errado ou item anunciado onde não podia.",
  "Assumo a responsabilidade por essas informações e me comprometo a avisar a LeverAds, por escrito, sempre que qualquer uma delas mudar (conta nova, mudança de preço, item que não pode mais ser anunciado).",
  "Autorizo a LeverAds a acessar as contas de marketplace que eu conectar, para executar a clonagem e a sincronização conforme as regras que informei acima.",
  "Estou ciente de que o Mercado Livre não permite anúncios duplicados entre contas que pertencem ao mesmo CNPJ ou ao mesmo CPF, e que essa é uma regra do marketplace, não da LeverAds. Se eu optar por clonar entre contas do mesmo documento, faço isso por minha conta e risco, respondendo sozinho por qualquer punição aplicada pelo Mercado Livre (anúncio pausado ou excluído, restrição ou bloqueio da conta).",
];

const sim_nao = (sim = "Sim", nao = "Não") => [sim, nao];

export const SECTIONS = [
  {
    key: "quem",
    title: "Quem está preenchendo",
    intro: "Pra gente saber com quem falar durante a integração e depois dela.",
    questions: [
      { key: "nome", label: "Seu nome completo", type: "text" },
      { key: "empresa", label: "Nome da empresa (razão social ou nome fantasia)", type: "text" },
      { key: "documento", label: "CNPJ (ou CPF, se você vende como pessoa física)", type: "text" },
      { key: "whatsapp", label: "WhatsApp de quem responde pela integração", type: "phone" },
      { key: "email", label: "E-mail para acessos e avisos", type: "email" },
      {
        key: "operador", type: "text",
        label: "Quem vai operar a LeverAds no dia a dia (nome e função)",
        help: "Se for você mesmo, escreva seu nome. Se for alguém do time, é essa pessoa que precisa estar na call.",
      },
    ],
  },

  {
    key: "contas",
    title: "Suas contas de marketplace",
    intro: "Liste TODAS as contas que entram na operação, as que você já usa e as que vai passar a usar. Conta que não estiver aqui fica de fora da integração.",
    questions: [
      {
        key: "contas", type: "list", addLabel: "adicionar outra conta", rowLabel: "Conta", min: 1,
        label: "As contas que entram na operação",
        fields: [
          { key: "marketplace", label: "Marketplace", type: "select", options: ["Mercado Livre", "Shopee", "Amazon", "Magalu", "Shein", "Outro"] },
          { key: "apelido", label: "Nome da conta (como ela aparece pra você)", type: "text" },
          {
            key: "papel", label: "O que essa conta faz na operação", type: "select",
            options: [
              "É a conta-mãe (é dela que saem os anúncios)",
              "Recebe os anúncios clonados",
              "As duas coisas (manda e recebe)",
            ],
          },
          { key: "conectada", label: "Essa conta já está conectada na LeverAds?", type: "select", options: ["Já está conectada", "Ainda não conectei", "Não sei dizer"] },
          { key: "envio", label: "Tipo de envio dessa conta", type: "select", options: ["Full", "Flex", "Coleta", "Agência ou Correios", "Envio próprio", "Mais de um tipo"] },
          { key: "setor", label: "Setor / nicho principal dessa conta (ex.: autopeças, moda, casa)", type: "text" },
          { key: "oficial", label: "É loja oficial?", type: "select", options: sim_nao("Sim, é loja oficial", "Não") },
        ],
      },
      { key: "mesma_plataforma", label: "Você tem mais de uma conta no MESMO marketplace?", type: "select", options: sim_nao() },
      {
        key: "loja_oficial", type: "text", showIf: { key: "mesma_plataforma", in: ["Sim"] },
        label: "Quando o mesmo produto puder ir para mais de uma conta do mesmo marketplace, qual conta é a oficial (a que deve receber)?",
        help: "Escreva o nome da conta como você digitou acima.",
      },
    ],
  },

  {
    key: "rotas",
    title: "De onde sai e para onde vai",
    intro: "É a pergunta de equalização: sem ela a gente não sabe de qual conta puxar o anúncio nem para qual mandar.",
    questions: [
      {
        key: "rotas", type: "list", addLabel: "adicionar outra rota", rowLabel: "Rota", min: 1,
        label: "As rotas de clonagem",
        fields: [
          { key: "origem", label: "Pego os anúncios da conta", type: "text" },
          { key: "destino", label: "E mando para a conta", type: "text" },
          { key: "oque", label: "Mando o quê", type: "select", options: ["O catálogo inteiro", "Só uma parte (explico abaixo)", "Só os campeões de venda"] },
        ],
      },
      {
        key: "rotas_recorte", type: "textarea",
        label: "Se em alguma rota você marcou 'só uma parte', explique o recorte",
        help: "Categoria, marca, faixa de preço ou lista de SKUs. Se manda o catálogo inteiro em todas as rotas, escreva: catálogo inteiro.",
      },
    ],
  },

  {
    key: "preco",
    title: "Preço",
    intro: "O preço do anúncio clonado sai daqui. Sem regra escrita, a gente replica o mesmo preço da conta de origem.",
    questions: [
      { key: "preco_diferente", label: "Tem diferença de preço entre as contas?", type: "select", options: ["Não, mesmo preço em todas", "Sim, tem diferença"] },
      {
        key: "preco_regra", type: "textarea", showIf: { key: "preco_diferente", in: ["Sim, tem diferença"] },
        label: "Qual é a regra, conta por conta?",
        help: "Ex.: Shopee = preço do Mercado Livre + 18% · conta B = mesmo preço · conta C = preço do ML menos 5%.",
      },
    ],
  },

  {
    key: "bloqueios",
    title: "O que NÃO pode ser clonado",
    intro: "Item que não pode sair da conta é a maior fonte de dor de cabeça depois da integração. Melhor dizer agora.",
    questions: [
      { key: "tem_bloqueio", label: "Tem anúncio que não pode ser clonado para outras contas?", type: "select", options: ["Não, pode clonar tudo", "Sim, tem item que não pode sair"] },
      {
        key: "bloqueio_quais", type: "textarea", showIf: { key: "tem_bloqueio", in: ["Sim, tem item que não pode sair"] },
        label: "Quais e por quê?",
        help: "Item banido, que já deu problema, marca com exclusividade, nicho proibido, produto de um fornecedor específico. Cole os links ou os SKUs.",
      },
    ],
  },

  {
    key: "padrao",
    title: "Padrão dos anúncios",
    intro: "Como o anúncio deve chegar na conta de destino.",
    questions: [
      { key: "descricao_padrao", label: "Você tem um padrão de descrição para os anúncios?", type: "select", options: ["Não, pode manter a descrição do anúncio de origem", "Sim, tenho um padrão por marketplace ou por conta"] },
      {
        key: "descricao_texto", type: "textarea", showIf: { key: "descricao_padrao", in: ["Sim, tenho um padrão por marketplace ou por conta"] },
        label: "Cole aqui o texto padrão, dizendo a qual marketplace ou conta cada um pertence",
      },
      { key: "moda", label: "Você vende moda, calçados ou qualquer item com numeração?", type: "select", options: sim_nao() },
      {
        key: "moda_tabela", type: "textarea", showIf: { key: "moda", in: ["Sim"] },
        label: "Cole aqui a sua tabela de medidas padrão (ou o link dela)",
        help: "É essa tabela que vai para os anúncios clonados.",
      },
      {
        key: "classico_premium", type: "select",
        label: "No Mercado Livre, quando o mesmo SKU tem anúncio Clássico e Premium, qual deles a gente clona para a Shopee?",
        options: ["O Clássico", "O Premium", "Não tenho os dois tipos", "Podem escolher vocês"],
      },
      {
        key: "status_clone", type: "select",
        label: "O anúncio clonado deve nascer com qual status?",
        options: ["O mesmo status da conta de origem", "Sempre ativo", "Sempre pausado (eu ativo depois)"],
      },
    ],
  },

  {
    key: "estoque",
    title: "Estoque e ERP",
    intro: "A sincronização de estoque só é ligada quando todas as condições abaixo estão respondidas. É ela que faz a venda em uma conta baixar o estoque nas outras.",
    questions: [
      { key: "erp", label: "Usa algum integrador de estoque / ERP?", type: "select", options: ["Não uso", "Bling", "Tiny (Olist)", "Outro"] },
      { key: "erp_qual", type: "text", showIf: { key: "erp", in: ["Outro"] }, label: "Qual?" },
      {
        key: "erp_contas", type: "select", showIf: { key: "erp", in: ["Bling", "Tiny (Olist)", "Outro"] },
        label: "Todas as contas estão ligadas nesse ERP?", options: ["Sim, todas", "Só algumas", "Nenhuma ainda"],
      },
      { key: "erp_quais", type: "text", showIf: { key: "erp_contas", in: ["Só algumas"] }, label: "Quais contas estão ligadas no ERP?" },

      { key: "sync", label: "Você quer sincronização de estoque entre as contas?", type: "select", options: ["Sim, quero", "Não, cada conta com o estoque dela", "Quero decidir na call"] },
      { key: "sync_deposito", type: "select", showIf: { key: "sync", in: ["Sim, quero"] }, label: "O estoque de todas as contas sai do MESMO depósito físico?", options: sim_nao() },
      { key: "sync_sku", type: "select", showIf: { key: "sync", in: ["Sim, quero"] }, label: "Os SKUs são iguais nas contas (mesmo código para o mesmo produto)?", options: ["Sim, todos", "Só uma parte", "Não"] },
      {
        key: "sync_full", type: "select", showIf: { key: "sync", in: ["Sim, quero"] },
        label: "Tem anúncio no Full?", options: ["Não tenho Full", "Tenho Full em uma conta", "Tenho Full em mais de uma conta"],
        help: "O estoque do Full pertence à conta que enviou pro centro de distribuição, então ele não entra na baixa comum.",
      },
      { key: "sync_fonte", type: "text", showIf: { key: "sync", in: ["Sim, quero"] }, label: "Qual conta (ou o ERP) manda no estoque, a fonte da verdade?" },
      { key: "sync_reserva", type: "select", showIf: { key: "sync", in: ["Sim, quero"] }, label: "Quer reservar uma parte do estoque por conta?", options: ["Não, estoque cheio em todas", "Sim, quero reservar"] },
      { key: "sync_reserva_regra", type: "text", showIf: { key: "sync_reserva", in: ["Sim, quero reservar"] }, label: "Qual a reserva? (ex.: a conta B só anuncia 30% do estoque)" },
      {
        key: "sync_ciente", type: "ack", showIf: { key: "sync", in: ["Sim, quero"] },
        label: "Entendi que, com a sincronização ligada, vender em uma conta baixa o estoque em todas as outras.",
      },
    ],
  },

  {
    key: "regras",
    title: "Como a operação funciona daqui pra frente",
    intro: "Marque cada item. São as regras que fazem a clonagem se comportar do jeito que você espera.",
    questions: [
      {
        key: "regra_mesmo_documento", type: "ack",
        label: "Estou ciente de que o Mercado Livre não permite o mesmo anúncio em contas do mesmo CNPJ ou do mesmo CPF, e que a punição (anúncio pausado ou excluído, restrição ou bloqueio da conta) é decisão do marketplace. Se eu mandar clonar entre contas do mesmo documento, assumo esse risco por minha conta, e a LeverAds fica isenta.",
        help: "A regra vale para contas do mesmo titular. Clonagem entre contas de titulares diferentes (CNPJs ou CPFs distintos) não tem essa restrição.",
      },
      {
        key: "regra_mae", type: "ack",
        label: "Produto novo eu publico na conta-mãe. É dela que a réplica sai para as outras contas; anúncio criado direto numa conta de destino nasce fora da clonagem e da sincronização.",
      },
      {
        key: "regra_auto", type: "ack",
        label: "Com a clonagem automática ligada, todo anúncio novo da conta-mãe é replicado sozinho para as contas de destino, seguindo as regras que informei aqui.",
      },
      {
        key: "regra_shopee", type: "ack",
        label: "A Shopee tem comissão, frete e formato próprios, então o preço lá não é automaticamente o mesmo do Mercado Livre. Se eu quero preço diferente, vale a regra que escrevi no campo de preço deste formulário.",
      },
      {
        key: "regra_edicao", type: "ack",
        label: "Alteração feita na mão dentro do anúncio de destino pode ser sobrescrita na próxima sincronização.",
      },
      {
        key: "regra_mudanca", type: "ack",
        label: "Se alguma regra mudar (conta nova, preço, item que não pode mais sair), eu aviso a LeverAds. Até eu avisar, a ferramenta segue o que está escrito aqui.",
      },
      {
        key: "observacoes", type: "textarea",
        label: "Mais alguma coisa que a gente precisa saber antes de integrar?",
        help: "Combinado feito na venda, prazo, particularidade da sua operação. Se não tiver nada, escreva: nada.",
      },
    ],
  },

  {
    key: "termo",
    title: "Termo de veracidade e responsabilidade",
    term: true, // a seção renderiza o TERM_TEXT antes das perguntas
    questions: [
      { key: "termo_aceite", type: "ack", label: "Li o termo acima, concordo com ele e confirmo que as informações que preenchi são verdadeiras." },
      { key: "assinatura", type: "text", label: "Assinatura: digite seu nome completo", help: "Vale como assinatura eletrônica deste formulário." },
      { key: "assinatura_doc", type: "text", label: "CPF de quem está assinando" },
    ],
  },
];

// Definição enviada pra página pública (hoje é a definição inteira; existe como
// função pra o dia em que houver campo interno que o cliente não deva ver).
export function publicSections() {
  return SECTIONS.map((s) => ({
    key: s.key, title: s.title, intro: s.intro || "", term: !!s.term,
    questions: (s.questions || []).map((q) => ({ ...q })),
  }));
}

// Todas as perguntas, em ordem, com a seção de origem junto.
export function allQuestions(sections = SECTIONS) {
  return sections.flatMap((s) => (s.questions || []).map((q) => ({ ...q, section: s.key, sectionTitle: s.title })));
}

// A condicional é sempre sobre a resposta de UMA pergunta (`showIf.key`) estar
// numa lista de valores. Pergunta sem showIf está sempre visível.
export function isVisible(question, answers) {
  const cond = question.showIf;
  if (!cond) return true;
  const val = answers?.[cond.key];
  return Array.isArray(cond.in) ? cond.in.includes(val) : !!val;
}

const isBlank = (v) => v == null || (typeof v === "string" && !v.trim());

// Validação server-authoritative: TUDO que está visível é obrigatório (decisão
// do Leo: o formulário existe pra não faltar informação na integração). O que a
// condicional esconde não é exigido nem guardado.
export function validateIntegrationAnswers(answers, sections = SECTIONS) {
  const errors = [];
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return [{ key: "_", error: "Respostas ausentes" }];
  for (const q of allQuestions(sections)) {
    if (!isVisible(q, answers)) continue;
    const val = answers[q.key];
    if (q.type === "list") {
      const rows = Array.isArray(val) ? val : [];
      const min = q.min || 1;
      if (rows.length < min) { errors.push({ key: q.key, error: `Preencha ao menos ${min} ${min === 1 ? "item" : "itens"}` }); continue; }
      rows.forEach((row, i) => {
        for (const f of q.fields || []) {
          if (isBlank(row?.[f.key])) errors.push({ key: `${q.key}[${i}].${f.key}`, error: `${q.rowLabel || "Item"} ${i + 1}: preencha "${f.label}"` });
          else if (f.type === "select" && !(f.options || []).includes(String(row[f.key]))) errors.push({ key: `${q.key}[${i}].${f.key}`, error: `${q.rowLabel || "Item"} ${i + 1}: opção inválida em "${f.label}"` });
        }
      });
      continue;
    }
    if (q.type === "ack") {
      if (val !== true) errors.push({ key: q.key, error: "Marque para continuar" });
      continue;
    }
    if (isBlank(val)) { errors.push({ key: q.key, error: "Preencha este campo" }); continue; }
    if (q.type === "select" && !(q.options || []).includes(String(val))) errors.push({ key: q.key, error: "Opção inválida" });
    if (q.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(val))) errors.push({ key: q.key, error: "E-mail inválido" });
    if (q.type === "phone" && String(val).replace(/\D/g, "").length < 10) errors.push({ key: q.key, error: "Telefone inválido" });
  }
  return errors;
}

// Respostas limpas: só as chaves que existem na definição E estão visíveis, com
// texto aparado e limite de tamanho (a rota é pública, então nada de campo livre
// sem teto). Guarda o formulário de lixo e de chave inventada.
export function sanitizeIntegrationAnswers(answers, sections = SECTIONS) {
  const out = {};
  const src = answers && typeof answers === "object" ? answers : {};
  const str = (v, max = 4000) => String(v == null ? "" : v).trim().slice(0, max);
  for (const q of allQuestions(sections)) {
    if (!isVisible(q, src)) continue;
    const val = src[q.key];
    if (q.type === "list") {
      const rows = Array.isArray(val) ? val.slice(0, 40) : [];
      out[q.key] = rows.map((row) => Object.fromEntries((q.fields || []).map((f) => [f.key, str(row?.[f.key], 300)])));
    } else if (q.type === "ack") {
      out[q.key] = val === true;
    } else {
      out[q.key] = str(val, q.type === "textarea" ? 4000 : 300);
    }
  }
  return out;
}

// Resumo de uma linha pro cockpit (lista da tela e timeline do lead): as contas
// e as rotas são o que o integrador quer ver antes de abrir a ficha inteira.
export function integrationSummary(answers = {}) {
  const contas = Array.isArray(answers.contas) ? answers.contas : [];
  const rotas = Array.isArray(answers.rotas) ? answers.rotas : [];
  const partes = [];
  if (contas.length) partes.push(`${contas.length} ${contas.length === 1 ? "conta" : "contas"}`);
  if (rotas.length) partes.push(`${rotas.length} ${rotas.length === 1 ? "rota" : "rotas"}`);
  if (answers.sync) partes.push(`estoque: ${String(answers.sync).toLowerCase()}`);
  if (answers.erp && answers.erp !== "Não uso") partes.push(`ERP: ${answers.erp}`);
  return partes.join(" · ");
}
