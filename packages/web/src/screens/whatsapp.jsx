import React from "react";
import { PageHead } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { WaBubbles, WaComposer, WaTemplateComposer, waWindowOpen } from "../components/wa-thread.jsx";
import { WaCallButton } from "../components/wa-call.jsx";
import { NextActionButton } from "../components/schedule-call.jsx";
import { waTemplatesFor } from "../lib/wa-templates.js";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import { waLink, leadTier } from "../lib/ui.js";
import { useIsMobile } from "../lib/responsive.js";
import { clientSummary, buildQueue, ACTION_LABELS } from "./today.jsx";
import { currentUser, usersByRole } from "../lib/users.js";
import { scriptChecklist } from "../lib/scripts.js";
import { moveGate, MoveLeadModal, applyGatedMove } from "../components/stage-move.jsx";

// Inbox de WhatsApp: um WhatsApp Web dentro do cockpit. Lista de conversas à
// esquerda (não-lidas primeiro na cara, ordenadas por recência) + conversa
// aberta à direita (histórico + responder + Ligar + abrir o lead). Tempo real
// pela mesma SSE do resto (version do useData). Escopo pelo produto ativo;
// número que respondeu sem ser lead ainda aparece igual (thread órfã).

function prettyPhone(d) {
  const s = String(d || "");
  const m = s.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : (s ? "+" + s : "");
}
function initials(name, phone) {
  const n = (name || "").trim();
  if (n) return n.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (String(phone).slice(-2) || "?");
}
function when(iso) {
  const d = new Date(iso || 0);
  if (!Number.isFinite(d.getTime())) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (days === 1) return "ontem";
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}

// Banner de saúde do WhatsApp (lê CONFIG.whatsapp.health do bootstrap, alimentado
// pelos webhooks de qualidade/status/conta). "danger" = segure os disparos;
// "warn" = fique de olho. Reusado pelo inbox e pela tela de Disparos.
export function WaHealthBanner({ style }) {
  const h = window.SEED?.CONFIG?.whatsapp?.health;
  if (!h || h.level === "ok" || !(h.messages || []).length) return null;
  const danger = h.level === "danger";
  return (
    <div style={{ margin: "12px var(--pad-x) 0", padding: "10px 14px", borderRadius: "var(--r-2)",
      border: "1px solid " + (danger ? "var(--neg)" : "var(--warn)"),
      background: danger ? "var(--neg-soft)" : "var(--warn-soft)", ...style }}>
      <div className="mono" style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4, color: danger ? "var(--neg)" : "var(--warn)" }}>
        {danger ? "⚠ Saúde do WhatsApp em risco" : "Saúde do WhatsApp · atenção"}
      </div>
      {(h.messages || []).map((m, i) => <div key={i} style={{ fontSize: 12.5, color: "var(--fg-1)", lineHeight: 1.4 }}>· {m}</div>)}
    </div>
  );
}

// Teto de conversas INICIADAS por dia (tier da Meta) em português.
const TIER_LABEL = {
  TIER_50: "50 conversas/dia", TIER_250: "250 conversas/dia", TIER_1K: "1 mil conversas/dia",
  TIER_10K: "10 mil conversas/dia", TIER_100K: "100 mil conversas/dia", TIER_UNLIMITED: "sem limite",
};
const QUALITY = {
  GREEN: { label: "alta", color: "var(--pos)" },
  YELLOW: { label: "média", color: "var(--warn)" },
  RED: { label: "baixa", color: "var(--neg)" },
};
// Tempo curto fica em minutos (é a escala da conversa); acima de 90 min vira
// hora, e acima de um dia vira dia — "1.480 min" ninguém lê.
function dur(min) {
  if (min == null) return "—";
  if (min < 90) return `${min} min`;
  const h = min / 60;
  if (h < 36) return `${(Math.round(h * 10) / 10).toString().replace(".", ",")} h`;
  return `${Math.round(h / 24)} d`;
}

// Faixa de contexto no topo do inbox: saúde do número (o que protege a conta)
// e os números que mudam a ação do dia — quem está esperando resposta, quanto
// a gente demora e quantas janelas de 24h ainda estão abertas.
function WaTopStats({ numInfo, stats }) {
  const q = QUALITY[String(numInfo?.quality || "").toUpperCase()];
  const tier = numInfo?.tier ? (TIER_LABEL[numInfo.tier] || String(numInfo.tier).replace("TIER_", "").toLowerCase()) : null;
  const waiting = stats?.awaiting || 0;
  const item = (label, value, tone) => (
    <div key={label} style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 96 }}>
      <span className="mono" style={{ fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-4)" }}>{label}</span>
      <span className="tnum" style={{ fontSize: 15, fontWeight: 600, color: tone || "var(--fg-1)", lineHeight: 1.2 }}>{value}</span>
    </div>
  );
  const sep = <div style={{ width: 1, alignSelf: "stretch", background: "var(--line-1)" }} />;

  return (
    <div style={{ margin: "12px var(--pad-x) 0", padding: "12px 16px", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
      {numInfo?.ok && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 150 }}>
            <span className="mono" style={{ fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-4)" }}>Número</span>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{numInfo.display || "—"}</span>
            {numInfo.name && <span style={{ fontSize: 11, color: "var(--fg-3)" }}>{numInfo.name}</span>}
          </div>
          {sep}
          {q && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 96 }}>
              <span className="mono" style={{ fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-4)" }}>Qualidade</span>
              <span style={{ fontSize: 15, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: q.color }} />{q.label}
              </span>
            </div>
          )}
          {tier && item("Limite de envio", tier)}
          {numInfo.throughput && item("Vazão", numInfo.throughput === "STANDARD" ? "padrão" : String(numInfo.throughput).toLowerCase())}
          {sep}
        </>
      )}

      {stats ? (
        <>
          {item(`Conversas · ${stats.days}d`, stats.activeThreads, null)}
          {/* O número que manda no dia: cliente falou e ninguém voltou. */}
          {item("Sem resposta", waiting ? `${waiting}${stats.oldestWaitHours != null ? ` · ${dur(Math.round(stats.oldestWaitHours * 60))}` : ""}` : "0", waiting ? "var(--neg)" : "var(--pos)")}
          {item("Resposta típica", dur(stats.medianReplyMinutes))}
          {/* Fora da janela de 24h a Meta só aceita template aprovado. */}
          {item("Janela aberta", stats.openWindow)}
          {item("Não lidas", stats.unread, stats.unread ? "var(--warn)" : null)}
          {item("Recebidas / enviadas", `${stats.inbound} / ${stats.outbound}`)}
          {stats.withoutLead > 0 && item("Sem lead", stats.withoutLead)}
          {/* Preencheu o form E disparou a mensagem do obrigado = lead mais
              quente. Mostra a taxa da janela. */}
          {stats.form && stats.form.formLeads > 0 && item(
            `Form → mandou o Whats · ${stats.days}d`,
            `${stats.form.formStarted}/${stats.form.formLeads} · ${Math.round((stats.form.formStarted / stats.form.formLeads) * 100)}%`,
            null,
          )}
          {/* Custo real do período (pricing_analytics da conta, cobrança por
              mensagem desde 01/07/2025). Serviço dentro da janela de 24h é
              grátis; o que pesa são os templates. Valores em centavos (fmt.money
              arredonda pra real inteiro e escondia o R$0,42), então formata com
              centavos aqui. */}
          {stats.costs && stats.costs.cost != null && item(
            `Custo · ${stats.days}d`,
            `${Number(stats.costs.cost).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}${stats.costs.messages ? ` · ${stats.costs.messages} msg` : ""}`,
          )}
        </>
      ) : (
        <span className="mono dim" style={{ fontSize: 11 }}>carregando números do inbox…</span>
      )}
    </div>
  );
}

export function WhatsappInboxScreen({ onOpenLead, initialThread, initialLead, initialDraft }) {
  const { version } = useData();
  const [product] = useActiveSaas();
  const isMobile = useIsMobile();
  const [threads, setThreads] = React.useState(null);
  const [sel, setSel] = React.useState(null); // thread.id (número)
  // Conversa aberta POR LEAD que ainda não tem thread (1º toque): o pane roda
  // com este registro sintético até a primeira mensagem criar a thread real.
  const [virtual, setVirtual] = React.useState(null);

  // Chegada pelo pop-up de lead quente: abre direto NA conversa do alerta.
  React.useEffect(() => {
    if (initialThread) setSel(String(initialThread));
  }, [initialThread]);

  // Abrir a conversa de um LEAD (atalho do Meu dia / mini-fila daqui): o
  // servidor resolve a grafia do número (nono dígito) pro id da thread REAL;
  // sem thread ainda, monta a conversa vazia — o composer decide sozinho
  // entre texto livre e template (janela de 24h).
  function openByLead(l) {
    const digits = String(l?.phone || "").replace(/\D/g, "");
    if (!digits) return;
    const asVirtual = (id) => setVirtual({ id, phone: id, name: l.name || "", leadId: l.id, saas: l.saas || "", virtual: true });
    api.waThread(digits)
      .then((r) => { const id = String(r.thread || digits); asVirtual(id); setSel(id); })
      .catch(() => { asVirtual(digits); setSel(digits); });
  }
  React.useEffect(() => {
    if (!initialLead) return;
    const l = (window.SEED?.LEADS || []).find((x) => x.id === initialLead);
    if (l) openByLead(l);
  }, [initialLead]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mensagem sugerida vinda do roteiro: entra ESCRITA na caixa (nunca envia
  // sozinha). Espera o composer montar — ele só existe com o histórico na mão
  // e a janela de 24h aberta; fechada, o roteiro segue com o "copiar".
  const pendingDraft = React.useRef("");
  React.useEffect(() => { if (initialDraft) pendingDraft.current = String(initialDraft); }, [initialDraft]);
  const [msgs, setMsgs] = React.useState([]);
  const [q, setQ] = React.useState("");
  // Filtro da lista: quem respondeu (lead falou por último) × sem resposta
  // (a gente falou por último e o lead ainda não voltou).
  const [answerFilter, setAnswerFilter] = React.useState("all"); // all | in | out
  // Card do cliente ao lado da conversa (desktop) — preferência lembrada.
  const [sideOpen, setSideOpen] = React.useState(() => { try { return localStorage.getItem("cockpit_wa_sidecard") !== "0"; } catch { return true; } });
  const toggleSide = () => setSideOpen((v) => { const n = !v; try { localStorage.setItem("cockpit_wa_sidecard", n ? "1" : "0"); } catch { /* ignore */ } return n; });
  const configured = !!window.SEED?.CONFIG?.whatsapp?.configured;

  // Número conectado, direto da Meta: confirma QUAL número está enviando. A
  // rota responde 200 sempre (com ok/reason no corpo) — ler os dados do número
  // exige whatsapp_business_management no token, permissão que o envio NÃO
  // precisa, então falhar aqui não quer dizer que o inbox está quebrado.
  const [numInfo, setNumInfo] = React.useState(null);
  React.useEffect(() => {
    if (!configured) return;
    let alive = true;
    // Número DO PRODUTO ativo: cada SaaS conversa pelo seu WhatsApp
    // (product.waPhoneId; Ajustes → Integrações).
    api.waNumber(product?.id)
      .then((n) => alive && setNumInfo(n))
      .catch((e) => alive && setNumInfo({ ok: false, reason: "meta_error", error: String(e.message || e).slice(0, 200) }));
    return () => { alive = false; };
  }, [configured, product?.id]);

  // Números do inbox + saúde do número: refazem junto com o tempo real, então
  // "sem resposta" e "janela aberta" acompanham a mensagem que acabou de entrar.
  const [stats, setStats] = React.useState(null);
  React.useEffect(() => {
    if (!configured) return;
    let alive = true;
    api.waInsights().then((s) => alive && setStats(s)).catch(() => { /* faixa some, inbox segue */ });
    return () => { alive = false; };
  }, [configured, version]);

  // Lista de conversas (refetch em tempo real). Escopo: produto ativo + órfãs.
  React.useEffect(() => {
    let alive = true;
    api.waThreads()
      // Escopo do inbox: conversas do produto ativo; órfã (sem saas) só aparece
      // se corre pelo número deste produto (waPhoneId) ou não tem número marcado.
      .then((r) => alive && setThreads((r.threads || []).filter((t) => {
        if (!product?.id) return true;
        if (t.saas) return t.saas === product.id;
        if (t.waPhoneId && product.waPhoneId) return t.waPhoneId === product.waPhoneId;
        return true;
      })))
      .catch(() => alive && setThreads([]));
    return () => { alive = false; };
  }, [product?.id, version]);

  // Mensagens da conversa aberta (refetch em tempo real). `msgsReady` evita o
  // composer decidir janela aberta/fechada antes do histórico chegar.
  const [msgsReady, setMsgsReady] = React.useState(false);
  // O atalho "Agendar call" escreve o rascunho de confirmação na caixa por aqui.
  const composerApi = React.useRef(null);
  // Reset SÓ na troca de conversa: tick do SSE não pode desmontar o composer
  // (perderia o rascunho digitado).
  React.useEffect(() => { setMsgsReady(false); }, [sel]);
  React.useEffect(() => {
    if (!sel) { setMsgs([]); return; }
    let alive = true;
    api.waThread(sel)
      .then((r) => { if (!alive) return; setMsgs(r.messages || []); setMsgsReady(true); })
      .catch(() => { if (!alive) return; setMsgs([]); setMsgsReady(true); });
    return () => { alive = false; };
  }, [sel, version]);

  // Rascunho do roteiro entra na caixa assim que ela existir (o composer monta
  // depois do histórico). Uma vez só: o que a pessoa editar não é sobrescrito.
  React.useEffect(() => {
    if (!pendingDraft.current || !msgsReady || !sel) return;
    const t = setTimeout(() => {
      if (composerApi.current?.insert) { composerApi.current.insert(pendingDraft.current); pendingDraft.current = ""; }
    }, 80);
    return () => clearTimeout(t);
  }, [msgsReady, sel, initialDraft]);

  // Auto-seleciona a primeira conversa; marca como lida ao abrir.
  const list = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = threads || [];
    const byQ = s ? base.filter((t) => (t.name || "").toLowerCase().includes(s) || String(t.phone).includes(s.replace(/\D/g, ""))) : base;
    // Encerradas ficam fora da lista viva (todas/respondidas/sem resposta) e
    // têm o próprio filtro — mensagem nova do lead reabre e ela volta sozinha.
    const open = byQ.filter((t) => (t.status || "open") !== "closed");
    if (answerFilter === "closed") return byQ.filter((t) => t.status === "closed");
    if (answerFilter === "in") return open.filter((t) => t.lastDir === "in");
    if (answerFilter === "out") return open.filter((t) => t.lastDir === "out");
    return open;
  }, [threads, q, answerFilter]);
  const answerCounts = React.useMemo(() => {
    const base = threads || [];
    const open = base.filter((t) => (t.status || "open") !== "closed");
    return {
      in: open.filter((t) => t.lastDir === "in").length,
      out: open.filter((t) => t.lastDir === "out").length,
      closed: base.length - open.length,
    };
  }, [threads]);

  // No mobile a lista é a tela inicial: não auto-abre conversa (abrir = navegar).
  React.useEffect(() => {
    if (!isMobile && !sel && list.length) setSel(list[0].id);
  }, [list, sel, isMobile]);

  const current = (threads || []).find((t) => t.id === sel) || (virtual && virtual.id === sel ? virtual : null) || null;

  // Modelos do fluxo de qualificação já preenchidos com o lead da conversa
  // aberta. Conversa sem lead ainda aproveita o nome do contato; o resto vira
  // [lembrete] no texto pro SDR completar antes de mandar.
  const templates = React.useMemo(() => {
    const rec = current?.leadId ? (window.SEED?.LEADS || []).find((l) => l.id === current.leadId) : null;
    const lead = rec || (current ? { name: current.name || "", phone: current.phone, saas: current.saas } : null);
    const saasCfg = (window.SEED?.SAAS || []).find((s) => s.id === (lead?.saas || product?.id));
    return waTemplatesFor(lead, saasCfg);
  }, [current?.id, current?.leadId, product?.id, version]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (sel && current?.unread) api.waThreadRead(sel).catch(() => {});
  }, [sel, current?.unread]);

  const totalUnread = (threads || []).reduce((a, t) => a + (t.unread || 0), 0);

  function openLead() {
    const rec = current?.leadId && (window.SEED?.LEADS || []).find((l) => l.id === current.leadId);
    if (rec && onOpenLead) onOpenLead(rec);
  }

  // Encerrar/reabrir a conversa (status do inbox, separado da etapa do card).
  // Otimista: some da lista viva na hora; o servidor confirma e o SSE alinha.
  function toggleClosed() {
    if (!current) return;
    const closed = (current.status || "open") !== "closed";
    setThreads((prev) => (prev || []).map((t) => (t.id === current.id ? { ...t, status: closed ? "closed" : "open" } : t)));
    api.waThreadClose(current.id, closed).catch(() => {});
  }

  // Vincular conversa órfã a um lead. Otimista como o encerrar: o SSE traz o
  // estado real logo em seguida (a rota também carimba as mensagens já gravadas).
  function linkLead(leadId) {
    if (!current) return;
    setThreads((prev) => (prev || []).map((t) => (t.id === current.id ? { ...t, leadId } : t)));
  }

  // Pedido manual de permissão de ligação (prospecção ativa / conversa antiga).
  // O refetch das mensagens vem no tick do SSE; o erro da Meta chega legível.
  function askToCall() {
    if (!current) return;
    api.waCallPermission(current.id, current.saas || product?.id)
      .then(() => api.waThread(current.id).then((r) => setMsgs(r.messages || [])))
      .catch((e) => window.alert(e.message || "não deu pra pedir a permissão"));
  }

  const box = { border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)" };

  const unreadLabel = totalUnread ? `${totalUnread} não lida${totalUnread > 1 ? "s" : ""}` : "conversas com os leads";
  const sub = !configured ? "não configurado no servidor"
    : numInfo?.ok && numInfo.display ? `enviando por ${numInfo.display}${numInfo.name ? ` · ${numInfo.name}` : ""} · ${unreadLabel}`
    : unreadLabel;

  const [newTpl, setNewTpl] = React.useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <PageHead title="WhatsApp" sub={sub}>
        <button onClick={() => setNewTpl(true)} title="cria um template aprovado da Meta (reabre conversa fora das 24h)"
          style={{ height: 32, padding: "0 13px", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", background: "var(--bg-1)", boxShadow: "var(--shadow-1)", color: "var(--fg-2)", fontSize: 12.5, fontWeight: 600 }}>
          Criar template
        </button>
      </PageHead>
      {newTpl && <WaTemplateCreator onClose={() => setNewTpl(false)} />}

      <WaHealthBanner />

      {/* A fila do dia mora no topo, acima das métricas: é o "o que fazer
          agora" do inbox — clique e a conversa do lead abre embaixo. */}
      {configured && <MyQueueStrip product={product} version={version} currentLeadId={current?.leadId || null} onPick={openByLead} />}

      {configured && <WaTopStats numInfo={numInfo} stats={stats} />}

      {configured && numInfo && numInfo.ok === false && (
        <div style={{ margin: "12px var(--pad-x) 0", padding: "10px 14px", border: "1px dashed var(--line-2)", borderRadius: "var(--r-2)", fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.5 }}>
          {numInfo.reason === "no_number_for_saas" ? (
            <>Este produto ainda <b>não tem um número de WhatsApp próprio</b>. As conversas não saem pelo número de outro produto: defina o <b>phone number id</b> de {product?.name || "este SaaS"} em <b>Ajustes → Integrações</b> (WhatsApp Manager → API Setup mostra o id do número).</>
          ) : numInfo.reason === "no_read_permission" ? (
            <>Não deu pra confirmar qual número está conectado: o token não tem a permissão <b>whatsapp_business_management</b> (leitura dos dados do número). <b>Isso não bloqueia o envio</b>, que usa outra permissão. Pra ver o número aqui, adicione essa permissão ao token no Meta Business.</>
          ) : numInfo.reason === "wrong_id" ? (
            <>
              O <b>WHATSAPP_PHONE_NUMBER_ID</b> do servidor não é o id de um número, então nada entra nem sai por aqui.
              {numInfo.numbers?.length > 0 ? (
                <> É o id da <b>conta</b> do WhatsApp. Troque a variável no EasyPanel por um destes e reinicie a API:
                  <span style={{ display: "flex", flexDirection: "column", gap: 4, margin: "8px 0 0" }}>
                    {numInfo.numbers.map((n) => (
                      <button key={n.id} className="mono" title="copiar o id do número"
                        onClick={() => { try { navigator.clipboard.writeText(n.id); } catch { window.prompt("Phone number ID:", n.id); } }}
                        style={{ alignSelf: "flex-start", padding: "4px 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", fontSize: 11.5, cursor: "pointer" }}>
                        {n.id}{n.display ? ` · ${n.display}` : ""}{n.name ? ` · ${n.name}` : ""} ⧉
                      </button>
                    ))}
                  </span>
                </>
              ) : numInfo.webhook?.phoneNumberId ? (
                <> As mensagens que a Meta entrega aqui vêm do id <span className="mono">{numInfo.webhook.phoneNumberId}</span>
                  {numInfo.webhook.display ? ` (${numInfo.webhook.display})` : ""} — é esse que a variável precisa ter.</>
              ) : (
                <> Pegue o <b>Phone number ID</b> em WhatsApp Manager → API Setup (é o id do NÚMERO, não o da conta) e ponha na variável.</>
              )}
            </>
          ) : (
            <>Não deu pra confirmar o número conectado. A Meta respondeu: <span className="mono">{numInfo.error || "erro desconhecido"}</span></>
          )}
        </div>
      )}

      {!configured && (
        <div style={{ margin: "12px var(--pad-x) 0", padding: "10px 14px", border: "1px dashed var(--line-2)", borderRadius: "var(--r-2)", fontSize: 12.5, color: "var(--fg-2)" }}>
          O WhatsApp (Cloud API) ainda não está configurado no servidor. Assim que o número dedicado e o token estiverem no ar, as conversas aparecem aqui. Enquanto isso, o botão “Ligar” abre a conversa no app.
        </div>
      )}

      {/* Mobile = painel único (WhatsApp de celular): lista OU conversa, com
          "‹ conversas" no cabeçalho pra voltar. Desktop segue lado a lado. */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 16, padding: "16px var(--pad-x) 56px" }}>
        {/* Lista de conversas */}
        {(!isMobile || !current) && (
        <div style={{ ...box, width: isMobile ? "100%" : 340, flexShrink: isMobile ? 1 : 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ padding: 10, borderBottom: "1px solid var(--line-1)", display: "flex", flexDirection: "column", gap: 8 }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="buscar por nome ou número"
              style={{ width: "100%", padding: "8px 10px", background: "var(--bg-2)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 12.5 }} />
            {/* Respondidas = o lead falou por último; sem resposta = a última é
                nossa e o lead ainda não voltou (a fila do re-toque). */}
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {[["all", "todas", null], ["in", "respondidas", answerCounts.in], ["out", "sem resposta", answerCounts.out], ["closed", "encerradas", answerCounts.closed]].map(([id, label, n]) => {
                const on = answerFilter === id;
                return (
                  <button key={id} onClick={() => setAnswerFilter(id)}
                    title={id === "in" ? "o lead falou por último" : id === "out" ? "a gente falou por último, esperando o lead" : "todas as conversas"}
                    style={{ height: 26, padding: "0 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 600, cursor: "pointer",
                      background: on ? "var(--accent-soft)" : "transparent", color: on ? "var(--accent)" : "var(--fg-3)",
                      border: "1px solid " + (on ? "var(--accent-line)" : "var(--line-2)") }}>
                    {label}{n != null ? <span className="tnum" style={{ marginLeft: 5, opacity: 0.75 }}>{n}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
            {threads === null ? (
              <div className="mono dim" style={{ fontSize: 11.5, padding: 16 }}>carregando…</div>
            ) : list.length === 0 ? (
              <div style={{ padding: 20 }}><EmptyState title="Nenhuma conversa" hint={configured ? "quando um lead responder, a conversa aparece aqui" : "configure o WhatsApp pra começar"} /></div>
            ) : list.map((t) => {
              const on = t.id === sel;
              return (
                <button key={t.id} onClick={() => setSel(t.id)} style={{
                  width: "100%", textAlign: "left", display: "flex", gap: 10, alignItems: "center", padding: "10px 12px",
                  border: "none", borderBottom: "1px solid var(--line-1)", cursor: "pointer",
                  background: on ? "var(--accent-soft)" : "transparent",
                }}>
                  <span style={{ width: 36, height: 36, borderRadius: "50%", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--bg-3)", border: "1px solid var(--line-2)", fontSize: 12, fontWeight: 700, color: "var(--fg-2)" }}>
                    {initials(t.name, t.phone)}
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>
                        {t.name || prettyPhone(t.phone)}
                      </span>
                      <span className="mono" style={{ fontSize: 10, color: "var(--fg-4)", flexShrink: 0 }}>{when(t.lastAt)}</span>
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                      <span className="dim" style={{ fontSize: 11.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>
                        {t.lastDir === "out" ? "→ " : ""}{t.lastText || "—"}
                      </span>
                      {t.unread > 0 && (
                        <span style={{ flexShrink: 0, minWidth: 18, height: 18, padding: "0 5px", borderRadius: 999, background: "#25D366", color: "#06120c", fontSize: 10.5, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{t.unread}</span>
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        )}

        {/* Conversa aberta */}
        {(!isMobile || current) && (
        <div style={{ ...box, flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {!current ? (
            <div style={{ margin: "auto", padding: 24 }}>
              <EmptyState title="Escolha uma conversa" hint="selecione um contato à esquerda pra ver e responder" />
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: "1px solid var(--line-1)", flexWrap: "wrap" }}>
                {isMobile && (
                  <button onClick={() => setSel(null)} aria-label="Voltar pra lista de conversas"
                    style={{ ...pill, padding: "0 9px", fontSize: 14 }}>‹</button>
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {current.name || prettyPhone(current.phone)}
                  </div>
                  <div className="mono dim" style={{ fontSize: 11 }}>
                    {prettyPhone(current.phone)}{current.stage ? ` · ${current.stage}` : ""}
                  </div>
                </div>
                {/* Status da conversa: encerrada sai da lista viva (lead
                    desqualificado encerra sozinho; mensagem nova reabre). */}
                {(current.status || "open") === "closed" && (
                  <span style={{ ...flowChip, background: "var(--warn-soft)", color: "var(--warn)", border: "1px solid var(--warn-line)" }}>encerrada</span>
                )}
                {!current.virtual && (
                  <button onClick={toggleClosed} style={pill}
                    title={(current.status || "open") === "closed" ? "volta pra lista viva do inbox" : "tira da lista viva (não mexe na etapa do card); mensagem nova do lead reabre sozinha"}>
                    {(current.status || "open") === "closed" ? "reabrir" : "encerrar"}
                  </button>
                )}
                {/* Fluxo de permissão de ligação: estado na conversa + pedido manual. */}
                {current.callFlow?.permission === "accepted" && (
                  <span title="o lead aceitou o pedido nativo de ligação" style={{ ...flowChip, background: "var(--pos)", color: "#fff" }}>✆ pode ligar</span>
                )}
                {current.callFlow?.permission === "pending" && (
                  <button onClick={askToCall}
                    title="pedido enviado, sem resposta ainda — clique pra pedir de novo (a Meta aceita 1 pedido a cada 24h; fora da janela ela recusa e o erro aparece)"
                    style={{ ...flowChip, border: "1px solid var(--line-2)", color: "var(--fg-3)", background: "var(--bg-1)", cursor: "pointer" }}>✆ permissão pedida · pedir de novo</button>
                )}
                {current.callFlow?.permission === "declined" && (
                  <span title="o lead prefere não receber ligação" style={{ ...flowChip, border: "1px solid var(--line-2)", color: "var(--warn)" }}>sem ligação</span>
                )}
                {configured && (!current.callFlow || current.callFlow.permission === "not_requested") && (
                  <button onClick={askToCall} style={pill} title="manda o pedido nativo de permissão de ligação com a saudação do fluxo (dentro da janela de 24h)">✆ Pedir pra ligar</button>
                )}
                {current.leadId ? (
                  <>
                    {/* A conversa andou? O card anda junto: destinos da etapa
                        atual (agendar call, fechar, perda…), tudo refletindo no
                        pipeline/fila na hora. */}
                    <NextActionButton thread={current} onScheduled={(draft) => composerApi.current?.insert?.(draft)} />
                    {!isMobile && (
                      <button onClick={toggleSide} style={{ ...pill, ...(sideOpen ? { background: "var(--accent-soft)", color: "var(--accent)", borderColor: "var(--accent-line)" } : {}) }}
                        title={sideOpen ? "Esconder o card do cliente" : "Mostrar o card do cliente ao lado da conversa"}>▤ card</button>
                    )}
                    <button onClick={openLead} style={pill}>Abrir lead ↗</button>
                  </>
                ) : (
                  <LinkLeadButton thread={current} onLinked={linkLead} />
                )}
                {/* "Ligar" tem DOIS botões bem diferentes, pra não parecer que
                    "não faz a ligação":
                     • permissão ACEITA (+ configurado) → verde sólido que DISCA
                       daqui do cockpit (WebRTC), o único que liga de verdade.
                     • sem permissão → botão de CONTORNO "no app ↗" (abre o
                       WhatsApp), visualmente distinto pra deixar claro que NÃO
                       é a discagem — pra ligar daqui, peça a permissão primeiro
                       (o botão "Pedir pra ligar" já está no header). */}
                {configured && current.callFlow?.permission === "accepted" ? (
                  <WaCallButton threadId={current.id} contactName={current.name || prettyPhone(current.phone)} />
                ) : !configured ? (
                  // WhatsApp não configurado no servidor: o app é o único caminho.
                  waLink(current.phone) && (
                    <a href={waLink(current.phone)} target="_blank" rel="noopener noreferrer"
                      title="Ligar / abrir no app"
                      style={{ ...pill, background: "#25D366", color: "#06120c", border: "none", fontWeight: 700, textDecoration: "none" }}>✆ Ligar</a>
                  )
                ) : (
                  waLink(current.phone) && (
                    <a href={waLink(current.phone)} target="_blank" rel="noopener noreferrer"
                      title="Abre a conversa no WhatsApp pra ligar POR LÁ. Pra discar daqui do cockpit, use o ‘Pedir pra ligar’ e espere o lead aceitar."
                      style={{ ...pill, textDecoration: "none" }}>✆ Ligar no app ↗</a>
                  )
                )}
              </div>

              <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "6px 12px" }}>
                <WaBubbles messages={msgs} emptyHint={configured ? "manda a primeira mensagem abaixo" : "nenhuma mensagem"} />
              </div>

              <div style={{ padding: 12, borderTop: "1px solid var(--line-1)" }}>
                {configured ? (
                  !msgsReady ? (
                    <div className="mono dim" style={{ fontSize: 11 }}>…</div>
                  ) : waWindowOpen(msgs) ? (
                    <>
                      <WaComposer templates={templates} apiRef={composerApi}
                        onSend={(t) => api.waThreadSend(current.id, t).then(() => api.waThread(current.id).then((r) => setMsgs(r.messages || [])))}
                        onSendMedia={(blob, opts) => api.waSendMedia(current.id, blob, opts).then(() => api.waThread(current.id).then((r) => setMsgs(r.messages || [])))} />
                      <div className="mono dim" style={{ fontSize: 9.5, marginTop: 5 }}>fora de 24h desde a última resposta do cliente, a Meta exige um template aprovado</div>
                    </>
                  ) : (
                    // Janela de 24h fechada: texto livre seria recusado (131047) —
                    // troca pro composer de template aprovado.
                    <WaTemplateComposer threadId={current.id} contactName={current.name || ""}
                      onSent={() => api.waThread(current.id).then((r) => setMsgs(r.messages || []))} />
                  )
                ) : (
                  <div className="mono dim" style={{ fontSize: 11, padding: "8px 10px", border: "1px dashed var(--line-2)", borderRadius: "var(--r-2)" }}>
                    envio indisponível até o WhatsApp ser configurado no servidor
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        )}

        {/* Card do cliente sempre à vista enquanto conversa (desktop): o resumo
            de qualificação do roteiro, a call marcada e o atalho pro drawer. */}
        {!isMobile && current?.leadId && sideOpen && (
          <LeadSideCard leadId={current.leadId} version={version} onOpenLead={openLead}
            leadStarted={msgsReady && msgs.length ? msgs[0].direction === "in" : null} />
        )}
      </div>
    </div>
  );
}

// Mini "Minhas atividades": as 3 próximas pendências de HOJE do usuário logado
// (mesma fila e ordem do Meu dia), no topo do inbox, acima das métricas — o
// SDR emenda um atendimento no outro sem sair da tela. Clique abre a conversa
// do lead, com ou sem thread ainda.
// Conversa órfã: quem escreveu de um número diferente do que digitou no form,
// ou chegou no WhatsApp sem passar por ele. Sem vínculo o SDR fica sem contexto
// e o fluxo automático não roda, então "sem lead" deixa de ser um rótulo morto e
// vira a ação de amarrar. O casamento automático já resolve o caso claro; isto
// cobre o resto (e desfaz, se amarrar errado).
function LinkLeadButton({ thread, onLinked }) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [saving, setSaving] = React.useState("");
  const leads = window.SEED?.LEADS || [];
  const hits = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return leads
      .filter((l) => `${l.name || ""} ${l.company || ""} ${l.phone || ""}`.toLowerCase().includes(s))
      .slice(0, 6);
  }, [q, leads]);

  async function link(lead) {
    setSaving(lead.id);
    try {
      await api.waLinkThread(thread.id, lead.id);
      setOpen(false); setQ("");
      onLinked?.(lead.id);
    } catch (e) { window.alert(e.message || "não deu pra vincular"); }
    finally { setSaving(""); }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ ...pill, borderStyle: "dashed" }}
        title="Esta conversa não está ligada a nenhum lead — o fluxo automático não roda e o card não aparece aqui">
        sem lead · vincular
      </button>
    );
  }
  return (
    <div style={{ position: "relative" }}>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); setQ(""); } }}
        placeholder="buscar lead por nome, empresa ou telefone"
        style={{ height: 28, width: 260, padding: "0 9px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12 }} />
      {!!hits.length && (
        <div style={{ position: "absolute", top: 32, right: 0, zIndex: 20, width: 300, background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", boxShadow: "var(--shadow-2)", overflow: "hidden" }}>
          {hits.map((l) => (
            <button key={l.id} onClick={() => link(l)} disabled={!!saving}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 10px", fontSize: 12.5, borderBottom: "1px solid var(--line-faint)" }}>
              <span style={{ fontWeight: 600 }}>{l.name || l.id}</span>
              {l.company && <span className="dim"> · {l.company}</span>}
              <span className="mono dim" style={{ display: "block", fontSize: 10.5 }}>{prettyPhone(l.phone) || "sem telefone"} · {l.stage || "novo"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MyQueueStrip({ product, version, currentLeadId, onPick }) {
  const me = currentUser()?.id || "";
  // Onde a pessoa parou NESTA sessão: a lista é longa (a fila do SDR passa de
  // 100) e o item só sai dela quando o toque é registrado, então sem esta
  // marca não dá pra saber quem já foi atendido.
  const [opened, setOpened] = React.useState(() => new Set());
  const items = React.useMemo(() => {
    if (!me) return [];
    try {
      const saasCfg = (window.SEED?.SAAS || []).find((s) => s.id === product?.id) || product;
      const leads = window.SEED?.LEADS || [];
      // Critério: o que se resolve POR MENSAGEM. Entra tudo da fila da pessoa
      // (1º contato, tentativa, retomada, no-show, reativação, follow-up) mais
      // a confirmação de call, que é mensagem também. Fica de fora só a call/
      // integração em si — essas se atendem no Meet, não aqui.
      // (Filtrar por fase `sdr` esvaziava a faixa pra closer e CS: os cards
      // deles vêm por `closer`/`integrator`, nunca por `owner`.)
      const byMsg = (i) => !i.done && (i.confirm || (i.kind !== "call" && i.kind !== "integracao"));
      const mine = buildQueue(leads, saasCfg, me).hoje.filter(byMsg).map((i) => ({ ...i, pool: false }));
      // A fila do SDR vem logo abaixo da minha: o inbox é onde ela se resolve,
      // uma conversa atrás da outra, sem trocar de tela.
      const pool = usersByRole("sdr").filter((u) => u.id !== me)
        .flatMap((u) => buildQueue(leads, saasCfg, u.id).hoje.filter(byMsg).map((i) => ({ ...i, pool: true })));
      const seen = new Set();
      return [...mine, ...pool].filter((i) => {
        const k = i.confirmWindow ? `${i.l.id}-${i.confirmWindow}` : i.l.id;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    } catch { return []; }
  }, [me, product?.id, version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!items.length) return null;
  const mineCount = items.filter((i) => !i.pool).length;
  const poolStart = items.findIndex((i) => i.pool);
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const timeOf = (i) => !i.due ? "agora"
    : i.due.t < startToday.getTime() ? "atrasado"
    : new Date(i.due.t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const labelOf = (i) => i.confirm ? "confirmar call"
    : i.group === "noshow" ? "remarcar" : i.group === "nutri" ? "reativação" : (ACTION_LABELS[i.kind] || "contato");
  return (
    <div style={{ margin: "12px var(--pad-x) 0", padding: "8px 14px 7px", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "0 4px 3px" }}>
        <span className="mono" style={{ fontSize: 9.5, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--fg-4)" }}>
          Fila de hoje{mineCount ? ` · ${mineCount} minha${mineCount > 1 ? "s" : ""}` : ""}
        </span>
        <span className="mono tnum" style={{ fontSize: 9.5, color: "var(--fg-4)" }}>{items.length} no total</span>
        <span style={{ flex: 1 }} />
        {opened.size > 0 && (
          <button onClick={() => setOpened(new Set())} title="limpa as marcas de quem você já abriu nesta sessão"
            className="mono" style={{ fontSize: 10, color: "var(--fg-4)", background: "none", border: "none", cursor: "pointer", padding: 0, marginRight: 10 }}>
            {opened.size} atendido{opened.size > 1 ? "s" : ""} · limpar
          </button>
        )}
        <a href="#today" style={{ fontSize: 11, color: "var(--fg-3)", textDecoration: "none" }}>ver a fila →</a>
      </div>
      {/* Lista rolável: a fila do SDR é longa e a faixa não pode comer a tela. */}
      <div style={{ maxHeight: 132, overflowY: "auto" }}>
        {items.map((i, idx) => {
          const on = !!currentLeadId && i.l.id === currentLeadId;
          const late = i.due && i.due.t < startToday.getTime();
          const hasPhone = !!String(i.l.phone || "").replace(/\D/g, "");
          const done = opened.has(i.l.id);
          const row = (
            <button key={i.confirmWindow ? `${i.l.id}-${i.confirmWindow}` : i.l.id}
              onClick={() => { if (!hasPhone) return; setOpened((s) => new Set(s).add(i.l.id)); onPick(i.l); }}
              title={hasPhone ? "Abrir a conversa deste lead" : "lead sem telefone"} disabled={!hasPhone}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "4px", border: "none", borderRadius: "var(--r-1)",
                background: on ? "var(--accent-soft)" : "transparent", cursor: hasPhone ? "pointer" : "default", textAlign: "left", opacity: !hasPhone ? 0.55 : done && !on ? 0.5 : 1 }}>
              <span className="mono tnum" style={{ fontSize: 10.5, width: 56, flexShrink: 0, color: late ? "var(--neg)" : "var(--fg-4)" }}>{timeOf(i)}</span>
              <span style={{ fontSize: 10.5, lineHeight: "17px", padding: "0 7px", borderRadius: "var(--r-1)", background: "var(--bg-2)", color: "var(--fg-3)", flexShrink: 0, whiteSpace: "nowrap" }}>{labelOf(i)}</span>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: on ? "var(--accent)" : "var(--fg-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i.l.name}</span>
              {i.l.company && <span style={{ fontSize: 11.5, color: "var(--fg-4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flexShrink: 3 }}>{i.l.company}</span>}
              <span style={{ flex: 1 }} />
              <span className="mono" style={{ fontSize: 10, color: done ? "var(--pos)" : "var(--fg-4)", flexShrink: 0 }}>{done ? "✓ aberto" : "abrir →"}</span>
            </button>
          );
          // Divisória entre a minha fila e o pool do SDR.
          if (idx === poolStart && poolStart > 0) {
            return (
              <React.Fragment key={`sep-${i.l.id}`}>
                <div className="mono" style={{ fontSize: 9, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--fg-4)", padding: "6px 4px 2px", borderTop: "1px solid var(--line-faint)", marginTop: 4 }}>
                  Fila do SDR · {items.length - poolStart}
                </div>
                {row}
              </React.Fragment>
            );
          }
          return row;
        })}
      </div>
    </div>
  );
}

// Card lateral do cliente: as perguntas de qualificação EDITÁVEIS (preenche
// conforme o lead responde no chat, mesmo checklist do roteiro) + o resumo
// compilado (clientSummary), vivos via SSE. Lead apagado só some.
function LeadSideCard({ leadId, version, onOpenLead, leadStarted = null }) {
  // Edição otimista: o valor digitado vale na hora; o tick do SSE traz o SEED
  // atualizado e zera a camada local (aí o dado já é o do servidor).
  const [edits, setEdits] = React.useState({});
  // Depois de mover o card (ex.: desqualificar), recarrega o SEED na hora pra a
  // fila do inbox (Minhas atividades) largar o lead sem esperar o tick da SSE.
  const { refresh } = useData();
  // Mover de etapa com gate (ganho/perdido/handoff pedem input) — mesmo modal
  // do pipeline; o PATCH passa pelo applyStageMove do servidor, então Minhas
  // atividades/Pipeline/Agenda refletem sozinhos via SSE.
  const [pendingMove, setPendingMove] = React.useState(null);
  React.useEffect(() => { setEdits({}); }, [version, leadId]);
  const base = (window.SEED?.LEADS || []).find((l) => l.id === leadId) || null;
  if (!base) return null;
  const lead = { ...base, ...edits };
  const saasCfg = (window.SEED?.SAAS || []).find((s) => s.id === lead.saas) || null;
  const patch = (p) => {
    setEdits((prev) => ({ ...prev, ...p }));
    api.update("leads", base.id, p).catch((err) => console.warn("lead não salvo:", err.message));
  };
  const checklist = scriptChecklist(saasCfg, lead);
  const { pain, facts, attribution } = clientSummary(saasCfg, lead, lead.stage || saasCfg?.funnel?.[0]?.stage || "", null);
  const tier = leadTier(lead);
  const fmtDT = (iso) => {
    const d = new Date(iso);
    return Number.isFinite(d.getTime())
      ? `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
      : "";
  };
  const kicker = { fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "var(--mono)" };
  return (
    <div style={{ width: 300, flexShrink: 0, border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line-1)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 14, fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead.name}</span>
          {tier.grade && (
            <span className="tnum" style={{ width: 18, height: 18, borderRadius: 5, display: "inline-flex", alignItems: "center", justifyContent: "center", background: tier.tone, color: tier.badgeFg, fontFamily: "var(--display)", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{tier.grade}</span>
          )}
        </div>
        {lead.company && <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead.company}</div>}
        <div style={{ marginTop: 7, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {/* Etapa EDITÁVEL: mover daqui vale como mover no pipeline (mesmos
              gates de ganho/perda/handoff; o servidor agenda o GPS e o resto). */}
          <select value={lead.stage || ""} title="Mover o card de etapa (mesmo efeito do pipeline)"
            onChange={(e) => {
              const toStage = e.target.value;
              if (!toStage || toStage === base.stage) return;
              const gate = moveGate(saasCfg, base, toStage);
              if (gate) { setPendingMove({ toStage, gate }); return; }
              patch({ stage: toStage });
            }}
            style={{ maxWidth: 170, height: 24, padding: "0 6px", borderRadius: "var(--r-1)", border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg-2)", fontSize: 11.5, fontWeight: 600 }}>
            {!lead.stage && <option value="">sem etapa</option>}
            {(saasCfg?.funnel || []).map((f) => <option key={f.stage} value={f.stage}>{f.stage}</option>)}
            {lead.stage && !(saasCfg?.funnel || []).some((f) => f.stage === lead.stage) && <option value={lead.stage}>{lead.stage}</option>}
          </select>
          {lead.callAt && <span className="chip accent" title="call marcada">▦ {fmtDT(lead.callAt)}</span>}
          {/* Quem começou a conversa: lead que preencheu o form E disparou a
              mensagem é mais quente do que o que só recebeu nosso template. */}
          {leadStarted === true && <span className="chip pos" title="preencheu o form e MANDOU a mensagem do WhatsApp — mais interessado">ele iniciou</span>}
          {leadStarted === false && <span className="chip" title="conversa aberta por nós (template/prospecção)">nós iniciamos</span>}
        </div>
      </div>

      {pendingMove && (
        <MoveLeadModal
          lead={base}
          toStage={pendingMove.toStage}
          gate={pendingMove.gate}
          saasCfg={saasCfg}
          onCancel={() => setPendingMove(null)}
          onConfirm={(mp, extra) => {
            setEdits((prev) => ({ ...prev, ...mp }));
            applyGatedMove(mp, extra, base.id).then(refresh).catch((err) => console.warn("movimento não persistido:", err.message));
            setPendingMove(null);
          }}
        />
      )}

      <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
        {pain && (
          <div style={{ padding: "6px 9px", borderRadius: "var(--r-2)", background: "var(--accent-soft)", border: "1px solid var(--accent-line)" }}>
            <span className="mono" style={{ ...kicker, color: "var(--accent)" }}>dor do anúncio</span>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 2 }}>[{pain.code}] {pain.label}</div>
          </div>
        )}

        {/* Qualificação EDITÁVEL (mesmo checklist do roteiro): o lead respondeu
            no chat → preenche aqui e grava na hora. Amarelo = falta responder. */}
        {checklist.length > 0 && (
          <div>
            <div className="mono" style={{ ...kicker, marginBottom: 4 }}>Qualificação · preencha conforme ele responde</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {checklist.map((c) => (
                <div key={c.key} style={{ padding: "5px 8px", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: c.value ? "var(--bg-1)" : "var(--warn-soft)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                    <span style={{ color: c.value ? "var(--pos)" : "var(--warn)", flexShrink: 0, fontSize: 11 }}>{c.value ? "✓" : "○"}</span>
                    <span className="dim" style={{ fontSize: 10.5, lineHeight: 1.3, minWidth: 0 }}>{c.label}</span>
                  </div>
                  {c.type === "select" ? (
                    <select value={c.raw || ""} onChange={(e) => patch({ [c.key]: e.target.value })}
                      style={{ width: "100%", height: 26, padding: "0 6px", borderRadius: "var(--r-1)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: c.raw ? "var(--fg-1)" : "var(--fg-4)", fontSize: 11.5, fontWeight: 500 }}>
                      <option value="">selecionar…</option>
                      {c.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      {c.raw && !c.options.some((o) => o.value === c.raw) && <option value={c.raw}>{c.raw}</option>}
                    </select>
                  ) : (
                    <input key={base.id + c.key} type="text" defaultValue={c.raw || ""} placeholder="preencher…"
                      onBlur={(e) => { if (e.target.value !== (c.raw || "")) patch({ [c.key]: e.target.value }); }}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                      style={{ width: "100%", height: 26, padding: "0 8px", borderRadius: "var(--r-1)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 11.5, fontWeight: 500 }} />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="mono" style={{ ...kicker, marginBottom: 4 }}>Resumo do cliente</div>
          {facts.map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11.5, padding: "3px 0", borderBottom: "1px solid var(--line-faint)" }}>
              <span className="mono dim" style={{ flexShrink: 0, fontSize: 10 }}>{k}</span>
              <span style={{ fontWeight: 500, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{v}</span>
            </div>
          ))}
          {!facts.length && <div className="mono dim" style={{ fontSize: 11 }}>sem qualificação ainda</div>}
        </div>
        {attribution.length > 0 && (
          <div>
            <div className="mono" style={{ ...kicker, marginBottom: 4 }}>De onde veio</div>
            {attribution.map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11, padding: "3px 0", borderBottom: "1px solid var(--line-faint)" }}>
                <span className="mono dim" style={{ flexShrink: 0, fontSize: 10 }}>{k}</span>
                <span style={{ fontWeight: 500, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{v}</span>
              </div>
            ))}
          </div>
        )}
        {lead.nextActionAt && (
          <div className="mono dim" style={{ fontSize: 10.5 }}>próximo toque {fmtDT(lead.nextActionAt)}{lead.nextActionNote ? ` · ${lead.nextActionNote}` : ""}</div>
        )}
      </div>

      <div style={{ padding: 10, borderTop: "1px solid var(--line-1)" }}>
        <button onClick={onOpenLead} style={{ width: "100%", height: 32, borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
          Abrir lead completo ↗
        </button>
      </div>
    </div>
  );
}

const pill = { display: "inline-flex", alignItems: "center", gap: 5, height: 28, padding: "0 11px", borderRadius: "var(--r-2)", fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", flexShrink: 0 };
const flowChip = { display: "inline-flex", alignItems: "center", gap: 4, height: 24, padding: "0 9px", borderRadius: 999, fontSize: 11, fontWeight: 700, flexShrink: 0 };

// Criar template aprovado da Meta a partir do cockpit. A Meta revisa (nasce
// PENDING) e, aprovado, entra no composer sozinho. Dois presets prontos da
// LeverAds: no-show da call e reengajamento ("ainda tem interesse?"). {{1}} =
// nome do lead (o composer preenche na hora de enviar). Copy sem travessão,
// no tom da Manuela, igual aos templates que já existem (retomada_diag etc.).
const TEMPLATE_PRESETS = [
  {
    key: "no_show",
    button: "No show da call",
    name: "call_no_show",
    category: "UTILITY",
    body: "Oi {{1}}, é a Manuela da LeverAds. Passei na nossa call no horário e não te encontrei, acontece! Quer que eu remarque? Me diz um horário que fica bom que eu já reservo.",
    example: "João",
  },
  {
    key: "interesse",
    button: "Ainda tem interesse?",
    name: "segue_interesse",
    category: "MARKETING",
    body: "Oi {{1}}, é a Manuela da LeverAds. Passando pra saber se você ainda tem interesse em escalar sua operação nos marketplaces com a gente. Se fizer sentido, me responde por aqui que eu te mostro como funciona, sem compromisso.",
    example: "João",
  },
];

function WaTemplateCreator({ onClose }) {
  const [form, setForm] = React.useState({ name: "", category: "UTILITY", language: "pt_BR", body: "", example: "" });
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null); // { ok, text }
  const set = (p) => setForm((f) => ({ ...f, ...p }));
  const preset = (p) => { setForm({ name: p.name, category: p.category, language: "pt_BR", body: p.body, example: p.example }); setMsg(null); };
  const nVars = (form.body.match(/\{\{\s*\d+\s*\}\}/g) || []).length;

  async function submit() {
    setBusy(true); setMsg(null);
    try {
      const r = await api.waCreateTemplate({
        name: form.name, category: form.category, language: form.language,
        body: form.body, example: nVars > 0 ? [form.example] : [],
      });
      setMsg({ ok: true, text: `enviado pra Meta como "${r.status || "PENDING"}". Aprovado (minutos a horas), ele aparece no composer sozinho.` });
    } catch (e) { setMsg({ ok: false, text: e?.message || "não deu pra criar o template" }); }
    setBusy(false);
  }

  const lab = { display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--fg-3)", marginBottom: 4 };
  const inp = { width: "100%", height: 36, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 13, boxSizing: "border-box" };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 100%)", maxHeight: "90vh", overflow: "auto", background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)", padding: 22 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
          <div style={{ fontSize: 15.5, fontWeight: 800, flex: 1 }}>Criar template do WhatsApp</div>
          <button onClick={onClose} style={{ ...pill, height: 26, padding: "0 9px" }}>✕</button>
        </div>
        <div className="dim" style={{ fontSize: 12, marginBottom: 14 }}>
          template aprovado reabre conversa fora das 24h. A Meta revisa antes de liberar; use <b>{"{{1}}"}</b> pro nome do lead.
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
          <span className="mono dim" style={{ fontSize: 10.5, alignSelf: "center" }}>PRESETS:</span>
          {TEMPLATE_PRESETS.map((p) => (
            <button key={p.key} onClick={() => preset(p)} style={{ ...pill, height: 26 }}>{p.button}</button>
          ))}
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 130px 100px", gap: 10 }}>
            <label><span style={lab}>Nome (a-z, _)</span>
              <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="call_no_show" className="mono" style={inp} />
            </label>
            <label><span style={lab}>Categoria</span>
              <select value={form.category} onChange={(e) => set({ category: e.target.value })} style={inp}>
                <option value="UTILITY">Utilidade</option>
                <option value="MARKETING">Marketing</option>
              </select>
            </label>
            <label><span style={lab}>Idioma</span>
              <input value={form.language} onChange={(e) => set({ language: e.target.value })} className="mono" style={inp} />
            </label>
          </div>
          <label><span style={lab}>Corpo da mensagem</span>
            <textarea value={form.body} onChange={(e) => set({ body: e.target.value })} rows={5} placeholder="Oi {{1}}, é a Manuela da LeverAds…"
              style={{ ...inp, height: "auto", padding: "9px 10px", resize: "vertical", lineHeight: 1.45 }} />
          </label>
          {nVars > 0 && (
            <label><span style={lab}>Exemplo pra {"{{1}}"} (a Meta exige)</span>
              <input value={form.example} onChange={(e) => set({ example: e.target.value })} placeholder="João" style={inp} />
            </label>
          )}
        </div>

        {msg && <div className="mono" style={{ fontSize: 12, marginTop: 12, color: msg.ok ? "var(--pos)" : "var(--neg)" }}>{msg.text}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={pill}>fechar</button>
          <button onClick={submit} disabled={busy || !form.name.trim() || !form.body.trim() || (nVars > 0 && !form.example.trim())}
            style={{ ...pill, background: "var(--btn-bg)", color: "var(--btn-fg)", border: "none", opacity: busy || !form.name.trim() || !form.body.trim() ? 0.55 : 1 }}>
            {busy ? "enviando…" : "Enviar pra aprovação"}
          </button>
        </div>
      </div>
    </div>
  );
}
