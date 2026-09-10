import React from "react";
import { PageHead, StatTile, FilterTab, Segmented, Card } from "../components/viz.jsx";
import { EmptyState, PrimaryButton, SecondaryButton, useEsc, toast } from "../atoms.jsx";
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
  if (erros) return <span className="chip neg">{erros} {erros === 1 ? "erro" : "erros"}</span>;
  if (avisos) return <span className="chip warn">{avisos} {avisos === 1 ? "aviso" : "avisos"}</span>;
  return <span className="chip pos">ok</span>;
}

function StatusChip({ status }) {
  const s = statusOf(status);
  return <span className={`chip${s.chip ? ` ${s.chip}` : ""}`}>{s.label.toLowerCase()}</span>;
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
  <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1 }}>
    <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ width: 16, height: 16, marginTop: 2, accentColor: "var(--accent)", flexShrink: 0 }} />
    <span style={{ minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 500 }}>{children}</div>
      {hint && <div className="dim" style={{ fontSize: 11.5, marginTop: 1, lineHeight: 1.45 }}>{hint}</div>}
    </span>
  </label>
);

// ── Automação: as regras do motor ───────────────────────────────────────────
// Salva a cada mudança (PATCH parcial); a API devolve as regras saneadas, que
// voltam pro estado. Não-admin vê, não mexe (a API dá 403 de qualquer jeito).
function AutomacaoCard({ saas, rules, state, aiConfigured, nextSlot, admin, onRules, onDigest }) {
  const [saving, setSaving] = useS(false);
  const [local, setLocal] = useS(rules || {});
  useE(() => { setLocal(rules || {}); }, [rules]);

  async function patch(partial) {
    if (!admin) return;
    const before = local;
    setLocal((cur) => ({ ...cur, ...partial }));
    setSaving(true);
    try {
      const r = await api.blogSaveRules(saas, partial);
      if (r?.rules) { setLocal(r.rules); onRules(r.rules, r.state); }
      toast("automação salva", "pos");
    } catch (e) {
      setLocal(before);
      toast(`não deu pra salvar: ${e.message} · tente de novo`, "neg");
    } finally { setSaving(false); }
  }

  const dias = Array.isArray(local.diasPublicacao) ? local.diasPublicacao : [];
  const toggleDia = (d) => {
    const next = dias.includes(d) ? dias.filter((x) => x !== d) : [...dias, d];
    if (!next.length) { toast("deixe pelo menos um dia de publicação", "warn"); return; }
    patch({ diasPublicacao: next });
  };
  const num = (key, min, max) => (
    <input type="number" className="inp" min={min} max={max} disabled={!admin} value={local[key] ?? ""}
      onChange={(e) => setLocal((c) => ({ ...c, [key]: e.target.value }))}
      onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== rules?.[key]) patch({ [key]: v }); }}
      style={{ width: 72 }} />
  );

  return (
    <Card title="Automação" hint="O que o motor faz sozinho a cada 15 minutos. Publicar sem revisão fica desligado até você confiar no pente fino."
      action={saving ? <span className="mono dim" style={{ fontSize: 11 }}>salvando…</span> : null}>
      <div className="resp-cols" style={{ "--cols": "minmax(0, 1.5fr) minmax(0, 1fr)", gap: "18px 28px", padding: "14px var(--inset-x) 20px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <Toggle checked={local.enabled} disabled={!admin} onChange={(v) => patch({ enabled: v })} hint="Desligado, nada roda: nem pauta, nem rascunho, nem publicação agendada.">Motor ligado</Toggle>
          <Toggle checked={local.autoPauta} disabled={!admin || !local.enabled} onChange={(v) => patch({ autoPauta: v })} hint="Quando a fila de pautas fica curta, a IA propõe temas novos a partir do que o cockpit aprendeu.">Minerar pautas sozinho</Toggle>
          <Toggle checked={local.autoRascunho} disabled={!admin || !local.enabled} onChange={(v) => patch({ autoRascunho: v })} hint="Um rascunho por ciclo, com limite diário. Você revisa antes de ir pro ar.">Escrever rascunhos sozinho</Toggle>
          <Toggle checked={local.autoPublicar} disabled={!admin || !local.enabled}
            onChange={(v) => {
              if (v && !window.confirm("Publicar sem revisão humana? O lint bloqueia preço, travessão e nome de cliente, mas não lê o texto por você. Rascunhos aprovados pelo lint vão pro ar na cadência.")) return;
              patch({ autoPublicar: v });
            }}
            hint="Rascunho que passa no lint entra na agenda sem ninguém aprovar.">Publicar sem revisão</Toggle>

          <div className="resp-cols" style={{ "--cols": "repeat(3, minmax(0, 1fr))", gap: "10px 14px" }}>
            <div>
              <Label>por semana</Label>
              <select className="inp" disabled={!admin} value={local.cadenciaSemanal || 2} onChange={(e) => patch({ cadenciaSemanal: Number(e.target.value) })} style={{ width: "100%", marginTop: 4 }}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} {n === 1 ? "post" : "posts"}</option>)}
              </select>
            </div>
            <div>
              <Label>hora (Brasília)</Label>
              <input type="time" className="inp" disabled={!admin} value={local.horaPublicacao || "09:00"}
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
                  <button key={id} disabled={!admin} onClick={() => toggleDia(id)} className="chip" aria-pressed={on} style={{
                    cursor: admin ? "pointer" : "default", fontWeight: 600, minWidth: 44, justifyContent: "center",
                    background: on ? "var(--accent-soft)" : "var(--bg-2)",
                    color: on ? "var(--accent)" : "var(--fg-3)",
                    boxShadow: on ? "inset 0 0 0 1px var(--accent-line)" : "none",
                  }}>{label}</button>
                );
              })}
            </div>
          </div>

          <div>
            <Label>link do CTA nos posts</Label>
            <input type="url" className="inp" disabled={!admin} value={local.ctaUrl || ""}
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
          {!aiConfigured && <div className="dim" style={{ fontSize: 11.5, lineHeight: 1.45 }}>Sem OPENROUTER_API_KEY no servidor o motor só publica o que já estiver agendado.</div>}
          <div style={{ marginTop: 4 }}>
            <SecondaryButton size="sm" onClick={onDigest}>Ver o que a IA lê</SecondaryButton>
          </div>
        </div>
      </div>
    </Card>
  );
}

const Line = ({ k, v, tone }) => (
  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5 }}>
    <span className="dim">{k}</span>
    <span className="tnum" style={{ textAlign: "right", color: tone === "pos" ? "var(--pos)" : tone === "neg" ? "var(--neg)" : "var(--fg-1)", fontWeight: 500 }}>{v}</span>
  </div>
);

// ── Modal simples (nova pauta, digest) ──────────────────────────────────────
function Modal({ onClose, busy, width = 560, children }) {
  useEsc(busy ? null : onClose);
  return (
    <div onClick={busy ? undefined : onClose} style={{ position: "fixed", inset: 0, background: "oklch(0 0 0 / 0.45)", display: "grid", placeItems: "center", zIndex: 80, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: `min(${width}px, 100%)`, maxHeight: "88vh", overflowY: "auto", background: "var(--bg-1)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-pop)", padding: 22 }}>
        {children}
      </div>
    </div>
  );
}

function NewPautaModal({ saas, categorias, onClose, onCreated }) {
  const [title, setTitle] = useS("");
  const [keyword, setKeyword] = useS("");
  const [category, setCategory] = useS(categorias[0] || "");
  const [busy, setBusy] = useS(false);
  const [err, setErr] = useS("");

  async function criar(e) {
    e?.preventDefault?.();
    if (!title.trim()) { setErr("dê um título pra pauta"); return; }
    setBusy(true); setErr("");
    try {
      const doc = await api.blogNewPauta(saas, { title: title.trim(), keyword: keyword.trim(), category });
      toast("pauta criada", "pos");
      onCreated(doc);
    } catch (e2) {
      setErr(e2.message);
    } finally { setBusy(false); }
  }

  return (
    <Modal onClose={onClose} busy={busy}>
      <form onSubmit={criar}>
        <div className="card-title">Nova pauta</div>
        <div className="card-sub" style={{ marginTop: 2 }}>Um tema que a IA vai transformar em rascunho. Título curto, como o leitor buscaria no Google.</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
          <div>
            <Label right={`${title.length}/60`}>título</Label>
            <input autoFocus className="inp" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Como operar várias contas de Mercado Livre sem duplicar trabalho" style={{ width: "100%", marginTop: 4 }} />
          </div>
          <div className="resp-cols" style={{ "--cols": "1fr 1fr", gap: 12 }}>
            <div>
              <Label>palavra-chave</Label>
              <input className="inp" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="várias contas mercado livre" style={{ width: "100%", marginTop: 4 }} />
            </div>
            <div>
              <Label>categoria</Label>
              <select className="inp" value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: "100%", marginTop: 4 }}>
                {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          {err && <div style={{ fontSize: 12.5, color: "var(--neg)" }}>{err}</div>}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <SecondaryButton onClick={onClose} disabled={busy}>Cancelar</SecondaryButton>
          <PrimaryButton onClick={criar} disabled={busy}>{busy ? "criando…" : "Criar pauta"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function DigestModal({ saas, onClose }) {
  const [digest, setDigest] = useS(null);
  const [err, setErr] = useS("");
  useE(() => {
    let alive = true;
    api.blogDigest(saas).then((d) => { if (alive) setDigest(d); }).catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [saas]);
  return (
    <Modal onClose={onClose} width={780}>
      <div className="card-title">O que a IA lê antes de propor pautas</div>
      <div className="card-sub" style={{ marginTop: 2 }}>Agregados anonimizados de formulários, calls, WhatsApp e resultados. Nenhum nome ou telefone sai daqui.</div>
      {err && <div style={{ fontSize: 12.5, color: "var(--neg)", marginTop: 12 }}>não deu pra carregar: {err}</div>}
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

  const load = useC(async () => {
    try {
      const d = await api.blogPost(saas, id);
      setDoc(d); setForm(pick(d)); setTagsText((d.tags || []).join(", ")); setErr("");
    } catch (e) { setErr(e.message); }
  }, [saas, id]);
  useE(() => { setDoc(null); setForm(null); setPreview(null); setView("editar"); load(); }, [load]);

  function tryClose() {
    if (busy) return;
    if (dirty && !window.confirm("Descartar as alterações não salvas deste post?")) return;
    onClose();
  }
  useEsc(busy ? null : tryClose);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function run(label, fn, okMsg) {
    setBusy(label); setLintErr([]);
    try {
      const r = await fn();
      if (okMsg) toast(okMsg, "pos");
      await load();
      onChanged();
      return r;
    } catch (e) {
      const lint = lintFromError(e);
      if (lint.length) setLintErr(lint);
      toast(`${e.message} · tente de novo`, "neg");
      return null;
    } finally { setBusy(""); }
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
  const saveThen = (label, fn, okMsg) => async () => {
    if (dirty) {
      const patch = patchBody();
      setBusy(label);
      try { await api.blogUpdate(saas, id, patch); }
      catch (e) { setBusy(""); setLintErr(lintFromError(e)); toast(`não deu pra salvar antes: ${e.message}`, "neg"); return; }
    }
    await run(label, fn, okMsg);
  };

  async function abrirPreview() {
    setView("preview");
    if (preview && new Date(preview.expiresAt).getTime() > Date.now() + 60_000 && !dirty) return;
    if (dirty) await salvar();
    try { setPreview(await api.blogPreviewUrl(saas, id)); }
    catch (e) { toast(`não deu pra montar o preview: ${e.message}`, "neg"); setView("editar"); }
  }

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
    <div onClick={tryClose} style={{ position: "fixed", inset: 0, background: "oklch(0 0 0 / 0.4)", display: "flex", justifyContent: "flex-end", zIndex: 70 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(880px, 100vw)", height: "100%", background: "var(--bg-1)", borderLeft: "1px solid var(--line-2)", display: "flex", flexDirection: "column", boxShadow: "var(--shadow-pop)" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexShrink: 0 }}>
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
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            {doc && st !== "pauta" && <Segmented value={view} onChange={(v) => (v === "preview" ? abrirPreview() : setView("editar"))} options={[{ value: "editar", label: "Editar" }, { value: "preview", label: "Preview" }]} />}
            <button onClick={tryClose} className="mono dim" style={{ fontSize: 16, padding: "0 4px" }} aria-label="fechar">✕</button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {err && <div style={{ padding: 20, color: "var(--neg)", fontSize: 12.5 }}>não deu pra carregar: {err} <button className="mono" style={{ color: "var(--accent)", marginLeft: 6 }} onClick={load}>tentar de novo</button></div>}
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
            <div style={{ padding: "16px 20px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
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
                  <input className="inp" value={form.title} onChange={(e) => set("title", e.target.value)} style={{ width: "100%", marginTop: 4, fontSize: 14, fontWeight: 600 }} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <Label right={doc.slugLocked ? "URL travada depois de publicada" : "só letras, números e hífen"}>slug</Label>
                  <input className="inp" value={form.slug} disabled={!!doc.slugLocked} onChange={(e) => set("slug", e.target.value.toLowerCase())} placeholder="gerado a partir do título" style={{ width: "100%", marginTop: 4 }} />
                  <div className="mono dim" style={{ fontSize: 11, marginTop: 3, wordBreak: "break-all" }}>{siteUrl}</div>
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <Label right={<span style={{ color: form.description.length > 155 ? "var(--neg)" : form.description.length < 70 && form.description.length > 0 ? "var(--warn)" : undefined }}>{form.description.length}/155</span>}>descrição (meta)</Label>
                  <textarea className="inp" value={form.description} onChange={(e) => set("description", e.target.value)} rows={2} style={{ width: "100%", marginTop: 4, height: "auto", padding: "7px 10px", resize: "vertical", lineHeight: 1.45 }} />
                </div>
                <div>
                  <Label>palavra-chave</Label>
                  <input className="inp" value={form.keyword} onChange={(e) => set("keyword", e.target.value)} style={{ width: "100%", marginTop: 4 }} />
                </div>
                <div>
                  <Label>intenção</Label>
                  <select className="inp" value={form.intent} onChange={(e) => set("intent", e.target.value)} style={{ width: "100%", marginTop: 4 }}>
                    {INTENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <Label>categoria</Label>
                  <select className="inp" value={form.category} onChange={(e) => set("category", e.target.value)} style={{ width: "100%", marginTop: 4 }}>
                    {!form.category && <option value="">escolha…</option>}
                    {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <Label right="separe por vírgula">tags</Label>
                  <input className="inp" value={tagsText} onChange={(e) => setTagsText(e.target.value)}
                    onBlur={() => set("tags", tagsText.split(",").map((t) => t.trim()).filter(Boolean))}
                    style={{ width: "100%", marginTop: 4 }} />
                </div>
              </div>

              {st !== "pauta" && (
                <div>
                  <Label right={`${doc.wordCount || 0} palavras · ${doc.readingMin || 1} min de leitura · markdown`}>texto</Label>
                  <textarea className="inp code" value={form.body} onChange={(e) => set("body", e.target.value)} spellCheck
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
                          <input className="inp" value={f.q} placeholder="pergunta" onChange={(e) => set("faq", form.faq.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))} style={{ flex: 1, fontWeight: 500 }} />
                          <button className="mono dim" title="remover pergunta" onClick={() => set("faq", form.faq.filter((_, j) => j !== i))} style={{ fontSize: 14, padding: "0 6px" }}>✕</button>
                        </div>
                        <textarea className="inp" value={f.a} placeholder="resposta" rows={2} onChange={(e) => set("faq", form.faq.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} style={{ width: "100%", height: "auto", padding: "7px 10px", resize: "vertical", lineHeight: 1.45 }} />
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
                    <input className="inp" value={instruction} onChange={(e) => setInstruction(e.target.value)} maxLength={600}
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
            </div>
          )}
        </div>

        {doc && form && (
          <div style={{ padding: "12px 20px", borderTop: "1px solid var(--line-1)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", flexShrink: 0, background: "var(--bg-1)" }}>
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
                  <input type="datetime-local" className="inp" value={when} onChange={(e) => setWhen(e.target.value)} title="Opcional: outro dia e hora (Brasília). Vazio = próximo slot da cadência." style={{ width: 190 }} />
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
                <SecondaryButton disabled={!!busy} style={{ color: "var(--neg)" }} onClick={() => { if (window.confirm(`Excluir "${doc.title}" de vez? Não tem volta.`)) run("delete", () => api.blogDelete(saas, id).then(() => onClose()), "excluído"); }}>Excluir</SecondaryButton>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── A tela ──────────────────────────────────────────────────────────────────
function BlogScreen() {
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

  const load = useC(async () => {
    if (!saas) { setData({ posts: [], counts: {}, rules: {}, state: {} }); return; }
    try {
      const d = await api.blog(saas);
      setData(d); setErr(null);
      // Primeira carga: se tem rascunho esperando, a tela abre nele (é o que
      // pede ação). Depois disso a aba é escolha da pessoa.
      if (!tabPicked.current) { tabPicked.current = true; if ((d?.counts?.rascunho || 0) > 0) setTab("rascunho"); }
    } catch (e) { setErr(e.message); setData((cur) => cur || { posts: [], counts: {}, rules: {}, state: {} }); }
  }, [saas]);
  useE(() => { setData(null); setSelId(null); tabPicked.current = false; load(); }, [load]);

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
    setBusy("pautas");
    try {
      const r = await api.blogMine(saas, {});
      const n = Array.isArray(r?.created) ? r.created.length : 0;
      toast(n ? `${n} ${n === 1 ? "pauta nova" : "pautas novas"}${r.dropped ? ` (${r.dropped} repetidas descartadas)` : ""}` : "nenhuma pauta nova: a IA só repetiu o que já existe", n ? "pos" : "warn");
      await load();
      if (n) setTab("pauta");
    } catch (e) { toast(`não deu pra gerar pautas: ${e.message}`, "neg"); }
    finally { setBusy(""); }
  }
  async function rodarAgora() {
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
    finally { setBusy(""); }
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
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead
        title="Blog"
        sub="A IA rascunha a partir do que o cockpit aprende com leads, calls e WhatsApp. Você revisa, o site publica na cadência."
      >
        <SecondaryButton disabled={!!busy || !saas || !data?.aiConfigured} title={data && !data.aiConfigured ? "IA não configurada no servidor" : "A IA propõe temas novos agora"} onClick={gerarPautas}>{busy === "pautas" ? "gerando…" : "Gerar pautas"}</SecondaryButton>
        <SecondaryButton disabled={!!busy || !saas} title="Roda um ciclo do motor agora: pauta, rascunho e publicação do que venceu" onClick={rodarAgora}>{busy === "tick" ? "rodando…" : "Rodar agora"}</SecondaryButton>
        <PrimaryButton disabled={!saas} onClick={() => setNewOpen(true)}>Nova pauta</PrimaryButton>
      </PageHead>

      <div style={{ flex: 1, overflow: "auto", padding: "16px var(--pad-x) 56px" }}>
        <div className="resp-cols" style={{ "--cols": "repeat(4, 1fr)", gap: 14 }}>
          <StatTile label="Pautas" value={data === null ? "…" : countOf("pauta")} delta="temas esperando texto" />
          <StatTile label="Rascunhos a revisar" value={data === null ? "…" : countOf("rascunho")} delta="a IA escreveu, falta aprovar" />
          <StatTile label="Agendados" value={data === null ? "…" : countOf("agendado")} delta={data?.nextSlot ? `próximo ${fmtSlot(data.nextSlot)}` : "nada na agenda"} />
          <StatTile label="Publicados" value={data === null ? "…" : countOf("publicado")} delta={data === null ? "" : `${publicados30} nos últimos 30 dias${ultimoPub ? ` · último ${fmtDay(ultimoPub.publishedAt)}` : ""}`} />
        </div>

        {data !== null && !semSaas && (
          <div style={{ marginTop: 16 }}>
            <AutomacaoCard saas={saas} rules={data.rules} state={data.state} aiConfigured={!!data.aiConfigured} nextSlot={data.nextSlot} admin={admin}
              onRules={(rules, state) => setData((d) => ({ ...d, rules, state: state || d.state }))}
              onDigest={() => setDigestOpen(true)} />
          </div>
        )}

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 20, flexWrap: "wrap" }}>
          <FilterTab active={tab === "todos"} count={posts.filter((p) => p.status !== "arquivado").length} onClick={() => setTab("todos")}>Todos</FilterTab>
          {STATUS.map((s) => (
            <FilterTab key={s.id} active={tab === s.id} count={countOf(s.id)} onClick={() => setTab(s.id)}>{s.label}s</FilterTab>
          ))}
          <span style={{ flex: 1 }} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} className="inp" placeholder="buscar título, palavra-chave…" style={{ width: "min(100%, 260px)" }} />
        </div>

        {err && <div style={{ marginTop: 14, color: "var(--neg)", fontSize: 12.5 }}>não deu pra carregar: {err} <button className="mono" style={{ color: "var(--accent)", marginLeft: 6 }} onClick={load}>tentar de novo</button></div>}

        <div style={{ marginTop: 14, background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)", overflow: "hidden" }}>
          {data === null && <div className="mono dim" style={{ fontSize: 12, padding: 20 }}>carregando…</div>}
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
              <table className="tbl" style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--bg-2)" }}>
                    <th className="kicker" style={{ padding: "8px 12px", textAlign: "left" }}>Título</th>
                    <th className="kicker" style={{ padding: "8px 12px", textAlign: "left" }}>Categoria</th>
                    <th className="kicker" style={{ padding: "8px 12px", textAlign: "left" }}>Situação</th>
                    <th className="kicker" style={{ padding: "8px 12px", textAlign: "left" }}>Pente fino</th>
                    <th className="kicker" style={{ padding: "8px 12px", textAlign: "left" }}>Data</th>
                    <th className="kicker" style={{ padding: "8px 12px", textAlign: "right" }}>Palavras</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((p) => (
                    <tr key={p.id} data-click onClick={() => setSelId(p.id)}>
                      <td style={{ maxWidth: 420 }}>
                        <div style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={p.title}>{p.title || "(sem título)"}</div>
                        {p.keyword && <div className="mono dim" style={{ fontSize: 10.5, marginTop: 1 }}>{p.keyword}</div>}
                      </td>
                      <td className="dim" style={{ whiteSpace: "nowrap" }}>{p.category || "–"}</td>
                      <td><StatusChip status={p.status} /></td>
                      <td><LintChip post={p} /></td>
                      <td className="mono dim" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>{dateOf(p)}</td>
                      <td className="tnum dim" style={{ textAlign: "right" }}>{p.wordCount ? p.wordCount.toLocaleString("pt-BR") : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {data !== null && !semSaas && visiveis.length > 0 && (
          <div className="mono dim" style={{ fontSize: 11, marginTop: 8 }}>{visiveis.length} de {posts.length} posts</div>
        )}
      </div>

      {newOpen && (
        <NewPautaModal saas={saas} categorias={categorias} onClose={() => setNewOpen(false)}
          onCreated={(doc) => { setNewOpen(false); load(); setTab("pauta"); setSelId(doc?.id || null); }} />
      )}
      {digestOpen && <DigestModal saas={saas} onClose={() => setDigestOpen(false)} />}
      {selId && (
        <PostDrawer saas={saas} id={selId} rules={data?.rules} nextSlot={data?.nextSlot} admin={admin}
          onClose={() => setSelId(null)} onChanged={load} />
      )}
    </div>
  );
}

export { BlogScreen };
