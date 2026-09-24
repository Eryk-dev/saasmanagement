// Espelho ticket de suporte ↔ issue do Linear. Regra dos dois sentidos:
//
//   cockpit → Linear   ticket de produto com o espelho ligado vira issue no
//                      time/projeto configurado (assunto, descrição, prioridade,
//                      estado, responsável) e cada mensagem nova vira comentário.
//   Linear → cockpit   estado da issue move o status do ticket (de-para por
//                      TIPO de estado), o assignee vira o responsável (mesma
//                      pessoa dos dois lados) e comentário do dev vira AVISO (evento na
//                      atividade + sino), sem copiar o texto: quem mostra a
//                      conversa da issue é a aba Linear, que lê ao vivo. Nada
//                      disso chega ao cliente pelo portal.
//
// Anti-ping-pong: tudo que ENTRA do Linear é gravado com o ator `linear`
// (ACTOR_LINEAR) e o gancho de saída (tickets-core) ignora esse ator. O
// `ticket.linear.mirror` guarda o que foi mandado da última vez, então só a
// diferença real sobe — o que impede o valor antigo de voltar por cima da
// edição feita no Linear.
//
// O que decide é o doc do ticket (state-based), não o evento: a fila
// (linear_outbox) só marca "este ticket está sujo" e o drenar recalcula. Uma
// entrega perdida se conserta sozinha no ciclo seguinte.

import { createHash } from "node:crypto";
import { withTaskLock, upsertNotification } from "./tasks-core.js";
import { canHandleSaas } from "./support-scope.js";
import {
  ACTOR_LINEAR, STATUS_KIND, TICKET_PRIORITIES, createTicket, loadSettings, saveSettings, patchTicket,
  recordTicketEvents, ticketTitle,
} from "./tickets-core.js";

export const OUTBOX = "linear_outbox";
export const MIRROR_MESSAGE_MODES = ["all", "public", "none"];

// Prioridade do Linear é número: 0 sem prioridade, 1 urgente … 4 baixa.
export const LINEAR_PRIORITY = { urgent: 1, high: 2, normal: 3, low: 4 };
export const PRIORITY_FROM_LINEAR = { 1: "urgent", 2: "high", 3: "normal", 4: "low" };

// De-para de volta pelo TIPO do estado (não pelo nome): cada time do Linear
// batiza as colunas como quer, mas o tipo é fixo na API.
// `duplicate` é coluna de verdade num time real (LEV): fica configurável, mas
// nasce sem de-para — issue marcada como duplicada quer dizer "outra issue
// cuida disso", e o cliente continua esperando. Fechar o ticket aí seria erro.
export const STATE_TYPES = ["triage", "backlog", "unstarted", "started", "completed", "canceled", "duplicate"];
export const DEFAULT_STATE_BACK = { triage: "", backlog: "", unstarted: "", started: "", completed: "resolved", canceled: "closed", duplicate: "" };

// Base do link do cockpit na descrição da issue. É SEMPRE a env, nunca o host
// da requisição: a descrição entra no hash do espelho, e um valor diferente por
// porta de entrada (botão da tela x runner) fazia o mesmo ticket parecer mudado
// a cada ciclo — e sobrescrever a descrição da issue de graça.
export const publicBaseUrl = () => String(process.env.COCKPIT_PUBLIC_URL || process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");

const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const hash = (s) => createHash("sha256").update(String(s ?? "")).digest("hex").slice(0, 16);
const nowIso = () => new Date().toISOString();
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const capIds = (list, max = 300) => [...new Set((list || []).map(String))].slice(-max);
const uniq = (arr) => [...new Set(arr)];
const excerpt = (s, n = 80) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

// ── Configuração por produto (mora em ticket_settings.linear) ────────────────
export function normalizeLinearSettings(src) {
  const s = isObj(src) ? src : {};
  const statusMap = {};
  for (const k of Object.keys(STATUS_KIND)) {
    const id = str(s.statusMap?.[k], 120);
    if (id) statusMap[k] = id;
  }
  const stateBack = { ...DEFAULT_STATE_BACK };
  if (isObj(s.stateBack)) {
    for (const t of STATE_TYPES) {
      if (!(t in s.stateBack)) continue;
      const v = str(s.stateBack[t], 40);
      stateBack[t] = STATUS_KIND[v] ? v : ""; // status desconhecido = não mexe
    }
  }
  return {
    enabled: s.enabled === true,
    teamId: str(s.teamId, 120), teamKey: str(s.teamKey, 20), teamName: str(s.teamName, 120),
    projectId: str(s.projectId, 120), projectName: str(s.projectName, 200),
    labelIds: (Array.isArray(s.labelIds) ? s.labelIds : []).map((x) => str(x, 120)).filter(Boolean).slice(0, 20),
    mirrorMessages: MIRROR_MESSAGE_MODES.includes(s.mirrorMessages) ? s.mirrorMessages : "all",
    syncPriority: s.syncPriority !== false,
    syncStatus: s.syncStatus !== false,
    titleBack: s.titleBack !== false,
    syncAssignee: s.syncAssignee !== false,
    people: normalizePeople(s.people),
    statusMap, stateBack,
  };
}

// Ajuste manual do de-para de pessoas: { usuárioDoCockpit: idDoLinear }, com
// PEOPLE_NONE = "não tem conta no Linear". O resto casa sozinho (linearIdForUser).
export const PEOPLE_NONE = "none";
function normalizePeople(src) {
  const out = {};
  if (!isObj(src)) return out;
  for (const [k, v] of Object.entries(src).slice(0, 200)) {
    const user = str(k, 120), id = str(v, 120);
    if (user && id) out[user] = id;
  }
  return out;
}

// ── Pessoas: responsável do ticket ↔ assignee da issue ──────────────────────
// O Linear não conhece os usuários do cockpit. Casa na ordem: ajuste manual da
// configuração, e-mail (a conta Google conectada no cockpit), nome completo
// único. Sem casamento = `undefined`, e aí o espelho NÃO MEXE no outro lado:
// atendente sem conta no Linear não tira o dev da issue, e dev que não usa o
// cockpit não tira o responsável do ticket.
const emailsOf = (u) => uniq([u?.email, u?.google?.account].map((e) => String(e || "").trim().toLowerCase()).filter(Boolean));

// Usuário do cockpit → id no Linear. "" (sem responsável) vira null = tirar o
// assignee da issue.
export function linearIdForUser(userId, { users = [], people = [], overrides = {} } = {}) {
  if (!userId) return null;
  const o = overrides[userId];
  if (o === PEOPLE_NONE) return undefined;
  if (o) return o;
  const u = users.find((x) => x.id === userId);
  if (!u) return undefined;
  const livres = people.filter((p) => p.active !== false && !Object.values(overrides).includes(p.id));
  const emails = emailsOf(u);
  const porEmail = livres.find((p) => p.email && emails.includes(String(p.email).toLowerCase()));
  if (porEmail) return porEmail.id;
  const k = nomeChave(u.name);
  const porNome = k ? livres.filter((p) => nomeChave(p.name) === k) : [];
  return porNome.length === 1 ? porNome[0].id : undefined;
}

// Assignee da issue → usuário do cockpit. null (issue sem assignee) vira "".
// Aceita o objeto da issue ({ id, name, email }) ou só o id do webhook.
export function userIdForLinear(assignee, { users = [], people = [], overrides = {} } = {}) {
  if (!assignee) return "";
  const id = str(assignee.id, 120);
  if (id) {
    const manual = Object.keys(overrides).find((u) => overrides[u] === id);
    if (manual) return users.some((u) => u.id === manual) ? manual : undefined;
  }
  const p = (id && people.find((x) => x.id === id)) || {};
  const email = String(assignee.email || p.email || "").toLowerCase();
  const nome = assignee.name || p.name || "";
  const livres = users.filter((u) => !overrides[u.id]); // quem tem ajuste manual só casa por ele
  if (email) {
    const porEmail = livres.filter((u) => emailsOf(u).includes(email));
    if (porEmail.length === 1) return porEmail[0].id;
  }
  const kr = nomeChave(nome);
  if (!kr) return undefined;
  const porNome = livres.filter((u) => nomeChave(u.name) === kr);
  if (porNome.length === 1) return porNome[0].id;
  // "Lia" no Linear casa com "Lia Atendente" aqui, se for a única com esse nome.
  const porPrimeiro = livres.filter((u) => nomeChave(String(u.name || "").split(" ")[0]) === kr);
  return porPrimeiro.length === 1 ? porPrimeiro[0].id : undefined;
}

// O que a issue diz do assignee: objeto, null (sem ninguém) ou undefined (o
// payload não trouxe o campo — aí não dá pra concluir nada). A GraphQL manda
// `assignee`; o webhook manda `assignee` e/ou `assigneeId`.
export function issueAssignee(issue) {
  if (!isObj(issue)) return undefined;
  if ("assignee" in issue) return isObj(issue.assignee) ? issue.assignee : null;
  if ("assigneeId" in issue) return issue.assigneeId ? { id: String(issue.assigneeId) } : null;
  return undefined;
}
// Chave do assignee no retrato do espelho ("" = ninguém).
const assigneeKey = (a) => (a ? str(a.id, 120) || (a.name ? `name:${str(a.name, 120)}` : "") : "");

// Pessoas do workspace do Linear, com cache curto (mesma régua dos estados).
let peopleCache = null;
export async function linearPeople(linear, { ttlMs = 10 * 60_000, now = Date.now() } = {}) {
  if (!linear?.configured?.() || typeof linear.users !== "function") return [];
  if (peopleCache && peopleCache.linear === linear && now - peopleCache.at < ttlMs) return peopleCache.people;
  const people = await linear.users();
  peopleCache = { linear, people, at: now };
  return people;
}
export const clearPeopleCache = () => { peopleCache = null; };

// ── Ticket → Linear ─────────────────────────────────────────────────────────
export const issueTitleFor = (ticket) => str(ticket.subject, 250) || `Ticket #${ticket.number}`;

// Cabeçalho com o de-onde-veio + a descrição do solicitante. O link é o do
// cockpit; o token do portal NUNCA entra (é acesso sem login ao chamado).
export function issueDescriptionFor(ticket, { baseUrl = "", customerName = "" } = {}) {
  const who = [ticket.requester?.name, ticket.requester?.email].filter(Boolean).join(" · ");
  const cabecalho = [
    `**Ticket ${ticketTitle(ticket)}** · suporte ${ticket.saas}`,
    customerName ? `Cliente: ${customerName}${who ? ` (${who})` : ""}` : (who ? `Solicitante: ${who}` : ""),
    ticket.category ? `Categoria: ${ticket.category}` : "",
    baseUrl ? `Abrir no cockpit: ${baseUrl}/#tickets/${ticket.id}` : "",
  ].filter(Boolean);
  const corpo = String(ticket.description || "_(sem descrição)_");
  return [...cabecalho, "", "---", "", corpo].join("\n").slice(0, 60000);
}

// Autoria legível no comentário: o Linear não conhece as pessoas do cockpit.
export function commentBodyFor(message, { users = [], ticket = null } = {}) {
  const agent = users.find((u) => u.id === message.author?.id);
  const nome = message.author?.type === "customer"
    ? `${message.author?.name || ticket?.requester?.name || "Cliente"} (cliente)`
    : `${agent?.name || message.author?.id || "Equipe"}${message.kind === "note" ? " · nota interna" : " → cliente"}`;
  return `**${nome}**\n\n${String(message.text || "").slice(0, 60000)}`;
}

// Mensagens que ainda não viraram comentário. O que VEIO do Linear nunca volta.
export function pendingComments(ticket, cfg) {
  if (cfg.mirrorMessages === "none") return [];
  const done = new Set(ticket.linear?.commented || []);
  return (ticket.messages || []).filter((m) => {
    if (done.has(m.id) || m.source?.type === "linear") return false;
    return cfg.mirrorMessages === "all" || m.kind === "reply";
  });
}

// Estado desejado da issue. `statusMap` explícito manda; senão, com syncStatus,
// só o CRUZAMENTO da fronteira aberto↔concluído mexe no Linear — assim uma
// coluna escolhida a dedo pelo dev (In Review, Blocked…) não é atropelada a
// cada mensagem do ticket.
export function wantedStateId(ticket, cfg, states = []) {
  if (cfg.statusMap?.[ticket.status]) return cfg.statusMap[ticket.status];
  if (!cfg.syncStatus || !states.length) return "";
  const kind = STATUS_KIND[ticket.status];
  const before = ticket.linear?.mirror?.status ? STATUS_KIND[ticket.linear.mirror.status] : null;
  if (kind === before) return "";
  const byType = (t) => states.find((s) => s.type === t)?.id || "";
  if (kind === "done") return byType("completed");
  if (before === "done") return byType("started") || byType("unstarted");
  return "";
}

// Retrato do que o cockpit mandaria pro Linear AGORA. Serve de duas formas:
// como carimbo depois de sincronizar e como "já está em dia" ao vincular uma
// issue que já existe — é o que impede o primeiro sync de sobrescrever o
// título, a descrição e a prioridade escritos por quem abriu a issue lá.
//
// Responsável são DOIS campos: `assignee` é o responsável do ticket na última
// sincronização (só uma troca AQUI sobe) e `assigneeId` o assignee da issue
// visto por último (só uma troca LÁ desce). Retrato antigo, sem os campos, não
// move nada — só passa a valer do próximo ciclo em diante.
export function mirrorSnapshot(ticket, cfg, { baseUrl = publicBaseUrl(), customerName = "", stateId = "", assignee, assigneeId } = {}) {
  const out = {
    title: issueTitleFor(ticket),
    descriptionHash: hash(issueDescriptionFor(ticket, { baseUrl, customerName })),
    priority: cfg?.syncPriority === false ? undefined : LINEAR_PRIORITY[ticket.priority],
    stateId,
    status: ticket.status,
  };
  if (assignee !== undefined) out.assignee = assignee;
  if (assigneeId !== undefined) out.assigneeId = assigneeId;
  return out;
}

// Responsável que sobe pro Linear: `input` undefined = não mexer no assignee
// da issue; null = tirar o assignee; string = o id da pessoa lá. `mirror` é o
// que o retrato passa a guardar.
export function wantedAssignee(ticket, cfg, people = {}) {
  const atual = ticket.assignee || "";
  const prev = ticket.linear?.mirror || {};
  const criando = !ticket.linear?.issueId;
  const parado = { input: undefined, mirror: { assignee: atual, assigneeId: prev.assigneeId } };
  if (!cfg?.syncAssignee) return parado;
  if (!criando && (!("assignee" in prev) || prev.assignee === atual)) return parado;
  const id = linearIdForUser(atual, people);
  if (id === undefined) return { input: undefined, mirror: { assignee: atual, assigneeId: criando ? "" : prev.assigneeId } };
  const lid = id || "";
  if (criando) return { input: lid || undefined, mirror: { assignee: atual, assigneeId: lid } };
  if (lid === (prev.assigneeId || "")) return { input: undefined, mirror: { assignee: atual, assigneeId: lid } };
  return { input: id, mirror: { assignee: atual, assigneeId: lid } };
}

// Plano puro (sem rede): o que criar/atualizar e quais mensagens ainda devem
// virar comentário. `null` = espelho desligado para este produto.
export function planTicketSync(ticket, settings, { states = [], baseUrl = publicBaseUrl(), customerName = "", users = [], people = [] } = {}) {
  const cfg = settings.linear;
  if (!cfg?.enabled || !cfg.teamId) return null;
  const title = issueTitleFor(ticket);
  const description = issueDescriptionFor(ticket, { baseUrl, customerName });
  const priority = cfg.syncPriority ? LINEAR_PRIORITY[ticket.priority] : undefined;
  const stateId = wantedStateId(ticket, cfg, states);
  const comments = pendingComments(ticket, cfg);
  const resp = wantedAssignee(ticket, cfg, { users, people, overrides: cfg.people || {} });
  const mirror = { ...mirrorSnapshot(ticket, cfg, { baseUrl, customerName, stateId, ...resp.mirror }), descriptionHash: hash(description) };

  if (!ticket.linear?.issueId) {
    const input = { teamId: cfg.teamId, title, description };
    if (cfg.projectId) input.projectId = cfg.projectId;
    if (cfg.labelIds.length) input.labelIds = cfg.labelIds;
    if (priority != null) input.priority = priority;
    if (stateId) input.stateId = stateId;
    if (resp.input) input.assigneeId = resp.input;
    return { action: "create", input, comments, mirror };
  }

  const prev = ticket.linear.mirror || {};
  const input = {};
  if (title !== prev.title) input.title = title;
  // Issue ADOTADA (importada ou vinculada a mão) nunca tem a descrição
  // gerenciada daqui: o relato mora lá, escrito por quem abriu, e o cockpit só
  // geraria um cabeçalho de quatro linhas no lugar dele. Descrição só sobe em
  // issue que o próprio espelho criou.
  if (!ticket.linear.adopted && mirror.descriptionHash !== prev.descriptionHash) input.description = description;
  if (priority != null && priority !== prev.priority) input.priority = priority;
  if (stateId && stateId !== prev.stateId) input.stateId = stateId;
  if (resp.input !== undefined) input.assigneeId = resp.input;
  // Projeto só entra quando a issue ainda não tem um: vincular a mão uma issue
  // que já vive no projeto de outro time não pode arrastá-la pro do suporte.
  if (cfg.projectId && !ticket.linear.projectId) input.projectId = cfg.projectId;
  const action = Object.keys(input).length || comments.length ? "update" : "noop";
  return { action, issueId: ticket.linear.issueId, input, comments, mirror };
}

// Estados do time, com cache curto — a tela de configuração e o drenar pedem o
// mesmo catálogo várias vezes seguidas.
const stateCache = new Map();
export async function teamStates(linear, teamId, { ttlMs = 10 * 60_000, now = Date.now() } = {}) {
  if (!teamId || !linear?.configured?.()) return [];
  const hit = stateCache.get(teamId);
  if (hit && now - hit.at < ttlMs) return hit.states;
  const teams = await linear.catalog();
  for (const t of teams) stateCache.set(t.id, { states: t.states, at: now });
  return stateCache.get(teamId)?.states || [];
}
export const clearStateCache = () => stateCache.clear();

// Grava o resultado do espelho no doc do ticket SEM passar por patchTicket: é
// carimbo de integração, não edição de atendimento — não gera evento de
// alteração, não mexe no SLA e não reentra na fila de saída.
async function stampLinear(repo, ticketId, patch) {
  return withTaskLock(`ticket:${ticketId}`, async () => {
    const cur = await repo.get("tickets", ticketId);
    if (!cur) return null;
    const doc = { linear: { ...(cur.linear || {}), ...patch } };
    if ("issueId" in patch) doc.linearIssueId = String(patch.issueId || ""); // topo = índice/listWhere
    return repo.update("tickets", ticketId, doc, { silent: true });
  });
}

// Executa o plano de um ticket. A rede roda FORA do lock do ticket (o lock só
// carimba o resultado), pra uma resposta do atendente não ficar esperando o
// Linear responder.
export async function syncTicketToLinear(repo, ticketId, { linear, baseUrl = publicBaseUrl(), now = nowIso(), log } = {}) {
  const ticket = await repo.get("tickets", ticketId);
  if (!ticket) return { skipped: "gone" };
  if (!linear?.configured?.()) return { skipped: "not_configured" };
  const settings = await loadSettings(repo, ticket.saas);
  const cfg = settings.linear;
  if (!cfg?.enabled || !cfg.teamId) return { skipped: "disabled" };

  const [states, users, customer, people] = await Promise.all([
    teamStates(linear, cfg.teamId).catch(() => []),
    repo.list("users").catch(() => []),
    ticket.customerId ? repo.get("customers", ticket.customerId).catch(() => null) : null,
    cfg.syncAssignee ? linearPeople(linear).catch(() => []) : [],
  ]);
  const plan = planTicketSync(ticket, settings, { states, baseUrl, customerName: customer?.name || "", users, people });
  if (!plan || plan.action === "noop") return { skipped: "clean" };

  const out = { created: false, updated: false, comments: 0 };
  let issueId = plan.issueId || "";
  const stamp = { mirror: plan.mirror, syncedAt: now, error: "" };

  if (plan.action === "create") {
    const issue = await linear.createIssue(plan.input);
    issueId = issue.id;
    Object.assign(stamp, {
      issueId: issue.id, identifier: issue.identifier || "", url: issue.url || "",
      teamId: cfg.teamId, projectId: issue.project?.id || cfg.projectId,
      stateId: issue.state?.id || "", stateName: issue.state?.name || "", stateType: issue.state?.type || "",
      linkedAt: now, linkedBy: ACTOR_LINEAR,
    });
    stamp.mirror = { ...plan.mirror, stateId: issue.state?.id || plan.mirror.stateId || "", ...issueAssigneeStamp(issue, plan.mirror) };
    out.created = true;
  } else if (Object.keys(plan.input).length) {
    const issue = await linear.updateIssue(issueId, plan.input);
    if (issue) {
      Object.assign(stamp, {
        identifier: issue.identifier || ticket.linear?.identifier || "", url: issue.url || ticket.linear?.url || "",
        stateId: issue.state?.id || "", stateName: issue.state?.name || "", stateType: issue.state?.type || "",
        projectId: issue.project?.id || cfg.projectId,
      });
      stamp.mirror = { ...plan.mirror, stateId: issue.state?.id || plan.mirror.stateId || "", ...issueAssigneeStamp(issue, plan.mirror) };
    }
    out.updated = true;
  }

  // Comentários um a um, guardando os ids já mandados — se o segundo falhar, o
  // primeiro não é reenviado no próximo ciclo.
  const commented = [...(ticket.linear?.commented || [])];
  const posted = [...(ticket.linear?.posted || [])];
  try {
    for (const m of plan.comments) {
      const c = await linear.createComment(issueId, commentBodyFor(m, { users, ticket }));
      commented.push(m.id);
      if (c?.id) posted.push(c.id);
      out.comments++;
    }
  } finally {
    stamp.commented = capIds(commented);
    stamp.posted = capIds(posted);
    await stampLinear(repo, ticketId, stamp);
  }

  if (out.created) {
    const saved = await repo.get("tickets", ticketId);
    await recordTicketEvents(repo, saved || ticket, [{ type: "linear_linked", data: { identifier: stamp.identifier, url: stamp.url, issueId } }], { by: ACTOR_LINEAR, now });
    log?.info?.(`linear: ticket #${ticket.number} → ${stamp.identifier || issueId}`);
  }
  return out;
}

// O assignee que a issue devolveu é o que vale no retrato: uma pessoa que o
// Linear recusou não pode ficar parecendo sincronizada.
function issueAssigneeStamp(issue, mirror) {
  const a = issueAssignee(issue);
  return a === undefined || !("assigneeId" in mirror) ? {} : { assigneeId: assigneeKey(a) };
}

// ── Linear → ticket ─────────────────────────────────────────────────────────
export async function findTicketByIssue(repo, issueId) {
  const id = str(issueId, 120);
  if (!id) return null;
  const rows = await repo.listWhere("tickets", { linearIssueId: id });
  return rows[0] || null;
}

// Issue mudou no Linear: estado vira status (de-para por tipo), título e
// prioridade voltam quando ligados. Sempre com o ator `linear`, pra não voltar.
export async function applyLinearIssue(repo, issue, { now = nowIso(), log, linear = null, people = null } = {}) {
  const ticket = await findTicketByIssue(repo, issue?.id);
  if (!ticket) return null;
  const settings = await loadSettings(repo, ticket.saas);
  const cfg = settings.linear;
  const stateType = str(issue.state?.type, 40);
  const patch = {};

  // O de-para vale pela SEMÂNTICA (kind), não pelo rótulo: ticket já Fechado
  // não vira Resolvido só porque a issue está em Done — isso reabriria um
  // atendimento encerrado a cada eco do webhook. Dentro do mesmo kind, quem
  // manda é o atendente.
  const back = cfg.stateBack?.[stateType] || "";
  if (back && STATUS_KIND[back] && STATUS_KIND[back] !== STATUS_KIND[ticket.status]) patch.status = back;
  // Dev pegou o card (In Progress/In Review = tipo `started`): ticket ainda Novo
  // passa a Em atendimento. Novo e Em atendimento são o mesmo kind, então o
  // de-para acima não cobre; só sai do Novo, nunca mexe em outro status.
  else if (stateType === "started" && ticket.status === "new") patch.status = "open";
  // Etiquetas colocadas DEPOIS de criar o card: ticket sem categoria ganha a
  // combinação agora. Categoria já escolhida no cockpit não é trocada.
  if (!ticket.category) {
    const { category, tags } = categoryFromLabels(issueLabelNames(issue));
    if (category) {
      await ensureCategory(repo, ticket.saas, category, { now });
      patch.category = category;
      patch.tags = uniq([...(ticket.tags || []), ...tags]);
    }
  }
  if (cfg.titleBack) {
    const title = str(issue.title, 200);
    if (title && title !== ticket.subject && title !== (ticket.linear?.mirror?.title || "")) patch.subject = title;
  }
  if (cfg.syncPriority) {
    const p = PRIORITY_FROM_LINEAR[Number(issue.priority)];
    if (p && TICKET_PRIORITIES.includes(p) && p !== ticket.priority && Number(issue.priority) !== ticket.linear?.mirror?.priority) patch.priority = p;
  }
  // Responsável: só uma TROCA na issue desce (compara com o último assignee
  // visto). Pessoa sem par no cockpit, ou que não atende o produto, não mexe no
  // ticket — o evento na atividade registra quem pegou lá.
  const prevMirror = ticket.linear?.mirror || {};
  const assignee = issueAssignee(issue);
  const linearNow = assignee === undefined ? undefined : assigneeKey(assignee);
  let assigneeNote = "";
  if (cfg.syncAssignee && linearNow !== undefined && "assigneeId" in prevMirror && linearNow !== (prevMirror.assigneeId || "")) {
    const users = await repo.list("users").catch(() => []);
    const pessoas = people || (assignee ? await linearPeople(linear).catch(() => []) : []);
    const uid = userIdForLinear(assignee, { users, people: pessoas, overrides: cfg.people || {} });
    const u = uid ? users.find((x) => x.id === uid) : null;
    if (uid === "") { if (ticket.assignee) patch.assignee = ""; }
    else if (u && canHandleSaas(u, ticket.saas)) { if (uid !== ticket.assignee) patch.assignee = uid; }
    else assigneeNote = str(assignee.name, 120) || pessoas.find((x) => x.id === assignee.id)?.name || "alguém sem conta no cockpit";
  }

  const stamp = {
    identifier: str(issue.identifier, 40) || ticket.linear?.identifier || "",
    url: str(issue.url, 500) || ticket.linear?.url || "",
    stateId: str(issue.state?.id, 120), stateName: str(issue.state?.name, 120), stateType,
    projectId: str(issue.project?.id, 120) || ticket.linear?.projectId || "",
    seenAt: now,
  };

  // Aplica primeiro e carimba DEPOIS, com o ticket já atualizado: o retrato do
  // espelho tem que valer o que o Linear tem AGORA, senão o ciclo seguinte
  // devolveria o valor antigo por cima da edição do dev. E o retrato precisa
  // ser recalculado inteiro, não remendado campo a campo — renomear a issue
  // muda o cabeçalho da descrição que o cockpit geraria, e um hash velho aí
  // fazia o espelho sobrescrever a descrição da issue no ciclo seguinte.
  let atual = ticket;
  if (Object.keys(patch).length) {
    const r = await patchTicket(repo, ticket.id, patch, { by: ACTOR_LINEAR, now });
    if (r?.ticket) atual = r.ticket;
    await recordTicketEvents(repo, atual, [{ type: "linear_issue_updated", data: { ...patch, state: stamp.stateName, identifier: stamp.identifier } }], { by: ACTOR_LINEAR, now });
    log?.info?.(`linear: ${stamp.identifier || issue.id} → ticket #${ticket.number} (${Object.keys(patch).join(", ")})`);
  }
  if (assigneeNote) {
    await recordTicketEvents(repo, atual, [{ type: "linear_issue_updated", data: { linearAssignee: assigneeNote, identifier: stamp.identifier } }], { by: ACTOR_LINEAR, now });
  }
  const customer = atual.customerId ? await repo.get("customers", atual.customerId).catch(() => null) : null;
  // O responsável do retrato só anda quando a troca veio da issue pro ticket:
  // uma troca feita no cockpit e ainda na fila de saída não pode ser dada como
  // sincronizada por um webhook que chegou antes (ela nunca subiria).
  stamp.mirror = mirrorSnapshot(atual, cfg, {
    customerName: customer?.name || "", stateId: stamp.stateId,
    assignee: "assignee" in patch ? (atual.assignee || "") : prevMirror.assignee,
    assigneeId: linearNow !== undefined ? linearNow : prevMirror.assigneeId,
  });
  await stampLinear(repo, ticket.id, stamp);
  return { ticket: ticket.id, patch };
}

// Comentário no Linear AVISA, mas não é copiado pro ticket: a aba Linear já
// mostra a issue ao vivo, e uma segunda cópia no doc ficaria invisível nas duas
// abas (a Conversa filtra a origem `linear`) só engordando o ticket. O que o
// ticket registra é o FATO: evento na atividade e aviso no sino de quem
// acompanha. Dedupe por id do comentário — webhook e reconciliação entregam o
// mesmo, e o que o próprio cockpit postou nunca volta.
export async function applyLinearComment(repo, { issueId, comment, now = nowIso(), log } = {}) {
  const cid = str(comment?.id, 120);
  const ticket = await findTicketByIssue(repo, issueId);
  if (!ticket || !cid) return null;
  if ((ticket.linear?.posted || []).includes(cid)) return { skipped: "own" };
  // `seenComments` é a memória do que já passou por aqui. A mensagem no doc não
  // basta como registro: ela pode ser apagada (e foi, quando o histórico da
  // issue saiu do ticket) e aí a reconciliação traria tudo de volta.
  if ((ticket.linear?.seenComments || []).includes(cid)) return { skipped: "seen" };
  if ((ticket.messages || []).some((m) => m.source?.type === "linear" && m.source?.commentId === cid)) return { skipped: "duplicate" };
  const body = String(comment?.body || "").trim();
  if (!body) return { skipped: "empty" };
  const autor = str(comment?.user?.name, 120) || "Linear";
  const ref = ticket.linear?.identifier || "Linear";
  const titulo = ticketTitle(ticket);

  await stampLinear(repo, ticket.id, {
    seenComments: capIds([...(ticket.linear?.seenComments || []), cid]),
    lastCommentAt: now, lastCommentBy: autor,
  });
  await recordTicketEvents(repo, ticket, [{
    type: "linear_comment",
    data: { author: autor, identifier: ref, commentId: cid, excerpt: excerpt(body, 140) },
  }], { by: ACTOR_LINEAR, now });

  // Avisa quem acompanha o atendimento (responsável + seguidores), pela mesma
  // régua do resto do módulo: quem perdeu o produto do escopo não recebe texto.
  const users = await repo.list("users").catch(() => []);
  const avisados = [];
  for (const id of uniq([ticket.assignee, ...(ticket.followers || [])].filter(Boolean))) {
    const u = users.find((x) => x.id === id);
    if (!u || !canHandleSaas(u, ticket.saas)) continue;
    await upsertNotification(repo, {
      user: id, type: "ticket_linear_comment", task: ticket.id, taskTitle: titulo, saas: ticket.saas,
      by: ACTOR_LINEAR, key: `linear-comment:${cid}:${id}`,
      text: `${autor} comentou em ${ref} (${titulo}): ${excerpt(body, 60)}`,
      link: { screen: "tickets", thread: ticket.id },
    }, { now });
    avisados.push(id);
  }
  log?.info?.(`linear: comentário ${cid} em ${ref} → aviso no ticket #${ticket.number}`);
  return { ticket: ticket.id, comment: cid, notified: avisados };
}

// Vínculo manual com uma issue que já existe (o atendente cola ENG-123 ou a URL).
export const issueKeyFromInput = (v) => {
  const s = String(v || "").trim();
  const url = /linear\.app\/[^/]+\/issue\/([A-Za-z0-9]+-\d+)/.exec(s);
  if (url) return url[1].toUpperCase();
  if (/^[A-Za-z0-9]{1,10}-\d+$/.test(s)) return s.toUpperCase();
  return s; // uuid da issue
};

// Vincular a uma issue que JÁ EXISTE não pode escrever nada lá: o espelho
// nasce "em dia" (mirrorSnapshot = o que mandaríamos hoje), então a descrição,
// o título e a prioridade da issue ficam de pé e só uma mudança POSTERIOR no
// ticket sobe. Sem isso, o primeiro ciclo trocava o relato do dev pelo
// cabeçalho do ticket.
export async function linkTicketToIssue(repo, ticketId, issue, { by = ACTOR_LINEAR, now = nowIso(), baseUrl = publicBaseUrl() } = {}) {
  const ticket = await repo.get("tickets", ticketId);
  if (!ticket) return null;
  const settings = await loadSettings(repo, ticket.saas);
  const customer = ticket.customerId ? await repo.get("customers", ticket.customerId).catch(() => null) : null;
  const saved = await stampLinear(repo, ticketId, {
    issueId: issue.id, identifier: issue.identifier || "", url: issue.url || "",
    teamId: issue.team?.id || "", projectId: issue.project?.id || "",
    stateId: issue.state?.id || "", stateName: issue.state?.name || "", stateType: issue.state?.type || "",
    mirror: mirrorSnapshot(ticket, settings.linear, {
      baseUrl, customerName: customer?.name || "", stateId: issue.state?.id || "",
      assignee: ticket.assignee || "", assigneeId: assigneeKey(issueAssignee(issue)),
    }),
    adopted: true, // a issue é de lá; a descrição dela não é nossa para reescrever
    linkedAt: now, linkedBy: by, error: "",
  });
  if (saved) await recordTicketEvents(repo, saved, [{ type: "linear_linked", data: { identifier: issue.identifier || "", url: issue.url || "", issueId: issue.id, manual: true } }], { by, now });
  return saved;
}

// ── Issue aberta direto no Linear → ticket ──────────────────────────────────
// O CS abre card direto no projeto do suporte. Sem isto, a volta só atualizava
// ticket JÁ vinculado e esses cards nunca chegavam ao cockpit. Entra pelo
// webhook e pela reconciliação; o que já existia antes vem pelo script
// scripts/2026-09-21-importar-cs-suporte-linear.mjs (mesma função).

// Nome comparável: sem acento, sem pontuação e sem sufixo de razão social —
// mesma régua do vínculo de org (2026-09-12-vincular-org-leverads.mjs).
export const nomeChave = (s) => String(s || "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9 ]/g, " ")
  .replace(/\b(ltda|me|mei|eireli|sa|s a|comercio|com|de|da|do|e)\b/g, " ")
  .replace(/\s+/g, " ").trim();
export const clienteDoTitulo = (title) => (String(title || "").match(/^\s*\[([^\]]+)\]/) || [])[1]?.trim() || "";

// Issue que o próprio espelho criou (cabeçalho de issueDescriptionFor). O
// webhook de criação pode chegar antes do carimbo do vínculo no ticket; sem
// esta trava, a issue do cockpit viraria um segundo ticket.
export const isCockpitIssue = (issue) => /^\*\*Ticket [^\n]*\*\* · suporte /.test(String(issue?.description || ""));

// Produto cujo espelho está ligado NESTE projeto. Sem projeto configurado não
// importa nada: o time inteiro do Linear não é fila de suporte.
export async function productForIssue(repo, issue) {
  const projectId = str(issue?.project?.id || issue?.projectId, 120);
  if (!projectId) return "";
  for (const p of await repo.list("products").catch(() => [])) {
    const cfg = (await loadSettings(repo, p.id).catch(() => null))?.linear;
    if (cfg?.enabled && cfg.teamId && cfg.projectId === projectId) return p.id;
  }
  return "";
}

// Etiquetas da issue: a GraphQL devolve `labels.nodes`, o webhook um array.
export const issueLabelNames = (issue) => {
  const l = issue?.labels;
  return uniq((Array.isArray(l) ? l : l?.nodes || []).map((x) => str(x?.name, 40)).filter(Boolean));
};

// Categoria = a combinação que o CS usa no projeto de suporte (skill
// cs-suporte-card): Código + tipo, Operação + Produção, ou só Operação. O que
// não entra na categoria (área extra, Integração, Segurança, data DD.MM) vira
// tag. Sem combinação reconhecida, fica sem categoria e tudo vai pras tags.
export const LINEAR_CATEGORIES = ["Código · Bug", "Código · Feature", "Código · Improvement", "Operação · Produção", "Operação"];
const TIPOS = ["Bug", "Feature", "Improvement"];
export function categoryFromLabels(names = []) {
  const k = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const tem = (n) => names.find((x) => k(x) === k(n));
  const tipo = TIPOS.find(tem);
  let usadas = [];
  if (tipo) usadas = [tem(tipo), tem("Código")].filter(Boolean);
  else if (tem("Operação") && tem("Produção")) usadas = [tem("Operação"), tem("Produção")];
  else if (tem("Operação")) usadas = [tem("Operação")];
  const category = tipo ? `Código · ${tipo}` : usadas.length === 2 ? "Operação · Produção" : usadas.length ? "Operação" : "";
  return { category, tags: names.filter((n) => !usadas.includes(n)) };
}

// Categoria fora da lista do produto é descartada no createTicket; a
// combinação do Linear entra na lista (sem tirar as que já existem).
export async function ensureCategory(repo, saas, category, { now = nowIso() } = {}) {
  if (!category) return;
  const { categories = [] } = await loadSettings(repo, saas);
  if (categories.includes(category)) return;
  await saveSettings(repo, saas, { categories: [...categories, category] }, { by: ACTOR_LINEAR, now });
}

// Ticket que a issue geraria. Cliente: o "[Cliente]" do título casado com o
// cadastro do produto por nome normalizado idêntico e ÚNICO — sem casamento
// não chuta, o nome vai no solicitante. Responsável: o da issue, pelo mesmo
// de-para de pessoas do espelho (userIdForLinear).
export function ticketFromIssue(issue, { saas, customers = [], users = [], people = [], overrides = {} } = {}) {
  const nome = clienteDoTitulo(issue.title);
  const k = nomeChave(nome);
  const casados = k ? customers.filter((c) => (c.saas || "") === saas && nomeChave(c.name) === k) : [];
  const customer = casados.length === 1 ? casados[0] : null;
  const uid = userIdForLinear(issueAssignee(issue), { users, people, overrides });
  const assignee = uid ? users.find((u) => u.id === uid) || null : null;
  const { category, tags } = categoryFromLabels(issueLabelNames(issue));
  // Sem descrição: a do ticket aparece na Conversa como "pedido" do cliente, e
  // a Conversa é só o atendimento. O relato da issue mora na aba Linear, lido
  // de lá (e o vínculo adotado nunca sobe descrição, então nada se perde).
  return {
    nome, customer, ambiguo: casados.length > 1, assignee,
    input: {
      saas, subject: str(issue.title, 250) || String(issue.identifier || "Issue do Linear"), description: "",
      priority: PRIORITY_FROM_LINEAR[Number(issue.priority)] || "normal",
      channel: "internal", tags: ["linear", ...tags], category,
      customerId: customer?.id || "",
      requester: customer ? {} : { name: nome },
      assignee: assignee?.id || "",
    },
  };
}

// Cria o ticket já VINCULADO (adopted: a descrição é de lá), com o status pelo
// de-para da volta e os comentários existentes marcados como vistos — senão a
// reconciliação avisaria no sino o histórico inteiro. Ator `linear` em tudo
// (anti-ping-pong). Idempotente: issue que já tem ticket devolve null.
export async function importLinearIssue(repo, issue, { saas, now = nowIso(), log, linear = null } = {}) {
  if (!issue?.id || !saas || isCockpitIssue(issue) || issue.trashed || issue.archivedAt) return null;
  return withTaskLock(`linear-issue:${issue.id}`, async () => {
    if (await findTicketByIssue(repo, issue.id)) return null;
    const [customers, users, settings] = await Promise.all([
      repo.list("customers").catch(() => []), repo.list("users").catch(() => []), loadSettings(repo, saas),
    ]);
    const people = issueAssignee(issue) ? await linearPeople(linear).catch(() => []) : [];
    const plan = ticketFromIssue(issue, { saas, customers, users, people, overrides: settings.linear?.people || {} });
    await ensureCategory(repo, saas, plan.input.category, { now });
    // Responsável fora do escopo do produto não derruba a entrada: o ticket
    // nasce sem responsável e o CS atribui.
    const ticket = await createTicket(repo, plan.input, { by: ACTOR_LINEAR, now }).catch((err) => {
      if (!/^assignee_/.test(err?.code || "")) throw err;
      return createTicket(repo, { ...plan.input, assignee: "" }, { by: ACTOR_LINEAR, now });
    });
    await linkTicketToIssue(repo, ticket.id, issue, { by: ACTOR_LINEAR, now });
    await applyLinearIssue(repo, issue, { now, people });
    const seen = (issue.comments?.nodes || []).map((c) => c.id);
    if (seen.length) await stampLinear(repo, ticket.id, { seenComments: capIds(seen) });
    const saved = await repo.get("tickets", ticket.id);
    log?.info?.(`linear: ${issue.identifier || issue.id} aberta no Linear → ticket #${saved?.number}`);
    return { ticket: ticket.id, created: true, plan };
  });
}

export async function unlinkTicket(repo, ticketId, { by = ACTOR_LINEAR, now = nowIso() } = {}) {
  const cur = await repo.get("tickets", ticketId);
  if (!cur?.linear?.issueId) return cur;
  const antes = cur.linear;
  const saved = await withTaskLock(`ticket:${ticketId}`, async () => repo.update("tickets", ticketId, { linear: {}, linearIssueId: "" }, { silent: true }));
  if (saved) await recordTicketEvents(repo, saved, [{ type: "linear_unlinked", data: { identifier: antes.identifier || "", issueId: antes.issueId } }], { by, now });
  return saved;
}
