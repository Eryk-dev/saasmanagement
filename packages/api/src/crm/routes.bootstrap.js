// Carga inicial do SPA (/api/bootstrap vira o window.SEED), visão do portfólio
// e leaderboard.

import { repo as defaultRepo } from "../platform/db.js";
import { currentRev } from "../platform/changes.js";
import { canScreen } from "../auth/screens.js";
import { computePortfolio, rollupProducts } from "./portfolio.js";
import { inScope, ticketScope } from "../auth/support-scope.js";
import { normalizeBoard } from "../tasks/tasks-core.js";
import { STATUS_KIND } from "../support/tickets-core.js";
import { slaState } from "../support/tickets-sla.js";
import { getWaHealth, waHealthSummary } from "../whatsapp/wa-health.js";
import { dealCatalogFromPlans, plansOf, slimPlan } from "../billing/plan-catalog.js";
import { loadFollowupContacts } from "./followup-config.js";
import { integrationStatus } from "./levercopy.js";
import { dealCatalog } from "../proposals/proposal-catalog.js";
import { mentoriaDealCatalog } from "../customers/mentoria.js";
import { deckOutline } from "../proposals/proposal-slides-page.js";

async function peopleObject(repo) {
  const list = await repo.list("people");
  const obj = {};
  for (const p of list) obj[p.id] = p;
  return obj;
}

export function registerBootstrapRoutes(app, repo, { googleClient, mpClient, metaClient, anthropicClient, discordClient, whatsappClient } = {}) {
  // Everything the cockpit web app needs in one shot (mirrors window.SEED).
  // Usuário com telas restritas (user.screens) recebe o payload FILTRADO:
  // esconder o menu no SPA sem cortar os dados aqui não seria restrição —
  // faturamento/clientes não podem chegar no navegador de quem não vê as telas.
  // Campos de IDENTIFICAÇÃO do cliente (nada financeiro): é o que vai pros
  // seletores de quem não tem a tela Clientes. Ver CUSTOMERS no bootstrap.
  const CUSTOMER_PICK_KEYS = ["id", "saas", "name", "company", "email", "phone"];
  const pickCustomer = (c) =>
    Object.fromEntries(CUSTOMER_PICK_KEYS.filter((k) => c?.[k] !== undefined).map((k) => [k, c[k]]));

  // Campos do lead que NENHUMA tela lê do SEED (medido em 17/09/2026: fbc/fbp
  // são cookies do Pixel guardados pra Meta CAPI, classificacao não tem leitor
  // no web; sourceUrl só aparece no drawer, que busca o lead inteiro em
  // GET /api/leads/:id ao abrir). Juntos eram ~1,1 MB
  // dos 4,4 MB de leads que todo bootstrap arrastava. PATCH faz merge no
  // servidor, então a cópia sem esses campos nunca os apaga.
  const LEAD_SEED_DROP = ["fbc", "fbp", "classificacao", "sourceUrl"];
  const slimLead = (l) => {
    if (!l || !LEAD_SEED_DROP.some((k) => k in l)) return l;
    const c = { ...l };
    for (const k of LEAD_SEED_DROP) delete c[k];
    return c;
  };

  // Memo do bootstrap por usuário × revisão do banco: o SSE faz TODA aba aberta
  // recarregar o bootstrap no mesmo segundo depois de qualquer escrita — N abas
  // viravam N leituras de 15 coleções + serialização de 4 MB. A chave leva o
  // rev (changes.js: qualquer escrita com bump muda) e o dia (tasksLate compara
  // com hoje); o TTL curto cobre escrita `silent` que o bootstrap lê. Guardamos
  // a PROMISE pra requisições simultâneas coalescerem numa computação só.
  // Só com o repo real: o mem-repo dos testes nunca chama bump, o rev ficaria
  // em 0 e os testes leriam resposta velha depois de escrever.
  const bootstrapMemo = repo === defaultRepo ? new Map() : null;
  const BOOTSTRAP_TTL_MS = 20_000;
  app.get("/api/bootstrap", async (req) => {
    if (!bootstrapMemo) return buildBootstrap(req);
    const now = Date.now();
    const key = `${req.authUser?.id || "key"}|${currentRev()}|${new Date().toISOString().slice(0, 10)}`;
    const hit = bootstrapMemo.get(key);
    if (hit && now - hit.at < BOOTSTRAP_TTL_MS) return hit.promise;
    const promise = buildBootstrap(req);
    bootstrapMemo.set(key, { at: now, promise });
    promise.catch(() => bootstrapMemo.delete(key));
    if (bootstrapMemo.size > 64) for (const [k, v] of bootstrapMemo) if (now - v.at > BOOTSTRAP_TTL_MS) bootstrapMemo.delete(k);
    return promise;
  });

  async function buildBootstrap(req) {
    const can = (screen) => canScreen(req.authUser, screen);
    const [products, customers, attention, leads, nps, lbMonth, lbAll, goals, portfolio, people, agendaBlocks, consultations] =
      await Promise.all([
        repo.list("products"),
        repo.list("customers"),
        repo.list("attention"),
        repo.list("leads"),
        repo.list("nps"),
        repo.list("leaderboard_month"),
        repo.list("leaderboard_all"),
        repo.list("goals"),
        computePortfolio(repo),
        peopleObject(repo),
        repo.list("agenda_blocks"),
        repo.list("consultations").catch(() => []),
      ]);
    // Sem nenhuma tela financeira, os números de receita saem até do catálogo
    // de produtos (o funil/config continua — o pipeline precisa dele).
    const seesFinance = can("overview") || can("customers") || can("metrics") || can("expenses");
    const FINANCE_KEYS = ["arr", "mrr", "mrrSeries", "mrrDelta", "nnm", "tcv", "tcvDelta", "acv", "acvDelta", "customers", "customersDelta", "churnRate", "nrr", "nrrDelta", "grr", "healthSeries"];
    let saas = rollupProducts(products, customers);
    if (!seesFinance) saas = saas.map((s) => { const c = { ...s }; for (const k of FINANCE_KEYS) delete c[k]; return c; });
    // ── Contadores da moldura (13/09) ───────────────────────────────────────
    // O menu diz onde tem fogo. Vêm daqui (e não de um fetch por tela) porque o
    // SEED já é o que o SSE atualiza: um número só, do servidor, sem a moldura
    // reimplementar régua de tela. Tarefas e Inbox usam as MESMAS regras das
    // telas donas (coluna de concluído do board; unread da thread).
    const contadores = {};
    try {
      const escopoSuporte = ticketScope(req.authUser);
      const [tarefas, boards, threads, tickets] = await Promise.all([
        can("tasks") ? repo.list("tasks").catch(() => []) : [],
        can("tasks") ? repo.list("task_boards").catch(() => []) : [],
        can("whatsapp") ? repo.list("wa_threads").catch(() => []) : [],
        can("tickets") && (escopoSuporte === null || escopoSuporte.length) ? repo.list("tickets").catch(() => []) : [],
      ]);
      const hoje = new Date().toISOString().slice(0, 10);
      const agora = new Date().toISOString();
      const meuId = req.authUser?.id || "";
      // Hermes: casos que esperam um aprovador (Validar / Aguardando resposta).
      // Conta só pra quem aprova no produto (ticket_settings.linear.hermes).
      const hermesPend = tickets.filter((t) => t.hermes?.needsHuman && STATUS_KIND[t.status] !== "done");
      const ajustesSuporte = hermesPend.length ? await repo.list("ticket_settings").catch(() => []) : [];
      const aprovaHermes = (saasId) => {
        const h = ajustesSuporte.find((x) => x.id === saasId)?.linear?.hermes;
        return h?.enabled === true && (!meuId || (h.approvers || []).includes(meuId));
      };
      for (const p of products) {
        const board = normalizeBoard(boards.find((b) => b.saas === p.id) || boards.find((b) => !b.saas));
        const minhas = tarefas.filter((t) => {
          if (t.parentId) return false;
          if (t.saas && t.saas !== p.id) return false;
          if (t.completed) return false;
          if (board.doneKey && t.column === board.doneKey) return false;
          const donos = Array.isArray(t.assignees) ? t.assignees : (t.assignee ? [t.assignee] : []);
          return !donos.length || !meuId || donos.includes(meuId);
        });
        // Tickets: abertos (não resolvidos) do produto, meus ou sem dono — só
        // se o produto está no escopo de suporte da sessão.
        const fila = inScope(escopoSuporte, p.id)
          ? tickets.filter((t) => t.saas === p.id && STATUS_KIND[t.status] !== "done" && (!t.assignee || !meuId || t.assignee === meuId))
          : [];
        contadores[p.id] = {
          tasks: minhas.length,
          tasksLate: minhas.filter((t) => t.dueDate && String(t.dueDate) < hoje).length,
          inbox: threads.filter((t) => (!t.saas || t.saas === p.id) && Number(t.unread) > 0 && t.status !== "closed").length,
          tickets: fila.length,
          ticketsBreached: fila.filter((t) => slaState(t, agora).overall === "breached").length,
          ticketsHermes: inScope(escopoSuporte, p.id) && aprovaHermes(p.id) ? hermesPend.filter((t) => t.saas === p.id).length : 0,
        };
      }
    } catch { /* contador é enfeite: falhar aqui não pode derrubar o bootstrap */ }

    // O que o CONFIG precisa do banco/integrações vai numa leva só: eram cinco
    // awaits em série no meio do objeto (templates, 3× app_config do Google,
    // saúde do WhatsApp), cada um uma ida ao pooler do Supabase.
    const [proposalTemplates, googleConnected, googleAccount, gmailReady, waHealth, catalogPlans, followupContacts] = await Promise.all([
      repo.list("proposal_templates"), googleClient.connected(), googleClient.account(), googleClient.gmailReady(), getWaHealth(repo), plansOf(repo),
      loadFollowupContacts(repo),
    ]);
    return {
      SAAS: saas,
      COUNTERS: contadores,
      PORTFOLIO: can("overview") ? portfolio : null,
      ATTENTION: can("overview") ? attention : [],
      PEOPLE: people,
      // Cliente pra ESCOLHER (cobrança, contrato, consulta, formulário de
      // integração) ≠ cliente pra ANALISAR. Quem não tem a tela Clientes recebe
      // só o suficiente pra achar a pessoa; ARR, MRR, saúde, churn e plano de
      // pagamento continuam fora. Sem isto o modal de cobrança abria com a aba
      // "Cliente" VAZIA e não dava pra gerar o link (foi o que travou o
      // Jonathan em 27/08/2026 — e o Vitor, do outro lado, em 24/08).
      CUSTOMERS: can("customers") ? customers : customers.map(pickCustomer),
      LEADS: can("pipeline") || can("today") || can("analise") ? leads.map(slimLead) : [], // Meu dia e Análise do pipeline = views dos mesmos leads
      AGENDA_BLOCKS: agendaBlocks, // bloqueios de horário por pessoa (tela Agenda) — alimentam a "agenda ocupada" ao marcar call/integração
      // Consulta da mentoria ocupa a agenda de quem atende: sem isso dava pra
      // marcar call de venda por cima do encontro de um cliente. Vai SÓ a
      // ocupação (quem/quando/quanto dura) — nome do cliente, da criança e
      // telefone ficam na tela Consultas, que tem guard próprio, senão o
      // bootstrap de todo mundo carregaria dado de família.
      CONSULTATION_SLOTS: (consultations || [])
        .filter((c) => c.at && c.owner && c.status !== "canceled")
        .map((c) => ({ user: c.owner, at: c.at, minutes: Number(c.durationMin) > 0 ? Number(c.durationMin) : 60 })),

      NPS: can("customers") ? nps : [],
      LEADERBOARD_MONTH: can("overview") ? lbMonth : [],
      LEADERBOARD_ALL: can("overview") ? lbAll : [],
      GOALS: can("overview") ? goals : [],
      // Estado de integrações que a UI precisa pra decidir o que renderizar
      // (ex.: mostrar o botão "Gerar proposta" nos leads de SaaS com provider).
      CONFIG: {
        levercopy: integrationStatus(),
        // Follow-up em 4 contatos: mensagem + prazo (dias úteis) de cada um.
        followupContacts,
        // `catalog` = o que o closer pode FECHAR, com os preços do template
        // (banco): o gate de fechamento do card monta o select de produto e
        // sugere o valor a partir daqui, então mexer no preço no banco vale na
        // hora, sem deploy. SaaS sem catálogo (UniqueKids) simplesmente não entra.
        proposals: (() => {
          const templates = proposalTemplates;
          const published = templates.filter((t) => t.status === "published");
          const catalog = {};
          const add = (saas, rows) => {
            if (!saas || !rows.length) return;
            const cur = catalog[saas] || (catalog[saas] = []);
            for (const r of rows) if (!cur.some((x) => x.id === r.id)) cur.push(r);
          };
          // Produto com catálogo de PLANOS semeado: o que se fecha sai dos
          // planos (fonte única). Sem planos, vale o catálogo do template.
          const plansOfSaas = (saas) => catalogPlans.filter((p) => p.saas === saas);
          const fromPlans = new Set(catalogPlans.map((p) => p.saas));
          for (const saas of fromPlans) add(saas, dealCatalogFromPlans(plansOfSaas(saas)));
          for (const t of published) if (!fromPlans.has(t.saas)) add(t.saas, dealCatalog(t.calc));
          // Deck alternativo (rascunho + selectable) também vende: a Mentoria
          // vive num deck selecionável do leverads, e os produtos dela precisam
          // existir no gate de fechamento do mesmo jeito. `group` nas linhas faz
          // o select separar as duas linhas de produto.
          for (const t of templates) {
            if (t.selectable && !plansOfSaas(t.saas).some((p) => p.line === "mentoria")) add(t.saas, mentoriaDealCatalog(t.calc));
          }
          // `slidesDeck` = as telas da apresentação em slides, na ordem, com a
          // condição que esconde cada uma (data-if do deck). A tela de
          // Propostas mostra isso no cartão da apresentação oficial; vem do
          // renderer (deckOutline) pra não existir uma segunda lista pra
          // alguém esquecer de atualizar.
          return { nativeSaas: published.map((t) => t.saas), catalog, slidesDeck: deckOutline() };
        })(),
        // Catálogo de planos por produto (enxuto): rótulo, preço por ciclo e
        // limites pra as telas escolherem e nomearem plano sem lista fixa.
        plans: catalogPlans.reduce((acc, p) => { (acc[p.saas] || (acc[p.saas] = [])).push(slimPlan(p)); return acc; }, {}),
        mp: { configured: mpClient.configured(), webhook: mpClient.hasWebhookSecret() },
        meta: { configured: metaClient.configured() },
        // meetCalendar: onde o evento do Meet nasce (GOOGLE_MEET_CALENDAR_ID).
        // Aparece em Ajustes → Integrações porque é a causa nº 1 de "não cria o
        // link": calendário de outra identidade, invisível pra conta conectada.
        google: { configured: googleClient.configured(), connected: googleConnected, account: googleAccount, gmail: gmailReady, meetCalendar: process.env.GOOGLE_MEET_CALENDAR_ID || "primary" },
        ai: { configured: anthropicClient.configured() },
        discord: { configured: discordClient.configured() },
        whatsapp: { configured: whatsappClient.configured(), health: waHealthSummary(waHealth) },
      },
    };
  }

  app.get("/api/portfolio", async () => await computePortfolio(repo));

  // Convenience: leaderboard by scope -> the right collection.
  app.get("/api/leaderboard", async (req) => {
    const scope = req.query.scope === "all" ? "leaderboard_all" : "leaderboard_month";
    return await repo.list(scope);
  });
}
