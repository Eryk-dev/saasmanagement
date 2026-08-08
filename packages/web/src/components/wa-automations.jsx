import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { Card, Pill } from "./viz.jsx";
import { EmptyState, PrimaryButton } from "../atoms.jsx";
import { WA_FLOW } from "../lib/wa-templates.js";
import { WaTemplateCreator } from "../screens/whatsapp.jsx";
// Automações — aba do Inbox: a central do WhatsApp em quatro blocos.
//   1. Regras automáticas (wa_automations): gatilho → resposta, avaliadas pelo
//      servidor a cada mensagem RECEBIDA. Regra nova nasce DESATIVADA.
//   2. Templates da Meta: os oficiais (reabrem conversa fora das 24h), com
//      status de aprovação e o criador que já existia no composer.
//   3. Fluxos de nutrição: as sequências (drip) dos Disparos — daqui dá pra
//      ver e pausar; a edição dos passos continua na tela Disparos.
//   4. Respostas rápidas do chat: os modelos do composer (WA_FLOW), editáveis
//      por produto sem deploy (product.waTemplates — salvar exige Ajustes).

const { useState, useEffect, useMemo } = React;

const TRIGGERS = [
  { id: "keyword", label: "Palavra-chave na mensagem" },
  { id: "first_message", label: "Primeira mensagem do contato" },
  { id: "off_hours", label: "Mensagem fora do horário" },
];
const triggerLabel = (id) => TRIGGERS.find((t) => t.id === id)?.label || id;
const COOLDOWNS = [[1, "1h"], [6, "6h"], [24, "24h"], [168, "7 dias"]];

const inp = { height: 34, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 13, width: "100%", boxSizing: "border-box" };
const areaStyle = { ...inp, height: "auto", minHeight: 64, padding: "8px 10px", resize: "vertical", fontFamily: "inherit", lineHeight: 1.45 };
const btn = { height: 30, padding: "0 12px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12, cursor: "pointer" };

const EMPTY_RULE = { name: "", trigger: "keyword", keyword: "", reply: "", cooldownHours: 24 };

function RuleForm({ initial, onSave, onCancel, busy }) {
  const [f, setF] = useState({ ...EMPTY_RULE, ...initial });
  const set = (p) => setF((v) => ({ ...v, ...p }));
  const ready = f.name.trim() && f.reply.trim() && (f.trigger !== "keyword" || f.keyword.trim());
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", background: "var(--bg-inset)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="kicker">Nome da regra</span>
          <input type="text" value={f.name} placeholder="ex.: resposta de preço" onChange={(e) => set({ name: e.target.value })} style={inp} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="kicker">Gatilho</span>
          <select value={f.trigger} onChange={(e) => set({ trigger: e.target.value })} style={inp}>
            {TRIGGERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        {f.trigger === "keyword" && (
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="kicker">Palavra ou frase</span>
            <input type="text" value={f.keyword} placeholder="ex.: preço" onChange={(e) => set({ keyword: e.target.value })} style={inp}
              title="sem diferença de caixa/acento: 'PRECO' encontra 'preço'" />
          </label>
        )}
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="kicker">No máx. 1x por conversa a cada</span>
          <select value={f.cooldownHours} onChange={(e) => set({ cooldownHours: Number(e.target.value) })} style={inp}>
            {COOLDOWNS.map(([h, l]) => <option key={h} value={h}>{l}</option>)}
          </select>
        </label>
      </div>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="kicker">Resposta automática</span>
        <textarea value={f.reply} placeholder={"Oi {{nome}}! Recebemos sua mensagem, já te respondo."} onChange={(e) => set({ reply: e.target.value })} style={areaStyle} />
        <span className="mono dim" style={{ fontSize: 10.5 }}>{"{{nome}}"} vira o primeiro nome do contato · a resposta sai pelo número da conversa e aparece no inbox como “automação”</span>
      </label>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={btn}>cancelar</button>
        <button onClick={() => ready && onSave(f)} disabled={!ready || busy}
          style={{ ...btn, background: "var(--btn-bg)", color: "var(--btn-fg)", border: "none", fontWeight: 600, opacity: !ready || busy ? 0.6 : 1 }}>
          {busy ? "salvando…" : "salvar regra"}
        </button>
      </div>
    </div>
  );
}

function RulesCard({ product }) {
  const { version, refresh } = useData();
  const [rules, setRules] = useState(null);
  const [editing, setEditing] = useState(null); // "new" | rule.id
  const [busy, setBusy] = useState(false);

  const load = () => api.list("wa_automations").then((r) => setRules((Array.isArray(r) ? r : r.items || []).filter((x) => !x.saas || x.saas === product.id))).catch(() => setRules([]));
  useEffect(load, [product.id, version]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(f) {
    setBusy(true);
    try {
      if (editing === "new") await api.create("wa_automations", { ...f, saas: product.id, active: false, createdAt: new Date().toISOString() });
      else await api.update("wa_automations", editing, f);
      setEditing(null); load(); refresh?.();
    } catch (e) { window.alert(e.message || "não deu pra salvar"); }
    finally { setBusy(false); }
  }
  async function toggle(r) {
    try { await api.update("wa_automations", r.id, { active: !r.active }); load(); } catch (e) { window.alert(e.message || "falhou"); }
  }
  async function remove(r) {
    if (!window.confirm(`Excluir a regra "${r.name}"? As conversas já respondidas não mudam.`)) return;
    try { await api.remove("wa_automations", r.id); load(); } catch (e) { window.alert(e.message || "falhou"); }
  }

  return (
    <Card title="Regras automáticas" hint="o servidor responde sozinho quando a mensagem recebida bate no gatilho · regra nova nasce desativada">
      <div style={{ padding: "12px var(--inset-x) 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        {rules === null && <span className="mono dim" style={{ fontSize: 12 }}>carregando…</span>}
        {rules?.length === 0 && editing !== "new" && (
          <EmptyState title="Nenhuma regra ainda" hint="Crie a primeira: boas-vindas na primeira mensagem, resposta de preço por palavra-chave ou aviso fora do horário."
            action={<PrimaryButton onClick={() => setEditing("new")}>+ nova regra</PrimaryButton>} />
        )}
        {(rules || []).map((r) => editing === r.id ? (
          <RuleForm key={r.id} initial={r} busy={busy} onSave={save} onCancel={() => setEditing(null)} />
        ) : (
          <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-1)", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{r.name}</div>
              <div className="mono dim" style={{ fontSize: 11, marginTop: 2 }}>
                {triggerLabel(r.trigger)}{r.trigger === "keyword" && r.keyword ? ` · “${r.keyword}”` : ""} · máx. 1x/{COOLDOWNS.find(([h]) => h === Number(r.cooldownHours))?.[1] || "24h"} por conversa
              </div>
              <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 520 }} title={r.reply}>{r.reply}</div>
            </div>
            <button onClick={() => toggle(r)} className={"chip " + (r.active ? "pos" : "")}
              title={r.active ? "desativar: para de responder na hora" : "ativar: começa a responder mensagens novas"}
              style={{ cursor: "pointer" }}>
              {r.active ? "ativa" : "desativada"}
            </button>
            <button onClick={() => setEditing(r.id)} style={btn}>editar</button>
            <button onClick={() => remove(r)} className="mono dim" title="Excluir regra" style={{ fontSize: 13, padding: "0 4px" }}>✕</button>
          </div>
        ))}
        {editing === "new"
          ? <RuleForm initial={EMPTY_RULE} busy={busy} onSave={save} onCancel={() => setEditing(null)} />
          : rules?.length > 0 && <div><button onClick={() => setEditing("new")} style={btn}>+ nova regra</button></div>}
      </div>
    </Card>
  );
}

const TPL_TONE = { APPROVED: "pos", PENDING: "warn", REJECTED: "neg" };

function TemplatesCard() {
  const [data, setData] = useState(null); // { templates, unsupported } | { error }
  const [creating, setCreating] = useState(false);

  const load = () => api.waMetaTemplates().then(setData).catch((e) => setData({ error: e.message || "não deu pra listar" }));
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card title="Templates do WhatsApp (Meta)" hint="mensagem aprovada pela Meta reabre conversa fora da janela de 24h">
      <div style={{ padding: "12px var(--inset-x) 16px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => setCreating(true)} style={btn}>+ novo template</button>
          <button onClick={load} className="mono dim" style={{ fontSize: 11 }}>↻ atualizar</button>
          {data?.unsupported > 0 && <span className="mono dim" style={{ fontSize: 10.5 }}>{data.unsupported} template(s) com formato que o composer não envia</span>}
        </div>
        {data === null && <span className="mono dim" style={{ fontSize: 12 }}>carregando…</span>}
        {data?.error && <span className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>{data.error}</span>}
        {(data?.templates || []).map((t) => (
          <div key={t.name + t.language} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: "1px solid var(--line-faint)", borderRadius: "var(--r-2)", flexWrap: "wrap" }}>
            <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{t.name}</span>
            <span className="mono dim" style={{ fontSize: 11 }}>{t.language}</span>
            <span style={{ flex: 1, fontSize: 12, color: "var(--fg-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 120 }} title={t.body || ""}>{t.body || ""}</span>
            <Pill tone={TPL_TONE[t.status] || "mut"}>{String(t.status || "?").toLowerCase()}</Pill>
          </div>
        ))}
        {data?.templates?.length === 0 && <span className="mono dim" style={{ fontSize: 12 }}>nenhum template ainda — crie o primeiro</span>}
      </div>
      {creating && <WaTemplateCreator onClose={() => { setCreating(false); load(); }} />}
    </Card>
  );
}

const SEQ_TONE = { active: "pos", paused: "warn", draft: "mut" };

function FlowsCard({ product }) {
  const [rows, setRows] = useState(null);

  const load = () => api.sequenceMetrics(product.id).then((r) => setRows(r.sequences || r || [])).catch(() => setRows([]));
  useEffect(load, [product.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggle(s) {
    const next = s.status === "active" ? "paused" : "active";
    try { await api.update("sequences", s.id, { status: next }); load(); }
    catch (e) { window.alert(e.message || "falhou"); }
  }

  return (
    <Card title="Fluxos de nutrição (sequências)" hint="cadência de mensagens no tempo · os passos são editados na tela Disparos">
      <div style={{ padding: "12px var(--inset-x) 16px", display: "flex", flexDirection: "column", gap: 8 }}>
        {rows === null && <span className="mono dim" style={{ fontSize: 12 }}>carregando…</span>}
        {rows?.length === 0 && <span className="mono dim" style={{ fontSize: 12 }}>nenhuma sequência neste produto — crie na tela Disparos</span>}
        {(rows || []).map((s) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: "1px solid var(--line-faint)", borderRadius: "var(--r-2)", flexWrap: "wrap" }}>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, minWidth: 140 }}>{s.name || s.id}</span>
            <span className="mono dim" style={{ fontSize: 11 }}>{s.enrolled ?? 0} inscrito(s){s.booked != null ? ` · ${s.booked} call(s)` : ""}{s.won != null ? ` · ${s.won} ganho(s)` : ""}</span>
            <Pill tone={SEQ_TONE[s.status] || "mut"}>{s.status || "?"}</Pill>
            <button onClick={() => toggle(s)} style={btn}>{s.status === "active" ? "pausar" : "ativar"}</button>
          </div>
        ))}
        <div>
          <button onClick={() => { window.location.hash = "disparos"; }} style={btn}>abrir Disparos (editar passos) →</button>
        </div>
      </div>
    </Card>
  );
}

function QuickRepliesCard({ product }) {
  // Modelos do composer (WA_FLOW) com override por produto: editar aqui muda a
  // copy dos SDRs sem deploy. Salvar escreve product.waTemplates (rota de
  // escrita de produto = tela Ajustes; sem a permissão o servidor recusa).
  const effective = useMemo(() => JSON.parse(JSON.stringify(
    Array.isArray(product.waTemplates) && product.waTemplates.length ? product.waTemplates : WA_FLOW
  )), [product.id, product.waTemplates]); // eslint-disable-line react-hooks/exhaustive-deps
  const [flow, setFlow] = useState(effective);
  const [dirtyFlag, setDirtyFlag] = useState(false);
  const [note, setNote] = useState(null);
  useEffect(() => { setFlow(effective); setDirtyFlag(false); }, [effective]);

  const setItem = (gi, ii, patch) => {
    setFlow((f) => f.map((g, a) => a !== gi ? g : { ...g, items: g.items.map((it, b) => b !== ii ? it : { ...it, ...patch }) }));
    setDirtyFlag(true);
  };
  const addItem = (gi) => {
    setFlow((f) => f.map((g, a) => a !== gi ? g : { ...g, items: [...g.items, { label: "Novo modelo", text: "" }] }));
    setDirtyFlag(true);
  };
  const removeItem = (gi, ii) => {
    setFlow((f) => f.map((g, a) => a !== gi ? g : { ...g, items: g.items.filter((_, b) => b !== ii) }));
    setDirtyFlag(true);
  };

  async function save() {
    try {
      await api.update("products", product.id, { waTemplates: flow });
      setNote({ ok: true, text: "modelos salvos — valem na hora pro composer de todo mundo" });
      setDirtyFlag(false);
    } catch (e) { setNote({ ok: false, text: e.message || "sem permissão (salvar modelos é escrita de produto, tela Ajustes)" }); }
  }

  return (
    <Card title="Respostas rápidas do chat" hint="os modelos que o composer do inbox oferece · {{tokens}} preenchem com o que o lead respondeu no form">
      <div style={{ padding: "12px var(--inset-x) 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        {flow.map((g, gi) => (
          <div key={gi} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="kicker accent">{g.group}</span>
            {g.items.map((it, ii) => (
              <div key={ii} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 12px", border: "1px solid var(--line-faint)", borderRadius: "var(--r-2)" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="text" value={it.label} onChange={(e) => setItem(gi, ii, { label: e.target.value })}
                    style={{ ...inp, height: 30, fontWeight: 600, flex: 1 }} />
                  <button onClick={() => removeItem(gi, ii)} className="mono dim" title="Remover modelo" style={{ fontSize: 13, padding: "0 4px" }}>✕</button>
                </div>
                <textarea value={it.text} onChange={(e) => setItem(gi, ii, { text: e.target.value })} style={{ ...areaStyle, minHeight: 56 }} />
              </div>
            ))}
            <div><button onClick={() => addItem(gi)} style={{ ...btn, height: 26, fontSize: 11.5 }}>+ modelo em {g.group}</button></div>
          </div>
        ))}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={save} disabled={!dirtyFlag}
            style={{ ...btn, background: "var(--btn-bg)", color: "var(--btn-fg)", border: "none", fontWeight: 600, opacity: dirtyFlag ? 1 : 0.5 }}>
            salvar modelos
          </button>
          {note && <span className="mono" style={{ fontSize: 11.5, color: note.ok ? "var(--pos)" : "var(--neg)" }}>{note.text}</span>}
        </div>
      </div>
    </Card>
  );
}

export function WaAutomationsPanel({ product }) {
  if (!product) return <EmptyState title="Nenhum produto cadastrado" hint="Crie o produto em Ajustes." />;
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 14, maxWidth: 980 }}>
      <RulesCard product={product} />
      <TemplatesCard />
      <FlowsCard product={product} />
      <QuickRepliesCard product={product} />
    </div>
  );
}
