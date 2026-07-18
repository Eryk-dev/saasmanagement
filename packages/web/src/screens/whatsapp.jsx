import React from "react";
import { PageHead } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { WaBubbles, WaComposer } from "../components/wa-thread.jsx";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import { waLink } from "../lib/ui.js";

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

export function WhatsappInboxScreen({ onOpenLead }) {
  const { version } = useData();
  const [product] = useActiveSaas();
  const [threads, setThreads] = React.useState(null);
  const [sel, setSel] = React.useState(null); // thread.id (número)
  const [msgs, setMsgs] = React.useState([]);
  const [q, setQ] = React.useState("");
  const configured = !!window.SEED?.CONFIG?.whatsapp?.configured;

  // Número conectado, direto da Meta: confirma QUAL número está enviando. A
  // rota responde 200 sempre (com ok/reason no corpo) — ler os dados do número
  // exige whatsapp_business_management no token, permissão que o envio NÃO
  // precisa, então falhar aqui não quer dizer que o inbox está quebrado.
  const [numInfo, setNumInfo] = React.useState(null);
  React.useEffect(() => {
    if (!configured) return;
    let alive = true;
    api.waNumber()
      .then((n) => alive && setNumInfo(n))
      .catch((e) => alive && setNumInfo({ ok: false, reason: "meta_error", error: String(e.message || e).slice(0, 200) }));
    return () => { alive = false; };
  }, [configured]);

  // Lista de conversas (refetch em tempo real). Escopo: produto ativo + órfãs.
  React.useEffect(() => {
    let alive = true;
    api.waThreads()
      .then((r) => alive && setThreads((r.threads || []).filter((t) => !product?.id || !t.saas || t.saas === product.id)))
      .catch(() => alive && setThreads([]));
    return () => { alive = false; };
  }, [product?.id, version]);

  // Mensagens da conversa aberta (refetch em tempo real).
  React.useEffect(() => {
    if (!sel) { setMsgs([]); return; }
    let alive = true;
    api.waThread(sel).then((r) => alive && setMsgs(r.messages || [])).catch(() => alive && setMsgs([]));
    return () => { alive = false; };
  }, [sel, version]);

  // Auto-seleciona a primeira conversa; marca como lida ao abrir.
  const list = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = threads || [];
    return s ? base.filter((t) => (t.name || "").toLowerCase().includes(s) || String(t.phone).includes(s.replace(/\D/g, ""))) : base;
  }, [threads, q]);

  React.useEffect(() => {
    if (!sel && list.length) setSel(list[0].id);
  }, [list, sel]);

  const current = (threads || []).find((t) => t.id === sel) || null;

  React.useEffect(() => {
    if (sel && current?.unread) api.waThreadRead(sel).catch(() => {});
  }, [sel, current?.unread]);

  const totalUnread = (threads || []).reduce((a, t) => a + (t.unread || 0), 0);

  function openLead() {
    const rec = current?.leadId && (window.SEED?.LEADS || []).find((l) => l.id === current.leadId);
    if (rec && onOpenLead) onOpenLead(rec);
  }

  const box = { border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)" };

  const unreadLabel = totalUnread ? `${totalUnread} não lida${totalUnread > 1 ? "s" : ""}` : "conversas com os leads";
  const sub = !configured ? "não configurado no servidor"
    : numInfo?.ok && numInfo.display ? `enviando por ${numInfo.display}${numInfo.name ? ` · ${numInfo.name}` : ""} · ${unreadLabel}`
    : unreadLabel;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <PageHead title="WhatsApp" sub={sub} />

      <WaHealthBanner />

      {configured && numInfo && numInfo.ok === false && (
        <div style={{ margin: "12px var(--pad-x) 0", padding: "10px 14px", border: "1px dashed var(--line-2)", borderRadius: "var(--r-2)", fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.5 }}>
          {numInfo.reason === "no_read_permission" ? (
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

      <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 16, padding: "16px var(--pad-x) 56px" }}>
        {/* Lista de conversas */}
        <div style={{ ...box, width: 340, flexShrink: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ padding: 10, borderBottom: "1px solid var(--line-1)" }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="buscar por nome ou número"
              style={{ width: "100%", padding: "8px 10px", background: "var(--bg-2)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 12.5 }} />
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

        {/* Conversa aberta */}
        <div style={{ ...box, flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {!current ? (
            <div style={{ margin: "auto", padding: 24 }}>
              <EmptyState title="Escolha uma conversa" hint="selecione um contato à esquerda pra ver e responder" />
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: "1px solid var(--line-1)" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {current.name || prettyPhone(current.phone)}
                  </div>
                  <div className="mono dim" style={{ fontSize: 11 }}>
                    {prettyPhone(current.phone)}{current.stage ? ` · ${current.stage}` : ""}
                  </div>
                </div>
                {current.leadId ? (
                  <button onClick={openLead} style={pill}>Abrir lead ↗</button>
                ) : (
                  <span className="mono dim" style={{ fontSize: 10.5 }}>sem lead</span>
                )}
                {waLink(current.phone) && (
                  <a href={waLink(current.phone)} target="_blank" rel="noopener noreferrer" title="Ligar / abrir no app"
                    style={{ ...pill, background: "#25D366", color: "#06120c", border: "none", fontWeight: 700, textDecoration: "none" }}>✆ Ligar</a>
                )}
              </div>

              <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "6px 12px" }}>
                <WaBubbles messages={msgs} emptyHint={configured ? "manda a primeira mensagem abaixo" : "nenhuma mensagem"} />
              </div>

              <div style={{ padding: 12, borderTop: "1px solid var(--line-1)" }}>
                {configured ? (
                  <>
                    <WaComposer onSend={(t) => api.waThreadSend(current.id, t).then(() => api.waThread(current.id).then((r) => setMsgs(r.messages || [])))} />
                    <div className="mono dim" style={{ fontSize: 9.5, marginTop: 5 }}>fora de 24h desde a última resposta do cliente, a Meta exige um template aprovado</div>
                  </>
                ) : (
                  <div className="mono dim" style={{ fontSize: 11, padding: "8px 10px", border: "1px dashed var(--line-2)", borderRadius: "var(--r-2)" }}>
                    envio indisponível até o WhatsApp ser configurado no servidor
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const pill = { display: "inline-flex", alignItems: "center", gap: 5, height: 28, padding: "0 11px", borderRadius: "var(--r-2)", fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", flexShrink: 0 };
