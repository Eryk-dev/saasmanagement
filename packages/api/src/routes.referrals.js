// FILA DE COLHEITA DE INDICAÇÃO (Leo, 12/09/2026).
//
// O gatilho do pedido é DADO, não calendário: cliente que acabou de ver
// resultado indica bem, cliente perguntado no aniversário de contrato indica
// por educação. Então a fila ordena por quanto os anúncios da Lever venderam na
// conta dele nos últimos 30 dias, e entrega a frase com o número dentro.
//
// Por que o número é o influenciado (gmv_clone) e não o faturamento da loja:
// a loja já vendia antes da gente. Prova inflada morre na primeira conferência
// que o cliente faz, e junto morre o pedido.
//
// A fila NÃO cria lead nem manda mensagem sozinha. Ela cria tarefa e registra o
// pedido (activity `referral_asked`), pro cliente não ser perguntado duas vezes
// no mesmo trimestre por duas pessoas diferentes.
import { isChurnedCustomer } from "./churn.js";
import { influencedByOrg } from "./leverads-results.js";
import { createTask } from "./tasks-core.js";
import { logActivity } from "./lead-flow.js";
import { isPaidReferral } from "./metrics-core.js";

const DAY = 86_400_000;
// Tempo mínimo de casa: antes disso não houve resultado pra mostrar, e pedir
// indicação de quem ainda está integrando queima o cliente.
export const MIN_DAYS = 30;
// Janela de descanso: o mesmo cliente não é pedido de novo antes disso.
export const ASK_COOLDOWN_DAYS = 90;
// Piso da prova: abaixo disso o número não sustenta o pedido. Medido na base
// real em 12/09/2026 — depois de vincular as contas que faltavam, metade dos
// clientes novos aparecia com R$ 500 a R$ 900 influenciados no mês, e "os
// anúncios que subimos venderam R$ 562" convida o cliente a discordar da prova
// em vez de indicar alguém. Quem está abaixo aparece como prova fraca, não como
// fila: é caso de esperar a operação engrenar.
export const MIN_PROOF_BRL = 1000;

const dias = (from, at = Date.now()) => {
  const t = new Date(from || 0).getTime();
  return Number.isFinite(t) && t ? Math.floor((at - t) / DAY) : null;
};

// Último pedido feito a este cliente: a activity mora no lead de origem dele
// (é onde a timeline do cliente vive).
function lastAskOf(acts, customer) {
  let best = "";
  for (const a of acts) {
    if (a?.meta?.event !== "referral_asked") continue;
    if (a.meta.customer !== customer.id && a.lead !== customer.leadId) continue;
    if (String(a.at || "") > best) best = String(a.at || "");
  }
  return best;
}

// A fila, já classificada. `bucket`:
//   pedir        prova acima do piso e ninguém pediu na janela de descanso
//   descanso     já foi pedido há menos de 90 dias
//   prova_fraca  vendeu algo pela Lever nos 30d, mas abaixo do piso
//   sem_prova    sem venda influenciada nenhuma (ou sem org vinculada no
//                cadastro — o gap aparece em `coverage`, porque é ele que
//                limita a fila)
export async function buildReferralQueue(repo, { saas = "", now = Date.now, influenced = influencedByOrg } = {}) {
  const [customers, leads, acts, users] = await Promise.all([
    repo.list("customers"), repo.list("leads"), repo.list("activities"), repo.list("users"),
  ]);
  const at = now();
  const mine = customers.filter((c) => (!saas || c.saas === saas));
  const ativos = mine.filter((c) => !isChurnedCustomer(c, at));
  const gmv = await influenced(ativos.map((c) => c.leveradsOrgId));
  const nameOf = (id) => users.find((u) => u.id === id)?.name || id || "";

  const rows = [];
  for (const c of ativos) {
    const casa = dias(c.startedAt, at);
    if (casa == null || casa < MIN_DAYS) continue;
    const influenced30d = gmv.get(String(c.leveradsOrgId || "").trim()) || 0;
    const lastAskedAt = lastAskOf(acts, c);
    const descanso = lastAskedAt && dias(lastAskedAt, at) < ASK_COOLDOWN_DAYS;
    const indicados = leads.filter((l) => l.referredByCustomer === c.id);
    const seeds = (Array.isArray(c.referralSeeds) ? c.referralSeeds : []).length;
    rows.push({
      customer: c.id,
      name: c.name || "",
      contact: c.contact || "",
      phone: c.phone || "",
      owner: c.owner || "",
      ownerName: c.owner ? nameOf(c.owner) : "",
      influenced30d,
      daysAsClient: casa,
      lastAskedAt,
      collected: indicados.length,
      closed: indicados.filter((l) => l.customerId).length,
      paid: indicados.filter((l) => isPaidReferral(l)).length,
      seeds,
      bucket: descanso ? "descanso"
        : influenced30d >= MIN_PROOF_BRL ? "pedir"
        : influenced30d > 0 ? "prova_fraca" : "sem_prova",
      // A frase sai do servidor pra existir em UM lugar só: a tela abre o
      // WhatsApp com ela, a tarefa guarda a mesma, e o dia em que o pedido
      // mudar de tom muda nos dois.
      script: askScript({ name: c.name, contact: c.contact, influenced30d }),
    });
  }
  // Maior prova primeiro: é a ordem em que o pedido tem mais chance.
  rows.sort((a, b) => b.influenced30d - a.influenced30d || String(a.name).localeCompare(String(b.name)));
  return {
    saas,
    generatedAt: new Date(at).toISOString(),
    rows,
    totals: {
      pedir: rows.filter((r) => r.bucket === "pedir").length,
      descanso: rows.filter((r) => r.bucket === "descanso").length,
      provaFraca: rows.filter((r) => r.bucket === "prova_fraca").length,
      semProva: rows.filter((r) => r.bucket === "sem_prova").length,
      influencedSum: Math.round(rows.reduce((a, r) => a + r.influenced30d, 0)),
    },
    // O gap cadastral: sem leveradsOrgId não existe prova, e sem prova o pedido
    // volta a ser genérico. É número de tela, não detalhe técnico.
    coverage: { customers: ativos.length, withOrg: ativos.filter((c) => String(c.leveradsOrgId || "").trim()).length },
  };
}

// A frase do pedido, com o número do cliente dentro. Sem travessão (régua de
// copy do Leo) e no tom de quem manda áudio, não de quem dispara campanha.
export function askScript({ name = "", contact = "", influenced30d = 0 } = {}) {
  const quem = String(contact || name || "").trim().split(/\s+/)[0] || "";
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(influenced30d || 0);
  const abre = influenced30d > 0
    ? `${quem ? `${quem}, ` : ""}os anúncios que a gente subiu venderam ${money} na sua conta nos últimos 30 dias.`
    : `${quem ? `${quem}, ` : ""}passando pra te contar como está a sua operação por aqui.`;
  return [
    abre,
    "Quero te pedir uma coisa: quem são dois lojistas que você conhece que vendem em marketplace e ainda estão fazendo anúncio na mão?",
    "Se fizer sentido, você me apresenta e eu falo com eles. Não procuro ninguém antes de você me dar o ok.",
  ].join(" ");
}

export function registerReferralRoutes(app, repo, opts = {}) {
  const influenced = opts.influenced || influencedByOrg;
  const now = opts.now || Date.now;

  app.get("/api/referrals/queue", async (req) =>
    buildReferralQueue(repo, { saas: String(req.query?.saas || ""), now, influenced }));

  // Registra que o pedido foi FEITO: tarefa pra quem vai pedir (ou pro dono do
  // cliente) e o carimbo que tira o cliente da fila pelos próximos 90 dias.
  app.post("/api/referrals/ask", async (req, reply) => {
    const id = String(req.body?.customer || "").trim();
    if (!id) return reply.code(400).send({ error: "informe o cliente" });
    const customer = await repo.get("customers", id);
    if (!customer) return reply.code(404).send({ error: "Cliente não encontrado" });
    const by = req.authUser?.id || "";
    const assignee = String(req.body?.assignee || by || customer.owner || "").trim();
    const influenced30d = Number(req.body?.influenced30d) || 0;
    const at = new Date(now()).toISOString();

    const task = await createTask(repo, {
      saas: customer.saas || "",
      title: `Pedir indicação pra ${customer.name || "cliente"}`,
      description: [
        askScript({ name: customer.name, contact: customer.contact, influenced30d }),
        "",
        "Quando ele der o nome, registre a indicação na ficha do cliente (bloco Indicações): a coleta entra no seu nome, R$ 100 se virar reunião feita e R$ 500 se fechar.",
      ].join("\n"),
      labels: ["indicacao"],
      ...(assignee ? { assignees: [assignee] } : {}),
      ...(req.body?.dueDate ? { dueDate: String(req.body.dueDate) } : {}),
    }, { by: by || "system" });

    // O carimbo vive na timeline do lead de origem do cliente; cliente sem lead
    // (venda direta) guarda o evento sem lead, casado por meta.customer.
    await logActivity(repo, {
      saas: customer.saas || "", lead: customer.leadId || "", type: "system",
      text: `Pedido de indicação pra ${customer.name || "cliente"}`,
      meta: { event: "referral_asked", customer: customer.id, task: task.id, influenced30d },
      author: by || "system", at,
    });
    return reply.code(201).send({ ok: true, task: task.id, askedAt: at });
  });
}
