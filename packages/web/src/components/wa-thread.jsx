import React from "react";
import { api } from "../lib/api.js";

// Peças de conversa de WhatsApp reusadas pelo inbox (tela) e pelo chat do drawer:
// WaBubbles (histórico) + WaComposer (texto livre) + WaTemplateComposer (fora da
// janela de 24h). As mensagens vêm do wa-store (GET /api/whatsapp/threads/:id):
// { direction:"in"|"out", text, at, status, error }.

// Janela de 24h da Meta: só mensagem RECEBIDA abre/renova. Sem inbound nas
// últimas 24h, texto livre é recusado (131047 "Re-engagement message") — quem
// renderiza o composer decide trocar pro de template com isto.
export function waWindowOpen(messages) {
  const lastIn = [...(messages || [])].reverse().find((m) => m.direction === "in");
  return !!lastIn && Date.now() - new Date(lastIn.at || 0).getTime() < 24 * 3600_000;
}

function hhmm(iso) {
  const d = new Date(iso || 0);
  return Number.isFinite(d.getTime()) ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
}

function dayLabel(iso) {
  const d = new Date(iso || 0);
  if (!Number.isFinite(d.getTime())) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0 && new Date().getDate() === d.getDate()) return "hoje";
  if (days <= 1) return "ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}

// Ticks de status da mensagem enviada (espelha o WhatsApp). Falha mostra o
// motivo da Meta no title (ex.: "Re-engagement message" = fora da janela de 24h).
function StatusTicks({ status, error }) {
  if (status === "failed") return <span title={error ? `falhou: ${error}` : "falhou"} style={{ color: "#e5484d" }}>⚠</span>;
  const read = status === "read";
  return <span title={status || "enviado"} style={{ color: read ? "#4aa3ff" : "var(--fg-4)", letterSpacing: -2 }}>{status === "sent" || status === "received" ? "✓" : "✓✓"}</span>;
}

// Mídia recebida (áudio/imagem/vídeo/documento). O binário se baixa autenticado
// (a Graph só entrega com token) e toca via object URL — só busca quando entra
// na tela (lazy) pra não puxar todos os áudios ao abrir a conversa.
function MediaBubble({ msg, out }) {
  const kind = msg.media?.kind || "";
  const [url, setUrl] = React.useState("");
  const [err, setErr] = React.useState("");
  const [load, setLoad] = React.useState(false);
  const boxRef = React.useRef(null);
  const started = React.useRef(false);

  const fetchIt = React.useCallback(() => {
    if (started.current) return;
    started.current = true;
    setLoad(true);
    api.waMedia(msg.id)
      .then((blob) => setUrl(URL.createObjectURL(blob)))
      .catch((e) => setErr(e?.status === 502 ? "áudio expirado no WhatsApp" : "não deu pra carregar"))
      .finally(() => setLoad(false));
  }, [msg.id]);

  // Áudio: carrega sozinho ao aparecer (é pra ouvir na hora). Imagem/vídeo:
  // idem. Documento: só baixa no clique.
  React.useEffect(() => {
    if (kind === "document") return;
    const el = boxRef.current;
    if (!el || typeof IntersectionObserver === "undefined") { fetchIt(); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { fetchIt(); io.disconnect(); } }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [kind, fetchIt]);

  React.useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const label = { audio: "🎤 áudio", image: "📷 imagem", video: "🎬 vídeo", document: "📎 " + (msg.media?.filename || "documento") }[kind] || "mídia";
  return (
    <div ref={boxRef} style={{ minWidth: kind === "audio" ? 210 : 120 }}>
      {err ? (
        <span className="mono dim" style={{ fontSize: 11 }}>{label} · {err}</span>
      ) : kind === "audio" ? (
        url ? <audio controls src={url} style={{ width: 230, height: 34 }} /> : <span className="mono dim" style={{ fontSize: 11 }}>{load ? "carregando áudio…" : label}</span>
      ) : kind === "image" ? (
        url ? <img src={url} alt="imagem" style={{ maxWidth: 240, maxHeight: 240, borderRadius: 8, display: "block" }} /> : <span className="mono dim" style={{ fontSize: 11 }}>{load ? "carregando…" : label}</span>
      ) : kind === "video" ? (
        url ? <video controls src={url} style={{ maxWidth: 260, borderRadius: 8, display: "block" }} /> : <span className="mono dim" style={{ fontSize: 11 }}>{load ? "carregando…" : label}</span>
      ) : (
        // documento: link que baixa sob demanda
        <button onClick={fetchIt} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: out ? "#0c2318" : "var(--fg-1)", fontSize: 12.5, textDecoration: "underline" }}>
          {url ? <a href={url} download={msg.media?.filename || "arquivo"} style={{ color: "inherit" }}>{label} · baixar</a> : load ? "baixando…" : label}
        </button>
      )}
    </div>
  );
}

export function WaBubbles({ messages, emptyHint }) {
  const ref = React.useRef(null);
  React.useEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight; }, [messages.length]);
  if (!messages.length) {
    return <div className="mono dim" style={{ fontSize: 11.5, padding: "24px 0", textAlign: "center" }}>{emptyHint || "nenhuma mensagem ainda"}</div>;
  }
  let lastDay = "";
  return (
    <div ref={ref} style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5, padding: "6px 4px" }}>
      {messages.map((m) => {
        const out = m.direction === "out";
        const day = dayLabel(m.at);
        const sep = day && day !== lastDay ? (lastDay = day) : null;
        return (
          <React.Fragment key={m.id}>
            {sep && (
              <div style={{ alignSelf: "center", margin: "6px 0", fontSize: 10, fontFamily: "var(--mono)", color: "var(--fg-4)", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: 999, padding: "2px 10px" }}>{sep}</div>
            )}
            <div style={{ alignSelf: out ? "flex-end" : "flex-start", maxWidth: "80%" }}>
              <div style={{
                padding: "7px 10px", borderRadius: 10, fontSize: 12.5, lineHeight: 1.4, whiteSpace: "pre-wrap", overflowWrap: "break-word",
                background: out ? "var(--wa-out, #d6f5cf)" : "var(--bg-3)", color: out ? "#0c2318" : "var(--fg-1)",
                borderBottomRightRadius: out ? 3 : 10, borderBottomLeftRadius: out ? 10 : 3,
              }}>{m.media?.id ? <MediaBubble msg={m} out={out} /> : m.text}</div>
              <div className="mono" style={{ fontSize: 9.5, color: "var(--fg-4)", marginTop: 2, display: "flex", gap: 4, justifyContent: out ? "flex-end" : "flex-start" }}>
                {hhmm(m.at)}{out && <StatusTicks status={m.status} error={m.error} />}
              </div>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// Composer de TEMPLATE aprovado — substitui o de texto livre quando a janela de
// 24h fechou (a Meta recusa texto). Lista os aprovados da conta, preenche as
// variáveis ({{1}} já vem com o primeiro nome do contato), mostra o preview do
// que o lead vai receber e envia. Quando o lead responder, a janela reabre e o
// composer normal volta sozinho (o pai decide por waWindowOpen).
export function WaTemplateComposer({ threadId, contactName = "", onSent }) {
  const [list, setList] = React.useState(null); // null = carregando · [] = nenhum
  const [loadErr, setLoadErr] = React.useState("");
  const [sel, setSel] = React.useState("");
  const [params, setParams] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");

  const firstName = String(contactName || "").trim().split(/\s+/)[0] || "";

  React.useEffect(() => {
    let alive = true;
    api.waMetaTemplates()
      .then((r) => { if (!alive) return; setList(r.templates || []); })
      .catch((e) => { if (!alive) return; setList([]); setLoadErr(e?.message || "não deu pra listar os templates"); });
    return () => { alive = false; };
  }, []);

  const tpl = (list || []).find((t) => t.name === sel) || null;

  // Seleção inicial + variáveis: {{1}} ganha o primeiro nome do contato.
  React.useEffect(() => {
    if (!list?.length || sel) return;
    setSel(list[0].name);
  }, [list, sel]);
  React.useEffect(() => {
    if (!tpl) return;
    setParams(Array.from({ length: tpl.params }, (_, i) => (i === 0 ? firstName : "")));
  }, [tpl?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const preview = tpl ? tpl.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => params[Number(n) - 1] || `{{${n}}}`) : "";
  const ready = tpl && params.slice(0, tpl.params).every((p) => String(p || "").trim());

  async function send() {
    if (!ready || busy) return;
    setBusy(true); setErr("");
    try {
      await api.waThreadSendTemplate(threadId, { name: tpl.name, language: tpl.language, params });
      onSent && onSent();
    } catch (e) { setErr(e?.message || "não foi possível enviar"); }
    finally { setBusy(false); }
  }

  const field = { height: 30, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12.5, minWidth: 0 };

  return (
    <div style={{ border: "1px dashed var(--warn-line, var(--line-2))", borderRadius: "var(--r-2)", padding: "10px 12px", background: "var(--warn-soft)" }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--warn)", marginBottom: 6 }}>
        Fora da janela de 24h · só template aprovado chega
      </div>

      {list === null && <div className="mono dim" style={{ fontSize: 11.5 }}>carregando templates aprovados…</div>}

      {list !== null && !list.length && (
        <div style={{ fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.5 }}>
          {loadErr
            ? <>Não deu pra listar os templates: <span className="mono">{loadErr}</span></>
            : <>Nenhum template aprovado na Meta ainda. Crie em <b>WhatsApp Manager → Conta → Modelos de mensagem</b> (categoria utilidade, corpo com <span className="mono code">{"{{1}}"}</span> pro nome) — depois de aprovado ele aparece aqui sozinho.</>}
          {" "}Enquanto isso, se o lead mandar qualquer mensagem, a janela reabre e o campo normal volta.
        </div>
      )}

      {tpl && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ ...field, flex: 1, minWidth: 160, maxWidth: "100%" }}>
              {(list || []).map((t) => <option key={t.name + t.language} value={t.name}>{t.name} · {t.language}</option>)}
            </select>
            {Array.from({ length: tpl.params }, (_, i) => (
              <input key={tpl.name + i} value={params[i] || ""} placeholder={`{{${i + 1}}}`}
                onChange={(e) => setParams((prev) => prev.map((p, j) => (j === i ? e.target.value : p)))}
                style={{ ...field, width: 130 }} />
            ))}
          </div>
          <div style={{ padding: "7px 10px", borderRadius: 10, fontSize: 12.5, lineHeight: 1.4, whiteSpace: "pre-wrap", overflowWrap: "break-word", background: "var(--wa-out, #d6f5cf)", color: "#0c2318", alignSelf: "flex-start", maxWidth: "100%" }}>
            {preview}
          </div>
          {err && <div style={{ fontSize: 11, color: "#e5484d" }}>{err}</div>}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button disabled={!ready || busy} onClick={send} style={{
              height: 34, padding: "0 16px", borderRadius: "var(--r-2)", fontSize: 12.5, fontWeight: 700,
              background: "#25D366", color: "#06120c", border: "none", cursor: "pointer", opacity: !ready || busy ? 0.55 : 1,
            }}>{busy ? "…" : "Enviar template"}</button>
            <span className="mono dim" style={{ fontSize: 10 }}>quando o lead responder, o campo de mensagem normal volta</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Composer: textarea + enviar. onSend(text) → Promise; devolve erro pra mostrar.
// `templates` = [{ group, items:[{ label, text }] }] com os tokens JÁ
// preenchidos: escolher só ESCREVE na caixa (nunca dispara), porque a última
// palavra sobre o que vai pro cliente é de quem está na conversa.
export function WaComposer({ onSend, disabled, placeholder, templates, apiRef }) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [openTpl, setOpenTpl] = React.useState(false);
  const boxRef = React.useRef(null);

  // Atalhos de fora (ex.: "Agendar call") deixam um RASCUNHO na caixa pelo
  // apiRef — mesma regra dos modelos: escrever nunca é enviar.
  React.useEffect(() => {
    if (!apiRef) return;
    apiRef.current = { insert: (t) => useTemplate(t) };
    return () => { apiRef.current = null; };
  });

  async function send() {
    const t = text.trim();
    if (!t || busy || disabled) return;
    setBusy(true); setErr("");
    try { await onSend(t); setText(""); }
    catch (e) { setErr(e?.message || "não foi possível enviar"); }
    finally { setBusy(false); }
  }

  // Caixa com rascunho não é sobrescrita: o modelo entra embaixo do que já
  // estava escrito (dois modelos seguidos viram uma mensagem só).
  function useTemplate(t) {
    setText((prev) => (prev.trim() ? `${prev.replace(/\s+$/, "")}\n\n${t}` : t));
    setOpenTpl(false);
    requestAnimationFrame(() => {
      const el = boxRef.current;
      if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; }
    });
  }

  const groups = Array.isArray(templates) ? templates.filter((g) => g?.items?.length) : [];

  return (
    <div>
      {err && <div style={{ fontSize: 11, color: "#e5484d", marginBottom: 6 }}>{err}</div>}
      {groups.length > 0 && (
        <div style={{ position: "relative", marginBottom: 6 }}>
          <button onClick={() => setOpenTpl((v) => !v)} disabled={disabled}
            title="Mensagens prontas do fluxo de qualificação"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 26, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: openTpl ? "var(--bg-2)" : "var(--bg-1)", color: "var(--fg-2)", fontSize: 11.5, fontWeight: 600, cursor: "pointer", opacity: disabled ? 0.5 : 1 }}>
            ⚡ modelos
          </button>
          {openTpl && (
            <>
              <div onClick={() => setOpenTpl(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
              <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, zIndex: 61, width: 340, maxHeight: "min(52vh, 460px)", overflowY: "auto", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-pop)", padding: 6 }}>
                {groups.map((g) => (
                  <div key={g.group} style={{ marginBottom: 4 }}>
                    <div className="mono" style={{ fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-4)", padding: "6px 8px 4px" }}>{g.group}</div>
                    {g.items.map((it) => (
                      <button key={it.label} onClick={() => useTemplate(it.text)} title={it.text}
                        style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", borderRadius: 6, border: 0, background: "transparent", color: "var(--fg-1)", fontSize: 12, cursor: "pointer", lineHeight: 1.35 }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-2)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                        {it.label}
                        <span style={{ display: "block", color: "var(--fg-4)", fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.text.replace(/\n+/g, " ")}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
        <textarea
          ref={boxRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={1}
          disabled={disabled}
          placeholder={disabled ? (placeholder || "sem telefone") : (placeholder || "mensagem… (↵ envia, Shift+↵ quebra linha)")}
          style={{ flex: 1, padding: "9px 11px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 12.5, resize: "vertical", maxHeight: 140 }}
        />
        <button disabled={busy || !text.trim() || disabled} onClick={send} style={{
          height: 38, padding: "0 16px", borderRadius: "var(--r-2)", fontSize: 12.5, fontWeight: 700,
          background: "#25D366", color: "#06120c", border: "none", cursor: "pointer", opacity: busy || !text.trim() || disabled ? 0.55 : 1, flexShrink: 0,
        }}>{busy ? "…" : "Enviar"}</button>
      </div>
    </div>
  );
}
