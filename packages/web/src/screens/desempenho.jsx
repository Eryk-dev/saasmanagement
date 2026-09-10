import React from "react";
import { PageHead, Segmented } from "../components/viz.jsx";
import { EmptyState, Avatar, SectionHead, SecondaryButton, toast } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import { usePeriod } from "../components/period-picker.jsx";
import { currentUser, isAdminUser, displayName } from "../lib/users.js";
import { fmt, bizDay } from "../lib/format.js";

// Análise de Desempenho (Leo, 10/09/2026): a revisão de fim de dia (depois
// semanal) de cada pessoa, com as métricas fixas por papel — SDR, mídia
// social e closer — uma linha por pessoa, na ordem que o Leo pediu. Os
// números de funil/venda vêm do /api/scoreboard (a MESMA régua da Visão geral
// e da Análise de Equipe); objeções, produção do social e os registros
// manuais do dia vêm do /api/desempenho. Clicar na linha abre o detalhe (quem
// furou, quem não respondeu, objeções); "copiar relatório" gera o texto da
// revisão. Sem envio automático: a tela É o relatório.
const { useState, useEffect, useMemo, useCallback } = React;

// ── Janela: Dia · Semana · Mês (+ ◀ ▶) sobre o período GLOBAL ─────────────────
const MODE_KEY = "cockpit_desempenho_mode";
const noon = (ymd) => { const [y, m, d] = String(ymd).split("-").map(Number); return new Date(y, m - 1, d, 12); };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monday = (d) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const firstOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1, 12);
const lastOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0, 12);
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const dm = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
// A IA escreve a objeção como frase inteira; no chip da linha cabe o começo
// (o texto completo fica no tooltip e na tabela do detalhe).
const short = (t, n) => { const s = String(t || ""); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

// Modo lido da janela global (preset ou custom que casa com um dia/semana/mês).
function modeOf(period, win) {
  if (period === "today" || period === "yesterday") return "dia";
  if (period === "week" || period === "lastWeek") return "semana";
  if (period === "month" || period === "lastMonth") return "mes";
  if (period === "custom" && win.since && win.until) {
    if (win.since === win.until) return "dia";
    const a = noon(win.since), b = noon(win.until);
    if (a.getDay() === 1 && b.getDay() === 0 && win.days === 7) return "semana";
    if (a.getDate() === 1 && ymd(b) === ymd(lastOfMonth(a))) return "mes";
  }
  return null;
}

function useWindowNav() {
  const { period, custom, setPeriod, setCustom, win } = usePeriod();
  const today = noon(bizDay(new Date()));
  const detected = modeOf(period, win);
  const [modePref, setModePref] = useState(() => { try { return localStorage.getItem(MODE_KEY) || "dia"; } catch { return "dia"; } });
  const mode = detected || modePref;
  const setMode = (m) => {
    setModePref(m);
    try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ }
    setPeriod(m === "dia" ? "today" : m === "semana" ? "week" : "month");
  };
  // Entrou na tela com a janela global fora do Dia/Semana/Mês (ex.: "últimos
  // 30 dias" de outra tela): aplica o modo preferido, senão o seletor mentiria.
  useEffect(() => {
    if (!detected) setPeriod(modePref === "dia" ? "today" : modePref === "semana" ? "week" : "month");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Âncora da janela atual (início) pra andar pra trás/frente.
  const anchor = detected ? noon(win.since) : today;
  const goTo = (start) => {
    const t = today;
    if (mode === "dia") {
      if (ymd(start) === ymd(t)) return setPeriod("today");
      if (ymd(start) === ymd(addDays(t, -1))) return setPeriod("yesterday");
      setCustom({ since: ymd(start), until: ymd(start) }); setPeriod("custom");
    } else if (mode === "semana") {
      const s = monday(start);
      if (ymd(s) === ymd(monday(t))) return setPeriod("week");
      if (ymd(s) === ymd(addDays(monday(t), -7))) return setPeriod("lastWeek");
      setCustom({ since: ymd(s), until: ymd(addDays(s, 6)) }); setPeriod("custom");
    } else {
      const s = firstOfMonth(start);
      if (ymd(s) === ymd(firstOfMonth(t))) return setPeriod("month");
      if (ymd(s) === ymd(firstOfMonth(addDays(firstOfMonth(t), -1)))) return setPeriod("lastMonth");
      setCustom({ since: ymd(s), until: ymd(lastOfMonth(s)) }); setPeriod("custom");
    }
  };
  const step = (dir) => {
    if (mode === "dia") return goTo(addDays(anchor, dir));
    if (mode === "semana") return goTo(addDays(monday(anchor), 7 * dir));
    return goTo(firstOfMonth(addDays(firstOfMonth(anchor), dir > 0 ? 32 : -1)));
  };
  const atNow = mode === "dia" ? ymd(anchor) >= ymd(today)
    : mode === "semana" ? ymd(monday(anchor)) >= ymd(monday(today))
      : ymd(firstOfMonth(anchor)) >= ymd(firstOfMonth(today));
  // Rótulo humano da janela.
  const label = (() => {
    if (!detected) return win.label || `${win.since} a ${win.until}`;
    const a = noon(win.since), b = noon(win.until);
    if (mode === "dia") return ymd(a) === ymd(today) ? `hoje · ${dm(a)}` : ymd(a) === ymd(addDays(today, -1)) ? `ontem · ${dm(a)}` : dm(a);
    if (mode === "semana") return `${dm(a)} a ${dm(b)}${period === "week" ? " · em curso" : ""}`;
    return `${MONTHS[a.getMonth()]}/${a.getFullYear()}${period === "month" ? " · em curso" : ""}`;
  })();
  return { mode, setMode, step, atNow, label, win, period, custom, singleDay: win.since === win.until };
}

// ── Texto do relatório (template, sem IA) ─────────────────────────────────────
const n = (v) => (v == null ? "—" : fmt.int(v));
const names = (list) => (list || []).map((r) => r.name || r.id).filter(Boolean);
const joinNames = (list) => { const a = names(list); return a.length ? a.join(", ") : "ninguém"; };

export function reportText({ role, row, extra, label, socialTotals }) {
  const head = `Relatório · ${row.name} (${role === "sdr" ? "SDR" : role === "closer" ? "closer" : "mídia social"}) · ${label}`;
  const lines = [head];
  if (role === "sdr") {
    const log = extra?.logs?.[row.user] || {};
    lines.push(`No-show: ${n(row.noShow)}`);
    lines.push(`Calls agendadas: ${n(row.callsBooked)} (${n(row.callsBookedIcp)} com ICP)`);
    lines.push(`Contatos feitos: ${n(row.contacted)} · sem resposta: ${n(row.noReply)}`);
    lines.push(`Social selling: ${n(log.socialSelling || 0)} feitos · ${n(row.socialSellingLeads)} viraram lead`);
    if (row.detail?.noShow?.length) lines.push(`Não compareceram: ${joinNames(row.detail.noShow)}`);
    if (row.detail?.noReply?.length) lines.push(`Não responderam: ${joinNames(row.detail.noReply)}`);
    if (row.detail?.icp?.length) lines.push(`Calls com ICP: ${joinNames(row.detail.icp)}`);
  } else if (role === "closer") {
    lines.push(`No-show: ${n(row.noShow)}`);
    lines.push(`Calls realizadas: ${n(row.callsShown)}`);
    lines.push(`Receita: ${fmt.money(row.revenue)} · ticket médio ${row.ticket != null ? fmt.money(row.ticket) : "—"}`);
    lines.push(`Follow-ups executados: ${n(row.followupsDone)}`);
    if (row.detail?.noShow?.length) lines.push(`Não compareceram: ${joinNames(row.detail.noShow)}`);
    const ob = extra?.objections?.[row.user];
    if (ob?.count) {
      const t = ob.temperatura || {};
      lines.push(`Calls analisadas: ${ob.count} (${t.quente || 0} quentes, ${t.morno || 0} mornas, ${t.frio || 0} frias)`);
      if (ob.objecoes?.length) lines.push(`Objeções: ${ob.objecoes.slice(0, 6).map((o) => `${o.objecao} (${o.total}${o.abertas ? `, ${o.abertas} em aberto` : ""})`).join("; ")}`);
      if (ob.dores?.length) lines.push(`Dores: ${ob.dores.slice(0, 5).map((d) => d.dor).join("; ")}`);
    } else lines.push("Calls analisadas: nenhuma call resumida por IA no período");
  } else {
    const log = extra?.logs?.[row.user] || {};
    const s = socialTotals || {};
    lines.push(`Feed: ${s.feed == null ? "—" : `${s.feed} (${s.posts || 0} posts, ${s.reels || 0} reels)`}`);
    lines.push(`Stories: ${n(s.stories)}`);
    lines.push(`Criativos: ${n(log.creatives || 0)}`);
  }
  return lines.join("\n");
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast("Relatório copiado", "pos"); }
  catch { toast("Não deu pra copiar · tente de novo", "neg"); }
}

// ── Peças de tabela ──────────────────────────────────────────────────────────
const Th = ({ children, right, title }) => (
  <th className="kicker" title={title} style={{ padding: "8px 10px", textAlign: right ? "right" : "left", whiteSpace: "nowrap", background: "var(--bg-2)", fontWeight: 600 }}>{children}</th>
);
const Num = ({ v, tone, title }) => (
  <td className="tnum" title={title} style={{ textAlign: "right", fontWeight: 600, color: tone === "neg" && v > 0 ? "var(--neg)" : "var(--fg-1)" }}>{v == null ? "—" : typeof v === "string" ? v : fmt.int(v)}</td>
);

function Stepper({ value, onInc, busy }) {
  const btn = (label, d) => (
    <button onClick={(e) => { e.stopPropagation(); onInc(d); }} disabled={busy}
      style={{ width: 24, height: 24, borderRadius: "var(--r-1)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 13, fontWeight: 700, lineHeight: 1, opacity: busy ? 0.5 : 1 }}>{label}</button>
  );
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} onClick={(e) => e.stopPropagation()}>
      {btn("−", -1)}<span className="tnum" style={{ minWidth: 18, textAlign: "center", fontWeight: 600 }}>{fmt.int(value || 0)}</span>{btn("+", 1)}
    </span>
  );
}

function Chips({ items, onOpen, empty = "ninguém" }) {
  if (!items?.length) return <span className="dim" style={{ fontSize: 12.5 }}>{empty}</span>;
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 6 }}>
      {items.map((r) => (
        <button key={r.id} onClick={() => onOpen(r)} className="chip" title="abrir o lead" style={{ cursor: "pointer" }}>{r.name || r.id}</button>
      ))}
    </span>
  );
}

const DetailBlock = ({ title, children }) => (
  <div style={{ minWidth: "min(100%, 220px)", flex: 1 }}>
    <div className="kicker" style={{ marginBottom: 6 }}>{title}</div>
    <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{children}</div>
  </div>
);

const TEMP_TONE = { quente: "pos", morno: "warn", frio: "neg" };
function ObjectionsBlock({ ob, onOpen }) {
  if (!ob?.count) return <DetailBlock title="Calls e objeções"><span className="dim">nenhuma call resumida por IA no período</span></DetailBlock>;
  const t = ob.temperatura || {};
  return (
    <div style={{ flex: "1 1 100%", display: "flex", flexWrap: "wrap", gap: 20 }}>
      <DetailBlock title={`Calls analisadas · ${ob.count}`}>
        <span style={{ display: "inline-flex", gap: 10, flexWrap: "wrap" }}>
          <span className="chip pos">{t.quente || 0} quentes</span>
          <span className="chip warn">{t.morno || 0} mornas</span>
          <span className="chip neg">{t.frio || 0} frias</span>
        </span>
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {(ob.recent || []).map((c) => (
            <div key={`${c.leadId}-${c.at}`} style={{ display: "flex", gap: 8, alignItems: "baseline", minWidth: 0 }}>
              <button onClick={() => onOpen({ id: c.leadId, name: c.leadName })} className="chip" style={{ cursor: "pointer", flexShrink: 0, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.leadName}>{c.leadName || c.leadId}</button>
              <span className={`chip ${TEMP_TONE[c.temperatura] || ""}`} style={{ flexShrink: 0 }}>{c.temperatura || "—"}</span>
              <span className="dim" style={{ fontSize: 12, flexShrink: 0 }}>{c.at ? dm(new Date(c.at)) : ""}</span>
              <span style={{ color: "var(--fg-2)", fontSize: 12.5, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.resumo}>{c.resumo}</span>
            </div>
          ))}
        </div>
      </DetailBlock>
      <DetailBlock title="Objeções">
        {ob.objecoes?.length ? (
          <table style={{ borderCollapse: "collapse" }}>
            <tbody>
              {ob.objecoes.slice(0, 10).map((o) => (
                <tr key={o.objecao}>
                  <td style={{ padding: "2px 10px 2px 0" }}>{o.objecao}</td>
                  <td className="tnum" style={{ padding: "2px 8px", textAlign: "right", fontWeight: 600 }}>{o.total}×</td>
                  <td style={{ padding: "2px 0", whiteSpace: "nowrap", color: o.abertas ? "var(--neg)" : "var(--fg-4)" }}>{o.abertas ? `${o.abertas} em aberto` : "tratada"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <span className="dim">nenhuma objeção registrada</span>}
        {ob.dores?.length > 0 && (
          <div style={{ marginTop: 8 }}><span className="kicker">dores</span> <span style={{ color: "var(--fg-2)" }}>{ob.dores.slice(0, 6).map((d) => `${d.dor} (${d.total})`).join(" · ")}</span></div>
        )}
      </DetailBlock>
    </div>
  );
}

// ── Linha + detalhe por papel ────────────────────────────────────────────────
function PersonCell({ row }) {
  return (
    <td style={{ minWidth: 180 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
        <Avatar id={row.user} name={row.name} size={26} />
        <span style={{ fontWeight: 600, fontSize: 13 }}>{row.name || displayName(row.user)}</span>
      </span>
    </td>
  );
}

function ReportCell({ onCopy }) {
  return (
    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
      <SecondaryButton size="sm" onClick={(e) => { e.stopPropagation(); onCopy(); }} title="copia o texto da revisão">copiar relatório</SecondaryButton>
    </td>
  );
}

function Section({ title, sub, cols, rows, render, renderDetail, emptyTitle, emptyHint }) {
  const [open, setOpen] = useState(null);
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <SectionHead title={title} sub={sub} />
      {!rows.length ? <EmptyState title={emptyTitle} hint={emptyHint} /> : (
        <div className="tbl-x" style={{ background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)" }}>
          <table className="tbl" style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead><tr><Th>Pessoa</Th>{cols.map((c) => <Th key={c.label} right={c.right !== false} title={c.title}>{c.label}</Th>)}<Th right> </Th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <React.Fragment key={row.user}>
                  <tr data-click onClick={() => setOpen(open === row.user ? null : row.user)} style={{ background: open === row.user ? "var(--accent-soft)" : undefined }}>
                    {render(row)}
                  </tr>
                  {open === row.user && (
                    <tr><td colSpan={cols.length + 2} style={{ background: "var(--bg-inset)", padding: "14px 16px 18px" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>{renderDetail(row)}</div>
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── A tela ───────────────────────────────────────────────────────────────────
function DesempenhoScreen({ onOpenLead }) {
  const { version } = useData();
  const [product] = useActiveSaas();
  const nav = useWindowNav();
  const { win, period, custom } = nav;
  const [sb, setSb] = useState(null);
  const [extra, setExtra] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  // Lente: admin vê todo mundo; acesso por chave mestra (sem usuário no
  // localStorage) conta como gestão, igual à Visão geral (#468).
  const meUser = currentUser();
  const admin = !meUser || isAdminUser(meUser);
  const me = meUser?.id || "";

  const loadExtra = useCallback(() => {
    if (!product?.id) return Promise.resolve();
    return api.desempenho(product.id, win).then(setExtra).catch((e) => { setExtra(null); setErr(e.message); });
  }, [product?.id, win.since, win.until]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!product?.id) return;
    let alive = true; setSb(null); setExtra(null); setErr(null);
    Promise.all([api.scoreboard(product.id, win), api.desempenho(product.id, win)])
      .then(([s, d]) => { if (!alive) return; setSb(s); setExtra(d); })
      .catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [product?.id, period, custom.since, custom.until, version]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lente individual: sem etiqueta admin, só a própria linha (mesma regra da Visão geral).
  const mine = (rows) => (admin ? rows : rows.filter((r) => r.user === me));
  const sdrRows = useMemo(() => mine(sb?.sdr || []), [sb, admin, me]); // eslint-disable-line react-hooks/exhaustive-deps
  const closerRows = useMemo(() => mine(sb?.closer || []), [sb, admin, me]); // eslint-disable-line react-hooks/exhaustive-deps
  const socialRows = useMemo(() => mine((extra?.socialUsers || []).map((id) => ({ user: id, name: displayName(id) }))), [extra, admin, me]); // eslint-disable-line react-hooks/exhaustive-deps
  const logOf = (uid) => extra?.logs?.[uid] || { socialSelling: 0, creatives: 0, days: {} };
  const canEdit = (uid) => nav.singleDay && (admin || uid === me);

  const openLead = (ref) => {
    const l = (window.SEED?.LEADS || []).find((x) => x.id === ref.id);
    if (l && onOpenLead) onOpenLead(l);
    else toast("Esse lead não está no seu escopo de leads", "warn");
  };
  const bump = async (uid, field, d) => {
    if (!product?.id || busy) return;
    setBusy(true);
    try {
      await api.desempenhoLog(product.id, { user: uid, day: win.since, inc: { [field]: d } });
      await loadExtra();
    } catch (e) { toast(`Não deu pra registrar · ${e.message || "tente de novo"}`, "neg"); }
    finally { setBusy(false); }
  };
  const counter = (uid, field) => {
    const v = logOf(uid)[field] || 0;
    return canEdit(uid)
      ? <td style={{ textAlign: "right" }}><Stepper value={v} busy={busy} onInc={(d) => bump(uid, field, d)} /></td>
      : <Num v={v} title={nav.singleDay ? "registrado no dia" : "soma dos dias da janela"} />;
  };
  const copy = (role, row) => copyText(reportText({ role, row, extra, label: nav.label, socialTotals: extra?.social }));

  if (!product) return <EmptyState title="Sem produto ativo" hint="Escolha um produto no seletor da barra lateral." />;
  const loading = sb == null && !err;
  const soc = extra?.social || {};

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      <PageHead title="Análise de Desempenho" sub="por pessoa · dia, semana ou mês · clique na linha pra ver quem é quem">
        <Segmented value={nav.mode} onChange={nav.setMode} options={[{ value: "dia", label: "Dia" }, { value: "semana", label: "Semana" }, { value: "mes", label: "Mês" }]} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <SecondaryButton size="sm" onClick={() => nav.step(-1)} title="anterior">◀</SecondaryButton>
          <span className="tnum" style={{ minWidth: 120, textAlign: "center", fontSize: 12.5, fontWeight: 600, color: "var(--fg-2)" }}>{nav.label}</span>
          <SecondaryButton size="sm" onClick={() => nav.step(1)} disabled={nav.atNow} title="próximo">▶</SecondaryButton>
        </span>
      </PageHead>
      <div style={{ padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 22 }}>
        {err && <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>{err}</div>}
        {loading && <div className="dim" style={{ fontSize: 12.5 }}>carregando…</div>}
        {!loading && (
          <>
            <Section
              title="SDR" sub="prospecção · contatos, agenda e social selling"
              rows={sdrRows}
              emptyTitle="Nenhum SDR neste produto" emptyHint="Marque a etiqueta SDR em Ajustes → Equipe pra pessoa aparecer aqui."
              cols={[
                { label: "No-show", title: "calls dos leads dela que não aconteceram (call vencida sem virar nada, furo marcado ou IA frio)" },
                { label: "Calls agendadas", title: "calls dos leads dela pela data da call" },
                { label: "Calls com ICP", title: "das agendadas, as com nota S/A/B (a faixa que vai pro closer sênior)" },
                { label: "Contatos feitos", title: "leads cujo 1º contato humano na janela foi dela" },
                { label: "Não responderam", title: "dos contatados por ela, os sem mensagem recebida no WhatsApp depois do 1º contato" },
                { label: "Social selling", title: "registrado por ela no Meu dia (+1 social selling)" },
                { label: "Viraram leads", title: "leads com origem Social selling criados na janela com ela de dona" },
              ]}
              render={(r) => (
                <>
                  <PersonCell row={r} />
                  <Num v={r.noShow} tone="neg" />
                  <Num v={r.callsBooked} />
                  <Num v={r.callsBookedIcp} />
                  <Num v={r.contacted} />
                  <Num v={r.noReply} tone="neg" />
                  {counter(r.user, "socialSelling")}
                  <Num v={r.socialSellingLeads} />
                  <ReportCell onCopy={() => copy("sdr", r)} />
                </>
              )}
              renderDetail={(r) => (
                <>
                  <DetailBlock title="Não compareceram"><Chips items={r.detail?.noShow} onOpen={openLead} /></DetailBlock>
                  <DetailBlock title="Não responderam"><Chips items={r.detail?.noReply} onOpen={openLead} /></DetailBlock>
                  <DetailBlock title="Calls com ICP"><Chips items={r.detail?.icp} onOpen={openLead} /></DetailBlock>
                  <DetailBlock title="Viraram leads (social selling)"><Chips items={r.detail?.socialSelling} onOpen={openLead} empty="nenhum" /></DetailBlock>
                  {extra?.objections?.[r.user] && <ObjectionsBlock ob={extra.objections[r.user]} onOpen={openLead} />}
                </>
              )}
            />

            <Section
              title="Mídia social" sub={`produção da conta${soc.errors?.feed ? " · Instagram indisponível agora" : ""}`}
              rows={socialRows}
              emptyTitle="Ninguém com o papel Mídia social" emptyHint="Marque a etiqueta em Ajustes → Equipe pra pessoa aparecer aqui."
              cols={[
                { label: "Feed", title: "posts, carrosséis e reels publicados no @ da conta na janela (produção da conta, não separa por pessoa)" },
                { label: "Stories", title: "stories capturados do Instagram na janela (captura de hora em hora)" },
                { label: "Criativos", title: "anotado por ela/ele na tela Redes sociais (criativos de hoje)" },
              ]}
              render={(r) => (
                <>
                  <PersonCell row={r} />
                  <Num v={soc.feed == null ? null : soc.feed} title={soc.feed == null ? (soc.errors?.feed || soc.errors?.setup || "sem dado") : `${soc.posts || 0} posts · ${soc.reels || 0} reels`} />
                  <Num v={soc.stories} />
                  {counter(r.user, "creatives")}
                  <ReportCell onCopy={() => copy("social", r)} />
                </>
              )}
              renderDetail={() => (
                <>
                  <DetailBlock title="Feed">
                    {soc.items?.length ? soc.items.map((m) => (
                      <div key={m.id}><span className="dim">{dm(new Date(m.at))}</span> · <span className="chip">{m.type === "VIDEO" ? "reel" : m.type === "CAROUSEL_ALBUM" ? "carrossel" : "post"}</span> {m.permalink ? <a href={m.permalink} target="_blank" rel="noopener noreferrer">{m.caption || "abrir"}</a> : m.caption}</div>
                    )) : <span className="dim">{soc.errors?.feed || soc.errors?.setup || "nada publicado na janela"}</span>}
                  </DetailBlock>
                  <DetailBlock title="Stories">
                    {soc.storyItems?.length ? soc.storyItems.map((s) => (
                      <div key={s.id}><span className="dim">{dm(new Date(s.at))}</span> · {s.type === "VIDEO" ? "vídeo" : "imagem"}{s.permalink ? <> · <a href={s.permalink} target="_blank" rel="noopener noreferrer">abrir</a></> : null}</div>
                    )) : <span className="dim">nenhum story capturado na janela</span>}
                  </DetailBlock>
                </>
              )}
            />

            <Section
              title="Closer" sub="fechamento · calls, receita e follow-up"
              rows={closerRows}
              emptyTitle="Nenhum closer neste produto" emptyHint="Marque a etiqueta closer em Ajustes → Equipe pra pessoa aparecer aqui."
              cols={[
                { label: "No-show", title: "calls dele na janela que não aconteceram" },
                { label: "Calls realizadas", title: "calls que aconteceram com ele (inclui a parte do histórico pré-cockpit)" },
                { label: "Receita", title: "receita reconhecida na janela (faturado/recorrente só pelo que entrou); conta grande fora" },
                { label: "Ticket médio", title: "receita ÷ fechamentos da janela" },
                { label: "Follow-ups", title: "follow-ups executados: toque humano em lead em Follow-up, 1 por lead por dia" },
                { label: "Objeções", title: "objeções das calls resumidas por IA na janela", right: false },
              ]}
              render={(r) => {
                const ob = extra?.objections?.[r.user];
                return (
                  <>
                    <PersonCell row={r} />
                    <Num v={r.noShow} tone="neg" />
                    <Num v={r.callsShown} />
                    <Num v={fmt.money(r.revenue)} />
                    <Num v={r.ticket != null ? fmt.money(r.ticket) : null} />
                    <Num v={r.followupsDone} />
                    <td style={{ maxWidth: 320 }}>
                      {ob?.count ? (
                        <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          <span className="dim" style={{ fontSize: 12 }}>{ob.count} call{ob.count === 1 ? "" : "s"}</span>
                          {(ob.objecoes || []).slice(0, 2).map((o) => <span key={o.objecao} className={`chip ${o.abertas ? "neg" : ""}`} title={o.objecao}>{short(o.objecao, 48)} · {o.total}</span>)}
                          {(ob.objecoes || []).length > 2 && <span className="dim" style={{ fontSize: 12 }}>+{ob.objecoes.length - 2}</span>}
                        </span>
                      ) : <span className="dim" style={{ fontSize: 12 }}>sem call resumida</span>}
                    </td>
                    <ReportCell onCopy={() => copy("closer", r)} />
                  </>
                );
              }}
              renderDetail={(r) => (
                <>
                  <DetailBlock title="Não compareceram"><Chips items={r.detail?.noShow} onOpen={openLead} /></DetailBlock>
                  <DetailBlock title="Follow-ups executados"><Chips items={r.detail?.followups} onOpen={openLead} empty="nenhum" /></DetailBlock>
                  <ObjectionsBlock ob={extra?.objections?.[r.user]} onOpen={openLead} />
                </>
              )}
            />
          </>
        )}
      </div>
    </div>
  );
}

export { DesempenhoScreen };
