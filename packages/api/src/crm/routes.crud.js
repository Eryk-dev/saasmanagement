// CRUD genérico sobre as coleções de COLLECTIONS (GET/POST/PATCH/DELETE em
// /api/:collection). Coleção em PRIVATE só sai pelas rotas próprias. Os efeitos
// de criar e editar (funil, agenda, cobrança, plano) rodam aqui.

import { rollupProduct, rollupProducts } from "./portfolio.js";
import { brtToday, createTask, deleteTask, patchTask, sanitizeBoardPatch } from "../tasks/tasks-core.js";
import { applyTemplateCatalogEdit, catalogConfigSaas, isPlanV2, newPlanDoc, nextPlan, planReferences, plansOf, syncPlanCatalogProjection, templateCatalogChange } from "../billing/plan-catalog.js";
import { FOLLOWUP_CONTACTS_KEY, followupDayOf } from "../shared/followup-contacts.js";
import { canScreen } from "../auth/screens.js";
import { randomUUID } from "node:crypto";
import { formKind } from "../forms/integration-form.js";
import { newManual, sameFamily } from "../calls/deliverables.js";
import { firstStage, isNoShowStage, kindOf, stageByKind } from "./stages.js";
import { applyStageMove, appointmentAhead, appointmentAt, autoLeadOwner, brtToIso, initialNextActionAt, logActivity, onActivityCreated } from "./lead-flow.js";
import { logReferralCollected, referralPatch } from "../customers/referrals.js";
import { dedupMergePatch, findDuplicateLead } from "./lead-dedup.js";
import { revenueClassificationPatch } from "./classificacao.js";
import { CREATE_DEFAULTS } from "./create-defaults.js";
import { closedInstallments, closedSubscriptionSpec, initSubscription, syncCustomerArr } from "../billing/billing.js";
import { dispatchProposal } from "../proposals/dispatch.js";
import { publicBase } from "../platform/request.js";
import { syncConsultationCalendar, syncConsultationMeetEvent } from "../calls/consultations.js";
import { customerPlanPatch, customerPlanState, recordPlanChange, stampSubscriptionPlan, subscriptionPlanState, syncCustomerPlanFromSub } from "../billing/plan-history.js";
import { syncProposalLeadSnapshot } from "../proposals/proposal.js";
import { convertWonLead, syncWonLeadDeal } from "./won-lead.js";
import { completeMilestoneTasks } from "../customers/customer-milestones.js";
import { CLOSED_PLAN_ANNUAL_FACTOR } from "../shared/plan-cycles.js";
import { syncPersonalCalendar } from "../google/google-user.js";
import { mirrorSubscriptionToMp } from "../payments/mp-charges.js";
import { mergeLeadQuestions } from "../forms/forms.js";
import { toNaiveBrt } from "./agenda-slots.js";
import { COLLECTION_NAMES } from "../platform/db.js";

// COMPROMISSO SEMPRE NA FORMA CANÔNICA (17/09): callAt/followupAt/integrationAt
// são "YYYY-MM-DDTHH:MM" no relógio de Brasília. Cliente que manda ISO em UTC
// ("2026-09-16T13:00:00.000Z", visto no card do Renan) fazia o lembrete dizer
// "hoje às 13h" pra uma call das 10h. Converte na entrada, POST e PATCH.
// Follow-up (05/10/2026) é só DIA ("YYYY-MM-DD"), sem horário: valor com hora
// (legado ou ISO) vira o dia de Brasília. Ver followup-contacts.js.
const WHEN_FIELDS = ["callAt", "integrationAt"];

function canonWhen(body) {
  if (!body || typeof body !== "object") return body;
  for (const k of WHEN_FIELDS) if (typeof body[k] === "string" && body[k]) body[k] = toNaiveBrt(body[k]);
  if (typeof body.followupAt === "string" && body.followupAt) body.followupAt = followupDayOf(body.followupAt);
  return body;
}

// Auth interna fica FORA do CRUD genérico: passwordHash/token de sessão nunca
// saem pela API. Gestão via rotas dedicadas (/api/auth/*).
// wa_threads/wa_messages ficam FORA do CRUD genérico: o inbox usa as rotas
// dedicadas (/api/whatsapp/*, gateadas), então o texto das conversas não vaza
// pra qualquer usuário autenticado via /api/wa_messages.
// blog_posts também fica fora: rascunho/pauta/fontes são internos e a máquina
// de estados (slug travado, lint, agenda) vive em routes.blog.js.
// task_events/notifications: atividade e caixa de entrada das tarefas — lidas
// só pelas rotas dedicadas (routes.tasks.js), nunca pelo CRUD genérico.
const PRIVATE = new Set(["users", "sessions", "user_assets", "activity_assets", "task_assets", "followup_assets", "task_events", "notifications", "wa_threads", "wa_messages", "wa_media", "wa_template_media", "blog_posts",
  // comp_months tem R$ por pessoa: só pelas rotas /api/comp/, que exigem
  // etiqueta admin (ADMIN_PREFIXES), nunca pelo CRUD genérico.
  "comp_months",
  // Suporte: isolamento por produto (support-scope.js) só pelas rotas
  // dedicadas de routes.tickets.js — o CRUD genérico seria porta dos fundos.
  "tickets", "ticket_events", "ticket_assets", "ticket_settings", "quick_replies", "linear_outbox",
  // Histórico de plano: append-only, escrito só pelo servidor (plan-history.js).
  "plan_changes"]);

const isExposed = (c) => COLLECTION_NAMES.includes(c) && !PRIVATE.has(c);

// Sem sessão = key mestre (MCP/integrações), que nunca é restringida.
const isAdminSession = (u) => !u || (u.roles || []).includes("admin");

// Collections external SaaS are allowed to write to via REST/MCP.
const WRITABLE = new Set(COLLECTION_NAMES.filter((c) => !PRIVATE.has(c)));

const isTruthyFlag = (v) => v === "1" || v === "true";

// Lista de propostas = o que a tela Propostas e o card do lead mostram: quem,
// quando, aberturas, aceite. Projetado no Postgres (listWhere + fields) pra não
// parsear o snapshot inteiro; `data` fica só com o lead (nome/empresa/telefone
// pro botão de WhatsApp), sem as respostas do formulário.
const PROPOSAL_SUMMARY_FIELDS = ["saas", "lead", "template", "name", "origin", "layout", "createdAt", "updatedAt", "accepted", "acceptedAt", "views", "lastViewedAt", "data"];

function summarizeProposal(p) {
  const l = p?.data?.lead || {};
  const { editKey, data, ...rest } = p; // eslint-disable-line no-unused-vars
  return { ...rest, data: { lead: { name: l.name ?? null, company: l.company ?? null, firstName: l.firstName ?? null, phone: l.phone ?? null } } };
}

// Filters applied to GET list endpoints. Each returns a predicate or null.
function listFilter(collection, q) {
  if (collection === "deals") {
    return (d) =>
      (!q.saas || d.saas === q.saas) &&
      (!q.stage || d.stage === q.stage) &&
      (!q.owner || d.owner === q.owner) &&
      (!q.score || d.score === q.score);
  }

  if (collection === "customers") {
    return (c) => {
      if (q.band === "red") return c.health < 50;
      if (q.band === "yellow") return c.health >= 50 && c.health < 70;
      if (q.band === "green") return c.health >= 70;
      if (q.saas) return c.saas === q.saas;
      return true;
    };
  }

  if (collection === "leads") return (l) => !q.priority || l.priority === q.priority;
  if (collection === "nps") return (n) => !q.saas || n.saas === q.saas;
  if (collection === "goals") return (g) => !q.scope || g.scope === q.scope;
  if (collection === "forms") return (f) => !q.saas || f.saas === q.saas;
  if (collection === "form_submissions") return (s) => (!q.form || s.form === q.form) && (!q.saas || s.saas === q.saas);
  if (collection === "proposal_templates") return (t) => !q.saas || t.saas === q.saas;
  if (collection === "proposals") return (p) => (!q.saas || p.saas === q.saas) && (!q.lead || p.lead === q.lead) && (!q.template || p.template === q.template);
  if (collection === "plans") return (p) => !q.saas || p.saas === q.saas;
  if (collection === "subscriptions") return (s) => (!q.saas || s.saas === q.saas) && (!q.customer || s.customer === q.customer) && (!q.status || s.status === q.status);
  if (collection === "invoices") return (i) => (!q.saas || i.saas === q.saas) && (!q.customer || i.customer === q.customer) && (!q.subscription || i.subscription === q.subscription) && (!q.status || i.status === q.status);
  if (collection === "ad_insights") return (r) => (!q.saas || r.saas === q.saas) && (!q.campaign || r.campaignId === q.campaign);
  if (collection === "tasks") {
    const today = q.due ? brtToday() : "";
    const isOn = (v) => v === "1" || v === "true";
    return (t) => (!q.saas || t.saas === q.saas)
      && (!q.assignee || (t.assignees || (t.assignee ? [t.assignee] : [])).includes(q.assignee))
      && (!q.column || t.column === q.column)
      && (!q.parent || (q.parent === "none" ? !t.parentId : t.parentId === q.parent))
      && (q.completed == null || !!t.completed === isOn(q.completed))
      && (!q.label || (t.labels || []).includes(q.label))
      && (!q.follower || (t.followers || []).includes(q.follower))
      && (!q.due || (q.due === "today" ? t.dueDate === today : q.due === "overdue" ? (!!t.dueDate && t.dueDate < today && !t.completed) : true));
  }

  if (collection === "activities") return (a) => (!q.lead || a.lead === q.lead) && (!q.saas || a.saas === q.saas) && (!q.type || a.type === q.type) && (!q.since || String(a.at || "") >= q.since);

  // Contratos gerados: o histórico da tela Contratos e o bloco da ficha do
  // cliente (?customer=) leem daqui — sem o filtro, a ficha mostraria contrato
  // dos outros.
  if (collection === "contract_issues") return (i) => (!q.saas || i.saas === q.saas) && (!q.customer || i.customerId === q.customer) && (!q.contract || i.contract === q.contract);

  // Formulário de integração: a tela lista por produto, e a ficha do cliente
  // (?customer=) pede só o dele.
  if (collection === "integration_forms") return (f) => (!q.saas || f.saas === q.saas) && (!q.customer || f.customerId === q.customer) && (!q.status || f.status === q.status);
  if (collection === "campaigns") return (c) => !q.saas || c.saas === q.saas;
  if (collection === "outbound_accounts") return (a) => (!q.saas || a.saas === q.saas) && (!q.status || a.status === q.status);
  if (collection === "sequences") return (s) => !q.saas || s.saas === q.saas;
  if (collection === "sequence_enrollments") return (e) => (!q.saas || e.saas === q.saas) && (!q.sequence || e.sequence === q.sequence) && (!q.status || e.status === q.status) && (!q.lead || e.lead === q.lead);
  if (collection === "drip_templates") return (t) => (!q.saas || t.saas === q.saas) && (!q.channel || t.channel === q.channel);
  return null;
}

// Etapas em que uma integração MARCADA ganha sala do Meet sozinha: a etapa de
// integração, o pós-venda e o Ganho (que vem antes da Integração no funil).
const INTEGRATION_MEET_KINDS = new Set(["integracao", "posvenda", "ganho"]);

// Mantém o leadQuestions do produto em dia com as perguntas do form (upsert por
// chave em mergeLeadQuestions). Chamado quando um form é criado/editado. Só grava
// se algo mudou. O painel do lead (deal.jsx) lê leadQuestions, então isso garante
// que nenhuma resposta capturada fique de fora por divergência de chave.
// Só form PUBLICADO entra: rascunho e backup são laboratório, e um rascunho
// chegou a empurrar sete perguntas de teste pro card de todo lead (05/10/2026).
async function syncLeadQuestions(repo, form) {
  if (!form || !form.saas || form.status !== "published") return;
  const product = await repo.get("products", form.saas);
  if (!product) return;
  const next = mergeLeadQuestions(product.leadQuestions, form);
  if (JSON.stringify(next) !== JSON.stringify(product.leadQuestions || [])) {
    await repo.update("products", product.id, { leadQuestions: next });
  }
}

export function registerCrudRoutes(app, repo, { discordClient, googleUser, metaCapiClient, briefer, autoCallMeet, autoIntegrationMeet, cancelIntegrationMeet, googleClient, mpClient } = {}) {
  // ── Generic CRUD over every collection ───────────────────────────────────
  app.get("/api/:collection", async (req, reply) => {
    const { collection } = req.params;
    if (!isExposed(collection)) return reply.code(404).send({ error: `Unknown collection: ${collection}` });
    // Propostas: cada documento é um SNAPSHOT inteiro (slides, calc, tema,
    // respostas) e a tabela passa de 38 MB — listar tudo custava 2 s de servidor
    // e 27 MB no fio pra uma tela que só mostra nome, data, aberturas e aceite.
    // A lista devolve o RESUMO, projetado no Postgres (listWhere + fields), e
    // nunca o editKey (segredo de edição). `?full=1` traz o documento inteiro.
    if (collection === "proposals" && !isTruthyFlag(req.query.full)) {
      const { saas, lead, template } = req.query;
      const rows = await repo.listWhere("proposals", { saas, lead, template }, { fields: PROPOSAL_SUMMARY_FIELDS });
      return rows.map(summarizeProposal);
    }
    // Timeline: a tabela de activities é a mais escrita do cockpit (o cache de
    // list() cai a cada toque), então filtrar em JS era um SELECT frio de 7 MB
    // por drawer aberto. Com filtro, o Postgres faz o corte (índice por lead).
    if (collection === "activities" && (req.query.lead || req.query.saas || req.query.type || req.query.since)) {
      const { lead, saas, type, since } = req.query;
      return repo.listWhere("activities", { lead, saas, type, at: { gte: since } });
    }
    let items = await repo.list(collection);
    const f = listFilter(collection, req.query);
    if (f) items = items.filter(f);
    if (collection === "products") items = rollupProducts(items, await repo.list("customers"));
    return items;
  });

  app.get("/api/:collection/:id", async (req, reply) => {
    const { collection, id } = req.params;
    if (!isExposed(collection)) return reply.code(404).send({ error: `Unknown collection: ${collection}` });
    const item = await repo.get(collection, id);
    if (!item) return reply.code(404).send({ error: "Not found" });
    return collection === "products" ? rollupProduct(item, await repo.list("customers")) : item;
  });

  app.post("/api/:collection", async (req, reply) => {
    const { collection } = req.params;
    if (!WRITABLE.has(collection)) return reply.code(404).send({ error: `Unknown collection: ${collection}` });
    if (!req.body || typeof req.body !== "object") return reply.code(400).send({ error: "JSON body required" });
    // TAREFAS: composição, regras de coluna, seguidores, eventos e notificações
    // vivem em tasks-core.js (mesmo caminho das rotas dedicadas).
    if (collection === "tasks" || collection === "task_boards") {
      try {
        if (collection === "task_boards") return reply.code(201).send(await repo.create("task_boards", { ...sanitizeBoardPatch(req.body, null), ...(req.body.id != null ? { id: req.body.id } : {}) }));
        return reply.code(201).send(await createTask(repo, req.body, { by: req.authUser?.id || "api" }));
      } catch (err) {
        if (err?.statusCode) return reply.code(err.statusCode).send({ error: err.message, code: err.code });
        throw err;
      }
    }
    if (collection === "app_config" && catalogConfigSaas(req.body.id) !== null && !isAdminSession(req.authUser)) {
      return reply.code(403).send({ error: "Configuração do catálogo de planos exige etiqueta admin" });
    }
    // Mensagens e prazos do follow-up: escrita da tela Configurações (o PATCH e
    // o DELETE pelo id já caem no prefixo de escrita de settings, screens.js).
    if (collection === "app_config" && req.body.id === FOLLOWUP_CONTACTS_KEY && req.authUser && !canScreen(req.authUser, "settings")) {
      return reply.code(403).send({ error: "Sem acesso a esta área" });
    }
    // PLANO do catálogo (v2, com `code`): id determinístico, preço normalizado e
    // versão de preço carimbados aqui; os templates de proposta recebem a
    // projeção. Plano sem `code` é o cadastro antigo e segue o caminho genérico.
    if (collection === "plans" && req.body.code != null) {
      if (!isAdminSession(req.authUser)) return reply.code(403).send({ error: "Criar plano exige etiqueta admin" });
      let doc;
      try { doc = newPlanDoc(req.body, { by: req.authUser?.id || "api" }); }
      catch (err) {
        if (err?.statusCode) return reply.code(err.statusCode).send({ error: err.message });
        throw err;
      }
      if (await repo.get("plans", doc.id)) return reply.code(409).send({ error: `já existe um plano com o código ${doc.code} neste produto` });
      const plan = await repo.create("plans", doc);
      await syncPlanCatalogProjection(repo, plan.saas);
      return reply.code(201).send(plan);
    }
    const now = new Date().toISOString();
    const stamp = {};
    if (collection === "leads") canonWhen(req.body);
    if ((collection === "leads" || collection === "consultations" || collection === "deliverables") && !req.body.createdAt) stamp.createdAt = now;
    // Consulta nasce com a responsável = quem marcou (a Ana marca as próprias).
    if (collection === "consultations" && !req.body.owner && req.authUser?.id) stamp.owner = req.authUser.id;
    // Contrato gerado: o histórico é registro de AUDITORIA — quando saiu e quem
    // gerou carimbam no servidor. Sessão de usuário manda no autor; key mestre
    // (MCP/integração) respeita o que veio no corpo.
    if (collection === "contract_issues") {
      if (!req.body.createdAt) stamp.createdAt = now;
      if (req.authUser?.id) stamp.author = req.authUser.id;
    }
    // Formulário de integração: o id É o token do link público (/fi/:id), então
    // não pode ser o gerador por timestamp do repo (adivinhável) nem vir do
    // corpo. Status, data e quem pediu carimbam aqui: é registro de auditoria.
    if (collection === "integration_forms") {
      stamp.id = "if_" + randomUUID().replace(/-/g, "").slice(0, 20);
      stamp.status = "pendente";
      stamp.kind = formKind({ kind: req.body.kind }); // tipo desconhecido vira o de integração
      stamp.createdAt = now;
      if (req.authUser?.id) stamp.author = req.authUser.id;
    }
    // Manual criado sem seções ganha o template (as 6 seções da apresentação).
    if (collection === "deliverables" && !(Array.isArray(req.body.sections) && req.body.sections.length)) {
      stamp.sections = newManual({}).sections;
    }
    // stageSince = quando o card entrou no estágio atual (base do contador "dias na
    // coluna"). No create, é agora; depois, recarimbado a cada mudança de estágio.
    if ((collection === "leads" || collection === "deals") && !req.body.stageSince) stamp.stageSince = now;
    // Activity: id randômico (burst de timeline colide com o gerador por timestamp
    // do repo — mesmo motivo do fe_ em form_events), at = quando aconteceu.
    if (collection === "activities") {
      if (!req.body.id) stamp.id = "ac_" + randomUUID();
      if (!req.body.at) stamp.at = now;
      if (!req.body.createdAt) stamp.createdAt = now;
    }
    // GPS: lead nasce com o próximo toque marcado pela cadência do estágio de
    // entrada (SLA de 1º contato) — a fila da Visão geral já o mostra na hora.
    // Criar lead JÁ numa etapa de call segue a mesma regra do movimento: sem
    // horário o card nasceria fantasma (foi assim que o lead do Vinicius entrou).
    if (collection === "leads" && typeof req.body.stage === "string" && req.body.stage) {
      try {
        const product = req.body.saas ? await repo.get("products", req.body.saas) : null;
        if (kindOf(product, req.body.stage) === "call" && !String(req.body.callAt || "").trim()) {
          return reply.code(422).send({
            error: `A etapa "${req.body.stage}" exige data e hora da call — preencha "Call agendada pra".`,
            code: "CALL_SEM_HORARIO",
          });
        }
      } catch { /* fail-open: nunca bloqueia por erro de leitura do produto */ }
    }
    if (collection === "leads" && !req.body.nextActionAt) {
      try {
        const product = req.body.saas ? await repo.get("products", req.body.saas) : null;
        const at = initialNextActionAt(product, req.body.stage);
        if (at) stamp.nextActionAt = at;
      } catch { /* fail-open */ }
    }
    // Responsável: todo lead novo entra com o SDR do produto como dono (quando há
    // só um). Espelho externo/MCP que já manda `owner` é respeitado.
    if (collection === "leads" && !req.body.owner) {
      const owner = await autoLeadOwner(repo, req.body.saas);
      if (owner) stamp.owner = owner;
    }
    // INDICAÇÃO: valida o cliente indicador (inexistente = 422, a cerca contra
    // lead inbound remarcado como "Indicação" pra virar prêmio) e carimba
    // coletor + data. Roda ANTES do dedup porque o vínculo também vale na
    // mescla: a pessoa indicada que já tinha preenchido o form não pode custar
    // a comissão de quem colheu.
    let refInfo = null;
    if (collection === "leads") {
      const r = await referralPatch(repo, req.body, { by: req.authUser?.id || "" });
      if (r.error) return reply.code(422).send({ error: r.error, code: r.code });
      if (Object.keys(r.patch).length) {
        Object.assign(stamp, r.patch);
        refInfo = { patch: r.patch, customer: r.customer || null };
      }
    }
    // Evita CADASTRO DUPLICADO: a mesma pessoa (telefone/e-mail) já no produto
    // MESCLA no lead que existe e devolve ele, sem criar card novo. Refresca a
    // atribuição e preenche buracos, sem tocar etapa/dono/GPS/proposta — lead
    // terminal continua fechado (decisão do Leo). Teste da equipe não dedup.
    if (collection === "leads" && !req.body.internal) {
      const dup = await findDuplicateLead(repo, { saas: req.body.saas, phone: req.body.phone, email: req.body.email });
      if (dup) {
        const patch = dedupMergePatch(dup, refInfo ? { ...req.body, ...refInfo.patch } : req.body);
        const merged = Object.keys(patch).length ? await repo.update("leads", dup.id, patch) : dup;
        // Indicação que ENTROU na mescla (lead sem vínculo antes) vira evento
        // datado: é o que a auditoria da comissão lê.
        if (patch.referredByCustomer) {
          await logReferralCollected(repo, {
            lead: merged.id, saas: merged.saas || "", customer: patch.referredByCustomer,
            by: merged.referralCollectedBy || "", customerName: refInfo?.customer?.name || "",
          });
        }
        try {
          await logActivity(repo, {
            saas: merged.saas || "", lead: merged.id, type: "system",
            meta: { event: "lead_resubmit", via: "api", source: req.body.source || "" },
            author: req.authUser?.id || "api",
          });
        } catch { /* fail-open */ }
        // _dedup é transiente (não persiste): avisa o cliente que NÃO nasceu card
        // novo — o cockpit mostra qual card recebeu a mescla em vez de fechar calado.
        return reply.code(200).send({ ...merged, _dedup: true });
      }
    }
    if (collection === "leads") Object.assign(stamp, revenueClassificationPatch({ ...req.body, ...stamp }));
    let created = await repo.create(collection, { ...(CREATE_DEFAULTS[collection] || {}), ...req.body, ...stamp });
    // Toque registrado → denormalizações do lead (últ. contato, tentativas) +
    // re-agendamento do próximo passo. Best-effort: nunca quebra o POST.
    if (collection === "activities") { try { await onActivityCreated(repo, created); } catch { /* fail-open */ } }
    // Timeline: nascimento do lead (form tem log próprio em routes.forms.js).
    if (collection === "leads") {
      try {
        const product = created.saas ? await repo.get("products", created.saas) : null;
        await logActivity(repo, {
          saas: created.saas || "", lead: created.id, type: "system",
          meta: { event: "lead_created", via: "api", source: created.source || "", stage: created.stage || firstStage(product) },
          author: req.authUser?.id || "api",
        });
      } catch { /* fail-open */ }
      if (refInfo?.patch?.referredByCustomer) {
        await logReferralCollected(repo, {
          lead: created.id, saas: created.saas || "", customer: refInfo.patch.referredByCustomer,
          by: created.referralCollectedBy || "", customerName: refInfo.customer?.name || "",
        });
      }
    }
    // Assinatura nova: janela do 1º ciclo + fatura inicial + customer.arr
    // (invariante: receita do produto deriva de customers).
    if (collection === "subscriptions") created = await initSubscription(repo, created);
    // Form salvo → sincroniza leadQuestions do produto (painel do lead nunca
    // diverge das chaves capturadas). Best-effort: nunca quebra o save do form.
    if (collection === "forms") { try { await syncLeadQuestions(repo, created); } catch { /* fail-open */ } }
    // Lead criado via API genérica (espelho de SaaS externo como o leverads.com.br,
    // ou MCP) → gera a proposta NATIVA se o SaaS tem template publicado. Espelha o
    // auto-trigger do form nativo (routes.forms.js) p/ leads que entram por aqui,
    // sobrescrevendo qualquer proposalUrl externo. Best-effort + idempotente
    // (runNativeProposal pula com auto quando já há proposta_id). Native-only: não
    // dispara levercopy automaticamente em todo create.
    if (collection === "leads" && created.saas && !created.proposta_id) {
      try {
        const templates = await repo.list("proposal_templates");
        const hasNative = templates.some((t) => t.saas === created.saas && t.status === "published");
        if (hasNative) {
          const r = await dispatchProposal(repo, created, { auto: true, baseUrl: publicBase(req) });
          if (r && r.lead) created = r.lead;
        }
      } catch { /* fail-open — nunca quebra o create */ }
    }
    // Lead criado manual/MCP avisa no Discord (submissão de form tem aviso
    // próprio em routes.forms.js, com o link da proposta gerada).
    if (collection === "leads" && discordClient.configured()) {
      const product = created.saas ? await repo.get("products", created.saas) : null;
      await discordClient.leadNew({ lead: created, productName: product?.name });
    }
    // Consulta marcada → espelha na agenda Google pessoal da responsável e
    // garante o Manual da Família do cliente (1 por cliente; a 1ª consulta cria).
    if (collection === "consultations") {
      try { await syncConsultationCalendar(repo, googleUser, created); } catch { /* fail-open */ }
      try {
        const manuals = await repo.list("deliverables");
        const has = manuals.some((m) => sameFamily(m, created));
        if (!has && created.clientName) {
          await repo.create("deliverables", newManual({
            saas: created.saas || "uniquekids", customerId: created.customerId || "",
            leadId: created.leadId || "", clientName: created.clientName, childName: created.childName || "",
          }));
        }
      } catch { /* fail-open */ }
    }
    return reply.code(201).send(created);
  });

  app.patch("/api/:collection/:id", async (req, reply) => {
    const { collection, id } = req.params;
    if (!WRITABLE.has(collection)) return reply.code(404).send({ error: `Unknown collection: ${collection}` });
    if (!req.body || typeof req.body !== "object") return reply.code(400).send({ error: "JSON body required" });
    if (collection === "leads") canonWhen(req.body);
    const before = collection === "subscriptions" ? await repo.get(collection, id) : null;
    // Movimento de estágio de LEAD passa pelo applyStageMove (lead-flow.js):
    // recarimba stageSince (respeitando o explícito do optimistic move), zera o
    // contador de tentativas, preenche/limpa motivo de perda, re-agenda o próximo
    // toque pela cadência e loga a activity `stage` (histórico do funil). Renome
    // de estágio NÃO passa por aqui (vai via PUT /funnel → repo.update direto).
    let patch = req.body;
    // Linhas, régua contas → pacote e adicionais do catálogo de planos moram em
    // app_config/plan_catalog_<saas>: tem preço (conta extra), então só admin.
    const catalogConfigFor = collection === "app_config" ? catalogConfigSaas(id) : null;
    if (catalogConfigFor !== null && !isAdminSession(req.authUser)) {
      return reply.code(403).send({ error: "Configuração do catálogo de planos exige etiqueta admin" });
    }
    // PLANO do catálogo (v2): código, workspace e produto vendido não mudam; mexer em preço, limite
    // ou opção sobe a versão de preço. Só admin escreve.
    if (collection === "plans") {
      const cur = await repo.get("plans", id);
      if (cur && isPlanV2(cur)) {
        if (!isAdminSession(req.authUser)) return reply.code(403).send({ error: "Editar plano exige etiqueta admin" });
        // Produto (e o acesso que ele define) é da criação: plano de outro
        // produto é outro plano.
        const { id: _id, v, saas, code, product, access, priceVersion, priceUpdatedAt, priceLog, price, cycle, ...clean } = req.body;
        const plan = await repo.update("plans", id, nextPlan(cur, clean, { by: req.authUser?.id || "api" }));
        await syncPlanCatalogProjection(repo, plan.saas);
        return plan;
      }
    }
    // TABELA DE PREÇO editada pelo template (tela de Propostas): a edição é do
    // PLANO, então pede admin como qualquer mudança de preço. Só vale com o
    // catálogo de planos do produto já semeado.
    let catalogChange = null;
    if (collection === "proposal_templates" && req.body.calc) {
      const curTemplate = await repo.get(collection, id);
      catalogChange = curTemplate ? templateCatalogChange(curTemplate, req.body) : null;
      if (catalogChange && !(await plansOf(repo, catalogChange.saas)).length) catalogChange = null;
      if (catalogChange && !isAdminSession(req.authUser)) {
        return reply.code(403).send({ error: "Mudar a tabela de preço exige etiqueta admin" });
      }
    }
    // MAPA MENTAL: trava otimista. O editor manda `baseVersion` (a versão que
    // ele abriu); se outra pessoa gravou no meio, devolve 409 com o doc atual
    // pra tela oferecer "recarregar" em vez de sobrescrever em silêncio. Toda
    // gravação carimba version+1, updatedAt e quem gravou.
    if (collection === "mindmaps") {
      const cur = await repo.get(collection, id);
      if (!cur) return reply.code(404).send({ error: "Not found" });
      const curV = Number(cur.version) || 0;
      const { baseVersion, ...rest } = req.body;
      if (baseVersion != null && Number(baseVersion) !== curV) {
        return reply.code(409).send({ error: "outra pessoa editou este mapa enquanto você mexia", code: "version_conflict", current: cur });
      }
      patch = { ...rest, version: curV + 1, updatedAt: new Date().toISOString(), updatedBy: req.authUser?.id || "" };
    }
    // TAREFAS: o PATCH cru (SPA, MCP) passa pela mesma régua das rotas
    // dedicadas — regras de coluna, comentários carimbados, eventos, avisos.
    if (collection === "tasks") {
      try {
        const r = await patchTask(repo, id, req.body, { by: req.authUser?.id || "api" });
        if (!r) return reply.code(404).send({ error: "Not found" });
        return r.task;
      } catch (err) {
        if (err?.statusCode) return reply.code(err.statusCode).send({ error: err.message, code: err.code });
        throw err;
      }
    }
    if (collection === "task_boards") {
      try { patch = sanitizeBoardPatch(req.body, await repo.get(collection, id)); }
      catch (err) {
        if (err?.statusCode) return reply.code(err.statusCode).send({ error: err.message, code: err.code });
        throw err;
      }
    }
    if (collection === "leads" && typeof req.body.stage === "string") {
      const cur = await repo.get(collection, id);
      if (cur && cur.stage !== req.body.stage) {
        try {
          patch = { ...req.body, ...(await applyStageMove(repo, { lead: cur, toStage: req.body.stage, patch: req.body, author: req.authUser?.id || "api" })) };
        } catch (err) {
          // Regra de negócio do movimento (ex.: call sem horário) vira 422 com a
          // mensagem legível — o erro padrão do Fastify mandaria só
          // "Unprocessable Entity" e a tela não teria o que mostrar.
          if (err?.statusCode) return reply.code(err.statusCode).send({ error: err.message, code: err.code });
          throw err;
        }
      }
    }
    if (collection === "deals" && typeof req.body.stage === "string" && req.body.stageSince == null) {
      const cur = await repo.get(collection, id);
      if (cur && cur.stage !== req.body.stage) patch = { ...req.body, stageSince: new Date().toISOString() };
    }
    // HISTÓRICO DE CALLS (Leo, 07/08): callAt é UM campo só — remarcar (ou
    // limpar) sobrescrevia a call que JÁ ACONTECEU e ela sumia da agenda pra
    // sempre (caso Thiago Nova Era: call de quinta apagada pela retomada de
    // sexta). Antes de gravar um callAt DIFERENTE por cima de um callAt
    // PASSADO, arquiva o antigo em lead.callHistory [{at, closer}] (máx 60);
    // a agenda desenha o histórico como call feita (✓). Vale pra TODO caminho
    // de escrita — tela, roteiro do Meu dia, drawer, MCP passam por este PATCH.
    if (collection === "leads" && "callAt" in req.body) {
      const cur = await repo.get(collection, id);
      const oldAt = String(cur?.callAt || "");
      const nextAt = String(req.body.callAt || "");
      if (cur && oldAt && oldAt !== nextAt) {
        const oldT = new Date(oldAt).getTime();
        const hist = Array.isArray(cur.callHistory) ? cur.callHistory : [];
        if (Number.isFinite(oldT) && oldT < Date.now() && !hist.some((h) => String(h?.at || "") === oldAt)) {
          patch = { ...patch, callHistory: [...hist, { at: oldAt, closer: cur.closer || "" }].slice(-60) };
        }
      }
      // QUANDO a call foi marcada por este caminho (a marcação do robô carimba
      // no bookCall). O lembrete de véspera usa isso pra não pedir confirmação
      // de um combinado que acabou de ser feito — ver VESPERA_MIN_GAP_MS.
      if (nextAt && oldAt !== nextAt) patch = { ...patch, callSetAt: new Date().toISOString() };
    }
    // UM COMPROMISSO MARCADO POR VEZ (Leo, 26/08): marcar call limpa o follow-up
    // futuro e vice-versa, pro mesmo lead nunca ocupar duas horas na agenda com
    // dois passos diferentes. Aqui é o caminho de quem edita o horário SEM mudar
    // de etapa (drawer, roteiro, MCP); a mudança de etapa passa pela mesma régua
    // dentro do applyStageMove. Compromisso PASSADO nunca é limpo: é história.
    if (collection === "leads" && ("callAt" in req.body || "followupAt" in req.body)) {
      const cur = await repo.get(collection, id);
      const ahead = (field, v) => appointmentAhead(field, v);
      if ("callAt" in req.body && ahead("callAt", req.body.callAt) && !("followupAt" in req.body) && ahead("followupAt", cur?.followupAt)) {
        patch = { ...patch, followupAt: "" };
      }
      if ("followupAt" in req.body && ahead("followupAt", req.body.followupAt) && !("callAt" in req.body) && ahead("callAt", cur?.callAt)) {
        patch = { ...patch, callAt: "" };
      }
    }
    // INDICAÇÃO registrada/corrigida no card: mesma régua do POST (cliente
    // precisa existir, coletor e data carimbados pelo servidor). `referralAt`
    // só nasce uma vez: reeditar o card não muda a janela da comissão.
    let refPatchInfo = null;
    if (collection === "leads" && "referredByCustomer" in req.body) {
      const cur = await repo.get(collection, id);
      if (!cur) return reply.code(404).send({ error: "Not found" });
      const r = await referralPatch(repo, req.body, { existing: cur, by: req.authUser?.id || "" });
      if (r.error) return reply.code(422).send({ error: r.error, code: r.code });
      if (Object.keys(r.patch).length) {
        patch = { ...patch, ...r.patch };
        // Evento novo só quando o vínculo NASCE (não em correção do mesmo cliente).
        if (r.patch.referredByCustomer && r.patch.referredByCustomer !== cur.referredByCustomer) {
          refPatchInfo = { customer: r.patch.referredByCustomer, name: r.customer?.name || "" };
        }
      }
    }
    // Plano do cliente editado na mão (cadastro/ficha): código validado contra
    // o catálogo, retrato e rótulo recalculados, e a edição entra no histórico.
    let planEdit = null;
    if (collection === "customers" && ["planCode", "planCycle", "planCustom"].some((k) => k in req.body)) {
      const cur = await repo.get(collection, id);
      if (cur) {
        try {
          const r = await customerPlanPatch(repo, cur, req.body);
          patch = { ...patch, ...r.patch };
          planEdit = { before: cur, plan: r.plan, snapshot: r.patch.planSnapshot };
        } catch (err) {
          if (err?.statusCode) return reply.code(err.statusCode).send({ error: err.message });
          throw err;
        }
      }
    }
    // Assinatura cancelada por QUALQUER caminho ganha o carimbo canceledAt (o
    // churn de CS do scoreboard e o histórico dependem dele; antes só o
    // syncWonLeadDeal gravava — o botão da tela e o webhook deixavam vazio).
    if (collection === "subscriptions" && patch.status === "canceled" && before && before.status !== "canceled" && !before.canceledAt) {
      patch = { ...patch, canceledAt: new Date().toISOString() };
    }
    if (collection === "leads" && ["orders", "ticket", "accounts", "listings", "volume", "trigger", "tried", "triedOther", "formProduct", "saas"].some((k) => k in patch)) {
      const current = await repo.get(collection, id);
      if (current) patch = { ...patch, ...revenueClassificationPatch({ ...current, ...patch }) };
    }
    const updated = await repo.update(collection, id, patch);
    if (!updated) return reply.code(404).send({ error: "Not found" });
    if (planEdit) {
      await stampSubscriptionPlan(repo, id, planEdit.plan, planEdit.snapshot).catch(() => null);
      await recordPlanChange(repo, {
        type: "manual_edit", saas: updated.saas, customer: id, lead: updated.leadId || "",
        from: customerPlanState(planEdit.before), to: customerPlanState(updated),
        listPrice: planEdit.snapshot?.listPrice, priceVersion: planEdit.snapshot?.priceVersion,
        source: "manual", author: req.authUser?.id || "api",
      });
    }
    if (collection === "subscriptions" && before && before.status !== updated.status) {
      await syncCustomerPlanFromSub(repo, updated).catch(() => null);
    }
    if (collection === "subscriptions" && before && before.status !== updated.status && (updated.status === "canceled" || updated.status === "paused")) {
      await recordPlanChange(repo, {
        type: updated.status, saas: updated.saas, customer: updated.customer, subscription: id,
        from: subscriptionPlanState(before), to: subscriptionPlanState(updated),
        source: "manual", author: req.authUser?.id || "api",
      });
    }
    // Tabela de preço editada na tela de Propostas: o deck oficial
    // (pt_leverads_slides) e o pt_leverads têm que ficar com o MESMO catálogo.
    // O catálogo MORA no pt_leverads — é lá que as migrações escrevem e de lá
    // que o ensureSlidesDeck copia a cada boot —, então gravar só num dos dois
    // faria o próximo deploy devolver o preço velho, sem aviso.
    if (catalogConfigFor) await syncPlanCatalogProjection(repo, catalogConfigFor);
    if (catalogChange) {
      // Catálogo de planos semeado: a edição vira mudança nos planos e a
      // projeção regrava os templates (o gêmeo incluso).
      try { await applyTemplateCatalogEdit(repo, catalogChange, { by: req.authUser?.id || "api" }); }
      catch (err) { req.log?.warn({ err: err?.message }, "plan-catalog: edição do template não chegou aos planos"); }
    } else if (collection === "proposal_templates" && patch.calc?.catalog) {
      const gemeo = { pt_leverads_slides: "pt_leverads", pt_leverads: "pt_leverads_slides" }[id];
      if (gemeo) {
        try {
          const outro = await repo.get("proposal_templates", gemeo);
          if (outro && JSON.stringify(outro.calc?.catalog || null) !== JSON.stringify(patch.calc.catalog)) {
            await repo.update("proposal_templates", gemeo, {
              calc: { ...(outro.calc || {}), catalog: JSON.parse(JSON.stringify(patch.calc.catalog)) },
            });
          }
        } catch { /* fail-open: a edição do template não pode falhar por causa do espelho */ }
      }
    }
    if (refPatchInfo) {
      await logReferralCollected(repo, {
        lead: updated.id, saas: updated.saas || "", customer: refPatchInfo.customer,
        by: updated.referralCollectedBy || "", customerName: refPatchInfo.name,
      });
    }
    // Empresa/nome preenchidos depois da geração precisam chegar na
    // apresentação existente. O helper também recupera a dor de origem quando
    // o snapshot é antigo; tudo é best-effort para nunca quebrar o PATCH do lead.
    if (collection === "leads" && updated.proposta_id && ["company", "name", "sourcePain", "utm"].some((k) => k in req.body)) {
      try {
        const proposal = await repo.get("proposals", updated.proposta_id);
        if (proposal) await syncProposalLeadSnapshot(repo, proposal);
      } catch { /* fail-open */ }
    }
    // Form editado → ressincroniza leadQuestions do produto (best-effort).
    if (collection === "forms") { try { await syncLeadQuestions(repo, updated); } catch { /* fail-open */ } }
    // Lead que virou "Ganho" → cria o cliente (pós-venda) com startedAt e link
    // pro lead de origem. Idempotente e best-effort: nunca quebra o PATCH.
    if (collection === "leads" && typeof req.body.stage === "string") {
      try { await convertWonLead(repo, updated, { metaCapi: metaCapiClient }); } catch { /* fail-open */ }
      // Card entrando em INTEGRAÇÃO → briefing de passagem pro integrador (lê a
      // transcrição da call de venda). Solto em background: a resposta do PATCH
      // não espera a IA, e o poller (start do domínio calls) re-tenta enquanto a
      // transcrição do Google não fica pronta, o caso mais comum logo após o move.
      const toKind = kindOf(await repo.get("products", updated.saas), updated.stage);
      if (briefer && (toKind === "integracao" || toKind === "ganho") && !updated.integrationBriefAt) {
        briefer.briefLead(updated.id).catch(() => { /* o poller tenta de novo */ });
      }
    }
    // Plano/valor/pagamento reeditados num lead que JÁ virou cliente (gate da
    // Integração ou edição direta) → o fechamento novo re-espelha no cliente e
    // na assinatura nascidos dele. Best-effort: nunca quebra o PATCH.
    if (collection === "leads" && updated.customerId && ["amount", "planClosed", "paymentMethod", "paymentInstallments", "consultPackage"].some((k) => k in req.body)) {
      try { await syncWonLeadDeal(repo, updated); } catch { /* fail-open */ }
    }
    // Caminho INVERSO do espelho acima: valor do contrato editado na tela de
    // Clientes (customer.arr) volta pro fechamento (lead.amount, que é o que a
    // coluna "Total fechado" mostra) e segue pelo mesmo syncWonLeadDeal até a
    // assinatura — senão MRR muda e o total fechado fica com o número velho.
    // Best-effort: nunca quebra o PATCH.
    // Marco concluído na FICHA → conclui a tarefa daquele marco no quadro (o
    // caminho inverso, tarefa concluída marca o marco, é hook em tasks-core).
    // Best-effort: nunca quebra o PATCH.
    if (collection === "customers" && req.body.milestonesDone && typeof req.body.milestonesDone === "object") {
      try {
        const antes = (before && before.milestonesDone) || {};
        const novos = Object.keys(updated.milestonesDone || {}).filter((k) => !antes[k]);
        if (novos.length) await completeMilestoneTasks(repo, updated, novos, { by: req.authUser?.id || "api" });
      } catch { /* fail-open */ }
    }
    // Dono da conta trocado na ficha → as tarefas ABERTAS do cliente (marcos da
    // régua, cobranças, cases) seguem pro dono novo; o antigo sai da lista de
    // responsáveis. Best-effort: nunca quebra o PATCH.
    if (collection === "customers" && "owner" in req.body && before && (before.owner || "") !== (updated.owner || "")) {
      try {
        const open = (await repo.listWhere("tasks", { customerId: updated.id })).filter((t) => !t.completed);
        for (const t of open) {
          const assignees = (t.assignees || []).filter((a) => a !== before.owner);
          if (updated.owner && !assignees.includes(updated.owner)) assignees.push(updated.owner);
          await patchTask(repo, t.id, { assignees }, { by: req.authUser?.id || "api" });
        }
      } catch { /* fail-open */ }
    }
    if (collection === "customers" && "arr" in req.body && updated.leadId) {
      try {
        const lead = await repo.get("leads", updated.leadId);
        if (lead && lead.customerId === updated.id) {
          const amount = Math.round((Number(updated.arr) || 0) / (CLOSED_PLAN_ANNUAL_FACTOR[lead.planClosed] || 1));
          if (amount !== (Number(lead.amount) || 0)) {
            const fresh = await repo.update("leads", lead.id, { amount });
            // Serviço único/fechamento legado não têm spec de assinatura: só o
            // amount espelha (cancelar/mexer em assinatura a partir de uma
            // edição de valor seria chute).
            if (closedSubscriptionSpec(fresh) || closedInstallments(fresh)) await syncWonLeadDeal(repo, fresh);
          }
        }
      } catch { /* fail-open */ }
    }
    // Call/integração agendada, reagendada ou reatribuída → espelha na agenda
    // PESSOAL do responsável (closer na call, integrator na integração) que
    // conectou a própria conta Google. Best-effort: nunca quebra o PATCH.
    if (collection === "leads" && ("callAt" in req.body || "closer" in req.body || "integrationAt" in req.body || "integrator" in req.body)) {
      try { await syncPersonalCalendar(repo, googleUser, updated); } catch { /* fail-open */ }
    }
    // Call agendada, remarcada ou reatribuída → o Meet acompanha SOZINHO: sem
    // sala, ela nasce na hora na conta @leverads do closer (gravar toda call
    // de venda é a regra — 01/09); com sala, o evento move pro horário novo
    // (e-mail de atualização pro lead) e sala que nasceu na conta do time é
    // recriada na do closer enquanto a call não aconteceu.
    if (collection === "leads" && ("callAt" in req.body || "closer" in req.body) && updated.callAt && autoCallMeet) {
      try { await autoCallMeet(updated.id); } catch { /* fail-open: o lembrete de 2h tenta de novo */ }
    }
    // REMARCOU UM NO-SHOW: o card volta pra etapa de call sozinho. Editar só o
    // horário deixava o card preso em "No show" com call futura — e a régua de
    // lembretes exige etapa de call, então o lead remarcado não recebia nem a
    // confirmação nem o link, e furava de novo (caso Alcindotzwicins, 25/08).
    if (collection === "leads" && "callAt" in req.body && req.body.stage == null) {
      try {
        const product = await repo.get("products", updated.saas);
        const at = Date.parse(brtToIso(String(updated.callAt || "")));
        const target = stageByKind(product, "call");
        if (target && Number.isFinite(at) && at > Date.now() && isNoShowStage(updated.stage)) {
          const patch = await applyStageMove(repo, { lead: updated, toStage: target.stage, author: req.authUser?.id || "system" });
          Object.assign(updated, await repo.update("leads", updated.id, { ...patch, stage: target.stage }));
        }
      } catch { /* fail-open: a etapa segue como está */ }
    }
    // Remarcou a call/integração/follow-up → o GPS segue o compromisso. Só quando
    // o horário mudou de verdade e o PATCH não trouxe um nextActionAt explícito
    // (toque marcado na mão pelo time continua ganhando). O follow-up entrou em
    // 25/08: remarcar só o followupAt deixava o GPS no horário velho, e a agenda
    // desenhava as duas horas.
    if (collection === "leads" && ("callAt" in req.body || "integrationAt" in req.body || "followupAt" in req.body) && req.body.nextActionAt == null) {
      try {
        const at = appointmentAt(await repo.get("products", updated.saas), updated);
        if (at && at !== updated.nextActionAt) {
          await repo.update("leads", updated.id, { nextActionAt: at });
          updated.nextActionAt = at;
        }
      } catch { /* fail-open: o GPS antigo continua valendo */ }
    }
    // Integração marcada, remarcada ou reatribuída → o Meet acompanha SOZINHO,
    // na MESMA régua da call de venda (Leo, 11/09: a integração também roda no
    // Meet com o cliente). Sem sala, nasce na conta @leverads do responsável
    // (integrador, ou o closer enquanto não há integrador); com sala, o evento
    // move pro horário novo (e-mail de atualização pro cliente) e sala nascida
    // na conta do time é recriada na do responsável enquanto a integração não
    // aconteceu. Cobre o fechamento saindo da call (stage+integrationAt no
    // mesmo PATCH), a data marcada depois no drawer, a remarcação do Meu dia e
    // a troca de integrador. Card em Ganho com integração marcada também conta
    // (o Ganho vem antes da Integração no funil). Sem Google, o botão manual
    // continua valendo.
    if (collection === "leads" && ("stage" in req.body || "integrationAt" in req.body || "integrator" in req.body) && autoIntegrationMeet) {
      try {
        const k = kindOf(await repo.get("products", updated.saas), updated.stage);
        if (INTEGRATION_MEET_KINDS.has(k) && updated.integrationAt) await autoIntegrationMeet(updated.id);
      } catch { /* fail-open: o botão manual continua valendo */ }
    }
    // Integração DESMARCADA (integrationAt limpo): o convite sai da agenda do
    // organizador e do cliente e os campos da sala zeram — a próxima marcação
    // nasce com sala nova, igual à call desmarcada.
    if (collection === "leads" && "integrationAt" in req.body && !updated.integrationAt && cancelIntegrationMeet) {
      try { await cancelIntegrationMeet(updated.id); } catch { /* fail-open */ }
    }
    // Consulta remarcada, cancelada ou reatribuída → re-espelha na agenda
    // pessoal da responsável (mesmo evento; cancelar apaga) E move o evento do
    // Meet na conta do time (o convite do cliente acompanha). Best-effort.
    if (collection === "consultations" && ("at" in req.body || "status" in req.body || "owner" in req.body || "durationMin" in req.body || "n" in req.body || "clientName" in req.body)) {
      try { await syncConsultationCalendar(repo, googleUser, updated); } catch { /* fail-open */ }
      try { await syncConsultationMeetEvent(repo, googleClient, updated); } catch { /* fail-open */ }
    }
    if (collection === "subscriptions") {
      await syncCustomerArr(repo, updated.customer);
      if (before && before.customer && before.customer !== updated.customer) await syncCustomerArr(repo, before.customer);
      // Cancelar/pausar/reativar aqui não pode deixar o MP cobrando (fail-open).
      await mirrorSubscriptionToMp(mpClient, before, updated, req.log);
    }
    return updated;
  });

  app.delete("/api/:collection/:id", async (req, reply) => {
    const { collection, id } = req.params;
    if (!WRITABLE.has(collection)) return reply.code(404).send({ error: `Unknown collection: ${collection}` });
    // TAREFA apagada leva junto subtarefas, atividade, notificações, anexos
    // órfãos e some dos bloqueios das outras (tasks-core.js).
    if (collection === "tasks") {
      const r = await deleteTask(repo, id, { by: req.authUser?.id || "api" });
      if (!r) return reply.code(404).send({ error: "Not found" });
      return { ok: true, id, removed: r.removed };
    }
    if (collection === "app_config" && catalogConfigSaas(id) !== null && !isAdminSession(req.authUser)) {
      return reply.code(403).send({ error: "Configuração do catálogo de planos exige etiqueta admin" });
    }
    // PLANO do catálogo em uso não se apaga: arquiva (status), senão assinatura,
    // cliente e negócio fechado ficam apontando pro vazio.
    if (collection === "plans") {
      const cur = await repo.get("plans", id);
      if (cur && isPlanV2(cur)) {
        if (!isAdminSession(req.authUser)) return reply.code(403).send({ error: "Excluir plano exige etiqueta admin" });
        const refs = await planReferences(repo, cur);
        if (refs.total) return reply.code(409).send({ error: "plano em uso: arquive em vez de excluir", code: "plan_in_use", refs });
        await repo.remove("plans", id);
        await syncPlanCatalogProjection(repo, cur.saas);
        return { ok: true, id };
      }
    }
    const subCustomer = collection === "subscriptions" ? (await repo.get(collection, id))?.customer : null;
    // Consulta apagada → tira o evento da agenda pessoal da responsável.
    const gone = collection === "consultations" ? await repo.get(collection, id) : null;
    const ok = await repo.remove(collection, id);
    if (!ok) return reply.code(404).send({ error: "Not found" });
    if (subCustomer) await syncCustomerArr(repo, subCustomer);
    if (gone?.calEventId && gone?.calEventUser) {
      try { await googleUser.deleteEvent(gone.calEventUser, gone.calEventId); } catch { /* fail-open */ }
    }
    // Consulta apagada → cancela também o evento do Meet (convite do cliente).
    if (gone?.meetEventId && googleClient?.configured?.()) {
      try { if (await googleClient.connected()) await googleClient.deleteCalendarEvent(gone.meetEventId); } catch { /* fail-open */ }
    }
    return { ok: true, id };
  });
}
