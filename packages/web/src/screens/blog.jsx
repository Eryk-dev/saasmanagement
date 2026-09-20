import React from "react";
import "./marketing.css";
import "./blog.css";
import { createPortal } from "react-dom";
import { Switch } from "../components/form-controls.jsx";
import { FilterTab, Segmented } from "../components/viz.jsx";
import { InfoLink } from "../components/story.jsx";
import { Modal as Painel, Drawer } from "../components/overlay.jsx";
import { EmptyState, PrimaryButton, SecondaryButton, toast } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useActiveSaas } from "../lib/workspace.js";
import { displayName, isAdminUser } from "../lib/users.js";

// Blog · a redação do blog SEO do site (leverads.com.br/blog).
//
// O motor do servidor (blog-engine.js) minera PAUTAS do que o cockpit aprende
// com leads, calls e WhatsApp, escreve RASCUNHOS com a IA e publica na cadência
// o que foi aprovado. Esta tela é a mesa de revisão: ver a fila, ler o
// rascunho, ajustar, aprovar (ou devolver pra IA com uma instrução) e
// acompanhar o que já está no ar.
//
// Estados de um post: pauta → rascunho → agendado → publicado (arquivado sai
// da fila a qualquer momento). Slug trava no primeiro publish: a URL do post
// no Google não muda mais, mesmo que o título mude.
//
// Lint: o servidor confere preço, travessão, "clonar", nome de cliente,
// contato e tamanho. Erro bloqueia aprovar/publicar; aviso só aparece.

const { useState: useS, useEffect: useE, useRef: useR, useMemo: useM, useCallback: useC } = React;

const STATUS = [
  { id: "pauta", label: "Pauta", chip: "info" },
  { id: "rascunho", label: "Rascunho", chip: "warn" },
  { id: "agendado", label: "Agendado", chip: "info" },
  { id: "publicado", label: "Publicado", chip: "pos" },
  { id: "arquivado", label: "Arquivado", chip: "" },
];
const statusOf = (id) => STATUS.find((s) => s.id === id) || { id, label: id || "sem status", chip: "" };

const DIAS = [["seg", "seg"], ["ter", "ter"], ["qua", "qua"], ["qui", "qui"], ["sex", "sex"], ["sab", "sáb"], ["dom", "dom"]];
const INTENTS = [["informacional", "Informacional"], ["comercial", "Comercial"], ["comparativo", "Comparativo"], ["guia", "Guia"]];

const BRT = "America/Sao_Paulo";
const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: BRT }) : "–");
const fmtAt = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: BRT }) : "–");
// Slot de publicação: "ter 16/09 · 09:00" (relógio de Brasília, que é o que a
// cadência usa no servidor).
const fmtSlot = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const dia = d.toLocaleDateString("pt-BR", { weekday: "short", timeZone: BRT }).replace(".", "");
  const data = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: BRT });
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: BRT });
  return `${dia} ${data} · ${hora}`;
};
// "há 12 min" / "há 3 h" / "há 2 dias" pro status do motor.
const ago = (iso) => {
  if (!iso) return "nunca";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "agora";
  const min = Math.round(ms / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
};
// datetime-local (relógio de Brasília, sem sufixo) → ISO UTC.
const brtLocalToIso = (v) => (v ? new Date(`${v}:00-03:00`).toISOString() : "");

const lintCounts = (lint) => {
  const list = Array.isArray(lint) ? lint : [];
  return { erros: list.filter((i) => i.level === "erro").length, avisos: list.filter((i) => i.level !== "erro").length };
};

function LintChip({ post }) {
  if (!post.body && post.status === "pauta") return <span className="dim">–</span>;
  const { erros, avisos } = lintCounts(post.lint);
  if (erros) return <span className="marketing-status" style={{ color: "var(--neg)" }}>{erros} {erros === 1 ? "erro" : "erros"}</span>;
  if (avisos) return <span className="marketing-status" style={{ color: "var(--warn)" }}>{avisos} {avisos === 1 ? "aviso" : "avisos"}</span>;
  return <span className="marketing-status" style={{ color: "var(--pos)" }}>ok</span>;
}

function StatusChip({ status }) {
  const s = statusOf(status);
  return <span className="marketing-status" style={{ color: s.chip ? `var(--${s.chip})` : "var(--fg-3)" }}>{s.label.toLowerCase()}</span>;
}

// Data que importa em cada estado: agendado mostra o slot, publicado a data
// no ar, o resto quando nasceu.
const dateOf = (p) => (p.status === "agendado" ? fmtSlot(p.scheduledAt) : p.status === "publicado" ? fmtDay(p.publishedAt) : fmtDay(p.createdAt));

// O `req` da api.js guarda o corpo do erro em `err.body` (lint da 422).
const lintFromError = (e) => (Array.isArray(e?.body?.lint) ? e.body.lint : []);

const Label = ({ children, right }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
    <span className="kicker">{children}</span>
    {right && <span className="mono dim" style={{ fontSize: 10.5 }}>{right}</span>}
  </div>
);

const Toggle = ({ checked, onChange, disabled, children, hint }) => (
  <div className="blog-toggle" onClick={(e) => { if (!disabled && !e.target.closest("button")) onChange(!checked); }}>
    <Switch checked={checked} onChange={onChange} disabled={disabled} label={children} />
    <div><strong>{children}</strong><p>{hint}</p></div>
  </div>
);
const inPortal = (content) => typeof document === "undefined" ? content : createPortal(content, document.body);

// ── Automação: as regras do motor ───────────────────────────────────────────
// Salva a cada mudança (PATCH parcial); a API devolve as regras saneadas, que
// voltam pro estado. Não-admin vê, não mexe (a API dá 403 de qualquer jeito).
function AutomacaoCard({ saas, rules, state, aiConfigured, nextSlot, admin, onRules, onDigest }) {
  const [saving, setSaving] = useS(false);
  const [local, setLocal] = useS(rules || {});
  const writing = useR(false);
  const [error, setError] = useS("");
  const previousRules = useR(rules || {});
  useE(() => {
    const before = previousRules.current;
    previousRules.current = rules || {};
    setLocal(cur => {
      const next = { ...rules };
      for (const key of Object.keys(cur)) if (!same(cur[key], before[key])) next[key] = cur[key];
      return next;
    });
  }, [rules]);

  async function patch(partial) {
    if (!admin || writing.current) return;
    writing.current = true; setError("");
    const before = local;
    setLocal((cur) => ({ ...cur, ...partial }));
    setSaving(true);
    try {
      const r = await api.blogSaveRules(saas, partial);
      if (r?.rules) { setLocal(r.rules); onRules(r.rules, r.state); }
      toast("automação salva", "pos");
    } catch (e) {
      setLocal(before); setError(`Não deu para salvar: ${e.message}. Tente novamente.`);
      toast(`não deu pra salvar: ${e.message} · tente de novo`, "neg");
    } finally { writing.current = false; setSaving(false); }
  }

  const dias = Array.isArray(local.diasPublicacao) ? local.diasPublicacao : [];
  const toggleDia = (d) => {
    const next = dias.includes(d) ? dias.filter((x) => x !== d) : [...dias, d];
    if (!next.length) { toast("deixe pelo menos um dia de publicação", "warn"); return; }
    patch({ diasPublicacao: next });
  };
  const num = (key, min, max) => (
    <input aria-label={key === "minPautas" ? "Mínimo de pautas" : "Mínimo de rascunhos"} type="number" className="inp" min={min} max={max} disabled={!admin || saving} value={local[key] ?? ""}
      onChange={(e) => setLocal((c) => ({ ...c, [key]: e.target.value }))}
      onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== rules?.[key]) patch({ [key]: v }); }}
      style={{ width: 72 }} />
  );

  return (
    <section className="blog-motor">
      <header className="blog-motor-head"><div><h2>O motor</h2><p>Roda a cada 15 minutos · último ciclo {ago(state?.lastTickAt)}{!aiConfigured ? " · IA não configurada" : ""}</p></div><div><span>Próxima publicação</span><strong>{nextSlot ? fmtSlot(nextSlot) : "sem agendamento"}</strong></div></header>
      {saving && <div role="status" className="blog-save-status">salvando…</div>}
      {error && <div role="alert" className="blog-error">{error}</div>}
      {!!state?.lastError && <div role="alert" className="blog-error">Último erro do motor: {state.lastError}</div>}
      <div className="blog-motor-grid">
        <div className="blog-toggles">
          <Toggle checked={local.enabled} disabled={!admin || saving} onChange={(v) => patch({ enabled: v })} hint="Desligado, nada roda: nem pauta, nem rascunho, nem publicação agendada.">Motor ligado</Toggle>
          <Toggle checked={local.autoPauta} disabled={!admin || saving || !local.enabled} onChange={(v) => patch({ autoPauta: v })} hint="Quando a fila de pautas fica curta, a IA propõe temas novos a partir do que o cockpit aprendeu.">Minerar pautas sozinho</Toggle>
          <Toggle checked={local.autoRascunho} disabled={!admin || saving || !local.enabled} onChange={(v) => patch({ autoRascunho: v })} hint="Um rascunho por ciclo, com limite diário. Você revisa antes de ir pro ar.">Escrever rascunhos sozinho</Toggle>
          <Toggle checked={local.autoPublicar} disabled={!admin || saving || !local.enabled}
            onChange={(v) => {
              if (v && !window.confirm("Publicar sem revisão humana? O lint bloqueia preço, travessão e nome de cliente, mas não lê o texto por você. Rascunhos aprovados pelo lint vão pro ar na cadência.")) return;
              patch({ autoPublicar: v });
            }}
            hint="Rascunho que passa no lint entra na agenda sem ninguém aprovar.">Publicar sem revisão</Toggle>

        </div>
        <div className="blog-cadence">
          <div className="resp-cols" style={{ "--cols": "repeat(3, minmax(0, 1fr))", gap: "10px 14px" }}>
            <div>
              <Label>por semana</Label>
              <select aria-label="Posts por semana" className="inp" disabled={!admin || saving} value={local.cadenciaSemanal || 2} onChange={(e) => patch({ cadenciaSemanal: Number(e.target.value) })} style={{ width: "100%", marginTop: 4 }}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} {n === 1 ? "post" : "posts"}</option>)}
              </select>
            </div>
            <div>
              <Label>hora (Brasília)</Label>
              <input aria-label="Hora de publicação" type="time" className="inp" disabled={!admin || saving} value={local.horaPublicacao || "09:00"}
                onChange={(e) => setLocal((c) => ({ ...c, horaPublicacao: e.target.value }))}
                onBlur={(e) => { if (/^\d{2}:\d{2}$/.test(e.target.value) && e.target.value !== rules?.horaPublicacao) patch({ horaPublicacao: e.target.value }); }}
                style={{ width: "100%", marginTop: 4 }} />
            </div>
            <div>
              <Label>mínimos na fila</Label>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
                {num("minPautas", 1, 20)}<span className="dim" style={{ fontSize: 11.5 }}>pautas</span>
                {num("minRascunhos", 1, 10)}<span className="dim" style={{ fontSize: 11.5 }}>rascunhos</span>
              </div>
            </div>
          </div>

          <div>
            <Label>dias de publicação</Label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {DIAS.map(([id, label]) => {
                const on = dias.includes(id);
                return (
                  <button key={id} disabled={!admin || saving} onClick={() => toggleDia(id)} className="chip" aria-pressed={on} style={{
                    cursor: admin ? "pointer" : "default", fontWeight: 600, minWidth: 44, justifyContent: "center",
                    background: on ? "var(--accent-soft)" : "var(--bg-2)",
                    color: on ? "var(--accent)" : "var(--fg-3)",
                    boxShadow: on ? "inset 0 0 0 1px var(--accent-line)" : "none",
                  }}>{label}</button>
                );
              })}
            </div>
          </div>

        </div>
      </div>
      <details className="blog-motor-details"><summary>Estado do motor e link dos posts</summary><div className="blog-motor-details-grid">
        <div>
          <div>
            <Label>link do CTA nos posts</Label>
            <input aria-label="Link do CTA nos posts" type="url" className="inp" disabled={!admin || saving} value={local.ctaUrl || ""}
              onChange={(e) => setLocal((c) => ({ ...c, ctaUrl: e.target.value }))}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== rules?.ctaUrl) patch({ ctaUrl: v }); }}
              placeholder="https://levermoney.com.br/f/…" style={{ width: "100%", marginTop: 4 }} />
            <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>As UTMs (utm_source=blog e o slug do post) entram sozinhas.</div>
          </div>
        </div>
        <div style={{ background: "var(--bg-inset)", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", padding: "14px 16px", alignSelf: "start", display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          <div className="kicker accent">estado do motor</div>
          <Line k="IA" v={aiConfigured ? "configurada" : "não configurada"} tone={aiConfigured ? "pos" : "neg"} />
          <Line k="Último ciclo" v={ago(state?.lastTickAt)} />
          <Line k="Últimas pautas" v={ago(state?.lastMineAt)} />
          <Line k="Último rascunho" v={ago(state?.lastDraftAt)} />
          <Line k="Última publicação" v={state?.lastPublishAt ? fmtAt(state.lastPublishAt) : "nenhuma"} />
          <Line k="Próxima publicação" v={nextSlot ? fmtSlot(nextSlot) : "sem slot (ninguém agendado)"} />
          {!!state?.lastError && (
            <div style={{ fontSize: 12, color: "var(--neg)", lineHeight: 1.45 }}>
              <span style={{ fontWeight: 600 }}>Último erro:</span> {state.lastError}
            </div>
          )}
          {!aiConfigured && <div className="dim" style={{ fontSize: 11.5, lineHeight: 1.45 }}>Sem a IA configurada, o motor só publica os textos que já estiverem agendados.</div>}
          <div style={{ marginTop: 4 }}>
            <SecondaryButton size="sm" onClick={onDigest}>Ver o que a IA lê</SecondaryButton>
          </div>
        </div>
      </div></details>
    </section>
  );
}

const Line = ({ k, v, tone }) => (
  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5 }}>
    <span className="dim">{k}</span>
    <span className="tnum" style={{ textAlign: "right", color: tone === "pos" ? "var(--pos)" : tone === "neg" ? "var(--neg)" : "var(--fg-1)", fontWeight: 500 }}>{v}</span>
  </div>
);

// ── Modal simples (nova pauta, digest) ──────────────────────────────────────
// O Modal local do Blog virou casca do compartilhado (14/09): o véu, a camada,
// o Esc e o ErrorBoundary vêm de components/overlay.jsx.
function Modal({ onClose, busy, width = 560, label = "blog", children }) {
  return (
    inPortal(<Painel onClose={onClose} fechavel={!busy} label={label} largura={width} style={{zIndex:1400}} painelStyle={{ padding: 22 }}>
      <div className="blog-modal">
      {children}
      </div>
    </Painel>)
  );
}

function NewPautaModal({ saas, categorias, onClose, onCreated }) {
  const [title, setTitle] = useS("");
  const [keyword, setKeyword] = useS("");
  const [category, setCategory] = useS(categorias[0] || "");
  const [busy, setBusy] = useS(false);
  const [err, setErr] = useS("");

  const writing = useR(false);
  const close = () => { if (writing.current) return; if ((title.trim() || keyword.trim() || category !== (categorias[0] || "")) && !window.confirm("Descartar esta nova pauta?")) return; onClose(); };

  async function criar(e) {
    e?.preventDefault?.();
    if (writing.current) return;
    if (!title.trim()) { setErr("dê um título pra pauta"); return; }
    writing.current = true;
    setBusy(true); setErr("");
    try {
      const doc = await api.blogNewPauta(saas, { title: title.trim(), keyword: keyword.trim(), category });
      toast("pauta criada", "pos");
      onCreated(doc);
    } catch (e2) {
      setErr(e2.message);
    } finally { writing.current = false; setBusy(false); }
  }

  return (
    <Modal onClose={close} busy={busy} label="Nova pauta">
      <form onSubmit={criar}><fieldset className="blog-fields" disabled={busy}>
        <div className="card-title">Nova pauta</div>
        <div className="card-sub" style={{ marginTop: 2 }}>Um tema que a IA vai transformar em rascunho. Título curto, como o leitor buscaria no Google.</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
          <div>
            <Label right={`${title.length}/60`}>título</Label>
            <input aria-label="Título da pauta" autoFocus className="inp" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Como operar várias contas de Mercado Livre sem duplicar trabalho" style={{ width: "100%", marginTop: 4 }} />
          </div>
          <div className="resp-cols" style={{ "--cols": "1fr 1fr", gap: 12 }}>
            <div>
              <Label>palavra-chave</Label>
              <input aria-label="Palavra-chave da pauta" className="inp" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="várias contas mercado livre" style={{ width: "100%", marginTop: 4 }} />
            </div>
            <div>
              <Label>categoria</Label>
              <select aria-label="Categoria da pauta" className="inp" value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: "100%", marginTop: 4 }}>
                {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          {err && <div role="alert" style={{ fontSize: 12.5, color: "var(--neg)" }}>{err}</div>}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <SecondaryButton type="button" onClick={close} disabled={busy}>Cancelar</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy}>{busy ? "criando…" : "Criar pauta"}</PrimaryButton>
        </div>
      </fieldset></form>
    </Modal>
  );
}

function DigestModal({ saas, onClose }) {
  const [attempt, setAttempt] = useS(0);
  const [digest, setDigest] = useS(null);
  const [err, setErr] = useS("");
  useE(() => {
    let alive = true;
    setErr("");
    api.blogDigest(saas).then((d) => { if (alive) setDigest(d); }).catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [saas, attempt]);
  return (
    <Modal onClose={onClose} width={780} label="Contexto da IA">
      <div className="card-title">O que a IA lê antes de propor pautas</div>
      <div className="card-sub" style={{ marginTop: 2 }}>Agregados anonimizados de formulários, calls, WhatsApp e resultados. Nenhum nome ou telefone sai daqui.</div>
      {err && <div role="alert" className="blog-error">Não deu para carregar: {err} <button onClick={() => setAttempt(n => n + 1)}>Tentar novamente</button></div>}
      {!digest && !err && <div className="mono dim" style={{ fontSize: 12, marginTop: 14 }}>carregando…</div>}
      {digest && (
        <>
          <div className="mono dim" style={{ fontSize: 11, marginTop: 12 }}>montado {digest.builtAt ? fmtAt(digest.builtAt) : "agora"}{digest.counts ? ` · ${Object.entries(digest.counts).map(([k, v]) => `${v} ${k}`).join(" · ")}` : ""}</div>
          <pre className="code" style={{ marginTop: 10, padding: "12px 14px", background: "var(--bg-2)", borderRadius: "var(--r-2)", fontSize: 11.5, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: "60vh", overflow: "auto" }}>{digest.text || "(vazio)"}</pre>
        </>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
        <SecondaryButton onClick={onClose}>Fechar</SecondaryButton>
      </div>
    </Modal>
  );
}

// ── Editor do post (drawer) ─────────────────────────────────────────────────
const EDITABLE = ["title", "slug", "description", "keyword", "intent", "category", "tags", "body", "faq"];
const pick = (doc) => ({
  title: doc.title || "", slug: doc.slug || "", description: doc.description || "", keyword: doc.keyword || "",
  intent: doc.intent || "informacional", category: doc.category || "",
  tags: Array.isArray(doc.tags) ? doc.tags : [], body: doc.body || "",
  faq: Array.isArray(doc.faq) ? doc.faq.map((f) => ({ q: f?.q || "", a: f?.a || "" })) : [],
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function PostDrawer({ saas, id, rules, nextSlot, admin, onClose, onChanged }) {
  const [doc, setDoc] = useS(null);
  const [form, setForm] = useS(null);
  const [err, setErr] = useS("");
  const [busy, setBusy] = useS(""); // qual ação está rodando
  const [view, setView] = useS("editar");
  const [preview, setPreview] = useS(null); // { url, expiresAt }
  const [instruction, setInstruction] = useS("");
  const [when, setWhen] = useS(""); // datetime-local opcional do approve
  const [tagsText, setTagsText] = useS("");
  const [lintErr, setLintErr] = useS([]); // lint que veio numa 422
  const dirty = !!(doc && form && !same(pick(doc), form));
  const writing = useR(false);
  const readVersion = useR(0);
  const [actionError, setActionError] = useS("");

  const load = useC(async () => {
    const revision = ++readVersion.current;
    try {
      const d = await api.blogPost(saas, id);
      if (revision !== readVersion.current) return;
      setDoc(d); setForm(pick(d)); setTagsText((d.tags || []).join(", ")); setErr("");
    } catch (e) { if (revision === readVersion.current) setErr(e.message); }
  }, [saas, id]);
  useE(() => { setDoc(null); setForm(null); setPreview(null); setView("editar"); load(); return () => { readVersion.current++; }; }, [load]);

  function tryClose() {
    if (writing.current) return;
    if (dirty && !window.confirm("Descartar as alterações não salvas deste post?")) return;
    onClose();
  }

  const set = (k, v) => { if (!writing.current) setForm((f) => ({ ...f, [k]: v })); };

  async function run(label, fn, okMsg, { saveFirst = false, reload = true } = {}) {
    if (writing.current) return null;
    writing.current = true;
    setBusy(label); setLintErr([]); setActionError("");
    try {
      if (saveFirst && dirty) await api.blogUpdate(saas, id, patchBody());
      const r = await fn();
      if (okMsg) toast(okMsg, "pos");
      if (reload) await load();
      onChanged();
      return r;
    } catch (e) {
      const lint = lintFromError(e);
      if (lint.length) setLintErr(lint);
      setActionError(e.message);
      toast(`${e.message} · tente de novo`, "neg");
      return null;
    } finally { writing.current = false; setBusy(""); }
  }

  const patchBody = () => {
    const out = {};
    for (const k of EDITABLE) {
      if (k === "slug" && doc.slugLocked) continue;
      if (!same(form[k], pick(doc)[k])) out[k] = form[k];
    }
    return out;
  };
  const salvar = () => {
    const patch = patchBody();
    if (!Object.keys(patch).length) { toast("nada pra salvar", "neutral"); return Promise.resolve(); }
    return run("salvar", () => api.blogUpdate(saas, id, patch), "post salvo");
  };
  // Ações que mudam de estado salvam antes, senão o servidor age sobre o texto velho.
  const saveThen = (label, fn, okMsg) => () => run(label, fn, okMsg, { saveFirst: true });

  async function abrirPreview() {
    if (writing.current) return;
    if (preview && new Date(preview.expiresAt).getTime() > Date.now() + 60_000 && !dirty) { setView("preview"); return; }
    await run("preview", async () => { const result = await api.blogPreviewUrl(saas, id); setPreview(result); setView("preview"); return result; }, null, { saveFirst: true });
  }
  useE(() => {
    if (!dirty) return;
    const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const st = doc?.status;
  const lint = Array.isArray(doc?.lint) ? doc.lint : [];
  const { erros } = lintCounts(lint);
  const allLint = lintErr.length ? lintErr : lint;
  const categorias = useM(() => {
    const base = Array.isArray(rules?.categorias) ? rules.categorias : [];
    return form?.category && !base.includes(form.category) ? [form.category, ...base] : base;
  }, [rules, form?.category]);
  const siteUrl = `leverads.com.br/blog/${form?.slug || ""}`;

  return (
    inPortal(<Drawer onClose={tryClose} fechavel={!busy} label="post do blog" largura={760} style={{zIndex:1400}} painelStyle={{overflow:"hidden"}}>
      <div className="blog-editor">
        <div className="blog-editor-head" style={{ padding: "14px 20px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div className="kicker" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {doc ? <StatusChip status={st} /> : "post"}
              {doc?.status === "agendado" && <span>sai {fmtSlot(doc.scheduledAt)}</span>}
              {doc?.status === "publicado" && <span>no ar desde {fmtDay(doc.publishedAt)}</span>}
              {doc?.updatedAt && <span>· editado {fmtAt(doc.updatedAt)}</span>}
              {dirty && <span style={{ color: "var(--warn)" }}>· alterações não salvas</span>}
            </div>
            <div style={{ fontSize: 17, fontWeight: 600, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{form?.title || doc?.title || "carregando…"}</div>
          </div>
          <fieldset disabled={!!busy} className="blog-fields blog-editor-actions" style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            {doc && st !== "pauta" && <Segmented value={view} onChange={(v) => (v === "preview" ? abrirPreview() : setView("editar"))} options={[{ value: "editar", label: "Editar" }, { value: "preview", label: "Preview" }]} />}
            <button onClick={tryClose} className="mono dim" style={{ fontSize: 16, padding: "0 4px" }} aria-label="fechar">✕</button>
          </fieldset>
        </div>

        {actionError && <div role="alert" className="blog-error">{actionError} · tente novamente.</div>}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {err && <div role="alert" style={{ padding: 20, color: "var(--neg)", fontSize: 12.5 }}>não deu pra carregar: {err} <button className="mono" style={{ color: "var(--accent)", marginLeft: 6 }} onClick={load}>tentar de novo</button></div>}
          {!doc && !err && <div className="mono dim" style={{ fontSize: 12, padding: 20 }}>carregando…</div>}

          {doc && view === "preview" && (
            <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
              <div style={{ padding: "8px 20px", borderBottom: "1px solid var(--line-1)", display: "flex", gap: 10, alignItems: "center", fontSize: 12 }}>
                <span className="dim">Como o post fica no site. Link válido por 30 minutos.</span>
                <span style={{ flex: 1 }} />
                {preview?.url && <a href={preview.url} target="_blank" rel="noreferrer" style={{ fontWeight: 600, color: "var(--accent)" }}>abrir em nova aba ↗</a>}
              </div>
              {preview?.url
                ? <iframe title="preview do post" src={preview.url} style={{ flex: 1, width: "100%", border: 0, background: "#fff" }} />
                : <div className="mono dim" style={{ fontSize: 12, padding: 20 }}>montando o preview…</div>}
            </div>
          )}

          {doc && form && view === "editar" && (
            <fieldset className="blog-fields blog-editor-fields" disabled={!!busy || (st === "publicado" && !admin)} style={{ padding: "16px 20px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
              {(lintErr.length > 0 || (st !== "pauta" && lint.length > 0)) && (
                <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", padding: "12px 14px", background: "var(--bg-inset)" }}>
                  <div className="kicker" style={{ color: erros || lintErr.some((i) => i.level === "erro") ? "var(--neg)" : "var(--warn)" }}>
                    pente fino {lintErr.length ? "(o servidor recusou por isto)" : ""}
                  </div>
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 3 }}>
                    {allLint.map((i, n) => (
                      <li key={n} style={{ fontSize: 12.5, color: i.level === "erro" ? "var(--neg)" : "var(--fg-2)" }}>
                        <span className="mono" style={{ fontSize: 11 }}>{i.level === "erro" ? "erro" : "aviso"}</span> · {i.msg || i.code}
                      </li>
                    ))}
                  </ul>
                  <div className="dim" style={{ fontSize: 11.5, marginTop: 6 }}>Erro bloqueia aprovar e publicar. Corrija na mão ou mande a IA reescrever com uma instrução.</div>
                </div>
              )}

              {st === "pauta" && (
                <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", padding: "12px 14px", background: "var(--bg-inset)", fontSize: 12.5, lineHeight: 1.5 }}>
                  <div className="kicker accent">pauta</div>
                  <div style={{ marginTop: 4 }}>Ainda sem texto. A IA escreve o rascunho a partir do ângulo e do roteiro abaixo, ou você manda escrever agora.</div>
                </div>
              )}

              <div className="resp-cols" style={{ "--cols": "minmax(0, 1fr) minmax(0, 1fr)", gap: "12px 16px" }}>
                <div style={{ gridColumn: "1 / -1" }}>
                  <Label right={<span style={{ color: form.title.length > 60 ? "var(--neg)" : undefined }}>{form.title.length}/60</span>}>título</Label>
                  <input aria-label="Título do post" className="inp" value={form.title} onChange={(e) => set("title", e.target.value)} style={{ width: "100%", marginTop: 4, fontSize: 14, fontWeight: 600 }} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <Label right={doc.slugLocked ? "URL travada depois de publicada" : "só letras, números e hífen"}>slug</Label>
                  <input aria-label="Slug do post" className="inp" value={form.slug} disabled={!!doc.slugLocked} onChange={(e) => set("slug", e.target.value.toLowerCase())} placeholder="gerado a partir do título" style={{ width: "100%", marginTop: 4 }} />
                  <div className="mono dim" style={{ fontSize: 11, marginTop: 3, wordBreak: "break-all" }}>{siteUrl}</div>
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <Label right={<span style={{ color: form.description.length > 155 ? "var(--neg)" : form.description.length < 70 && form.description.length > 0 ? "var(--warn)" : undefined }}>{form.description.length}/155</span>}>descrição (meta)</Label>
                  <textarea aria-label="Descrição do post" className="inp" value={form.description} onChange={(e) => set("description", e.target.value)} rows={2} style={{ width: "100%", marginTop: 4, height: "auto", padding: "7px 10px", resize: "vertical", lineHeight: 1.45 }} />
                </div>
                <div>
                  <Label>palavra-chave</Label>
                  <input aria-label="Palavra-chave do post" className="inp" value={form.keyword} onChange={(e) => set("keyword", e.target.value)} style={{ width: "100%", marginTop: 4 }} />
                </div>
                <div>
                  <Label>intenção</Label>
                  <select aria-label="Intenção do post" className="inp" value={form.intent} onChange={(e) => set("intent", e.target.value)} style={{ width: "100%", marginTop: 4 }}>
                    {INTENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <Label>categoria</Label>
                  <select aria-label="Categoria do post" className="inp" value={form.category} onChange={(e) => set("category", e.target.value)} style={{ width: "100%", marginTop: 4 }}>
                    {!form.category && <option value="">escolha…</option>}
                    {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <Label right="separe por vírgula">tags</Label>
                  <input aria-label="Tags do post" className="inp" value={tagsText} onChange={(e) => { setTagsText(e.target.value); set("tags", e.target.value.split(",").map(t => t.trim()).filter(Boolean)); }}
                    onBlur={() => set("tags", tagsText.split(",").map((t) => t.trim()).filter(Boolean))}
                    style={{ width: "100%", marginTop: 4 }} />
                </div>
              </div>

              {st !== "pauta" && (
                <div>
                  <Label right={`${doc.wordCount || 0} palavras · ${doc.readingMin || 1} min de leitura · markdown`}>texto</Label>
                  <textarea aria-label="Texto do post" className="inp code" value={form.body} onChange={(e) => set("body", e.target.value)} spellCheck
                    style={{ width: "100%", marginTop: 4, height: "auto", minHeight: "60vh", padding: "10px 12px", resize: "vertical", fontSize: 12.5, lineHeight: 1.55 }} />
                </div>
              )}

              {st !== "pauta" && (
                <div>
                  <Label right={`${form.faq.length} ${form.faq.length === 1 ? "pergunta" : "perguntas"}`}>perguntas frequentes</Label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
                    {form.faq.map((f, i) => (
                      <div key={i} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: "8px 10px", background: "var(--bg-inset)", display: "flex", flexDirection: "column", gap: 6 }}>
                        <div style={{ display: "flex", gap: 8 }}>
                          <input aria-label={`Pergunta frequente ${i + 1}`} className="inp" value={f.q} placeholder="pergunta" onChange={(e) => set("faq", form.faq.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))} style={{ flex: 1, fontWeight: 500 }} />
                          <button className="mono dim" title="remover pergunta" onClick={() => set("faq", form.faq.filter((_, j) => j !== i))} style={{ fontSize: 14, padding: "0 6px" }}>✕</button>
                        </div>
                        <textarea aria-label={`Resposta frequente ${i + 1}`} className="inp" value={f.a} placeholder="resposta" rows={2} onChange={(e) => set("faq", form.faq.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} style={{ width: "100%", height: "auto", padding: "7px 10px", resize: "vertical", lineHeight: 1.45 }} />
                      </div>
                    ))}
                    <div><SecondaryButton size="sm" onClick={() => set("faq", [...form.faq, { q: "", a: "" }])}>+ pergunta</SecondaryButton></div>
                  </div>
                </div>
              )}

              <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", padding: "12px 14px", background: "var(--bg-inset)" }}>
                <div className="kicker accent">de onde veio</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8, fontSize: 12.5, lineHeight: 1.5 }}>
                  {doc.angle && <div><span className="dim">Ângulo: </span>{doc.angle}</div>}
                  {Array.isArray(doc.outline) && doc.outline.length > 0 && (
                    <div><span className="dim">Roteiro: </span>{doc.outline.join(" · ")}</div>
                  )}
                  {Array.isArray(doc.evidence) && doc.evidence.length > 0 && (
                    <div>
                      <span className="dim">Evidências do cockpit:</span>
                      <ul style={{ margin: "3px 0 0", paddingLeft: 18 }}>{doc.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
                    </div>
                  )}
                  {Array.isArray(doc.sources) && doc.sources.length > 0 && (
                    <div>
                      <span className="dim">Fontes usadas: </span>
                      <span className="mono" style={{ fontSize: 11 }}>{doc.sources.map((s) => `${s.type || "fonte"}:${s.ref || ""}`).join(" · ")}</span>
                    </div>
                  )}
                  {doc.ai?.model && (
                    <div className="mono dim" style={{ fontSize: 11 }}>
                      {doc.ai.model} · prompt {doc.ai.promptVersion || "?"} · {doc.ai.generatedAt ? fmtAt(doc.ai.generatedAt) : ""}
                      {doc.ai.usage && (doc.ai.usage.input_tokens || doc.ai.usage.prompt_tokens) ? ` · ${(doc.ai.usage.input_tokens || doc.ai.usage.prompt_tokens || 0) + (doc.ai.usage.output_tokens || doc.ai.usage.completion_tokens || 0)} tokens` : ""}
                      {doc.edited ? " · editado à mão depois" : ""}
                    </div>
                  )}
                  {!doc.angle && !doc.ai?.model && !(doc.evidence || []).length && <div className="dim">Pauta criada à mão.</div>}
                </div>
              </div>

              {Array.isArray(doc.history) && doc.history.length > 0 && (
                <div>
                  <div className="kicker">histórico</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 6 }}>
                    {[...doc.history].slice(-12).reverse().map((h, i) => (
                      <div key={i} className="mono dim" style={{ fontSize: 11 }}>
                        {fmtAt(h.at)} · {h.action}{h.by ? ` · ${h.by === "cockpit" ? "motor" : displayName(h.by) || h.by}` : ""}{h.note ? ` · ${h.note}` : ""}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", padding: "12px 14px" }}>
                <div className="kicker accent">inteligência artificial</div>
                {st === "pauta" ? (
                  <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12.5, flex: 1, minWidth: 200 }}>Escrever o rascunho agora, com o conhecimento da empresa e as evidências acima.</span>
                    <PrimaryButton disabled={!!busy} onClick={saveThen("draft", () => api.blogDraft(saas, id), "rascunho escrito")}>{busy === "draft" ? "escrevendo…" : "Gerar rascunho"}</PrimaryButton>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                    <input aria-label="Instrução para reescrever" className="inp" value={instruction} onChange={(e) => setInstruction(e.target.value)} maxLength={600}
                      placeholder="ex.: encurte a introdução e troque o exemplo por autopeças" style={{ flex: 1, minWidth: 220 }} />
                    <SecondaryButton disabled={!!busy || !instruction.trim()}
                      onClick={saveThen("revise", () => api.blogRevise(saas, id, instruction.trim()).then((r) => { setInstruction(""); return r; }), "texto reescrito")}>
                      {busy === "revise" ? "reescrevendo…" : "Reescrever com IA"}
                    </SecondaryButton>
                    {st === "rascunho" && !doc.slugLocked && (
                      <SecondaryButton disabled={!!busy} title="Joga o texto fora e escreve de novo a partir da pauta"
                        onClick={() => { if (window.confirm("Escrever de novo do zero? O texto atual deste rascunho é descartado.")) run("draft", () => api.blogDraft(saas, id, true), "rascunho reescrito do zero"); }}>
                        {busy === "draft" ? "escrevendo…" : "Do zero"}
                      </SecondaryButton>
                    )}
                  </div>
                )}
              </div>
            </fieldset>
          )}
        </div>

        {doc && form && (
          <div className="blog-editor-footer" style={{ padding: "12px 20px", borderTop: "1px solid var(--line-1)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", flexShrink: 0, background: "var(--bg-1)" }}>
            {st === "pauta" && (
              <>
                <SecondaryButton disabled={!!busy} onClick={salvar}>{busy === "salvar" ? "salvando…" : "Salvar"}</SecondaryButton>
                <span style={{ flex: 1 }} />
                <SecondaryButton disabled={!!busy} style={{ color: "var(--neg)" }} onClick={() => { if (window.confirm(`Arquivar a pauta "${doc.title}"? Ela sai da fila e a IA não escreve sobre ela.`)) run("archive", () => api.blogAction(saas, id, "archive"), "pauta arquivada"); }}>Arquivar</SecondaryButton>
              </>
            )}
            {st === "rascunho" && (
              <>
                <SecondaryButton disabled={!!busy} onClick={salvar}>{busy === "salvar" ? "salvando…" : "Salvar"}</SecondaryButton>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <PrimaryButton disabled={!!busy || erros > 0} onClick={saveThen("approve", () => api.blogAction(saas, id, "approve", when ? { scheduledAt: brtLocalToIso(when) } : {}), "aprovado e agendado")}>
                    {busy === "approve" ? "agendando…" : "Aprovar e agendar"}
                  </PrimaryButton>
                  <input aria-label="Data e hora da publicação" disabled={!!busy} type="datetime-local" className="inp" value={when} onChange={(e) => setWhen(e.target.value)} title="Opcional: outro dia e hora (Brasília). Vazio = próximo slot da cadência." style={{ width: 190 }} />
                  <span className="dim" style={{ fontSize: 11.5 }}>{when ? "no horário escolhido" : nextSlot ? `próximo slot ${fmtSlot(nextSlot)}` : "próximo slot da cadência"}</span>
                </div>
                <span style={{ flex: 1 }} />
                {admin && <SecondaryButton disabled={!!busy || erros > 0} onClick={() => { if (window.confirm(`Publicar "${doc.title}" agora? O post vai pro ar em leverads.com.br/blog e a URL trava.`)) saveThen("publish", () => api.blogAction(saas, id, "publish"), "publicado")(); }}>{busy === "publish" ? "publicando…" : "Publicar agora"}</SecondaryButton>}
                <SecondaryButton disabled={!!busy} style={{ color: "var(--neg)" }} onClick={() => { if (window.confirm(`Arquivar o rascunho "${doc.title}"? Ele sai da fila de revisão.`)) run("archive", () => api.blogAction(saas, id, "archive"), "rascunho arquivado"); }}>Arquivar</SecondaryButton>
              </>
            )}
            {st === "agendado" && (
              <>
                <SecondaryButton disabled={!!busy} onClick={salvar}>{busy === "salvar" ? "salvando…" : "Salvar"}</SecondaryButton>
                <SecondaryButton disabled={!!busy} onClick={() => run("unschedule", () => api.blogAction(saas, id, "unschedule"), "voltou pra rascunho")}>Voltar pra rascunho</SecondaryButton>
                <span style={{ flex: 1 }} />
                {admin && <PrimaryButton disabled={!!busy || erros > 0} onClick={() => { if (window.confirm(`Publicar "${doc.title}" agora, sem esperar ${fmtSlot(doc.scheduledAt)}?`)) saveThen("publish", () => api.blogAction(saas, id, "publish"), "publicado")(); }}>{busy === "publish" ? "publicando…" : "Publicar agora"}</PrimaryButton>}
                <SecondaryButton disabled={!!busy} style={{ color: "var(--neg)" }} onClick={() => { if (window.confirm(`Arquivar "${doc.title}"? Sai da agenda e não vai pro ar.`)) run("archive", () => api.blogAction(saas, id, "archive"), "arquivado"); }}>Arquivar</SecondaryButton>
              </>
            )}
            {st === "publicado" && (
              <>
                {admin ? <SecondaryButton disabled={!!busy} onClick={salvar}>{busy === "salvar" ? "salvando…" : "Salvar"}</SecondaryButton> : <span className="dim" style={{ fontSize: 12 }}>Post no ar: só admin edita.</span>}
                <a href={`https://${siteUrl}`} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)" }}>abrir no site ↗</a>
                <span style={{ flex: 1 }} />
                {admin && <SecondaryButton disabled={!!busy} onClick={() => { if (window.confirm(`Despublicar "${doc.title}"? Some do site em até 5 minutos e volta pra rascunho (a URL continua reservada).`)) run("unpublish", () => api.blogAction(saas, id, "unpublish"), "despublicado"); }}>Despublicar</SecondaryButton>}
                {admin && <SecondaryButton disabled={!!busy} style={{ color: "var(--neg)" }} onClick={() => { if (window.confirm(`Arquivar "${doc.title}"? Some do site em até 5 minutos e sai da lista.`)) run("archive", () => api.blogAction(saas, id, "archive"), "arquivado"); }}>Arquivar</SecondaryButton>}
              </>
            )}
            {st === "arquivado" && (
              <>
                <SecondaryButton disabled={!!busy} onClick={() => run("restore", () => api.blogAction(saas, id, "restore"), "restaurado")}>Restaurar</SecondaryButton>
                <span style={{ flex: 1 }} />
                <SecondaryButton disabled={!!busy} style={{ color: "var(--neg)" }} onClick={() => { if (window.confirm(`Excluir "${doc.title}" de vez? Não tem volta.`)) run("delete", () => api.blogDelete(saas, id).then(() => onClose()), "excluído", { reload: false }); }}>Excluir</SecondaryButton>
              </>
            )}
          </div>
        )}
      </div>
    </Drawer>)
  );
}

// ── A tela ──────────────────────────────────────────────────────────────────
function BlogScreen() {
  const [product] = useActiveSaas();
  return <BlogWorkspace key={product?.id} />;
}
function BlogWorkspace() {
  const [product] = useActiveSaas();
  const saas = product?.id || "";
  const [data, setData] = useS(null);
  const [err, setErr] = useS(null);
  const [tab, setTab] = useS("todos");
  const [q, setQ] = useS("");
  const [selId, setSelId] = useS(null);
  const [newOpen, setNewOpen] = useS(false);
  const [digestOpen, setDigestOpen] = useS(false);
  const [busy, setBusy] = useS("");
  const admin = isAdminUser();
  const tabPicked = useR(false);
  const writing = useR(false);
  const readVersion = useR(0);

  const load = useC(async () => {
    if (!saas) { setData({ posts: [], counts: {}, rules: {}, state: {} }); return; }
    const revision = ++readVersion.current;
    try {
      const d = await api.blog(saas);
      if (revision !== readVersion.current) return;
      setData(d); setErr(null);
      // Primeira carga: se tem rascunho esperando, a tela abre nele (é o que
      // pede ação). Depois disso a aba é escolha da pessoa.
      if (!tabPicked.current) { tabPicked.current = true; if ((d?.counts?.rascunho || 0) > 0) setTab("rascunho"); }
    } catch (e) { if (revision === readVersion.current) setErr(e.message); }
  }, [saas]);
  useE(() => { setData(null); setSelId(null); tabPicked.current = false; load(); return () => { readVersion.current++; }; }, [load]);

  // O motor grava fora da tela: SSE avisa e a lista recarrega (com folga de 2s
  // pra não repintar a cada gravação em rajada).
  useE(() => {
    if (typeof window === "undefined") return undefined;
    let timer = null;
    const on = (e) => {
      const c = e.detail?.collection;
      if (c && c !== "blog_posts" && c !== "app_config") return;
      if (timer) return;
      timer = setTimeout(() => { timer = null; load(); }, 2000);
    };
    window.addEventListener("cockpit-change", on);
    return () => { window.removeEventListener("cockpit-change", on); if (timer) clearTimeout(timer); };
  }, [load]);

  async function gerarPautas() {
    if (writing.current) return; writing.current = true;
    setBusy("pautas");
    try {
      const r = await api.blogMine(saas, {});
      const n = Array.isArray(r?.created) ? r.created.length : 0;
      toast(n ? `${n} ${n === 1 ? "pauta nova" : "pautas novas"}${r.dropped ? ` (${r.dropped} repetidas descartadas)` : ""}` : "nenhuma pauta nova: a IA só repetiu o que já existe", n ? "pos" : "warn");
      await load();
      if (n) setTab("pauta");
    } catch (e) { toast(`não deu pra gerar pautas: ${e.message}`, "neg"); }
    finally { writing.current = false; setBusy(""); }
  }
  async function rodarAgora() {
    if (writing.current) return; writing.current = true;
    setBusy("tick");
    try {
      const r = await api.blogTick(saas);
      const partes = [];
      if (r?.mined) partes.push(`${r.mined} ${r.mined === 1 ? "pauta" : "pautas"}`);
      if (r?.drafted) partes.push(`${r.drafted} rascunho`);
      if (r?.scheduled) partes.push(`${r.scheduled} agendado`);
      if (r?.published) partes.push(`${r.published} publicado`);
      const errs = Array.isArray(r?.errors) ? r.errors.length : 0;
      toast(partes.length ? `ciclo rodou: ${partes.join(", ")}${errs ? ` · ${errs} erro` : ""}` : errs ? `ciclo rodou com ${errs} erro: veja o estado do motor` : "ciclo rodou: nada a fazer agora", errs ? "warn" : "pos");
      await load();
    } catch (e) { toast(`não deu pra rodar: ${e.message}`, "neg"); }
    finally { writing.current = false; setBusy(""); }
  }

  const posts = data?.posts || [];
  const counts = data?.counts || {};
  const countOf = (s) => counts[s] ?? posts.filter((p) => p.status === s).length;
  const term = q.trim().toLowerCase();
  const visiveis = useM(() => posts
    .filter((p) => tab === "todos" ? p.status !== "arquivado" : p.status === tab)
    .filter((p) => !term || `${p.title || ""} ${p.keyword || ""} ${p.category || ""} ${p.slug || ""}`.toLowerCase().includes(term))
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""))), [posts, tab, term]);
  const publicados30 = posts.filter((p) => p.status === "publicado" && p.publishedAt && Date.now() - new Date(p.publishedAt).getTime() < 30 * 86400000).length;
  const ultimoPub = posts.filter((p) => p.status === "publicado" && p.publishedAt).sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))[0];
  const categorias = Array.isArray(data?.rules?.categorias) ? data.rules.categorias : [];
  const semSaas = data && !saas;

  return (
    <div className="marketing-page blog-page" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <header className="blog-head"><h1>Blog</h1><div>        <SecondaryButton disabled={!!busy || !saas || !data?.aiConfigured} title={data && !data.aiConfigured ? "IA não configurada no servidor" : "A IA propõe temas novos agora"} onClick={gerarPautas}>{busy === "pautas" ? "gerando…" : "Gerar pautas"}</SecondaryButton>
        <SecondaryButton disabled={!!busy || !saas} title="Roda um ciclo do motor agora: pauta, rascunho e publicação do que venceu" onClick={rodarAgora}>{busy === "tick" ? "rodando…" : "Rodar ciclo agora"}</SecondaryButton>
        <PrimaryButton disabled={!saas || !!busy} onClick={() => setNewOpen(true)}>Criar pauta</PrimaryButton>
</div></header>

      <div className="blog-body">
        {data && countOf("rascunho") > 0 && <section className="blog-review-call"><span /><div><strong>{countOf("rascunho")} rascunho{countOf("rascunho") === 1 ? "" : "s"} esperando revisão</strong><p>A IA escreveu. Falta conferir o texto e aprovar a publicação.</p></div><PrimaryButton onClick={() => { setTab("rascunho"); setQ(""); }}>Revisar agora</PrimaryButton></section>}

        {data !== null && !semSaas && (
          <div>
            <AutomacaoCard saas={saas} rules={data.rules} state={data.state} aiConfigured={!!data.aiConfigured} nextSlot={data.nextSlot} admin={admin}
              onRules={(rules, state) => { readVersion.current++; setData((d) => ({ ...d, rules, state: state || d.state })); }}
              onDigest={() => setDigestOpen(true)} />
          </div>
        )}

        <div className="blog-filters">
          <FilterTab active={tab === "todos"} count={posts.filter((p) => p.status !== "arquivado").length} onClick={() => setTab("todos")}>Todos</FilterTab>
          {STATUS.map((s) => (
            <FilterTab key={s.id} active={tab === s.id} count={countOf(s.id)} onClick={() => setTab(s.id)}>{s.label}s</FilterTab>
          ))}
          <span style={{ flex: 1 }} />
          <input aria-label="Buscar posts" type="search" value={q} onChange={(e) => setQ(e.target.value)} className="inp" placeholder="buscar título, palavra-chave…" style={{ width: "min(100%, 260px)" }} />
        </div>

        {err && <div role="alert" style={{ marginTop: 14, color: "var(--neg)", fontSize: 12.5 }}>não deu pra carregar: {err} <button className="mono" style={{ color: "var(--accent)", marginLeft: 6 }} onClick={load}>tentar de novo</button></div>}

        <section className="blog-list">
          {data === null && !err && <div role="status" className="mono dim" style={{ fontSize: 12, padding: 20 }}>carregando…</div>}
          {data !== null && semSaas && <EmptyState title="Escolha um produto" hint="O blog é por produto: selecione o workspace na barra lateral." />}
          {data !== null && !semSaas && !visiveis.length && (
            <EmptyState
              title={posts.length ? "Nada nesse filtro" : "Nenhuma pauta ainda"}
              hint={posts.length ? "Troque a aba ou limpe a busca." : "Clique em Gerar pautas: a IA lê o que o cockpit aprendeu com leads, calls e WhatsApp e propõe os primeiros temas. Ou crie uma pauta na mão."}
              action={!posts.length ? <PrimaryButton disabled={!!busy || !data?.aiConfigured} onClick={gerarPautas}>Gerar pautas</PrimaryButton> : null}
            />
          )}
          {data !== null && !semSaas && !!visiveis.length && (
            <div className="tbl-x">
              <table className="marketing-table" style={{ tableLayout: "fixed", minWidth: 640 }}>
                <colgroup><col style={{ width: "40%" }} /><col style={{ width: "14%" }} /><col style={{ width: "16%" }} /><col style={{ width: "13%" }} /><col style={{ width: "17%" }} /></colgroup>
                <thead><tr><th>Título</th><th>Estado</th><th>Categoria</th><th>Pente fino</th><th>Quando</th></tr></thead>
                <tbody>{visiveis.map((p) => <tr key={p.id}>
                  <td>
                    <button onClick={() => setSelId(p.id)} style={{ textAlign: "left", fontSize: 13.5, fontWeight: 600, lineHeight: 1.4, color: "var(--fg-1)", width: "100%" }}>{p.title || "(sem título)"}</button>
                    <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginTop: 3 }}>{[p.keyword, p.wordCount ? `${p.wordCount.toLocaleString("pt-BR")} palavras` : ""].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td><StatusChip status={p.status} /></td>
                  <td style={{ color: "var(--fg-3)", overflowWrap: "anywhere" }}>{p.category || "–"}</td>
                  <td><button onClick={() => setSelId(p.id)} title="Abrir a revisão e os motivos do pente fino"><LintChip post={p} /></button></td>
                  <td className="tnum" style={{ fontSize: 11.5, color: "var(--fg-3)" }}>{dateOf(p)}</td>
                </tr>)}</tbody>
              </table>
            </div>
          )}
        </section>
        {data !== null && !semSaas && visiveis.length > 0 && (
          <div className="mono dim" style={{ fontSize: 11, marginTop: 8 }}>{visiveis.length} de {posts.length} posts · <InfoLink texto={`${publicados30} publicados nos últimos 30 dias${ultimoPub ? ` · última publicação ${fmtDay(ultimoPub.publishedAt)}` : ""}`}>publicações no período</InfoLink></div>
        )}
      </div>

      {newOpen && (
        <NewPautaModal saas={saas} categorias={categorias} onClose={() => setNewOpen(false)}
          onCreated={(doc) => { setNewOpen(false); load(); setTab("pauta"); setSelId(doc?.id || null); }} />
      )}
      {digestOpen && <DigestModal saas={saas} onClose={() => setDigestOpen(false)} />}
      {selId && (
        <PostDrawer key={`${saas}:${selId}`} saas={saas} id={selId} rules={data?.rules} nextSlot={data?.nextSlot} admin={admin}
          onClose={() => setSelId(null)} onChanged={load} />
      )}
    </div>
  );
}

export { BlogScreen };
