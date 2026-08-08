import React from "react";
import { api } from "../lib/api.js";
import { Segmented, Pill } from "./viz.jsx";
// Widget de feedback — botão flutuante no canto inferior direito de TODAS as
// telas (montado no shell do app): atalho pra reportar bug ou sugerir melhoria
// sem sair do que se está fazendo. O envio NÃO cria coleção nova: o servidor
// (POST /api/feedback) transforma o reporte num card do quadro de Tarefas com
// label "bug"/"melhoria", print (colado com Ctrl+V ou anexado) e o contexto
// automático (tela + quem reportou). As rotas /api/feedback* são próprias
// porque /api/tasks exige a tela "tasks" e o widget vale pra qualquer usuário,
// inclusive os de telas restritas. O painel também lista os últimos reportes
// com a coluna atual no quadro (o "cadê o que eu enviei").
// z-index: FAB/painel ficam ABAIXO dos modais (70+) e do WaHotAlert (110),
// então drawers e popups cobrem o widget normalmente.

const { useState, useEffect, useRef } = React;

const KIND = {
  bug: { label: "Bug", placeholder: "O que aconteceu? Em qual tela, com qual dado?" },
  melhoria: { label: "Melhoria", placeholder: "Qual a sua ideia? O que ficaria melhor?" },
};

function currentUser() {
  try { return JSON.parse(localStorage.getItem("cockpit_user") || "null"); } catch { return null; }
}

export function FeedbackWidget({ screenLabel }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("bug");
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState("");
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentFlash, setSentFlash] = useState(false);
  const [error, setError] = useState("");
  // Reportes já enviados (tasks com label bug/melhoria) + colunas do quadro,
  // carregados ao abrir o painel (sem polling; abrir de novo re-sincroniza).
  const [reports, setReports] = useState([]);
  const [columns, setColumns] = useState([]);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    api.feedbackList().then(({ reports, columns }) => {
      if (!alive) return;
      setColumns(columns || []);
      setReports(reports || []);
    }).catch(() => {});
    return () => { alive = false; };
  }, [open, sentFlash]);

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);

  async function attachPhoto(file) {
    if (!file || uploading) return;
    setUploading(true); setError("");
    try {
      const { url } = await api.feedbackAsset(file, file.name || "print.png");
      setPhoto(url);
    } catch (err) { setError(err.message || "não deu pra anexar o print"); }
    finally { setUploading(false); }
  }

  // Print direto do clipboard (Ctrl+V dentro do textarea) — o caminho natural
  // de quem acabou de capturar a tela.
  function onPaste(e) {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (!item) return;
    e.preventDefault();
    attachPhoto(item.getAsFile());
  }

  async function submit() {
    const body = text.trim();
    if (!body || sending || uploading) return;
    setSending(true); setError("");
    try {
      await api.feedbackSend({ kind, text: body, screen: screenLabel || "", photo });
      setText(""); setPhoto("");
      setSentFlash(true);
      setTimeout(() => setSentFlash(false), 3200);
    } catch (err) { setError(err.message || "não deu pra enviar"); }
    finally { setSending(false); }
  }

  // Coluna atual do reporte no quadro (mesma regra do kanban: key desconhecida
  // cai na primeira coluna). Última coluna = concluído.
  const colOf = (t) => {
    const cols = columns.length ? columns : [{ key: "todo", name: "A fazer" }, { key: "doing", name: "Em andamento" }, { key: "done", name: "Concluído" }];
    const c = cols.find((x) => x.key === t.column) || cols[0];
    return { name: c.name, done: c.key === cols[cols.length - 1].key };
  };

  const smallBtn = { height: 26, padding: "0 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 500, border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)" };

  return (
    <>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
          <div style={{
            position: "fixed", right: 18, bottom: 76, zIndex: 61,
            width: "min(340px, calc(100vw - 36px))", maxHeight: "min(560px, calc(100vh - 100px))", overflowY: "auto",
            background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)",
            boxShadow: "var(--shadow-pop)", padding: 16, display: "flex", flexDirection: "column", gap: 10,
          }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 14.5, fontWeight: 600 }}>Feedback</span>
              <span style={{ fontSize: 11.5, color: "var(--fg-4)" }}>vira card no quadro de Tarefas</span>
              <button onClick={() => setOpen(false)} title="Fechar (Esc)" style={{ marginLeft: "auto", color: "var(--fg-3)", fontSize: 14, lineHeight: 1 }}>✕</button>
            </div>

            <Segmented value={kind} onChange={setKind}
              options={[{ value: "bug", label: "Bug" }, { value: "melhoria", label: "Melhoria" }]} />

            <textarea value={text} onChange={(e) => setText(e.target.value)} onPaste={onPaste}
              rows={4} placeholder={KIND[kind].placeholder}
              style={{ width: "100%", padding: "8px 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-inset)", color: "var(--fg-1)", fontSize: 13, lineHeight: 1.45, resize: "vertical", fontFamily: "inherit" }} />

            {photo ? (
              <div style={{ position: "relative" }}>
                <a href={photo} target="_blank" rel="noreferrer" title="abrir o print em tamanho cheio">
                  <img src={photo} alt="" style={{ width: "100%", maxHeight: 140, objectFit: "cover", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", display: "block" }} />
                </a>
                <button onClick={() => setPhoto("")} title="remover o print"
                  style={{ position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: 999, background: "var(--bg-1)", border: "1px solid var(--line-2)", color: "var(--fg-2)", fontSize: 11, lineHeight: 1 }}>✕</button>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => fileRef.current?.click()} disabled={uploading} style={smallBtn}>
                  {uploading ? "enviando…" : "📎 anexar print"}
                </button>
                <span style={{ fontSize: 11, color: "var(--fg-4)" }}>ou cole com Ctrl+V no texto</span>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
                  onChange={(e) => { attachPhoto(e.target.files?.[0]); e.target.value = ""; }} />
              </div>
            )}

            <div style={{ fontSize: 11, color: "var(--fg-4)" }}>
              vai junto: {screenLabel || "tela atual"} · {currentUser()?.name || "sem usuário"}
            </div>
            {error && <div style={{ fontSize: 12, color: "var(--neg)" }}>{error}</div>}

            <button onClick={submit} disabled={!text.trim() || sending || uploading}
              style={{
                height: 34, borderRadius: "var(--r-2)", fontSize: 13, fontWeight: 600,
                background: sentFlash ? "var(--pos)" : "var(--accent)", color: "var(--accent-fg, #fff)",
                opacity: !text.trim() || sending || uploading ? 0.55 : 1, transition: "var(--transition-ui)",
              }}>
              {sentFlash ? "enviado ✓" : sending ? "enviando…" : kind === "bug" ? "Reportar bug" : "Enviar melhoria"}
            </button>

            {reports.length > 0 && (
              <div style={{ borderTop: "1px solid var(--line-1)", paddingTop: 8 }}>
                <div className="mono" style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-3)", marginBottom: 6 }}>Últimos reportes</div>
                {reports.map((t) => {
                  const col = colOf(t);
                  return (
                    <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 12.5 }}>
                      <span className="chip" style={{ minHeight: 18, fontSize: 10.5, flexShrink: 0 }}>{(t.labels || [])[0]}</span>
                      <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--fg-2)" }}>{t.title}</span>
                      <Pill tone={col.done ? "pos" : "mut"}>{col.name}</Pill>
                    </div>
                  );
                })}
                <button onClick={() => { setOpen(false); location.hash = "tasks"; }}
                  style={{ fontSize: 12, fontWeight: 500, color: "var(--accent)", marginTop: 4 }}>
                  ver no quadro de Tarefas →
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Balãozinho fixo ao lado do FAB (Leo, 07/08: "para pessoal não esquecer
          dele") — some enquanto o painel está aberto; clicar também abre. */}
      {!open && (
        <button onClick={() => setOpen(true)}
          style={{
            position: "fixed", right: 74, bottom: 27, zIndex: 59,
            height: 28, padding: "0 12px", borderRadius: 999,
            background: "var(--bg-1)", border: "1px solid var(--line-2)",
            boxShadow: "var(--shadow-pop)", color: "var(--fg-2)",
            fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", cursor: "pointer",
          }}>
          Reporte um bug ou uma melhoria
          {/* rabinho do balão apontando pro botão */}
          <span style={{
            position: "absolute", right: -4, top: "50%", width: 8, height: 8,
            transform: "translateY(-50%) rotate(45deg)", background: "var(--bg-1)",
            borderTop: "1px solid var(--line-2)", borderRight: "1px solid var(--line-2)",
          }} />
        </button>
      )}

      <button onClick={() => setOpen((v) => !v)} title="Reportar bug ou sugerir melhoria"
        style={{
          position: "fixed", right: 18, bottom: 18, zIndex: 59,
          width: 46, height: 46, borderRadius: 999, border: "none",
          background: "var(--accent)", color: "var(--accent-fg, #fff)",
          boxShadow: "var(--shadow-pop)", display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", transition: "var(--transition-ui)",
        }}>
        {/* balão de conversa com "!" — feedback, sem depender de emoji */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="15.5" x2="12.01" y2="15.5" />
        </svg>
      </button>
    </>
  );
}
