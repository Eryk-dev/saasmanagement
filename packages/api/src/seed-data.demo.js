// Seed data — real SaaS operator metrics, ported verbatim from the design prototype.
// Hybrid units: $ for MRR/TCV/ACV/NNM, % for NRR/conversion/activation.
// Three deliberately heterogeneous SaaS so consolidation matters.
// This module is the API's source of truth on first run; after that the SQLite
// store owns the data (so external SaaS can mutate it via REST/MCP).

export const SAAS = [
  {
    id: "leverads",
    name: "LeverAds",
    tag: "Orquestração de anúncios de performance",
    plan: "Enterprise",
    motion: "Liderado por vendas",
    ticketBand: "Ent",
    cycleDays: 78,
    health: 81, healthDelta: +2, healthTrend: "improving",

    mrr: 184_200, mrrDelta: +12_400,
    arr: 2_210_400,
    nrr: 1.18, nrrDelta: +0.03,
    grr: 0.94,
    logoRetention: 0.95,
    churnRate: 0.011,

    nnm: { new: 24_800, expansion: 9_600, contraction: -4_500, churn: -7_500 },

    tcv: 1_640_000, tcvDelta: +0.08,
    pipelineCoverage: 3.4,
    acv: 48_200, acvDelta: +0.04,
    winRate: 0.27, winRateDelta: +0.03,
    velocity: 142, velocityDelta: +0.06,

    funnel: [
      { stage: "Prospect",    count: 480, conv: 1.00 },
      { stage: "Qualify",     count: 192, conv: 0.40 },
      { stage: "Discovery",   count: 73,  conv: 0.38, flag: "bottleneck" },
      { stage: "Proposal",    count: 31,  conv: 0.42 },
      { stage: "Negotiation", count: 19,  conv: 0.61 },
      { stage: "Closed Won",  count: 13,  conv: 0.68 },
    ],
    activation: 0.71, activationDelta: +0.02,
    nps: 47, npsDelta: +3,

    mrrSeries: [171, 170, 172, 173, 173, 174, 176, 176, 177, 178, 179, 181, 182, 184],
    healthSeries: [62, 64, 63, 66, 68, 67, 70, 72, 71, 74, 75, 78, 79, 81],

    customers: 412, customersDelta: +6,
    accent: 33,
  },
  {
    id: "quill",
    name: "Quill",
    tag: "Escrita com IA para criadores solo",
    plan: "Pro / Basic",
    motion: "PLG",
    ticketBand: "SMB",
    cycleDays: 6,
    health: 54, healthDelta: -7, healthTrend: "worsening",

    mrr: 94_180, mrrDelta: -8_240,
    arr: 1_130_160,
    nrr: 0.86, nrrDelta: -0.07,
    grr: 0.81,
    logoRetention: 0.78,
    churnRate: 0.062,

    nnm: { new: 11_400, expansion: 2_100, contraction: -8_900, churn: -12_840 },

    tcv: 0, tcvDelta: 0,
    pipelineCoverage: null,
    acv: 504, acvDelta: -0.03,
    winRate: 0.42, winRateDelta: -0.04,
    velocity: 84, velocityDelta: -0.12,

    funnel: [
      { stage: "Signup",   count: 1_240, conv: 1.00 },
      { stage: "Aha",      count: 532,   conv: 0.43, flag: "regression" },
      { stage: "Trial",    count: 412,   conv: 0.77 },
      { stage: "Paid",     count: 178,   conv: 0.43, flag: "bottleneck" },
      { stage: "Retained", count: 142,   conv: 0.80 },
    ],
    activation: 0.43, activationDelta: -0.08,
    nps: 18, npsDelta: -9,

    mrrSeries: [104, 103, 102, 102, 101, 100, 99, 98, 97, 96, 95, 94, 94, 94],
    healthSeries: [72, 70, 72, 71, 69, 68, 66, 65, 67, 63, 62, 60, 58, 54],

    customers: 1_872, customersDelta: -41,
    accent: 235,
  },
  {
    id: "mesa",
    name: "Mesa",
    tag: "Operações de estoque de armazém",
    plan: "Pro / Enterprise",
    motion: "Assistido por vendas",
    ticketBand: "Mid",
    cycleDays: 32,
    health: 67, healthDelta: 0, healthTrend: "stable",

    mrr: 128_600, mrrDelta: +1_120,
    arr: 1_543_200,
    nrr: 1.04, nrrDelta: -0.01,
    grr: 0.92,
    logoRetention: 0.91,
    churnRate: 0.018,

    nnm: { new: 6_400, expansion: 4_120, contraction: -3_200, churn: -6_200 },

    tcv: 890_000, tcvDelta: +0.01,
    pipelineCoverage: 2.1,
    acv: 7_440, acvDelta: +0.00,
    winRate: 0.31, winRateDelta: 0,
    velocity: 108, velocityDelta: +0.01,

    funnel: [
      { stage: "Prospect", count: 312, conv: 1.00 },
      { stage: "Qualify",  count: 148, conv: 0.47 },
      { stage: "Pilot",    count: 56,  conv: 0.38 },
      { stage: "Proposal", count: 31,  conv: 0.55 },
      { stage: "Closed",   count: 19,  conv: 0.61 },
    ],
    activation: 0.58, activationDelta: +0.01,
    nps: 31, npsDelta: -1,

    mrrSeries: [126, 127, 128, 127, 128, 128, 128, 127, 129, 128, 128, 128, 128, 128],
    healthSeries: [65, 66, 67, 66, 68, 67, 67, 66, 68, 67, 68, 67, 67, 67],

    customers: 1_204, customersDelta: -2,
    accent: 152,
  },
];

// Portfolio constants the prototype kept hard-coded for the trajectory chart.
// (mrr / arr / mrrDelta / tcv / customers are derived from SAAS at request time.)
export const PORTFOLIO_CONST = {
  nrr: 1.06, // weighted
  mrrSeries30d: [398, 400, 401, 402, 403, 401, 402, 404, 404, 403, 404, 406, 406, 407, 406, 405, 405, 406, 406, 407, 407, 406, 406, 407, 407, 407, 407, 407, 407, 407],
};

export const ATTENTION = [
  {
    id: "a1", saas: "quill", severity: "critical",
    title: "MRR contraiu −R$8,2k MoM · churn dobrou",
    detail: "62 cancelamentos em 30d · 12 citam 'IA alucinou citações'",
    metric: "Churn R$", value: "−R$12.840", delta: -0.082, age: "2h",
    link: { type: "saas", id: "quill" },
  },
  {
    id: "a2", saas: "quill", severity: "critical",
    title: "Ativação despencou −8pp s/s (51% → 43%)",
    detail: "Queda concentrada em signups de busca orgânica · 412 trials afetados",
    metric: "Ativação", value: "43%", delta: -0.08, age: "5h",
    link: { type: "saas", id: "quill" },
  },
  {
    id: "a3", saas: "leverads", severity: "high",
    title: "Conversão Discovery → Proposal em 42% (era 58%)",
    detail: "Tempo mediano no estágio 14d vs base de 6d · 23 deals travados · R$1,1M de TCV parado",
    metric: "Conv", value: "42%", delta: -0.16, age: "1d",
    link: { type: "pipeline", id: "leverads", stage: "Discovery" },
  },
  {
    id: "a4", saas: "mesa", severity: "high",
    title: "3 contas enterprise entraram na zona vermelha — R$214k de ARR em risco",
    detail: "Northwind, Acme Logistics, Blueprint · todas com uso caindo há 3sem",
    metric: "ARR em risco", value: "R$214k", delta: -0.139, age: "1d",
    link: { type: "customers", id: "mesa", filter: "red" },
  },
  {
    id: "a5", saas: "leverads", severity: "medium",
    title: "Desvio de rep — ciclo da Priya R. 2.3× a mediana do ICP",
    detail: "Padrão: pulando o estágio Discovery · 4 deals · CTA de coaching na fila",
    metric: "Ciclo", value: "+130%", delta: -0.7, age: "2d",
    link: { type: "rep", id: "PR" },
  },
  {
    id: "a6", saas: "quill", severity: "medium",
    title: "MRR de expansão caiu pra R$2,1k (média 90d R$7,4k)",
    detail: "Upsells do tier power travados · provável ligação com o cluster de detratores",
    metric: "Expansão", value: "R$2,1k", delta: -0.72, age: "3d",
    link: { type: "saas", id: "quill" },
  },
];

export const DEALS = [
  { id: "d1",  title: "Helios Media",      company: "Helios Media",   amount: 84_000,  stage: "Prospect",    owner: "JC", age: 3,  score: "warm", contacts: 2, source: "Outbound", saas: "leverads" },
  { id: "d2",  title: "Northwind Trading", company: "Northwind",      amount: 142_000, stage: "Prospect",    owner: "PR", age: 8,  score: "cold", contacts: 1, source: "Inbound",  saas: "leverads" },
  { id: "d3",  title: "Civic Labs",        company: "Civic Labs",     amount: 28_000,  stage: "Prospect",    owner: "JC", age: 1,  score: "hot",  contacts: 4, source: "Indicação", saas: "leverads" },
  { id: "d4",  title: "Acme Logistics",    company: "Acme Logistics", amount: 96_000,  stage: "Qualify",     owner: "PR", age: 6,  score: "warm", contacts: 3, source: "Outbound", saas: "leverads" },
  { id: "d5",  title: "Blueprint",         company: "Blueprint",      amount: 22_000,  stage: "Qualify",     owner: "MK", age: 12, score: "cold", contacts: 2, source: "Evento",    saas: "leverads" },
  { id: "d6",  title: "Vertex Cloud",      company: "Vertex Cloud",   amount: 124_000, stage: "Discovery",   owner: "PR", age: 18, score: "warm", contacts: 5, source: "Outbound", flag: "stuck", saas: "leverads" },
  { id: "d7",  title: "Ferro Group",       company: "Ferro",          amount: 168_000, stage: "Discovery",   owner: "MK", age: 22, score: "hot",  contacts: 6, source: "Inbound",  flag: "stuck", saas: "leverads" },
  { id: "d8",  title: "Polaris Bank",      company: "Polaris",        amount: 210_000, stage: "Discovery",   owner: "JC", age: 15, score: "warm", contacts: 4, source: "Outbound", flag: "stuck", saas: "leverads" },
  { id: "d9",  title: "Tessera",           company: "Tessera",        amount: 38_000,  stage: "Discovery",   owner: "PR", age: 9,  score: "warm", contacts: 3, source: "Indicação", saas: "leverads" },
  { id: "d10", title: "Hartwell Foods",    company: "Hartwell",       amount: 76_000,  stage: "Proposal",    owner: "MK", age: 5,  score: "hot",  contacts: 4, source: "Outbound", proposal: "visto 4x · 3:21 méd", saas: "leverads" },
  { id: "d11", title: "Atlas Bio",         company: "Atlas Bio",      amount: 132_000, stage: "Proposal",    owner: "JC", age: 11, score: "warm", contacts: 5, source: "Inbound",  proposal: "parado 4d · 0 aberturas", saas: "leverads" },
  { id: "d12", title: "Lumen Capital",     company: "Lumen",          amount: 88_000,  stage: "Negotiation", owner: "PR", age: 4,  score: "hot",  contacts: 6, source: "Indicação", saas: "leverads" },
  { id: "d13", title: "Cedar Health",      company: "Cedar",          amount: 64_000,  stage: "Closed Won",  owner: "MK", age: 0,  score: "hot",  contacts: 5, source: "Outbound", saas: "leverads" },
  { id: "d14", title: "Stride Apparel",    company: "Stride",         amount: 42_000,  stage: "Closed Won",  owner: "JC", age: 0,  score: "warm", contacts: 3, source: "Inbound",  saas: "leverads" },

  // Synthetic deals for Quill & Mesa so the stacked "All pipelines" view has real content.
  { id: "q1",  title: "Pivot Apps",    company: "Pivot Apps",    stage: "Aha",      amount: 1200, score: "hot",  owner: "PR", age: 1,  contacts: 1, source: "PLG",      saas: "quill" },
  { id: "q2",  title: "Curio",         company: "Curio",         stage: "Trial",    amount: 900,  score: "warm", owner: "SS", age: 2,  contacts: 1, source: "PLG",      saas: "quill" },
  { id: "q3",  title: "Drift Co.",     company: "Drift Co.",     stage: "Signup",   amount: 0,    score: "cold", owner: "AB", age: 0,  contacts: 1, source: "PLG",      saas: "quill" },
  { id: "q4",  title: "Maple Studio",  company: "Maple Studio",  stage: "Signup",   amount: 0,    score: "warm", owner: "SS", age: 1,  contacts: 1, source: "PLG",      saas: "quill" },
  { id: "q5",  title: "Inkwell",       company: "Inkwell",       stage: "Trial",    amount: 1500, score: "hot",  owner: "PR", age: 3,  contacts: 1, source: "PLG",      saas: "quill" },
  { id: "q6",  title: "Roma Studios",  company: "Roma Studios",  stage: "Paid",     amount: 1200, score: "warm", owner: "AB", age: 5,  contacts: 1, source: "PLG",      saas: "quill" },
  { id: "q7",  title: "Vega Type",     company: "Vega Type",     stage: "Aha",      amount: 600,  score: "warm", owner: "SS", age: 2,  contacts: 1, source: "PLG",      saas: "quill" },
  { id: "q8",  title: "Foliage",       company: "Foliage",       stage: "Paid",     amount: 2400, score: "hot",  owner: "PR", age: 8,  contacts: 1, source: "PLG",      saas: "quill" },
  { id: "q9",  title: "Quartz",        company: "Quartz",        stage: "Retained", amount: 1200, score: "warm", owner: "AB", age: 30, contacts: 1, source: "PLG",      saas: "quill" },
  { id: "q10", title: "Lumio",         company: "Lumio",         stage: "Signup",   amount: 0,    score: "cold", owner: "SS", age: 0,  contacts: 1, source: "PLG",      saas: "quill" },

  { id: "m1",  title: "Forge & Co.",     company: "Forge & Co.",     stage: "Prospect", amount: 28_000, score: "warm", owner: "MK", age: 4,  contacts: 2, source: "Outbound", saas: "mesa" },
  { id: "m2",  title: "Beacon Health",   company: "Beacon Health",   stage: "Qualify",  amount: 32_000, score: "hot",  owner: "AB", age: 3,  contacts: 2, source: "Outbound", saas: "mesa" },
  { id: "m3",  title: "Cargo Liné",      company: "Cargo Liné",      stage: "Prospect", amount: 18_000, score: "cold", owner: "SS", age: 9,  contacts: 2, source: "Outbound", saas: "mesa" },
  { id: "m4",  title: "Atlas Depot",     company: "Atlas Depot",     stage: "Pilot",    amount: 44_000, score: "warm", owner: "MK", age: 12, contacts: 2, source: "Outbound", saas: "mesa" },
  { id: "m5",  title: "Northwind",       company: "Northwind",       stage: "Pilot",    amount: 84_000, score: "warm", owner: "AB", age: 18, contacts: 2, source: "Outbound", flag: "stuck", saas: "mesa" },
  { id: "m6",  title: "Stride Apparel",  company: "Stride Apparel",  stage: "Proposal", amount: 22_000, score: "hot",  owner: "SS", age: 5,  contacts: 2, source: "Outbound", saas: "mesa" },
  { id: "m7",  title: "Tessera",         company: "Tessera",         stage: "Proposal", amount: 38_000, score: "warm", owner: "MK", age: 7,  contacts: 2, source: "Outbound", saas: "mesa" },
  { id: "m8",  title: "Granary",         company: "Granary",         stage: "Qualify",  amount: 26_000, score: "warm", owner: "AB", age: 6,  contacts: 2, source: "Outbound", saas: "mesa" },
  { id: "m9",  title: "Blueprint",       company: "Blueprint",       stage: "Closed",   amount: 58_000, score: "hot",  owner: "SS", age: 0,  contacts: 2, source: "Outbound", saas: "mesa" },
];

// People are keyed by id in the prototype (PEOPLE object). Stored as rows; the
// bootstrap endpoint rebuilds the keyed object.
export const PEOPLE = {
  JC: { id: "JC", name: "Jordan Cho",    role: "Closer · Ent", quota: 0.91, deals: 7,  won: 4,  band: "ok",  avatar: 33 },
  PR: { id: "PR", name: "Priya Rao",     role: "Closer · Ent", quota: 0.46, deals: 9,  won: 2,  band: "off", avatar: 290, flag: "deviation" },
  MK: { id: "MK", name: "Mika Kessler",  role: "Closer · Mid", quota: 1.12, deals: 6,  won: 5,  band: "top", avatar: 152, flag: "top" },
  SS: { id: "SS", name: "Sam Sato",      role: "SDR",          quota: 0.78, deals: 22, won: 11, band: "ok",  avatar: 65 },
  AB: { id: "AB", name: "Amelia Brewer", role: "SDR",          quota: 1.04, deals: 19, won: 13, band: "top", avatar: 200, flag: "top" },
  RV: { id: "RV", name: "Roma Vance",    role: "CSM",          quota: null, deals: 0,  won: 0,  band: "ok",  avatar: 105 },
  NB: { id: "NB", name: "Niko Brent",    role: "CSM",          quota: null, deals: 0,  won: 0,  band: "ok",  avatar: 12 },
};

export const CUSTOMERS = [
  { id: "c1",  name: "Northwind Trading", saas: "mesa",     plan: "Enterprise", arr: 84_000,  health: 28, delta: -22, usage: "−42% s/s", lastTouch: "12d", csm: "AB", nps: 2, renewal: "21d",  flags: ["renewal-90d", "usage-decay", "ticket-spike"] },
  { id: "c2",  name: "Acme Logistics",    saas: "mesa",     plan: "Enterprise", arr: 72_000,  health: 31, delta: -18, usage: "−31% s/s", lastTouch: "5d",  csm: "SS", nps: 3, renewal: "44d",  flags: ["usage-decay", "champion-left"] },
  { id: "c3",  name: "Blueprint",         saas: "mesa",     plan: "Pro",        arr: 58_000,  health: 39, delta: -12, usage: "−18% s/s", lastTouch: "8d",  csm: "AB", nps: 4, renewal: "67d",  flags: ["usage-decay"] },
  { id: "c4",  name: "Cedar Health",      saas: "leverads", plan: "Enterprise", arr: 64_000,  health: 88, delta: +4,  usage: "+12% s/s", lastTouch: "1d",  csm: "SS", nps: 9, renewal: "112d", flags: ["expansion"] },
  { id: "c5",  name: "Helios Media",      saas: "leverads", plan: "Enterprise", arr: 84_000,  health: 72, delta: -2,  usage: "estável",     lastTouch: "3d",  csm: "AB", nps: 7, renewal: "189d", flags: [] },
  { id: "c6",  name: "Roma Studios",      saas: "quill",    plan: "Pro",        arr: 1_200,   health: 54, delta: -5,  usage: "−9% s/s",  lastTouch: "14d", csm: "SS", nps: 3, renewal: "—",    flags: ["detractor"] },
  { id: "c7",  name: "Lumen Capital",     saas: "leverads", plan: "Enterprise", arr: 88_000,  health: 76, delta: +1,  usage: "+3% s/s",  lastTouch: "2d",  csm: "AB", nps: 8, renewal: "201d", flags: [] },
  { id: "c8",  name: "Stride Apparel",    saas: "mesa",     plan: "Pro",        arr: 22_000,  health: 61, delta: -3,  usage: "−4% s/s",  lastTouch: "6d",  csm: "SS", nps: 6, renewal: "55d",  flags: [] },
  { id: "c9",  name: "Tessera",           saas: "mesa",     plan: "Pro",        arr: 38_000,  health: 68, delta: +2,  usage: "+6% s/s",  lastTouch: "4d",  csm: "AB", nps: 7, renewal: "72d",  flags: [] },
  { id: "c10", name: "Vertex Cloud",      saas: "leverads", plan: "Enterprise", arr: 124_000, health: 82, delta: +3,  usage: "+8% s/s",  lastTouch: "1d",  csm: "SS", nps: 9, renewal: "245d", flags: ["expansion"] },
];

export const LEADS = [
  { id: "l1", name: "Mara Olin",    company: "Drift Robotics", saas: "leverads", stage: "Prospect", priority: "P0", score: 92, source: "Form · LP /pricing", age: "12m", icp: 0.95, reason: "Enterprise · 200+ funcionários · bate com o ICP", value: "Ent" },
  { id: "l2", name: "Theo Anand",   company: "Northwind",      saas: "leverads", stage: "Prospect", priority: "P0", score: 87, source: "Inbound · form de demo", age: "31m", icp: 0.91, reason: "Cargo de champion · visitante recorrente · 4 sessões", value: "Ent" },
  { id: "l3", name: "Roma Vance",   company: "Pivot Apps",     saas: "quill",    stage: "Aha",      priority: "P1", score: 71, source: "Signup PLG",         age: "2h",  icp: 0.74, reason: "Atingiu o Aha em 7min · provável conversão", value: "SMB" },
  { id: "l4", name: "Cleo Han",     company: "Helios Media",   saas: "leverads", stage: "Qualify",  priority: "P1", score: 68, source: "Indicação",           age: "4h",  icp: 0.82, reason: "Indicado pela Cedar Health", value: "Ent" },
  { id: "l5", name: "Jin Park",     company: "Forge & Co.",    saas: "mesa",     stage: "Prospect", priority: "P2", score: 54, source: "Evento",              age: "1d",  icp: 0.62, reason: "Conversa no estande · follow-up pendente", value: "Mid" },
  { id: "l6", name: "Niko Brent",   company: "Solis",          saas: "leverads", stage: "Prospect", priority: "P2", score: 48, source: "Cold",               age: "2d",  icp: 0.58, reason: "Bate com a persona · sem sinal de engajamento", value: "Ent" },
  { id: "l7", name: "Asha Patel",   company: "Beacon Health",  saas: "mesa",     stage: "Prospect", priority: "P1", score: 76, source: "Webinar",            age: "3h",  icp: 0.84, reason: "Assistiu a sessão toda · baixou a calc de ROI", value: "Mid" },
  { id: "l8", name: "Felix Yamada", company: "Curio",          saas: "quill",    stage: "Trial",    priority: "P2", score: 62, source: "Signup PLG",         age: "1d",  icp: 0.69, reason: "Padrão de power user · 14 docs criados no dia 2", value: "SMB" },
];

export const NPS = [
  { id: "n1",  saas: "quill",    score: 2,  role: "Power", tags: ["hallucination", "citations"],         age: "3h",  text: "Citou 4 artigos que não existem. Perdi um cliente por causa disso." },
  { id: "n2",  saas: "quill",    score: 1,  role: "Pro",   tags: ["hallucination", "citations", "trust"], age: "8h",  text: "Igual ao mês passado — o modelo inventa citações. Pensando em cancelar." },
  { id: "n3",  saas: "quill",    score: 3,  role: "Pro",   tags: ["hallucination"],                       age: "11h", text: "Quando o modelo erra com confiança, é pior que não ter ferramenta." },
  { id: "n4",  saas: "leverads", score: 9,  role: "Admin", tags: ["onboarding", "ROI"],                   age: "1d",  text: "ROAS subiu 31% em 6 semanas. O onboarding foi sofrido, mas valeu." },
  { id: "n5",  saas: "leverads", score: 10, role: "Power", tags: ["features", "support"],                 age: "2d",  text: "Time de suporte é surreal. O roteamento multi-conta salvou meu trimestre." },
  { id: "n6",  saas: "mesa",     score: 7,  role: "Admin", tags: ["mobile", "scanner"],                   age: "1d",  text: "A web é ótima. Mas o scanner do app trava toda semana." },
  { id: "n7",  saas: "mesa",     score: 4,  role: "Power", tags: ["api", "docs"],                         age: "2d",  text: "A doc da API é um labirinto. Gastei dois dias numa integração de webhook." },
  { id: "n8",  saas: "quill",    score: 2,  role: "Basic", tags: ["hallucination"],                       age: "16h", text: "O bug de citações não foi corrigido. Prometeram em março." },
  { id: "n9",  saas: "quill",    score: 3,  role: "Pro",   tags: ["citations", "trust"],                  age: "1d",  text: "Perdi a confiança. Cancelei o anual, voltei pro mensal." },
  { id: "n10", saas: "leverads", score: 8,  role: "Admin", tags: ["features"],                            age: "3d",  text: "A atribuição multi-touch enfim funciona como eu esperava." },
  { id: "n11", saas: "mesa",     score: 9,  role: "Power", tags: ["features"],                            age: "4d",  text: "O fluxo de recebimento em massa economiza ~6h/semana." },
  { id: "n12", saas: "quill",    score: 6,  role: "Pro",   tags: ["latency"],                             age: "5d",  text: "Ficou mais lento nas últimas duas semanas." },
];

export const LEADERBOARD_MONTH = [
  { id: "lbm1", rank: 1, person: "MK", cat: "Índice de Receita",    metric: "152",     delta: +24, badge: "🥇" },
  { id: "lbm2", rank: 2, person: "AB", cat: "Índice de Receita",    metric: "128",     delta: +3,  badge: "🥈" },
  { id: "lbm3", rank: 3, person: "JC", cat: "Índice de Receita",    metric: "119",     delta: -2,  badge: "🥉" },
  { id: "lbm4", rank: 1, person: "AB", cat: "Taxa de Win",          metric: "68%",     delta: +9,  badge: "🥇" },
  { id: "lbm5", rank: 1, person: "MK", cat: "Mais Evoluiu",     metric: "+24 idx", delta: +24, badge: "📈" },
  { id: "lbm6", rank: 1, person: "SS", cat: "Consistência",       metric: "9/9 wks", delta: +1,  badge: "🎯" },
  { id: "lbm7", rank: 1, person: "JC", cat: "Compressão de Ciclo", metric: "−18d",    delta: -18, badge: "⚡" },
];

export const LEADERBOARD_ALL = [
  { id: "lba1", rank: 1, person: "MK", cat: "Deals ganhos na carreira", metric: "287", badge: "👑" },
  { id: "lba2", rank: 2, person: "JC", cat: "Deals ganhos na carreira", metric: "201", badge: "🏆" },
  { id: "lba3", rank: 3, person: "AB", cat: "Deals ganhos na carreira", metric: "162", badge: "🏆" },
];

export const GOALS = [
  { id: "g1", scope: "Portfolio", name: "MRR",               target: 450_000, current: 406_980, projected: 421_000, unit: "$",   band: "yellow" },
  { id: "g2", scope: "Portfolio", name: "NRR",               target: 1.10,    current: 1.06,    projected: 1.08,    unit: "pct", band: "yellow" },
  { id: "g3", scope: "LeverAds",  name: "Cobertura de pipeline", target: 3.0,     current: 3.4,     projected: 3.6,     unit: "x",   band: "green" },
  { id: "g4", scope: "LeverAds",  name: "Taxa de win",          target: 0.28,    current: 0.27,    projected: 0.29,    unit: "pct", band: "green" },
  { id: "g5", scope: "Quill",     name: "Ativação",        target: 0.55,    current: 0.43,    projected: 0.41,    unit: "pct", band: "red" },
  { id: "g6", scope: "Quill",     name: "Churn (mensal)",   target: 0.04,    current: 0.062,   projected: 0.058,   unit: "pct", band: "red", invert: true },
  { id: "g7", scope: "Mesa",      name: "NRR",               target: 1.05,    current: 1.04,    projected: 1.05,    unit: "pct", band: "yellow" },
  { id: "g8", scope: "Mesa",      name: "Retenção de logos",    target: 0.93,    current: 0.91,    projected: 0.92,    unit: "pct", band: "yellow" },
];

export const PROPOSALS = [
  { id: "p1", title: "LeverAds · Hartwell Foods", amount: 76_000,  status: "viewed",      opens: 4, lastOpen: "2h", sectionsViewed: ["Cover", "Approach", "Pricing"],          rep: "MK", deal: "d10" },
  { id: "p2", title: "LeverAds · Atlas Bio",      amount: 132_000, status: "stale",       opens: 0, lastOpen: "4d", sectionsViewed: [],                                        rep: "JC", deal: "d11" },
  { id: "p3", title: "LeverAds · Lumen Capital",  amount: 88_000,  status: "negotiation", opens: 7, lastOpen: "1h", sectionsViewed: ["Cover", "Approach", "Pricing", "Terms"], rep: "PR", deal: "d12" },
  { id: "p4", title: "Mesa · Beacon Health",      amount: 32_000,  status: "viewed",      opens: 2, lastOpen: "5h", sectionsViewed: ["Cover", "Pricing"],                      rep: "MK" },
  { id: "p5", title: "Mesa · Forge & Co.",        amount: 28_000,  status: "sent",        opens: 0, lastOpen: "—",  sectionsViewed: [],                                        rep: "JC" },
];

// Collection registry: route name -> seed rows. Drives table creation + seeding
// and the generic REST router. People is stored row-per-person (values of the obj).
export const COLLECTIONS = {
  products:          SAAS,
  attention:         ATTENTION,
  deals:             DEALS,
  people:            Object.values(PEOPLE),
  customers:         CUSTOMERS,
  leads:             LEADS,
  nps:               NPS,
  goals:             GOALS,
  leaderboard_month: LEADERBOARD_MONTH,
  leaderboard_all:   LEADERBOARD_ALL,
};
