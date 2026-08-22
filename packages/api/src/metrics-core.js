// Régua ÚNICA das métricas do cockpit. Antes deste módulo cada endpoint
// reimplementava as próprias contas e elas divergiam em 4 eixos:
//
//   1. O DIA: UTC-3 fixo (marketing/scoreboard), America/Sao_Paulo (pace),
//      UTC puro (funil da Análise) e corte por instante (/api/metrics). Aqui:
//      `dayKey` — dia do negócio em America/Sao_Paulo, pra todo mundo (o front
//      espelha em bizDay, lib/format.js).
//   2. O GANHO: a régua oficial é a venda como FATO do lead — `isWonLead`
//      (customerId carimbado pelo convertWonLead, ou etapa de kind ganho) e
//      `wonAtOf` (quando vendeu), definidos em stages.js e re-exportados aqui.
//      `winsIn` recorta os fechamentos numa janela, com fallback pro lead
//      legado sem carimbo (startedAt do cliente vinculado).
//   3. O LEAD: contagens oficiais EXCLUEM leads internos (`isRealLead`) — o
//      CPL já excluía e o resto não, então tile e custo divergiam.
//   4. A JANELA: `rangeFromQuery` — since/until por dia do negócio, default
//      30 dias, em todo endpoint que aceita período.
//
// Todo endpoint de métrica importa DAQUI. Regra nova de funil/venda entra
// aqui (ou em stages.js) primeiro; o metrics-consistency.test.js roda as
// telas sobre o mesmo dataset e quebra se alguém divergir.

import { kindOf, isLoss, isNoShowStage, isWonLead, wonAtOf, TOUCH_TYPES, TERMINAL_KINDS } from "./stages.js";
import { isMentoriaLead, mentoriaFit } from "./mentoria.js";

export { isWonLead, wonAtOf }; // a régua oficial de ganho, num import só

// Dinheiro de CARTÃO DE CRÉDITO que ENTROU no mês (espelho do Mercado Pago,
// aprovados por dateApproved). É a base do custo percentual `cartao12x` da aba
// Custos e do Financeiro — régua única nos dois lugares.
// Regra final do Leo (08/08/2026, 4ª iteração): com antecipação D+0 a taxa
// incide INTEIRA no mês em que o dinheiro CAI — nunca sobre a marcação
// "cartão 12x" do fechamento (contrato marcado que ainda não passou no cartão
// não paga taxa; foi isso que inflou a base pra 172k com ~100 recebidos).
export function card12xBaseIn(mpPayments, month) {
  let sum = 0;
  for (const p of mpPayments || []) {
    if (p.status !== "approved" || p.methodType !== "credit_card") continue;
    if (monthKey(p.dateApproved || p.dateCreated) !== month) continue;
    sum += Number(p.amount) || 0;
  }
  return Math.round(sum * 100) / 100;
}

export const DAY_MS = 86_400_000;
export const round2 = (n) => Math.round(n * 100) / 100;

// ── O dia do negócio ─────────────────────────────────────────────────────────
const DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function dayKey(value) {
  if (!value) return "";
  // Data PURA ("2026-07-03", sem hora — ex.: ad_insights.date) já É o dia do
  // negócio: passar pelo fuso deslocaria um dia (meia-noite UTC = 21h da
  // véspera em São Paulo).
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  const parts = Object.fromEntries(
    DATE_FMT.formatToParts(d).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export const monthKey = (value) => dayKey(value).slice(0, 7);

// Janela padrão dos endpoints com ?since=&until= (default: últimos 30 dias).
export function rangeFromQuery(q = {}, now = new Date()) {
  const until = q.until || dayKey(now);
  const since = q.since || dayKey(new Date(now.getTime() - 29 * DAY_MS));
  return { since, until };
}

// ── O que é lead ─────────────────────────────────────────────────────────────
// Lead interno (teste/seed) fica fora de TODA contagem oficial.
// Lead que conta nas métricas do produto: fora os testes internos do time e
// fora quem saiu por uma SAÍDA LATERAL do form (ex.: "ainda não vende em
// marketplace", que vai pra fila da Mentoria). Esses últimos são contato, mas
// não são lead DESTE produto — contá-los faz o CPL parecer barato justamente
// porque encheu de gente que não compra.
export const isRealLead = (l) => !l?.internal && !l?.formExit;

// ── O que é VENDA (Leo, 16/08/2026) ─────────────────────────────────────────
// A régua do DINHEIRO é mais larga que a do LEAD: a mentoria entra normal, como
// contrato e receita, pra pessoa e pro time. O lead dela segue fora do funil
// (`isRealLead`), e isso é de propósito, porque o denominador do funil é a
// máquina da plataforma: CPL, taxa de contato, agendamento e conversão por call
// medem quem PODE comprar o software. Vender mentoria não passa por call
// agendada, então contá-la nas taxas inflaria a conversão e desdobraria a meta
// errado.
//
// Em uma frase: dinheiro conta tudo o que o time vendeu; funil conta só a
// máquina da plataforma. Quem soma contrato ou R$ usa esta; quem soma lead,
// contato, call ou taxa usa a de cima.
export const isSaleLead = (l) => !l?.internal && (!l?.formExit || isMentoriaLead(l));

// ── Mentoria: a segunda fila do produto (Leo, 16/08/2026) ───────────────────
// O lead da mentoria continua FORA do isRealLead, e isso é de propósito: contar
// no funil quem não pode comprar a plataforma faria o CPL parecer barato e
// ensinaria a Meta a caçar mais gente fora do perfil. Mas a VENDA dele é venda
// de verdade, tem dono (o SDR) e agora é contabilizada, num bloco PRÓPRIO.
//
// Régua separada, nunca somada ao funil: os dois têm denominadores diferentes
// (aqui não existe call agendada nem taxa de fechamento por call), então
// misturar mentiria nos dois lados.
//
//   leads        todos os leads do produto (sem filtro de isRealLead)
//   inWin        (iso) => bool, a janela do período
//   startByLead  customerStartMap (fallback de ganho legado)
//   contactedIds Set de leadId com 1º contato humano NA JANELA (contactAttribution)
//   authorOf     leadId → quem fez esse 1º contato (crédito por pessoa)
export function mentoriaScore(product, leads, { inWin, startByLead, contactedIds, authorOf } = {}) {
  const fila = (leads || []).filter((l) => l.saas === product?.id && isMentoriaLead(l) && !l.internal);
  const winAt = winsIn(product, fila, inWin, startByLead);
  const open = fila.filter((l) => !TERMINAL_KINDS.has(kindOf(product, l.stage)) && !l.customerId);
  const byVerba = {};
  let potential = 0;
  for (const l of open) {
    const fit = mentoriaFit(l);
    const band = fit?.verba || "";
    byVerba[band] = (byVerba[band] || 0) + 1;
    potential += fit?.price || 0;
  }
  // Por pessoa: a fila e o contato vão pro DONO do card; a venda vai por owner
  // também (aqui não há closer separado, a fila é do SDR de ponta a ponta).
  const byUser = new Map();
  const bucket = (uid) => {
    if (!byUser.has(uid)) byUser.set(uid, { user: uid, queue: 0, contacted: 0, won: 0, revenue: 0 });
    return byUser.get(uid);
  };
  for (const l of open) if (l.owner) bucket(l.owner).queue++;
  for (const l of fila) {
    if (contactedIds?.has(l.id)) bucket(authorOf?.get(l.id) || l.owner || "").contacted++;
    if (winAt.has(l.id)) {
      const b = bucket(l.owner || "");
      b.won++;
      b.revenue = round2(b.revenue + (Number(l.amount) || 0));
    }
  }
  const wonLeads = fila.filter((l) => winAt.has(l.id));
  return {
    queue: open.length,
    queueByVerba: byVerba,
    queuePotential: Math.round(potential),
    newIn: fila.filter((l) => inWin(l.createdAt)).length,
    contacted: fila.filter((l) => contactedIds?.has(l.id)).length,
    won: wonLeads.length,
    revenue: tcvOf(wonLeads),
    unowned: open.filter((l) => !l.owner).length, // card sem dono = ninguém trabalha
    byUser: [...byUser.values()].filter((b) => b.user),
  };
}

// ── Conta grande (key account) ──────────────────────────────────────────────
// Cliente fora da régua: Galante (R$ 120 mil) e CRGroup (R$ 300 mil) no meio de
// vendas de R$ 3 a 7 mil. O flag mora no CLIENTE (`customer.keyAccount`, campo
// "Conta grande" na ficha) e a venda dele é reconhecida pelo vínculo do lead.
//
// REGRA (Leo, 23/07 e 18/08): o dinheiro dela conta em caixa e vendido, sempre.
// Quem ignora é MÉDIA e meta derivada — um contrato de 300 mil no ticket médio
// quebra a cadeia inteira (meta de contratos, calls, leads) e faz o placar de
// quem fechou parecer o de outra pessoa.
export const keyAccountIds = (customers) => new Set((customers || []).filter((c) => !!c.keyAccount).map((c) => c.id));
export const isKeyAccountLead = (keyIds, lead) => !!(lead?.customerId && keyIds?.has(lead.customerId));

// ── Indicação (referral) ─────────────────────────────────────────────────────
// Lead que veio por INDICAÇÃO (de um cliente): a origem (`source`) ou o
// `utm.source` contém "indica" — pega "Indicação", "indicacao", "Indicação de
// cliente". É a régua do placar do CS (meta de indicação): conta TODA indicação
// recebida na janela, sem atribuição fina por pessoa (decisão do Leo).
const stripAccents = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
export const isReferralLead = (l) =>
  stripAccents(l?.source).includes("indica") || stripAccents(l?.utm?.source).includes("indica");

// ── Classes de lead (Receita Previsível: Sementes · Redes · Alvos) ───────────
// Cada classe tem ciclo, taxa e previsibilidade próprios, então nunca entram na
// mesma projeção (Aaron Ross, cap. 6). Semente = veio por indicação/boca a boca
// (a régua isReferralLead). Alvo = a prospecção outbound foi atrás (lead com
// flag `outbound`, source contendo "outbound" ou utm.medium "outbound" — é como
// o radar de contas carimba). Rede = o marketing pescou (tráfego pago, form,
// social: todo o resto). A soma das 3 classes fecha com o total por construção.
export const LEAD_CLASSES = ["semente", "rede", "alvo"];
export function leadClassOf(lead) {
  if (isReferralLead(lead)) return "semente";
  const src = stripAccents(lead?.source);
  if (lead?.outbound || src.includes("outbound") || stripAccents(lead?.utm?.medium) === "outbound") return "alvo";
  return "rede";
}

// Contagens por classe numa janela: leads que ENTRARAM (createdAt), ganhos e
// receita (winAt = Map do winsIn — a régua oficial da venda). Soma das classes
// = tile de leads/ganhos do período, pro funil por origem nunca divergir.
export function classCounts(leads, inWin, winAt) {
  const out = Object.fromEntries(LEAD_CLASSES.map((c) => [c, { leads: 0, won: 0, revenue: 0 }]));
  for (const l of leads) {
    const c = out[leadClassOf(l)];
    if (inWin(l.createdAt)) c.leads++;
    if (winAt?.has(l.id)) { c.won++; c.revenue = round2(c.revenue + (Number(l.amount) || 0)); }
  }
  return out;
}

// ── Fechamentos numa janela ──────────────────────────────────────────────────
// Vendas da janela pela régua oficial: isWonLead + data do wonAtOf. Fallback
// pro lead legado sem carimbo nenhum: startedAt do cliente vinculado (leadId).
// Retorna Map lead.id → momento da venda (só os que caem na janela).
export function winsIn(product, leads, inWin, customerStartByLead) {
  const winAt = new Map();
  for (const l of leads) {
    if (!isWonLead(product, l)) continue;
    const at = wonAtOf(l) || customerStartByLead?.get(l.id) || "";
    if (at && inWin(at)) winAt.set(l.id, at);
  }
  return winAt;
}

// Vínculo lead → início do cliente (fallback do winsIn pra dado legado).
export const customerStartMap = (customers) =>
  new Map(customers.filter((c) => c.leadId && c.startedAt).map((c) => [c.leadId, c.startedAt]));

// TCV de um conjunto de leads (valor lançado no fechamento).
export const tcvOf = (leads) => round2(leads.reduce((a, l) => a + (Number(l.amount) || 0), 0));

// ── A safra de calls ─────────────────────────────────────────────────────────
// Avançou pra frente da call (a call ACONTECEU): proposta/negociação/fechou.
export const FORWARD_KINDS = new Set(["proposta", "followup", "integracao", "ganho"]);

// Leads DISTINTOS da lista que atingiram estágio de kind `call` na janela.
//   actsOf: (leadId) => activities ORDENADAS por data.
export function bookedLeadsIn(product, leads, actsOf, inWin) {
  const byId = new Map(leads.map((l) => [l.id, l]));
  const ids = new Set();
  for (const l of leads) {
    for (const a of actsOf(l.id) || []) {
      if (a.type === "stage" && inWin(a.at) && kindOf(product, a.meta?.to) === "call") ids.add(l.id);
    }
  }
  return [...ids].map((id) => byId.get(id)).filter(Boolean);
}

// ── A TESTEMUNHA da call: o resumo por IA da transcrição ────────────────────
// Regra do Leo (03/08): "call realizada é apenas quando o cliente APARECE".
// Quando o cliente fura, a responsável entra sozinha na sala, a transcrição
// pega só ela e a IA classifica a temperatura como "frio" — então o resumo é
// a prova do que aconteceu de verdade, imune a card parado, no-show não
// marcado ou callAt remarcado/limpo: FRIO = não compareceu; QUENTE/MORNO =
// compareceu. O resumo de INTEGRAÇÃO fica fora (outra conversa, outra régua).
// Devolve o resumo de call mais RECENTE do lead ({ temperatura, at }) ou null.
export function callWitness(acts) {
  let best = null;
  for (const a of acts || []) {
    const m = a?.meta;
    if (m?.event !== "call_summary" || !m.summary || m.kind === "integracao") continue;
    if (!best || String(a.at || "") > String(best.at || "")) best = a;
  }
  return best ? { temperatura: String(best.meta.summary.temperatura || ""), at: best.at || "" } : null;
}

// Safra de calls de uma janela: lead com callAt NA janela OU com resumo de
// call (testemunha) gerado nela. O segundo braço resgata a call que ACONTECEU
// mas sumiria da conta porque o callAt foi REMARCADO pra frente (o campo é um
// só: a call de hoje apaga a da semana passada) ou LIMPO depois do desfecho —
// caso real da UniqueKids em 03/08: 4 calls feitas, com transcrição, fora da
// safra. Quem tem os dois na janela conta UMA vez (é o mesmo lead).
export function callCohortIn(leads, actsOf, inWin) {
  return (leads || []).filter((l) => {
    if (l.callAt && inWin(l.callAt)) return true;
    return (actsOf(l.id) || []).some((a) =>
      a?.meta?.event === "call_summary" && a.meta.summary && a.meta.kind !== "integracao" && inWin(a.at));
  });
}

// Resolução da safra de calls, com a data de hoje pra separar "não veio" de
// "ainda vai acontecer" (Leo, 25/07 — o gap agendadas−realizadas não é tudo
// no-show: parte é call marcada pro futuro):
//   shown   = a call ACONTECEU: testemunha quente/morna, avançou pra frente
//             OU perdeu por OUTRO motivo (sem testemunha dizendo o contrário).
//   noShow  = não veio: testemunha FRIA (Leo, 03/08 — backup pro no-show não
//             aplicado), perda "nao_compareceu", etapa de No show, OU call já
//             VENCIDA (callAt ≤ hoje) parada sem avançar (moveu pra Nutrição
//             etc. sem virar call real). É o "não compareceram" do funil.
//   pending = call marcada pro FUTURO (callAt > hoje), ainda não aconteceu —
//             fora da conta de comparecimento (não é furo, é agenda).
// Precedência: GANHO vence tudo (cliente que fechou obviamente apareceu);
// depois a testemunha (frio → furo; quente/morno → realizada); sem
// transcrição, vale o estado do card como sempre valeu.
// Assim agendadas = shown + noShow + pending, e comparecimento = shown ÷
// (shown+noShow) mede só o que já deveria ter acontecido.
// `today` (dia do negócio "YYYY-MM-DD"); sem ele, tudo que não aconteceu conta
// como noShow (comportamento antigo — coorte histórica não tem call futura).
// `inWin` (opcional): com a janela na mão, a testemunha só fala se o resumo é
// DA janela — senão o lead remarcado pro mês seguinte carregaria o resumo do
// mês anterior e contaria "realizada" antes da call nova acontecer.
export function callOutcome(product, list, actsOf, today = null, inWin = null) {
  let shown = 0, noShow = 0, pending = 0, won = 0;
  for (const l of list) {
    const isW = isWonLead(product, l);
    const lost = isLoss(product, l.stage);
    if (isW) { won++; shown++; continue; }
    const w = callWitness(actsOf(l.id));
    const temp = w && (!inWin || inWin(w.at)) ? w.temperatura : "";
    if (temp === "frio") { noShow++; continue; }
    if (temp === "quente" || temp === "morno") { shown++; continue; }
    const advanced = FORWARD_KINDS.has(kindOf(product, l.stage))
      || (actsOf(l.id) || []).some((a) => a.type === "stage" && FORWARD_KINDS.has(kindOf(product, a.meta?.to)));
    if (advanced || (lost && l.lostReason !== "nao_compareceu")) { shown++; continue; }
    if ((lost && l.lostReason === "nao_compareceu") || isNoShowStage(l.stage)) { noShow++; continue; }
    // Não avançou e não é furo marcado: futuro = ainda vai acontecer; senão,
    // call vencida que não virou nada = não compareceu.
    if (today && dayKey(l.callAt) > today) pending++;
    else noShow++;
  }
  return { shown, noShow, pending, won };
}

// ── Funil de conversão do produto (base ÚNICA das telas) ─────────────────────
// Contagens do funil COORTE na janela (leads criados nela): contatados →
// agendaram call → compareceram → fecharam, + ganhos e receita. É a MESMA base
// da Visão geral (Conversões do funil) e da Análise de Pace, pra as duas telas
// nunca divergirem. O funil ENCADEIA — cada denominador é o passo anterior.
//   actsOf: (leadId) => activities ordenadas;  winLeadsIn(inWin) => leads ganhos
// `adjust` (product.paceAdjust) soma HISTÓRICO PRÉ-COCKPIT (dados reais de antes
// do registro no sistema): { leads, contacted, booked, shown, won } — só somas
// positivas; noShow e ganhos totais (revenue) não entram no ajuste.
// ── Contato com ATRIBUIÇÃO (a régua ÚNICA de "contatados") ───────────────────
// Decisões do Leo (24/07): contato = ação HUMANA — toque de cadência
// (whatsapp/call/email/meeting) ou mensagem ENVIADA no inbox por gente do time
// (`humanIds` = ids da collection users). Automação (fluxo de ligação, drip,
// envio por chave "cockpit") NÃO conta no total: sai em `automationReached`
// (leads distintos que ela alcançou, informativo). Cada lead vai pro autor do
// PRIMEIRO contato humano da janela, então a soma dos autores fecha EXATA com
// o total — é o que deixa o funil da Visão geral ser a soma dos cards.
// O inbox segue separado das activities DE PROPÓSITO (chat ≠ toque de cadência,
// não re-agenda o GPS), mas a mensagem enviada conta como contato aqui.
// `creditAllTo` (decisão do Leo, 25/07): com um ÚNICO SDR na operação, TODO
// contato humano credita nele — o funil de prospecção é dele, mesmo quando um
// closer respondeu o lead (o autor real segue nas activities; aqui é o placar).
// Devolve { leadIds, byAuthor (Map autor → leads distintos), automationReached }.
export function contactAttribution({ leads, actsOf, waMessages, saas, inWin, humanIds, creditAllTo } = {}) {
  const first = new Map();       // leadId → { at, author } do 1º contato humano
  const autoReached = new Set(); // leads que a automação tocou (mesmo que gente também)
  const record = (id, at, author) => {
    if (!humanIds?.has(author || "")) { autoReached.add(id); return; }
    const cur = first.get(id);
    if (!cur || String(at || "") < String(cur.at || "")) first.set(id, { at: at || "", author: creditAllTo || author });
  };
  const knownIds = new Set((leads || []).map((l) => l.id));
  for (const m of waMessages || []) {
    if (m.direction !== "out" || !m.leadId || !m.author) continue;
    if (saas && m.saas && m.saas !== saas) continue;
    if (!knownIds.has(m.leadId) || !inWin(m.at)) continue;
    record(m.leadId, m.at, m.author);
  }
  for (const l of leads || []) {
    for (const a of actsOf(l.id) || []) {
      if (inWin(a.at) && TOUCH_TYPES.has(a.type)) record(l.id, a.at, a.author);
    }
  }
  const byAuthor = new Map();
  for (const { author } of first.values()) byAuthor.set(author, (byAuthor.get(author) || 0) + 1);
  // `firstAt` = leadId → quando foi o 1º contato humano (alimenta o SLA de 1º
  // toque: minutos entre o cadastro e a resposta do time).
  const firstAt = new Map([...first].map(([id, v]) => [id, v.at]));
  // `authorOf` = leadId → autor creditado (base das taxas por pessoa em coorte).
  const authorOf = new Map([...first].map(([id, v]) => [id, v.author]));
  return { leadIds: new Set(first.keys()), firstAt, byAuthor, authorOf, automationReached: autoReached.size };
}

// ── Primeira RESPOSTA por qualquer canal (humano OU robô) ────────────────────
// O contato humano acima é a régua de COBRANÇA do time e segue intacta (o
// sdr-bot cai em automationReached, de propósito). Com o SDR automatizado no
// ar, a pergunta "quanto tempo o LEAD esperou por alguém" precisa de régua
// própria: a primeira mensagem enviada na conversa dele (qualquer autor,
// sdr-bot incluído) ou o primeiro toque de cadência, o que vier antes.
// Devolve Map leadId → { at, human } (human = o autor está na collection users).
export function firstResponseAttribution({ leads, actsOf, waMessages, saas, inWin, humanIds } = {}) {
  const first = new Map();
  const record = (id, at, author) => {
    if (!at) return;
    const cur = first.get(id);
    if (!cur || String(at) < String(cur.at)) first.set(id, { at, human: !!humanIds?.has(author || "") });
  };
  const knownIds = new Set((leads || []).map((l) => l.id));
  for (const m of waMessages || []) {
    if (m.direction !== "out" || !m.leadId) continue;
    if (saas && m.saas && m.saas !== saas) continue;
    if (!knownIds.has(m.leadId) || !inWin(m.at)) continue;
    record(m.leadId, m.at, m.author);
  }
  for (const l of leads || []) {
    for (const a of actsOf(l.id) || []) {
      if (inWin(a.at) && TOUCH_TYPES.has(a.type)) record(l.id, a.at, a.author);
    }
  }
  return first;
}

export function funnelCounts(product, { leads, actsOf, inWin, winLeadsIn, adjust, waContactedIds } = {}) {
  const recentLeads = leads.filter((l) => inWin(l.createdAt));
  const recentIds = new Set(recentLeads.map((l) => l.id));
  const contacted = recentLeads.filter((l) => (actsOf(l.id) || []).some((a) => TOUCH_TYPES.has(a.type)) || waContactedIds?.has(l.id));
  const booked = bookedLeadsIn(product, leads, actsOf, inWin).filter((l) => recentIds.has(l.id));
  const outcome = callOutcome(product, booked, actsOf);
  const wonLeads = winLeadsIn ? winLeadsIn(inWin) : [];
  const a = adjust && typeof adjust === "object" ? adjust : {};
  const adjN = (k) => { const n = Math.floor(Number(a[k])); return Number.isFinite(n) && n > 0 ? n : 0; };
  const adjApplied = ["leads", "contacted", "booked", "shown", "won"].reduce((o, k) => (adjN(k) ? { ...o, [k]: adjN(k) } : o), null);
  return {
    leads: recentLeads.length + adjN("leads"),
    contacted: contacted.length + adjN("contacted"),
    booked: booked.length + adjN("booked"),
    shown: outcome.shown + adjN("shown"),
    noShow: outcome.noShow,
    won: outcome.won + adjN("won"),   // ganhos DA SAFRA de calls (+ pré-cockpit) — o que encadeia
    wonTotal: wonLeads.length,         // ganhos totais no período (todos, por transição)
    revenue: tcvOf(wonLeads),
    adjust: adjApplied,
  };
}

// ── Dinheiro ─────────────────────────────────────────────────────────────────
// MRR da base: soma do arr/12 dos clientes (a régua do bootstrap e do pace).
export const mrrOf = (customers) =>
  round2(customers.reduce((a, c) => a + (Number(c.arr) || 0), 0) / 12);

// Caixa do mês: faturas PAGAS com paidAt dentro do mês (chave "YYYY-MM").
export const cashCollectedIn = (invoices, month) =>
  round2(invoices
    .filter((i) => i.status === "paid" && i.paidAt && monthKey(i.paidAt) === month)
    .reduce((a, i) => a + (Number(i.amount) || 0), 0));

// Caixa numa janela em 3 BALDES (livro: novos negócios · add-ons · renovações).
// Mesma régua da faixa de meta (fatura paga, por paidAt), só que repartida:
// kind "upsell" = add-on; cliente que COMEÇOU dentro da janela = receita NOVA;
// cliente antigo pagando de novo = renovação/recorrência. novos + upsell +
// renovacao = cashCollectedIn da mesma janela, por construção.
export function cashBucketsIn(invoices, customers, inWin) {
  const startBy = new Map(customers.map((c) => [c.id, c.startedAt || ""]));
  const out = { novos: 0, upsell: 0, renovacao: 0 };
  for (const i of invoices) {
    if (i.status !== "paid" || !i.paidAt || !inWin(i.paidAt)) continue;
    const amt = Number(i.amount) || 0;
    if (i.kind === "upsell") out.upsell += amt;
    else if (inWin(startBy.get(i.customer))) out.novos += amt;
    else out.renovacao += amt;
  }
  return {
    novos: round2(out.novos), upsell: round2(out.upsell), renovacao: round2(out.renovacao),
    total: round2(out.novos + out.upsell + out.renovacao),
  };
}

// A receber até uma data (faturas abertas/vencidas com dueDate ≤ limite).
export const receivablesUntil = (invoices, untilDay) =>
  invoices.filter((i) => {
    if (i.status !== "open" && i.status !== "overdue") return false;
    const due = dayKey(i.dueDate);
    return due && due <= untilDay;
  });

// ── Origem do lead (Aquisição) ──────────────────────────────────────────────
// Classifica o lead pelo UTM + referrer do cadastro — régua ÚNICA: a tela de
// Publicidade (e qualquer card novo) lê DAQUI. Ordem importa: pago primeiro
// (medium=paid, com o canal pelo referrer/source), depois social orgânico
// (bio), busca, site próprio. Sem nada = Direto (link limpo, ex.: WhatsApp).
// Calibrado nos leads reais de 07/08: meta+paid com referrer facebook/instagram
// é o grosso; "ig"/"fb" no source são os links antigos; "an" = Audience Network.
export function leadOrigin(lead) {
  const utm = (lead && typeof lead.utm === "object" && lead.utm) || {};
  const src = String(utm.source || "").toLowerCase();
  const medium = String(utm.medium || "").toLowerCase();
  const ref = String(utm.referrer || "").toLowerCase();
  const ig = ref.includes("instagram") || src === "ig" || src === "instagram";
  const fb = ref.includes("facebook") || src === "fb" || src === "facebook" || src === "an";
  if (medium === "paid") {
    if (ig) return "ads_ig";
    if (fb) return "ads_fb";
    return "ads_meta"; // pago sem canal identificável (referrer vazio/estranho)
  }
  if (ig) return "bio_ig";
  if (fb) return "bio_fb";
  if (src.includes("google") || ref.includes("google")) return "google";
  if (src.includes("site") || ref.includes("leverads.com.br") || ref.includes("levermoney")) return "site";
  if (!src && !medium && !ref) return "direto";
  return "outros";
}

export const LEAD_ORIGINS = [
  { key: "ads_ig", label: "Ads IG" },
  { key: "ads_fb", label: "Ads FB" },
  { key: "ads_meta", label: "Ads Meta · sem canal" },
  { key: "bio_ig", label: "Bio IG" },
  { key: "bio_fb", label: "Bio FB" },
  { key: "google", label: "Google" },
  { key: "site", label: "Site" },
  { key: "direto", label: "Direto · sem UTM" },
  { key: "outros", label: "Outros" },
];
