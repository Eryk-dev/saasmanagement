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

// Exemplos prontos (1 clique abre o form preenchido; a regra ainda nasce
// desativada — o Leo revisa a copy e liga no interruptor).
const RULE_EXAMPLES = [
  { name: "Boas-vindas", trigger: "first_message", keyword: "", cooldownHours: 168, reply: "Oi {{nome}}! Recebemos sua mensagem aqui na LeverAds. Já vou te responder. Me adianta uma coisa: hoje você anuncia em quantas contas?" },
  { name: "Fora do horário", trigger: "off_hours", keyword: "", cooldownHours: 24, reply: "Oi {{nome}}! Estamos fora do horário agora (seg a sex, 8h às 18h). Deixa sua mensagem que amanhã cedo te respondo." },
  { name: "Pergunta de preço", trigger: "keyword", keyword: "preço", cooldownHours: 24, reply: "Oi {{nome}}! O investimento depende do tamanho da sua operação. Me diz quantas contas você opera hoje que eu já te passo o plano certo." },
];

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
  const [preset, setPreset] = useState(null);   // exemplo escolhido pro form novo
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
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span className="mono dim" style={{ fontSize: 10.5 }}>exemplos (abrem preenchidos):</span>
          {RULE_EXAMPLES.map((ex) => (
            <button key={ex.name} onClick={() => { setPreset(ex); setEditing("new"); }} className="chip" style={{ cursor: "pointer" }}>{ex.name}</button>
          ))}
        </div>
        {rules?.length === 0 && editing !== "new" && (
          <EmptyState title="Nenhuma regra ainda" hint="Crie a primeira: boas-vindas na primeira mensagem, resposta de preço por palavra-chave ou aviso fora do horário."
            action={<PrimaryButton onClick={() => { setPreset(null); setEditing("new"); }}>+ nova regra</PrimaryButton>} />
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
          ? <RuleForm key={preset?.name || "blank"} initial={preset || EMPTY_RULE} busy={busy} onSave={save} onCancel={() => { setEditing(null); setPreset(null); }} />
          : rules?.length > 0 && <div><button onClick={() => { setPreset(null); setEditing("new"); }} style={btn}>+ nova regra</button></div>}
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

// ── Saudação automática no 1º contato ───────────────────────────────────────
// A primeira mensagem de um lead novo recebe sozinha a saudação (TEXTO
// simples; o pedido nativo de permissão de ligação foi removido em 22/08/2026
// pra proteger o número — violação de taxa de atendimento das ligações).
// Saudação dupla pelo relógio do time. Grava product.waCallFlow (escrita de
// produto = permissão de Ajustes; sem ela o servidor recusa o salvar).
function CallFlowCard({ product }) {
  const { refresh } = useData();
  const s = product;
  const [on, setOn] = useState(!!s.waCallFlow?.enabled);
  const [greeting, setGreeting] = useState(s.waCallFlow?.greeting || "");
  const [after, setAfter] = useState(s.waCallFlow?.afterHours || "");
  const [start, setStart] = useState(s.waCallFlow?.hourStart ?? 8);
  const [end, setEnd] = useState(s.waCallFlow?.hourEnd ?? 18);
  const [vars, setVars] = useState(false);
  const [note, setNote] = useState(null);
  const greetRef = React.useRef(null);
  const afterRef = React.useRef(null);
  const lastField = React.useRef("greeting");
  const VARS = [
    { t: "{nome}", d: "primeiro nome do lead (some se não tiver)" },
    { t: "{empresa}", d: "empresa do lead (some se não tiver)" },
    { t: "{produto}", d: `nome do produto (${s.name})` },
    { t: "{volta}", d: "quando o time volta: \"hoje às 8h\" / \"amanhã às 8h\" / \"segunda às 8h\" (pro texto de fora do horário)" },
  ];
  function insertVar(tok) {
    const isAfter = lastField.current === "after";
    const el = (isAfter ? afterRef : greetRef).current;
    const val = isAfter ? after : greeting;
    const set = isAfter ? setAfter : setGreeting;
    const a = el?.selectionStart ?? val.length;
    const b = el?.selectionEnd ?? val.length;
    set(val.slice(0, a) + tok + val.slice(b));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(a + tok.length, a + tok.length); });
  }
  async function save() {
    const hour = (v, fb) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n < 24 ? n : fb; };
    try {
      await api.update("products", s.id, {
        waCallFlow: { enabled: !!on, greeting: greeting.trim(), afterHours: after.trim(), hourStart: hour(start, 8), hourEnd: hour(end, 18) },
      });
      setNote({ ok: true, text: "salvo — vale já pro próximo lead novo" });
      refresh?.();
    } catch (e) { setNote({ ok: false, text: e.message || "sem permissão (escrita de produto = tela Ajustes)" }); }
  }
  const areaWide = { ...areaStyle, minHeight: 52, fontSize: 12.5 };
  return (
    <Card title="Saudação automática no 1º contato" hint={"a primeira mensagem de um lead novo recebe sozinha a saudação do time (texto) · a resposta salta como pop-up pro SDR · sem pedido de ligação (removido pra proteger o número)"}>
      <div style={{ padding: "12px var(--inset-x) 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
          ligado neste produto
        </label>
        {on && (
          <>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className="kicker">horário do time · seg a sex, das</span>
              <input type="number" min={0} max={23} value={start} onChange={(e) => setStart(e.target.value)} className="mono" style={{ ...inp, width: 58, fontFamily: "var(--mono)" }} />
              <span className="kicker">às</span>
              <input type="number" min={1} max={24} value={end} onChange={(e) => setEnd(e.target.value)} className="mono" style={{ ...inp, width: 58, fontFamily: "var(--mono)" }} />
              <span className="mono dim" style={{ fontSize: 10 }}>fim de semana conta como fora do horário · a mesma régua vale pro gatilho "fora do horário" das regras</span>
            </div>
            <div>
              <div className="kicker">dentro do horário</div>
              <textarea ref={greetRef} value={greeting} onChange={(e) => setGreeting(e.target.value)} rows={2}
                onFocus={() => { lastField.current = "greeting"; }}
                placeholder={"Olá {nome}! Recebi seu formulário aqui. Podemos conversar por aqui mesmo sobre a plataforma?"}
                style={{ ...areaWide, marginTop: 6 }} />
            </div>
            <div>
              <div className="kicker">fora do horário (avisa quando o time volta)</div>
              <textarea ref={afterRef} value={after} onChange={(e) => setAfter(e.target.value)} rows={2}
                onFocus={() => { lastField.current = "after"; }}
                placeholder={"Olá {nome}! Recebi seu formulário aqui. Nosso time está fora do horário agora, mas volta {volta}. Pode deixar sua mensagem que respondemos assim que voltarmos."}
                style={{ ...areaWide, marginTop: 6 }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => setVars((v) => !v)} className="mono"
                style={{ height: 24, padding: "0 10px", borderRadius: 999, border: "1px solid var(--line-2)", background: vars ? "var(--accent-soft)" : "var(--bg-1)", color: vars ? "var(--accent)" : "var(--fg-3)", fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}>
                {"{ }"} variáveis
              </button>
              <span className="mono dim" style={{ fontSize: 10 }}>texto vazio usa o padrão</span>
            </div>
            {vars && (
              <div style={{ padding: "10px 12px", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-2)", display: "flex", flexDirection: "column", gap: 6 }}>
                {VARS.map((v) => (
                  <div key={v.t} style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <button onClick={() => insertVar(v.t)} className="mono" title="clique pra inserir no texto, na posição do cursor"
                      style={{ flexShrink: 0, padding: "2px 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--accent)", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
                      {v.t}
                    </button>
                    <span style={{ fontSize: 11.5, color: "var(--fg-2)", lineHeight: 1.45 }}>{v.d}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "flex-end" }}>
          {note && <span className="mono" style={{ fontSize: 11.5, color: note.ok ? "var(--pos)" : "var(--neg)" }}>{note.text}</span>}
          <button onClick={save} style={{ ...btn, background: "var(--btn-bg)", color: "var(--btn-fg)", border: "none", fontWeight: 600 }}>salvar</button>
        </div>
      </div>
    </Card>
  );
}

// ── Fluxos de conversa (construtor estilo ManyChat) ─────────────────────────
const newNodeId = () => "n" + Math.random().toString(36).slice(2, 8);
const blankNode = (kind = "message") => ({ id: newNodeId(), kind, text: "", next: null, branches: [], fallbackTo: null });

// Exemplo pronto: qualificação com pergunta sim/não.
const FLOW_EXAMPLE = () => {
  const n1 = newNodeId(), n2 = newNodeId(), n3 = newNodeId(), n4 = newNodeId();
  return {
    name: "Qualificação rápida",
    trigger: { type: "first_message", keyword: "" },
    nodes: [
      { id: n1, kind: "message", text: "Oi {{nome}}! Aqui é da LeverAds. Recebi sua mensagem.", next: n2, branches: [], fallbackTo: null },
      { id: n2, kind: "question", text: "Hoje você já vende em marketplace (Mercado Livre/Shopee)? Responde sim ou não que eu te direciono certinho.", next: null, branches: [{ contains: "sim", to: n3 }, { contains: "não", to: n4 }], fallbackTo: null },
      { id: n3, kind: "message", text: "Perfeito! Então nosso time comercial já vai te chamar pra entender sua operação e te mostrar a plataforma.", next: null, branches: [], fallbackTo: null },
      { id: n4, kind: "message", text: "Sem problema! A LeverAds é pra quem já vende e quer escalar pra várias contas. Quando você começar, estamos aqui.", next: null, branches: [], fallbackTo: null },
    ],
  };
};

function FlowEditor({ product, initial, onClose, onSaved }) {
  const [name, setName] = useState(initial?.name || "");
  const [trigger, setTrigger] = useState(initial?.trigger || { type: "keyword", keyword: "" });
  const [nodes, setNodes] = useState(() => initial?.nodes?.length ? JSON.parse(JSON.stringify(initial.nodes)) : [blankNode("message")]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const stepNo = (id) => nodes.findIndex((n) => n.id === id) + 1;
  const setNode = (i, patch) => setNodes((ns) => ns.map((n, a) => a === i ? { ...n, ...patch } : n));
  const addNode = () => setNodes((ns) => {
    const node = blankNode("message");
    // conveniência: mensagem solta no fim aponta pro passo novo sozinha
    const prev = ns[ns.length - 1];
    const linked = prev && prev.kind === "message" && !prev.next ? ns.map((n, i) => i === ns.length - 1 ? { ...n, next: node.id } : n) : ns;
    return [...linked, node];
  });
  const removeNode = (i) => setNodes((ns) => {
    const dead = ns[i].id;
    return ns.filter((_, a) => a !== i).map((n) => ({
      ...n,
      next: n.next === dead ? null : n.next,
      fallbackTo: n.fallbackTo === dead ? null : n.fallbackTo,
      branches: (n.branches || []).map((b) => b.to === dead ? { ...b, to: null } : b),
    }));
  });

  const targetOptions = (selfId) => nodes.filter((n) => n.id !== selfId);
  const ready = name.trim() && nodes.length > 0 && nodes.every((n) => n.text.trim()) && (trigger.type !== "keyword" || trigger.keyword.trim());

  async function save() {
    if (!ready) { setErr("Preencha o nome, o gatilho e o texto de todos os passos."); return; }
    setBusy(true); setErr(null);
    try {
      const doc = { name: name.trim(), trigger, nodes, saas: product.id };
      if (initial?.id) await api.update("wa_flows", initial.id, doc);
      else await api.create("wa_flows", { ...doc, active: false, createdAt: new Date().toISOString() });
      onSaved?.(); onClose();
    } catch (e) { setErr(e.message || "não deu pra salvar o fluxo"); }
    finally { setBusy(false); }
  }

  const TargetSelect = ({ value, onChange, selfId, emptyLabel }) => (
    <select value={value || ""} onChange={(e) => onChange(e.target.value || null)} style={{ ...inp, height: 28, width: "auto", fontSize: 12 }}>
      <option value="">{emptyLabel}</option>
      {targetOptions(selfId).map((n) => <option key={n.id} value={n.id}>Passo {stepNo(n.id)}</option>)}
    </select>
  );

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "oklch(0 0 0 / 0.45)", zIndex: 130, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(100%, 680px)", maxHeight: "92vh", overflowY: "auto", background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-pop)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{initial?.id ? "Editar fluxo" : "Novo fluxo de conversa"}</div>
            <div className="mono dim" style={{ fontSize: 11, marginTop: 2 }}>mensagens em cadeia · pergunta espera a resposta e ramifica · fluxo novo nasce desativado</div>
          </div>
          <button onClick={onClose} className="mono dim" style={{ fontSize: 15 }}>✕</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="kicker">Nome do fluxo</span>
            <input type="text" value={name} placeholder="ex.: qualificação rápida" onChange={(e) => setName(e.target.value)} style={inp} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="kicker">Começa quando</span>
            <div style={{ display: "flex", gap: 6 }}>
              <select value={trigger.type} onChange={(e) => setTrigger({ ...trigger, type: e.target.value })} style={inp}>
                <option value="keyword">mensagem contém…</option>
                <option value="first_message">primeira mensagem do contato</option>
              </select>
              {trigger.type === "keyword" && (
                <input type="text" value={trigger.keyword} placeholder="palavra" onChange={(e) => setTrigger({ ...trigger, keyword: e.target.value })} style={{ ...inp, width: 120 }} />
              )}
            </div>
          </label>
        </div>

        {/* O desenho: passos numerados ligados pela linha; ramificação vira
            chips "→ Passo N" dentro da pergunta. */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          {nodes.map((n, i) => (
            <div key={n.id} style={{ display: "flex", gap: 10 }}>
              {/* trilho visual: bolinha numerada + linha descendo */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 26, flexShrink: 0 }}>
                <div style={{ width: 22, height: 22, borderRadius: 999, background: n.kind === "question" ? "var(--accent)" : "var(--btn-bg)", color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</div>
                {i < nodes.length - 1 && <div style={{ flex: 1, width: 2, background: "var(--line-2)", minHeight: 14 }} />}
              </div>
              <div style={{ flex: 1, marginBottom: 10, padding: "10px 12px", border: "1px solid " + (n.kind === "question" ? "var(--accent-line)" : "var(--line-1)"), borderRadius: "var(--r-2)", background: n.kind === "question" ? "var(--accent-soft)" : "var(--bg-inset)", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <select value={n.kind} onChange={(e) => setNode(i, { kind: e.target.value, ...(e.target.value === "message" ? { branches: [], fallbackTo: null } : { next: null }) })} style={{ ...inp, height: 28, width: "auto", fontSize: 12, fontWeight: 600 }}>
                    <option value="message">mensagem</option>
                    <option value="question">pergunta (espera resposta)</option>
                  </select>
                  <span style={{ flex: 1 }} />
                  <button onClick={() => removeNode(i)} className="mono dim" title="Remover passo" style={{ fontSize: 13, padding: "0 4px" }}>✕</button>
                </div>
                <textarea value={n.text} onChange={(e) => setNode(i, { text: e.target.value })}
                  placeholder={n.kind === "question" ? "A pergunta que espera resposta… ({{nome}} vale aqui)" : "O texto da mensagem… ({{nome}} vale aqui)"}
                  style={{ ...areaStyle, minHeight: 52, background: "var(--bg-1)" }} />
                {n.kind === "message" && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span className="kicker">depois</span>
                    <TargetSelect value={n.next} onChange={(v) => setNode(i, { next: v })} selfId={n.id} emptyLabel="encerrar o fluxo" />
                  </div>
                )}
                {n.kind === "question" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {(n.branches || []).map((b, bi) => (
                      <div key={bi} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        <span className="kicker">se a resposta contém</span>
                        <input type="text" value={b.contains} placeholder="sim" onChange={(e) => setNode(i, { branches: n.branches.map((x, a) => a === bi ? { ...x, contains: e.target.value } : x) })} style={{ ...inp, height: 28, width: 110, fontSize: 12 }} />
                        <span className="mono" style={{ fontSize: 12, color: "var(--accent)", fontWeight: 700 }}>→</span>
                        <TargetSelect value={b.to} onChange={(v) => setNode(i, { branches: n.branches.map((x, a) => a === bi ? { ...x, to: v } : x) })} selfId={n.id} emptyLabel="(escolher passo)" />
                        <button onClick={() => setNode(i, { branches: n.branches.filter((_, a) => a !== bi) })} className="mono dim" style={{ fontSize: 12 }}>✕</button>
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <button onClick={() => setNode(i, { branches: [...(n.branches || []), { contains: "", to: null }] })} style={{ ...btn, height: 26, fontSize: 11.5 }}>+ ramificação</button>
                      <span className="kicker">qualquer outra resposta</span>
                      <TargetSelect value={n.fallbackTo} onChange={(v) => setNode(i, { fallbackTo: v })} selfId={n.id} emptyLabel="encerrar (SDR assume)" />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, paddingLeft: 36 }}>
            <button onClick={addNode} style={btn}>+ passo</button>
          </div>
        </div>

        {err && <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={btn}>cancelar</button>
          <button onClick={save} disabled={busy}
            style={{ ...btn, background: "var(--btn-bg)", color: "var(--btn-fg)", border: "none", fontWeight: 600, opacity: busy ? 0.6 : 1 }}>
            {busy ? "salvando…" : "salvar fluxo"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConversationFlowsCard({ product }) {
  const { version } = useData();
  const [flows, setFlows] = useState(null);
  const [editor, setEditor] = useState(null); // { initial } | null

  const load = () => api.list("wa_flows").then((r) => setFlows((Array.isArray(r) ? r : []).filter((f) => !f.saas || f.saas === product.id))).catch(() => setFlows([]));
  useEffect(load, [product.id, version]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggle(f) {
    try { await api.update("wa_flows", f.id, { active: !f.active }); load(); } catch (e) { window.alert(e.message || "falhou"); }
  }
  async function remove(f) {
    if (!window.confirm(`Excluir o fluxo "${f.name}"? Conversas no meio dele são soltas na hora (o SDR assume).`)) return;
    try { await api.remove("wa_flows", f.id); load(); } catch (e) { window.alert(e.message || "falhou"); }
  }

  const trgLabel = (t) => t?.type === "first_message" ? "primeira mensagem" : `contém “${t?.keyword || "?"}”`;

  return (
    <Card title="Fluxos de conversa" hint="desenhe a conversa: gatilho → mensagens → pergunta que espera a resposta e ramifica · a conversa fica capturada pelo fluxo até ele terminar">
      <div style={{ padding: "12px var(--inset-x) 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => setEditor({ initial: null })} style={btn}>+ novo fluxo</button>
          <button onClick={() => setEditor({ initial: FLOW_EXAMPLE() })} className="chip" style={{ cursor: "pointer" }} title="abre o construtor preenchido com um fluxo de qualificação sim/não">usar exemplo: qualificação</button>
        </div>
        {flows === null && <span className="mono dim" style={{ fontSize: 12 }}>carregando…</span>}
        {flows?.length === 0 && <span className="mono dim" style={{ fontSize: 12 }}>nenhum fluxo ainda — comece pelo exemplo de qualificação</span>}
        {(flows || []).map((f) => (
          <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-1)", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{f.name}</div>
              <div className="mono dim" style={{ fontSize: 11, marginTop: 2 }}>
                começa: {trgLabel(f.trigger)} · {(f.nodes || []).length} passo(s) · {(f.nodes || []).filter((n) => n.kind === "question").length} pergunta(s)
              </div>
            </div>
            <button onClick={() => toggle(f)} className={"chip " + (f.active ? "pos" : "")}
              title={f.active ? "desativar: conversas no meio são soltas" : "ativar: começa a capturar mensagens novas"}
              style={{ cursor: "pointer" }}>
              {f.active ? "ativo" : "desativado"}
            </button>
            <button onClick={() => setEditor({ initial: f })} style={btn}>editar</button>
            <button onClick={() => remove(f)} className="mono dim" title="Excluir fluxo" style={{ fontSize: 13, padding: "0 4px" }}>✕</button>
          </div>
        ))}
      </div>
      {editor && <FlowEditor product={product} initial={editor.initial} onClose={() => setEditor(null)} onSaved={load} />}
    </Card>
  );
}

// ── SDR automático (Fase 1) ─────────────────────────────────────────────────
// Primeiro toque em minutos (24/7) + lembretes de call (véspera/1h/10min) +
// resgate de no-show, tudo em nome do SDR dono do lead — o motor roda no
// servidor (sdr-flow.js). Aqui: liga/desliga, as 3 frentes e o estado dos
// templates da Meta (o 1º toque de quem nunca escreveu depende de aprovação).
function SdrBotCard({ product }) {
  const { refresh } = useData();
  const cfg = product.sdrBot || {};
  const [on, setOn] = useState(!!cfg.enabled);
  const [firstTouch, setFirstTouch] = useState(cfg.firstTouch !== false);
  const [reminders, setReminders] = useState(cfg.reminders !== false);
  const [rescue, setRescue] = useState(cfg.rescue !== false);
  const [conversation, setConversation] = useState(cfg.conversation === true);
  const [conversationTest, setConversationTest] = useState(cfg.conversationTest === true);
  const [delay, setDelay] = useState(cfg.firstTouchDelayMin ?? 3);
  const [status, setStatus] = useState(null);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [replayDoc, setReplayDoc] = useState(null);
  const [replayBusy, setReplayBusy] = useState(false);

  const loadStatus = () => api.sdrStatus(product.id).then(setStatus).catch((e) => setStatus({ error: e.message || "não deu pra ler o status" }));
  const loadReplay = () => api.sdrReplayStatus().then(setReplayDoc).catch(() => {});
  useEffect(() => { loadStatus(); loadReplay(); }, [product.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Bateria rodando: acompanha o progresso a cada 5s até terminar.
  useEffect(() => {
    if (replayDoc?.status !== "running") return;
    const t = setInterval(loadReplay, 5000);
    return () => clearInterval(t);
  }, [replayDoc?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function startReplay() {
    setReplayBusy(true); setNote(null);
    try {
      await api.sdrReplayStart(product.id, { threads: 25, turns: 3 });
      await loadReplay();
    } catch (e) { setNote({ ok: false, text: e.message || "não deu pra iniciar a bateria" }); }
    finally { setReplayBusy(false); }
  }

  async function save() {
    try {
      await api.update("products", product.id, {
        sdrBot: {
          ...cfg, enabled: on, firstTouch, reminders, rescue, conversation, conversationTest,
          firstTouchDelayMin: Math.max(1, Number(delay) || 3),
          // Carimbo de QUANDO ligou: o robô só faz 1º toque em lead criado
          // DEPOIS dele (backlog antigo segue fila humana). Religar re-carimba.
          enabledAt: on ? (cfg.enabled && cfg.enabledAt ? cfg.enabledAt : new Date().toISOString()) : (cfg.enabledAt || ""),
        },
      });
      setNote({ ok: true, text: on ? "ligado — vale já pro próximo lead novo" : "salvo (robô desligado)" });
      refresh?.();
    } catch (e) { setNote({ ok: false, text: e.message || "sem permissão (escrita de produto = tela Ajustes)" }); }
  }
  async function setupTemplates() {
    setBusy(true); setNote(null);
    try {
      const r = await api.sdrTemplateSetup();
      setNote({ ok: true, text: "submetidos pra Meta: " + (r.templates || []).map((t) => `${t.name.replace("sdr_", "")} ${t.status}`).join(" · ") });
      loadStatus();
    } catch (e) { setNote({ ok: false, text: e.message || "não deu pra submeter os templates" }); }
    finally { setBusy(false); }
  }

  const tpl = status?.templates || [];
  const pending = tpl.filter((t) => !t.approved);
  return (
    <Card title="SDR automático" hint="primeiro toque em minutos (24/7) + lembretes da call + resgate de no-show · fala em nome do SDR dono do lead; no inbox as mensagens aparecem com autor sdr-bot">
      <div style={{ padding: "12px var(--inset-x) 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
          ligado neste produto
        </label>
        {on && (
          <>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
                <input type="checkbox" checked={firstTouch} onChange={(e) => setFirstTouch(e.target.checked)} />
                primeiro toque no lead novo
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
                <input type="checkbox" checked={reminders} onChange={(e) => setReminders(e.target.checked)} />
                lembretes da call (véspera · 1h · 10min)
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
                <input type="checkbox" checked={rescue} onChange={(e) => setRescue(e.target.checked)} />
                resgate de no-show
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer", fontWeight: 600 }}
                title="Fase 2: a IA responde a conversa e marca a call sozinha (horários reais da agenda, preço nunca, handoff pra humano). Só ligar depois de rodar e revisar a bateria de replay abaixo.">
                <input type="checkbox" checked={conversation} onChange={(e) => setConversation(e.target.checked)} />
                conversa com IA (agenda sozinha)
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}
                title="O robô INTEIRO (1º toque, lembretes, resgate e conversa com IA) atende leads marcados como teste da equipe — e SÓ eles nesta chave. É o test-drive: cria um lead interno com o seu número e conversa com o robô no seu WhatsApp, sem tocar lead real e sem sujar métrica.">
                <input type="checkbox" checked={conversationTest} onChange={(e) => setConversationTest(e.target.checked)} />
                modo teste (só leads de teste da equipe)
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className="kicker">1º toque sai</span>
              <input type="number" min={1} max={60} value={delay} onChange={(e) => setDelay(e.target.value)} className="mono" style={{ ...inp, width: 58, fontFamily: "var(--mono)" }} />
              <span className="kicker">min depois do cadastro</span>
              <span className="mono dim" style={{ fontSize: 10 }}>a pausa curta soa como gente que viu o cadastro, não robô de 2 segundos</span>
            </div>
            <div className="mono dim" style={{ fontSize: 10.5 }}>
              lembretes gravam nas mesmas chaves das tarefas de confirmação do Meu dia (feito lá cala o robô e vice-versa) · resposta do lead confirma a call sozinha ou vira pop-up quente · mensagem humana na conversa silencia o 1º toque
            </div>
          </>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className="kicker">templates da Meta (1º toque fora da janela de 24h depende deles)</span>
            <button onClick={setupTemplates} disabled={busy} style={{ ...btn, opacity: busy ? 0.6 : 1 }}>{busy ? "submetendo…" : "submeter pra aprovação"}</button>
            <button onClick={loadStatus} className="mono dim" style={{ fontSize: 11 }}>↻</button>
          </div>
          {status?.error && <span className="mono" style={{ fontSize: 11.5, color: "var(--neg)" }}>{status.error}</span>}
          {status?.templatesError && !status?.error && <span className="mono dim" style={{ fontSize: 10.5 }}>{status.templatesError}</span>}
          {tpl.map((t) => (
            <div key={t.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", border: "1px solid var(--line-faint)", borderRadius: "var(--r-2)", flexWrap: "wrap" }}>
              <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{t.name}</span>
              <span style={{ flex: 1, fontSize: 11.5, color: "var(--fg-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 120 }} title={t.body}>{t.body}</span>
              <Pill tone={t.approved ? "pos" : /reject|disable|paused/i.test(t.event || "") ? "neg" : "warn"}>
                {t.approved ? "aprovado" : /reject/i.test(t.event || "") ? "reprovado" : "aguardando"}
              </Pill>
            </div>
          ))}
          {on && pending.length > 0 && (
            <span className="mono dim" style={{ fontSize: 10.5 }}>
              sem o template aprovado, o 1º toque só sai pra lead que já escreveu (janela aberta); lembrete cai em alerta quente quando a janela fecha
            </span>
          )}
        </div>
        {/* Bateria de replay: o portão da conversa com IA — roda o cérebro
            contra conversas reais do histórico e mostra o que ele teria feito. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className="kicker">bateria de replay (testa a IA em 25 conversas reais antes de ligar a conversa)</span>
            <button onClick={startReplay} disabled={replayBusy || replayDoc?.status === "running"}
              style={{ ...btn, opacity: replayBusy || replayDoc?.status === "running" ? 0.6 : 1 }}>
              {replayDoc?.status === "running" ? `rodando… ${replayDoc?.progress?.done ?? 0}/${replayDoc?.progress?.total ?? "?"}` : "rodar bateria"}
            </button>
            <button onClick={loadReplay} className="mono dim" style={{ fontSize: 11 }}>↻</button>
          </div>
          {replayDoc?.status === "error" && <span className="mono" style={{ fontSize: 11.5, color: "var(--neg)" }}>{replayDoc.error}</span>}
          {replayDoc?.report && (replayDoc.status === "done" || replayDoc.status === "running") && (
            <span className="mono dim" style={{ fontSize: 11 }}>
              {replayDoc.report.threads} conversas · {replayDoc.report.turns} turnos · agendaria em {replayDoc.report.wouldBookThreads} (na vida real {replayDoc.report.realBookedThreads} viraram call) · pediria humano {replayDoc.report.actions?.humano ?? 0}x · trava de preço {replayDoc.report.priceGuardHits} · erros {replayDoc.report.errors}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "flex-end" }}>
          {note && <span className="mono" style={{ fontSize: 11.5, color: note.ok ? "var(--pos)" : "var(--neg)", maxWidth: 520, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={note.text}>{note.text}</span>}
          <button onClick={save} style={{ ...btn, background: "var(--btn-bg)", color: "var(--btn-fg)", border: "none", fontWeight: 600 }}>salvar</button>
        </div>
      </div>
    </Card>
  );
}

export function WaAutomationsPanel({ product }) {
  if (!product) return <EmptyState title="Nenhum produto cadastrado" hint="Crie o produto em Ajustes." />;
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 14, maxWidth: 980 }}>
      <SdrBotCard key={"sdr-" + product.id} product={product} />
      <ConversationFlowsCard product={product} />
      <RulesCard product={product} />
      <CallFlowCard key={product.id} product={product} />
      <TemplatesCard />
      <FlowsCard product={product} />
      <QuickRepliesCard product={product} />
    </div>
  );
}
