// Briefing de passagem pro INTEGRADOR — o card entrou em Integração, o cliente
// fechou e quem vai fazer o onboarding não estava na call de venda. Este módulo
// lê a transcrição da call de VENDA (Meet → Drive), soma os dados do cadastro e
// devolve uma ordem de serviço: quem é o cliente, o que foi prometido, o que
// confirmar e o passo a passo do setup.
//
// Fonte, em ordem: transcrição da call de venda → resumo estruturado que a IA já
// tirou dessa call (activity call_summary kind "call"). Sem nenhuma das duas o
// briefing NÃO é gerado (cadastro sozinho não sustenta "o que foi prometido").
//
// Dedup por lead: `integrationBriefFor` guarda o evento da call que originou o
// briefing (ou "sem-call"), `integrationBriefAt` o horário. Regerar é explícito
// (force), então o poller nunca reescreve o que o integrador já leu.
import { logActivity } from "./lead-flow.js";
import { kindOf } from "./stages.js";

// Faixa do formulário ("3-5", "10000+", "200k-1m") em texto legível — a IA lê
// melhor "3 a 5 contas" do que o código cru, e o briefing não inventa número.
const range = (v) => String(v || "")
  .replace(/^(\d+[a-z]*)-(\d+[a-z]*)$/i, "$1 a $2")
  .replace(/^(\d+[a-z]*)\+$/i, "mais de $1");

const MONEY = (n) => `R$ ${(Number(n) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PLAN_LABEL = { anual: "Anual", semestral: "Semestral", mensal: "Mensal", unico: "Serviço único" };
const PAY_LABEL = { pix: "PIX", boleto: "Boleto faturado", cartao12x: "Cartão de crédito 12x" };

// Dados do cadastro que MUDAM o setup da integração (o resto do lead é ruído
// pro integrador). Só entra o que está preenchido.
export function factsOf(lead, { closerName = "" } = {}) {
  const f = [];
  const push = (label, value) => { if (value != null && String(value).trim() !== "") f.push(`${label}: ${value}`); };
  push("Contas de marketplace", range(lead.accounts));
  push("Anúncios na maior conta", range(lead.listings));
  if (!lead.listings) push("Anúncios novos por semana", range(lead.volume));
  push("Marketplaces onde vende", Array.isArray(lead.marketplaces) ? lead.marketplaces.join(", ") : lead.marketplaces);
  push("Faturamento", range(lead.revenue));
  push("Time de anúncios", range(lead.staff));
  push("Planeja expandir contas", lead.plan_expand);
  push("Nicho", lead.niche);
  if (Number(lead.amount) > 0) push("Valor fechado", MONEY(lead.amount));
  push("Plano fechado", PLAN_LABEL[lead.planClosed] || "");
  push("Forma de pagamento", PAY_LABEL[lead.paymentMethod] || "");
  push("Fechado por", closerName);
  push("Integração agendada para", lead.integrationAt);
  return f;
}

// Texto da timeline (plain, multiline, sem travessão — regra do Leo).
// O passo a passo da call NÃO entra aqui: ele já vive no roteiro da etapa
// (Passo a passo, no drawer). Repetir só faria o integrador ler duas vezes.
export function formatBriefText(b) {
  const lines = ["Briefing da integração (IA) · negócio FECHADO e pago, passagem do closer pro integrador", "", b.resumo];
  const entregas = b.entregas || b.vendido; // shape antigo do briefing (antes do enxugamento)
  if (entregas?.length) lines.push("", "Entregas acordadas:", ...entregas.map((v) => `• ${v}`));
  if (b.atencao?.length) {
    lines.push("", "Pontos de atenção:");
    for (const a of b.atencao) lines.push(`• ${typeof a === "string" ? a : `${a.ponto}: ${a.porque}`}`);
  }
  if (b.primeiraMensagem) lines.push("", `Primeira mensagem sugerida: "${b.primeiraMensagem}"`);
  return lines.join("\n");
}

export function makeIntegrationBriefer({ repo, google, anthropic, log = console }) {
  // Transcrição da call de VENDA (o Meet da venda, não o da integração). Mesmo
  // caminho do resumo de call: Meet API primeiro, Drive como fallback.
  async function salesTranscript(lead) {
    const code = (String(lead.callUrl || "").match(/meet\.google\.com\/([a-z0-9-]+)/i) || [])[1];
    if (!code) return null;
    let t = null;
    try { t = await google.fetchTranscript(code); } catch { /* cai no Drive */ }
    if (!t && typeof google.fetchTranscriptFromDrive === "function") {
      try {
        t = await google.fetchTranscriptFromDrive({ eventId: lead.meetEventId, leadName: lead.name, since: lead.meetScheduledAt });
      } catch (err) {
        log.warn?.({ lead: lead.id, err: err.message }, "briefing: transcrição da venda pelo Drive falhou");
      }
    }
    return t;
  }

  // Resumo estruturado que a IA já tirou da call de VENDA (fallback quando a
  // transcrição não vem: o Meet pode ter sido de outra conta, ou já expirou).
  async function priorCallSummary(leadId) {
    const acts = (await repo.list("activities"))
      .filter((a) => a.lead === leadId && a.meta?.event === "call_summary" && a.meta?.summary && (a.meta.kind || "call") === "call")
      .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
    return acts[0]?.meta?.summary || null;
  }

  // Gera (ou regenera com force) o briefing de UM lead. Devolve { ok, reason? }
  // com motivos estáveis pro drawer traduzir: not_configured, not_found,
  // already_done, no_source.
  async function briefLead(leadId, { force = false } = {}) {
    if (!anthropic.configured()) return { ok: false, reason: "not_configured" };
    const lead = await repo.get("leads", leadId);
    if (!lead) return { ok: false, reason: "not_found" };
    if (!force && lead.integrationBriefAt) return { ok: false, reason: "already_done" };

    const t = (await google.connected().catch(() => false)) ? await salesTranscript(lead) : null;
    const prior = t?.text ? null : await priorCallSummary(lead.id);
    if (!t?.text && !prior) return { ok: false, reason: "no_source" };

    const product = lead.saas ? await repo.get("products", lead.saas) : null;
    const closerName = lead.closer
      ? ((await repo.list("users").catch(() => [])).find((u) => u.id === lead.closer)?.name || lead.closer)
      : "";
    const brt = (d) => new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

    const { brief } = await anthropic.briefIntegration({
      transcript: t?.text || "",
      priorSummary: prior,
      lead: { name: lead.name, company: lead.company, niche: lead.niche },
      facts: factsOf(lead, { closerName }),
      productName: product?.name || "LeverAds",
      callDate: t?.startTime ? brt(t.startTime) : (lead.callAt ? brt(lead.callAt) : ""),
      today: brt(new Date()),
    });

    const source = t?.text ? "transcricao" : "resumo";
    await logActivity(repo, {
      saas: lead.saas || "",
      lead: lead.id,
      type: "system",
      text: formatBriefText(brief),
      meta: {
        event: "integration_brief",
        source, // "transcricao" = leu a call inteira · "resumo" = só o resumo estruturado
        recordingUrl: t?.recordingUrl || "",
        integrator: lead.integrator || "",
        brief,
      },
      author: "cockpit",
    });
    await repo.update("leads", lead.id, {
      integrationBriefFor: lead.meetEventId || "sem-call",
      integrationBriefAt: new Date().toISOString(),
    });
    return { ok: true, source, brief, recordingUrl: t?.recordingUrl || "" };
  }

  // Um passe: todo lead em estágio de integração (ou já ganho, se passou direto)
  // ainda sem briefing. Existe porque no momento do movimento a transcrição
  // quase nunca está pronta — aqui ele tenta de novo até conseguir, por até 14
  // dias (depois disso o onboarding já andou e o briefing perdeu a função).
  async function tick() {
    if (!anthropic.configured()) return { scanned: 0, briefed: 0 };
    const cutoff = Date.now() - 14 * 86_400_000;
    const products = new Map();
    const pending = [];
    for (const l of await repo.list("leads")) {
      if (l.integrationBriefAt) continue;
      if (!products.has(l.saas)) products.set(l.saas, l.saas ? await repo.get("products", l.saas) : null);
      const kind = kindOf(products.get(l.saas), l.stage);
      if (kind !== "integracao" && kind !== "posvenda" && kind !== "ganho") continue;
      const since = new Date(l.stageSince || l.createdAt || 0).getTime();
      if (Number.isFinite(since) && since < cutoff) continue;
      pending.push(l.id);
    }
    let done = 0;
    for (const id of pending) {
      try {
        const r = await briefLead(id);
        if (r.ok) { done++; log.info?.({ lead: id, source: r.source }, "briefing de integração gerado"); }
      } catch (err) {
        log.warn?.({ lead: id, err: err.message }, "briefing de integração falhou (re-tenta no próximo ciclo)");
      }
    }
    return { scanned: pending.length, briefed: done };
  }

  return { briefLead, tick };
}

// Poller de produção: mesmo padrão do startCallSummaries. Silencioso quando a
// IA não está configurada.
export function startIntegrationBriefs(repo, { google, anthropic, intervalMs = 600_000, log = console } = {}) {
  const worker = makeIntegrationBriefer({ repo, google, anthropic, log });
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await worker.tick(); }
    catch (err) { log.warn?.({ err: err.message }, "poller de briefings falhou"); }
    finally { running = false; }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  setTimeout(run, 25_000).unref?.(); // primeiro passe pouco depois do boot
  return { stop: () => clearInterval(timer), run };
}
