// "Histórico e resumos" do cliente (Clientes → ⋯). Uma vista com desenho
// próprio, na linguagem da ficha lateral: à esquerda as reuniões (próxima,
// resumidas e sem resumo), no centro o resumo escolhido e a linha do tempo do
// lead. Superfícies --bg-inset raio 20 sem borda, peças internas --bg-1 raio
// 16, controles em cápsula e status como ponto + palavra.
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { displayName } from "../lib/users.js";
import { waLink } from "../lib/ui.js";
import { ACTIVITY_TYPES, activityText } from "./timeline.jsx";
import { summaryReason } from "./customer-meeting.jsx";

const TZ = "America/Sao_Paulo";
function momentOf(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const d = new Date(/([Zz]|[+-]\d{2}:?\d{2})$/.test(s) ? s : `${s}${s.length === 16 ? ":00" : ""}-03:00`);
  return Number.isFinite(d.getTime()) ? d : null;
}
const fmtDay = (d) => d.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" });
const fmtLong = (d) => d.toLocaleString("pt-BR", { timeZone: TZ, day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const fmtStamp = (d) => d.toLocaleString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const fmtMonth = (d) => d.toLocaleDateString("pt-BR", { timeZone: TZ, month: "long", year: "numeric" });

const KIND_LABEL = { integracao: "Reunião com o cliente", call: "Call de venda", brief: "Briefing da integração" };
const toneOfSummary = (s) => {
  if (s.kind === "brief") return { tone: "accent", word: "passagem" };
  if (s.kind === "integracao") {
    const v = s.data.sentimento || "";
    return { tone: v === "satisfeito" ? "pos" : v === "em risco" ? "neg" : "warn", word: v || "sem leitura" };
  }
  const t = s.data.temperatura || "";
  return { tone: t === "quente" ? "neg" : t === "morno" ? "warn" : "mut", word: t || "sem leitura" };
};

function Status({ tone, children }) {
  return <span className="chist-status" data-tone={tone}>{children}</span>;
}

// Os itens do resumo vêm como string ou objeto, conforme a versão da IA.
const textOf = (v) => (typeof v === "string" ? v : v?.item || v?.ponto || v?.objecao || JSON.stringify(v));

function Block({ title, children }) {
  return <section className="chist-block"><h4>{title}</h4>{children}</section>;
}
function Bullets({ items, numbered = false, check = false }) {
  if (!items?.length) return null;
  const Tag = numbered ? "ol" : "ul";
  return <Tag className={`chist-list${check ? " is-check" : ""}`}>{items.map((v, i) => <li key={i}>{textOf(v)}</li>)}</Tag>;
}

function SuggestedMessage({ title, text, phone }) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  const wa = phone ? waLink(phone) : null;
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { window.prompt("Mensagem:", text); } };
  return (
    <div className="chist-message">
      <span className="chist-kicker">{title}</span>
      <p>{text}</p>
      <div className="chist-actions">
        {wa && <a className="chist-btn is-wa" href={`${wa}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">Enviar no WhatsApp ↗</a>}
        <button type="button" className="chist-btn" onClick={copy}>{copied ? "Copiado ✓" : "Copiar"}</button>
      </div>
    </div>
  );
}

function SummaryView({ item, phone }) {
  const s = item.data;
  const { tone, word } = toneOfSummary(item);
  const why = s.sentimentoPorque || s.temperaturaPorque || "";
  const at = new Date(item.at);
  return (
    <article className="chist-card chist-summary">
      <header className="chist-summary-head">
        <div>
          <span className="chist-kicker is-accent">{KIND_LABEL[item.kind]} · IA</span>
          <h3>{Number.isFinite(at.getTime()) ? fmtLong(at) : "sem data"}</h3>
        </div>
        <Status tone={tone}>{word}</Status>
      </header>
      {why && <p className="chist-why">{why}</p>}
      {s.resumo && <p className="chist-lead">{s.resumo}</p>}

      {item.kind === "integracao" && (
        <div className="chist-blocks">
          {s.configurado?.length > 0 && <Block title="Configurado"><Bullets items={s.configurado} check /></Block>}
          {s.pendencias?.length > 0 && (
            <Block title="Pendências">
              <ul className="chist-list is-owners">{s.pendencias.map((p, i) => (
                <li key={i}><span className="chist-owner">{p.responsavel || "?"}</span><span>{textOf(p)}</span></li>
              ))}</ul>
            </Block>
          )}
          {s.proximosPassos?.length > 0 && <Block title="Próximos passos"><Bullets items={s.proximosPassos} numbered /></Block>}
        </div>
      )}
      {item.kind === "call" && (
        <div className="chist-blocks">
          {s.dores?.length > 0 && <Block title="Dores confirmadas"><Bullets items={s.dores} /></Block>}
          {s.objecoes?.length > 0 && (
            <Block title="Objeções">
              <ul className="chist-list is-objections">{s.objecoes.map((o, i) => (
                <li key={i}>
                  <Status tone={o.resolvida ? "pos" : "neg"}>{o.resolvida ? "tratada" : "em aberto"}</Status>
                  <strong>{textOf(o)}</strong>
                  {o.comoFoiTratada && <small>{o.comoFoiTratada}</small>}
                </li>
              ))}</ul>
            </Block>
          )}
          {s.compromissos?.length > 0 && <Block title="Combinados"><Bullets items={s.compromissos} /></Block>}
        </div>
      )}
      {item.kind === "brief" && (
        <div className="chist-blocks">
          {(s.entregas || s.vendido)?.length > 0 && <Block title="O que foi vendido"><Bullets items={s.entregas || s.vendido} check /></Block>}
          {s.atencao?.length > 0 && (
            <Block title="Pontos de atenção">
              <ul className="chist-list">{s.atencao.map((a, i) => <li key={i}>{typeof a === "string" ? a : `${a.ponto}: ${a.porque}`}</li>)}</ul>
            </Block>
          )}
        </div>
      )}

      {s.followup?.nota && (
        <div className="chist-note"><span className="chist-kicker">{item.kind === "call" ? "Próximo passo" : "Acompanhamento"}</span><p>{s.followup.nota}</p></div>
      )}
      <SuggestedMessage title="WhatsApp sugerido" text={s.followup?.whatsapp} phone={phone} />
      {item.recordingUrl && <a className="chist-btn is-ghost" href={item.recordingUrl} target="_blank" rel="noopener noreferrer">Ver gravação ↗</a>}
    </article>
  );
}

function Timeline({ acts }) {
  const [all, setAll] = useState(false);
  const shown = all ? acts : acts.slice(0, 12);
  let month = "";
  return (
    <section className="chist-card">
      <header className="chist-card-head">
        <h3>Linha do tempo</h3>
        <span>{acts.length} {acts.length === 1 ? "registro" : "registros"}</span>
      </header>
      {acts.length === 0 ? <p className="chist-empty">Nenhum contato registrado ainda.</p> : (
        <ol className="chist-timeline">
          {shown.map((a) => {
            const d = new Date(a.at || 0);
            const m = Number.isFinite(d.getTime()) ? fmtMonth(d) : "";
            const head = m && m !== month ? (month = m) : "";
            const meta = ACTIVITY_TYPES[a.type] || ACTIVITY_TYPES.note;
            const auto = a.type === "stage" || a.type === "system";
            const author = a.author && !["system", "api", "cockpit"].includes(a.author) ? (a.author === "lead" ? "cliente" : displayName(a.author)) : "";
            return (
              <React.Fragment key={a.id}>
                {head && <li className="chist-month">{head}</li>}
                <li className={`chist-item${auto ? " is-auto" : ""}`}>
                  <span className="chist-icon" title={meta.label} aria-hidden="true">{meta.glyph}</span>
                  <div>
                    <div className="chist-item-text">{activityText(a)}</div>
                    <small>{[Number.isFinite(d.getTime()) ? fmtStamp(d) : "", meta.label, author].filter(Boolean).join(" · ")}</small>
                  </div>
                </li>
              </React.Fragment>
            );
          })}
        </ol>
      )}
      {acts.length > 12 && (
        <button type="button" className="chist-btn is-ghost" onClick={() => setAll((v) => !v)}>{all ? "Mostrar menos" : `Ver tudo (${acts.length})`}</button>
      )}
    </section>
  );
}

export function CustomerHistoryView({ customer, lead, onSchedule }) {
  const leadId = customer.leadId && lead ? lead.id : "";
  const [acts, setActs] = useState(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [sel, setSel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!leadId) { setActs([]); return undefined; }
    setActs(null); setFailed(false);
    api.listActivities(leadId).then((a) => alive && setActs(a || [])).catch(() => { if (alive) { setActs([]); setFailed(true); } });
    return () => { alive = false; };
  }, [leadId, reload]);

  const summaries = useMemo(() => (acts || []).flatMap((a) => {
    if (a.meta?.event === "call_summary" && a.meta?.summary) return [{ id: a.id, at: a.at, kind: a.meta.kind === "integracao" ? "integracao" : "call", data: a.meta.summary, recordingUrl: a.meta.recordingUrl || "" }];
    if (a.meta?.event === "integration_brief" && a.meta?.brief) return [{ id: a.id, at: a.at, kind: "brief", data: a.meta.brief, recordingUrl: a.meta.recordingUrl || "" }];
    return [];
  }).sort((x, y) => new Date(y.at || 0) - new Date(x.at || 0)), [acts]);
  const timeline = useMemo(() => (acts || [])
    .filter((a) => !(a.type === "system" && (a.meta?.event === "call_summary" || a.meta?.event === "integration_brief")))
    .sort((x, y) => new Date(y.at || 0) - new Date(x.at || 0)), [acts]);
  const current = summaries.find((s) => s.id === sel) || summaries[0] || null;

  const at = momentOf(lead?.integrationAt);
  const upcoming = at && at.getTime() > Date.now() ? at : null;
  const unsummarized = !upcoming && at && lead?.integrationCallUrl && lead.integrationSummaryFor !== lead.integrationMeetEventId ? at : null;

  async function summarize() {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api.customerMeetingSummary(customer.id);
      if (r?.ok) { setMsg({ text: "Resumo pronto." }); setReload((n) => n + 1); }
      else setMsg({ error: true, text: `Sem resumo: ${summaryReason(r)}.` });
    } catch (e) { setMsg({ error: true, text: e.message || "Falha ao gerar o resumo." }); }
    finally { setBusy(false); }
  }

  if (!leadId) {
    return <div className="chist"><p className="chist-empty is-card">Cliente sem lead vinculado: o histórico e os resumos de reunião moram no lead de origem.</p></div>;
  }
  return (
    <div className="chist">
      <aside className="chist-card chist-meetings" aria-label="Reuniões">
        <header className="chist-card-head"><h3>Reuniões</h3>{onSchedule && <button type="button" className="chist-btn is-small" onClick={onSchedule}>{upcoming ? "Remarcar" : "Marcar"}</button>}</header>
        <ul>
          {upcoming && (
            <li className="chist-meeting is-static">
              <span className="chist-meeting-date">{fmtDay(upcoming)}</span>
              <span className="chist-meeting-body">
                <strong>Próxima reunião</strong>
                <span className="chist-meeting-meta"><Status tone="accent">{`marcada · ${upcoming.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })}`}</Status>
                  {lead.integrationCallUrl && <a className="chist-link" href={lead.integrationCallUrl} target="_blank" rel="noopener noreferrer">Entrar no Meet ↗</a>}</span>
              </span>
            </li>
          )}
          {unsummarized && (
            <li className="chist-meeting is-static">
              <span className="chist-meeting-date">{fmtDay(unsummarized)}</span>
              <span className="chist-meeting-body">
                <strong>Reunião com o cliente</strong>
                <span className="chist-meeting-meta"><Status tone="warn">sem resumo</Status>
                  <button type="button" className="chist-link" onClick={summarize} disabled={busy}>{busy ? "Gerando…" : "Gerar resumo"}</button></span>
              </span>
            </li>
          )}
          {summaries.map((s) => {
            const d = new Date(s.at);
            const active = current?.id === s.id;
            return (
              <li key={s.id}>
                <button type="button" className="chist-meeting" aria-pressed={active} onClick={() => setSel(s.id)}>
                  <span className="chist-meeting-date">{Number.isFinite(d.getTime()) ? fmtDay(d) : "—"}</span>
                  <span className="chist-meeting-body"><strong>{KIND_LABEL[s.kind]}</strong><span className="chist-meeting-meta"><Status tone="pos">resumida</Status></span></span>
                </button>
              </li>
            );
          })}
        </ul>
        {acts === null && <p className="chist-empty">carregando…</p>}
        {acts !== null && !upcoming && !unsummarized && summaries.length === 0 && <p className="chist-empty">Nenhuma reunião com resumo ainda.</p>}
        {msg && <p role={msg.error ? "alert" : "status"} className={`chist-feedback${msg.error ? " is-error" : ""}`}>{msg.text}</p>}
      </aside>

      <div className="chist-main">
        {failed && (
          <div className="chist-card chist-error" role="alert">
            <span>Não foi possível carregar o histórico.</span>
            <button type="button" className="chist-btn is-small" onClick={() => setReload((n) => n + 1)}>Tentar de novo</button>
          </div>
        )}
        {acts === null ? <div className="chist-card"><p className="chist-empty">carregando o histórico…</p></div> : (
          <>
            {current ? <SummaryView item={current} phone={customer.phone || lead.phone || ""} /> : !failed && (
              <div className="chist-card chist-summary-empty">
                <h3>Nenhum resumo ainda</h3>
                <p>O resumo sai sozinho depois de uma reunião gravada no Meet. Marque a próxima pela ficha e ele aparece aqui.</p>
              </div>
            )}
            <Timeline acts={timeline} />
          </>
        )}
      </div>
    </div>
  );
}
