// Treinamentos — flashcards por vaga (SDR / closer / …) pra treinar o time.
// Um doc por produto na collection `flashcards`; sem doc, cai nos defaults
// abaixo. Editar salva pra TODO o time. Mesma forma de offers/metas.

// Cartão: { id, role, front (pergunta/gatilho), back (resposta/técnica) }.
const ROLE_LABELS = { sdr: "SDR", closer: "Closer", integrator: "Integrador · CS", social: "Mídia social" };

// 10 flashcards pra cada vaga, na voz da LeverAds (clona anúncios ML/Shopee
// entre contas). O Leo edita à vontade na tela.
const DEFAULTS = {
  leverads: [
    // ── SDR ──────────────────────────────────────────────────────────────
    { id: "sdr_1", role: "sdr", front: "O que a LeverAds faz, em 1 frase?", back: "Clona e sincroniza seus anúncios entre todas as contas de Mercado Livre e Shopee, sozinha. Mais exposição, menos operação e retrabalho." },
    { id: "sdr_2", role: "sdr", front: "Qual é o SEU objetivo na ligação de SDR?", back: "Confirmar os dados (nicho, contas, anúncios, expansão) e AGENDAR a call com o closer. Você qualifica e marca, não vende aqui." },
    { id: "sdr_3", role: "sdr", front: "Lead: 'me manda por WhatsApp'", back: "'Mando sim! Mas em 10 min no vídeo eu te mostro clonando um anúncio SEU de verdade, entende muito mais rápido. Prefere amanhã de manhã ou no fim da tarde?'" },
    { id: "sdr_4", role: "sdr", front: "Perguntas de qualificação, na ordem", back: "1) Nicho · 2) Nome da loja/empresa · 3) Quantas contas de marketplace · 4) Quantos anúncios na maior conta · 5) Pretende abrir mais contas · 6) Tamanho do time de marketing." },
    { id: "sdr_5", role: "sdr", front: "Lead: 'não tenho tempo agora'", back: "'É rapidinho: 20-30 min e você já sai vendo a ferramenta rodando na SUA conta. Qual o melhor horário essa semana pra eu reservar com o especialista?'" },
    { id: "sdr_6", role: "sdr", front: "Como criar urgência sem forçar?", back: "Ancore na dor ('cada dia com anúncio parado numa conta é venda indo pro concorrente') e use a agenda ('consigo encaixar amanhã 10h, seguro pra você?')." },
    { id: "sdr_7", role: "sdr", front: "Lead: 'já uso outra ferramenta'", back: "'Boa, então já sabe o valor de automatizar. Vale ver como a gente clona ENTRE ML e Shopee e mantém atributo/SKU no lugar, costuma ser o que falta. 15 min pra comparar?'" },
    { id: "sdr_8", role: "sdr", front: "Não atendeu a ligação. E agora?", back: "Liga de novo em seguida. Caiu na caixa 2×, manda o WhatsApp de apresentação e registra o toque (vai pra Qualificando e retoma amanhã). Cadência de até 5 toques." },
    { id: "sdr_9", role: "sdr", front: "O que NUNCA pode faltar antes de passar pro closer?", back: "Call agendada (dia e hora), o closer responsável e o e-mail do lead pro convite do Meet. Sem isso a call não acontece." },
    { id: "sdr_10", role: "sdr", front: "Frase de transição pra agendar a call", back: "'Fechado! Vou te colocar com nosso especialista pra você ver a ferramenta clonando um anúncio de verdade na sua operação. Melhor amanhã de manhã ou no fim da tarde?'" },
    // ── Closer ───────────────────────────────────────────────────────────
    { id: "clo_1", role: "closer", front: "Como abrir a call (primeiros 2 min)?", back: "Rapport rápido + confirma o cenário (contas, anúncios, dor). Alinhe a agenda: 'vou te mostrar rodando na sua conta e no fim a gente vê se faz sentido, combinado?'" },
    { id: "clo_2", role: "closer", front: "O teste que desarma quase toda objeção", back: "Clonar 10 anúncios DELE na criação da conta, ~2h de trabalho manual feito em minutos, sem cartão e sem compromisso. Ele vê o valor na própria operação." },
    { id: "clo_3", role: "closer", front: "Objeção: 'tá caro'", back: "Não baixe o preço de cara. Empilhe valor: quanto custa um funcionário pra fazer isso (~R$50 mil/ano), quanto vale a exposição extra. SÓ então a escada de ofertas." },
    { id: "clo_4", role: "closer", front: "A escada de ofertas (de cima pra baixo)", back: "Anual 12x 599 (âncora) → se travar, Semestral 12x 299 → último recurso, Serviço único 12x 149. Nunca comece pela mais barata; desça só na objeção real de preço." },
    { id: "clo_5", role: "closer", front: "Objeção: 'tenho medo de banir a conta'", back: "'Justamente por isso existe processo: atributo e SKU no lugar, clonagem no padrão. Risco é operar tudo na mão. Te mostro contas rodando há meses sem problema.'" },
    { id: "clo_6", role: "closer", front: "Prova social pra usar na call", back: "Case Unique: conta nova clonada da mãe fez +105% em vendas, +98,8% pedidos e +115% visitas no 1º mês. Prints reais do painel do Mercado Livre." },
    { id: "clo_7", role: "closer", front: "Objeção: 'vou pensar'", back: "Isola a real: 'claro! Só pra eu te ajudar: é o preço, o timing ou uma dúvida de como funciona?'. Resolve a objeção verdadeira em vez de deixar esfriar." },
    { id: "clo_8", role: "closer", front: "Como conduzir pro fechamento", back: "Recapitula a dor + o que ele viu no teste + a oferta. Pergunta de compromisso: 'faz sentido começar pelo anual pra travar o melhor preço?'. Depois, silêncio." },
    { id: "clo_9", role: "closer", front: "Objeção: 'preciso falar com meu sócio'", back: "'Decisão boa se toma junto. Topa marcar 15 min com ele ainda essa semana pra eu tirar as dúvidas na fonte? Seguro esse valor até lá.'" },
    { id: "clo_10", role: "closer", front: "Depois do 'sim', o que garantir?", back: "Link de pagamento certo (anual/semestral/único), confirmar o e-mail e já encaminhar pra integração (o setup começa). Não deixe o lead 'no ar' após o aceite." },
  ],
};

const ROLES = new Set(Object.keys(ROLE_LABELS));

function sanitize(cards) {
  if (!Array.isArray(cards)) return null;
  return cards.slice(0, 400).map((c, i) => ({
    id: String(c?.id || `card_${i + 1}`).slice(0, 60),
    role: ROLES.has(c?.role) ? c.role : "sdr",
    front: String(c?.front || "").slice(0, 600),
    back: String(c?.back || "").slice(0, 1200),
  })).filter((c) => c.front.trim() || c.back.trim());
}

export function registerFlashcardRoutes(app, repo) {
  async function cardsFor(saas) {
    const doc = saas ? await repo.get("flashcards", saas) : null;
    return doc?.cards || DEFAULTS[saas] || [];
  }

  app.get("/api/flashcards/:saas", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    return { saas: product.id, roleLabels: ROLE_LABELS, cards: await cardsFor(product.id) };
  });

  app.put("/api/flashcards/:saas", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    const cards = sanitize(req.body?.cards);
    if (!cards) return reply.code(400).send({ error: "cards deve ser uma lista" });
    const existing = await repo.get("flashcards", product.id);
    const saved = existing
      ? await repo.update("flashcards", product.id, { cards })
      : await repo.create("flashcards", { id: product.id, cards });
    return { saas: product.id, cards: saved.cards };
  });
}

export const FLASHCARD_DEFAULTS = DEFAULTS;
