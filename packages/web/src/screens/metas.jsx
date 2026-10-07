import React from "react";
import "./metas.css";
import { PageHead, Segmented } from "../components/viz.jsx";
import { Info } from "../components/story.jsx";
import { Avatar } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useActiveSaas } from "../lib/workspace.js";
import { Regua, levelOf } from "./overview.jsx";
import { CAREER_LEVELS, LEVELED_ROLES, levelLabel } from "../lib/levels.js";
import { isAdminUser } from "../lib/users.js";

// Metas — edita TODAS as metas de desempenho do produto por VAGA (SDR / closer
// / integrador) e, opcionalmente, por PESSOA. Escreve na collection `goals`, a
// mesma que o scoreboard e a Visão geral leem, então vale em todo campo que
// mostra meta. Campo vazio = usa o benchmark padrão.
//
// Reformulada (08/08/2026) no modelo aprovado da Visão geral: a meta do mês em
// RÉGUA com pace (digitar já move a barra; salvar é o que grava), a cadeia como
// funil HORIZONTAL com as taxas nos degraus, explicação longa em tooltip e a
// agenda de meses no fim, porque planejamento mexe pouco e operação fica em
// cima. Escala de cores única: vermelho → teal → verde → dourado.

const { useState: useS, useEffect: useE } = React;

// Meta digitada que briga com o que a meta do mês exige (mais de 15% de
// diferença). 15% porque arredondamento de cadeia sempre dá uma folga pequena,
// e avisar por 3 de diferença vira ruído que ninguém lê.
const divergente = (digitado, derivado) => {
  const v = Number(String(digitado ?? "").trim());
  if (!(v > 0) || !(Number(derivado) > 0)) return false;
  return Math.abs(v - derivado) / derivado > 0.15;
};

// "2026-08" → "ago/2026" (o mês da agenda de metas).
const mesLabel = (m) => {
  const [ano, mes] = String(m).split("-");
  const d = new Date(Number(ano), Number(mes) - 1, 1);
  return d.toLocaleDateString("pt-BR", { month: "short", year: "numeric" }).replace(".", "");
};

const infoDot = (t) => <Info texto={t} />;

const rk = (role, metric) => `${role}:${metric}`;

const money = (n) => `R$ ${Math.round(n).toLocaleString("pt-BR")}`;
const pct = (v) => `${Math.round(v * 1000) / 10}%`.replace(".", ",");
const int = (n) => Math.round(n).toLocaleString("pt-BR");

// De onde veio cada número — sem isso a cadeia parece chute.
const RATE_SOURCE = {
  history: "medida na janela do funil",
  calibrated: "calibrado pela ponta a ponta real",
  goal: "da meta configurada",
  benchmark: "padrão do mercado",
};
const TICKET_SOURCE = {
  prev_month: "ticket médio do mês anterior (vendido reconhecido ÷ nº de vendas, sem contas grandes)",
  initial_payments: "1ª fatura paga de cada cliente",
  paid_invoices: "faturas pagas recentes",
  won_tcv: "valor dos ganhos recentes",
  configured_ticket: "o ticket que você configurou",
};
// "2026-09" → "set/26" (a base do ticket médio na cadeia e no campo de contratos).
const mesCurto = (ym) => {
  const [y, m] = String(ym || "").split("-").map(Number);
  const nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return y && m ? `${nomes[m - 1]}/${String(y).slice(2)}` : "";
};
// Mês "AAAA-MM" → índice inteiro (a MESMA conta do servidor em pipeline-pace.js):
// a diferença entre dois índices é o expoente da regra de crescimento.
const monthIndex = (m) => { const [y, mm] = String(m).split("-").map(Number); return y * 12 + (mm - 1); };
// Trimestre do mês (1..4) e os três meses de um trimestre do ano.
const quarterOf = (m) => Math.floor((Number(String(m).slice(5, 7)) - 1) / 3) + 1;
const QUARTER_MONTHS = ["jan a mar", "abr a jun", "jul a set", "out a dez"];
// Como a meta daquele mês foi definida (a origem que o servidor devolve).
const META_SOURCE = { month: "meta agendada", growth: "pela regra de crescimento", default: "meta padrão do produto", system: "meta padrão do sistema" };
// Veredito de mês FECHADO (sem pace: ou bateu ou não).
const VEREDITO = { red: "não bateu", ok: "não bateu", green: "meta batida", gold: "super meta" };
const LVL_COLOR = { red: "var(--neg)", ok: "var(--accent)", green: "var(--pos)", gold: "var(--gold)" };

const BLOCKED = {
  ticket: "sem ticket médio ainda (nenhuma fatura paga nem valor lançado nos ganhos): preencha o Ticket médio no card do Closer e a cadeia passa a fechar.",
  closeRate: "a conversão da call está zerada, sem histórico e sem meta: preencha Call → ganho no card do Closer.",
  showRate: "o comparecimento está zerado, sem histórico e sem meta: preencha Comparecimento na call no card do SDR.",
  bookingRate: "a taxa de agendamento está zerada, sem histórico e sem meta: preencha Taxa de agendamento no card do SDR.",
  contactRate: "a taxa de contato está zerada, sem histórico e sem meta: preencha Taxa de contato no card do SDR.",
};
const blockedText = (k) => BLOCKED[k] || "faltam dados pra desdobrar a meta.";

// ── Cadeia da meta como funil horizontal ─────────────────────────────────────
// Mesmo desenho do Funil do período da Visão geral, só que com o que a meta
// EXIGE: caixa = volume da etapa, degrau = a taxa que liga uma etapa à outra
// (a origem de cada número mora no hover). Lê da esquerda pra direita: leads
// viram contatos, contatos viram calls, calls viram ganhos, ganhos viram venda.
function ChainBox({ nm, big, sub, title }) {
  return (
    <div className="metas-chain-box" title={title} style={{ flex: "1 1 0", minWidth: 92, padding: "4px 6px", textAlign: "center", cursor: title ? "help" : "default" }}>
      <div className="kicker" style={{ marginBottom: 4, whiteSpace: "nowrap" }}>{nm}</div>
      <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 650, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>{big}</div>
      <div className="tnum" style={{ fontSize: 10.5, color: "var(--fg-4)", minHeight: 15, whiteSpace: "nowrap" }}>{sub || ""}</div>
    </div>
  );
}

function ChainStep({ big, nm, title }) {
  return (
    <div title={title} style={{ flex: "0 0 auto", alignSelf: "center", textAlign: "center", padding: "0 6px", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, cursor: title ? "help" : "default" }}>
      {big != null && <span className="tnum" style={{ fontSize: 12.5, fontWeight: 650, color: "var(--accent)" }}>{big}</span>}
      <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true" style={{ color: "var(--fg-4)" }}>
        <path d="M1 5h10m0 0L8 2m3 3L8 8" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      </svg>
      <span style={{ fontSize: 10, color: "var(--fg-4)", whiteSpace: "nowrap" }}>{nm}</span>
    </div>
  );
}

function chainParts(d, people = {}) {
  const share = (total, role) => {
    const n = people?.[role] || 0;
    return n > 1 ? `${int(total / n)} por pessoa` : null;
  };
  // Período e amostra no hover: "medida no funil de jul/2026 (8 de 17 ...)" —
  // responde na tela de onde a taxa saiu e de qual período (pergunta do Leo).
  // O modo mês usa as MESMAS contas do funil da Visão geral filtrada no mês.
  const janela = d.rateWindow?.mode === "month" ? `no funil de ${mesLabel(d.rateWindow.month)}` : "nos últimos 30 dias";
  const amostra = (k, unidade) => {
    const c = d.rateCounts?.[k];
    return c?.d > 0 ? ` (${int(c.n)} de ${int(c.d)} ${unidade})` : "";
  };
  const fonte = (nome, src, k, unidade) => src === "history"
    ? `${nome}: medida ${janela}${amostra(k, unidade)}.`
    : `${nome}: ${RATE_SOURCE[src] || "sem origem"}.`;
  const boxes = [
    { nm: "Leads", big: int(d.leads), sub: "marketing entrega", title: "Entrada do funil: quem entrega é o marketing, então não vira meta de vaga." },
    { nm: "Contatos", big: int(d.contacts), sub: share(d.contacts, "sdr"), title: "Contatos no mês (meta do time de SDR)." },
    { nm: "Agendadas", big: int(d.callsBooked), sub: share(d.callsBooked, "sdr"), title: "Calls agendadas no mês (meta do time de SDR)." },
    { nm: "Realizadas", big: int(d.callsShown), sub: null, title: "Calls realizadas no mês, sem contar no-show (meta do time de closer)." },
    { nm: "Ganhos", big: int(d.won), sub: [d.wonSource === "company" ? "digitado vence" : null, share(d.won, "closer")].filter(Boolean).join(" · ") || null,
      title: d.wonSource === "company" ? "Meta de contratos digitada na Meta do mês: vence a divisão venda ÷ ticket." : "Meta de venda ÷ ticket médio." },
    { nm: d.superMode ? `Super ${d.chasePct}%` : "Venda", big: money(d.target), sub: d.superMode ? `base ${money(d.base)} batida` : "meta do mês",
      title: d.superMode ? `A meta base já caiu; a cadeia inteira persegue a próxima super meta (${d.chasePct}% da base).` : "A meta de venda do mês corrente." },
  ];
  const steps = [
    { big: pct(d.rates.contactRate), nm: "contato", title: fonte("Taxa de contato", d.rates.contactRateSource, "contactRate", "leads contatados") },
    { big: pct(d.rates.bookingRate), nm: "agendamento", title: fonte("Taxa de agendamento", d.rates.bookingRateSource, "bookingRate", "leads trabalhados marcaram call") },
    { big: pct(d.rates.showRate), nm: "comparecimento", title: fonte("Comparecimento", d.rates.showRateSource, "showRate", "que já deviam ter acontecido") },
    { big: pct(d.rates.closeRate), nm: "conversão",
      title: d.rates.closeRateSource === "calibrated"
        ? `Conversão da call: calibrada pela ponta a ponta real ${janela}${amostra("leadToWin", "leads viraram ganho")}, pra cadeia inteira multiplicada fechar no lead→ganho medido.`
        : fonte("Conversão da call", d.rates.closeRateSource, "closeRate", "calls realizadas") },
    d.ticket
      ? { big: money(d.ticket), nm: d.ticketMonth ? `× ticket de ${mesCurto(d.ticketMonth)}` : "× ticket médio",
          title: `Ticket médio: ${TICKET_SOURCE[d.ticketSource] || "sem origem"}.`
            + (d.ticketMonth && d.previousMonth ? ` ${mesCurto(d.ticketMonth)}: ${money(d.previousMonth.sold)} em ${int(d.previousMonth.soldN)} vendas.` : "") }
      : { big: null, nm: "contratos digitados", title: "Sem ticket médio ainda: a meta de contratos digitada sustenta a cadeia sozinha." },
  ];
  return { boxes, steps };
}

// A cadeia dessa meta: o desdobramento como funil horizontal. Era um CARTÃO
// separado (13/09) — virou seção dentro do cartão da meta, porque é a resposta
// de "como essa meta acontece" e ninguém liga dois cartões de peso igual.
function CadeiaDaMeta({ data, applyDerived }) {
  if (!data.derived) return null;
  return (
    <div className="metas-chain">
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h4 className="card-title" style={{ margin: 0, fontSize: 14 }}>A cadeia dessa meta</h4>
          <div className="card-sub" style={{ marginTop: 2 }}>
            {data.derived.superMode ? `meta base batida · perseguindo a super meta ${data.derived.chasePct}%` : "o que a meta do mês exige de cada etapa · recalcula ao salvar"}
            {infoDot("A meta de venda desce pela MESMA cadeia e pelas mesmas taxas da Análise de Pace. As taxas são as do FUNIL do último mês fechado, as mesmas contas da Visão geral filtrada naquele mês; sem amostra por lá (20 leads e 1 ganho), caem nos últimos 30 dias. Passe o mouse em cada número pra ver o período e a amostra.")}
          </div>
        </div>
        {!data.derived.blockedBy && (
          <button onClick={applyDerived}
            title="Preenche os campos de VOLUME das vagas (calls, contatos, ganhos do time) com o desdobramento abaixo. As taxas ficam como estão: são a ambição que alimenta a cadeia, não resultado dela. Nada é gravado até clicar em salvar metas."
            style={{ height: 30, padding: "0 12px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", boxShadow: "var(--shadow-1)", color: "var(--fg-2)", fontSize: 12, fontWeight: 600 }}>
            derivar metas do pace
          </button>
        )}
      </div>
      {data.derived.blockedBy ? (
        <div style={{ padding: "0 0 4px" }}>
          <div className="mono" style={{ fontSize: 12.5, color: "var(--warn)" }}>{blockedText(data.derived.blockedBy)}</div>
        </div>
      ) : (
        <div className="tbl-x" style={{ padding: "0 0 4px" }}>
          <div style={{ display: "flex", gap: 0, alignItems: "stretch", minWidth: 680 }}>
            {(() => {
              const { boxes, steps } = chainParts(data.derived, data.people);
              return boxes.map((b, i) => (
                <React.Fragment key={b.nm}>
                  {i > 0 && <ChainStep {...steps[i - 1]} />}
                  <ChainBox {...b} />
                </React.Fragment>
              ));
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Histórico: meta × realizado mês a mês ────────────────────────────────────
// Uma régua por mês (a MESMA Regua da Visão geral e do card Meta do mês), do
// mais recente pro mais antigo. Mês fechado não tem pace: ou bateu ou não, e o
// chip vira veredito. O corrente segue com o traço do "hoje". Embaixo, o
// acumulado do ano, pra responder "estamos cumprindo a escada?" sem somar.
function histVeredito(m) {
  const expected = m.ended ? 1 : m.expectedProgress;
  const lvl = levelOf(m.sold, m.target, expected);
  return { lvl, chip: m.ended && lvl ? VEREDITO[lvl] : undefined, expected: m.ended ? null : m.expectedProgress };
}
function HistoricoCard({ hist, histErr, onRetry }) {
  const rows = hist ? [...hist.months].reverse() : [];
  return (
    <Card title="Histórico"
      hint={<>
        meta × realizado, mês a mês · a mesma régua da Visão geral
        {infoDot("Realizado = receita RECONHECIDA do mês (à vista e cartão 12x contam inteiro; boleto faturado, PIX parcelado e assinatura recorrente só o que caiu no mês), com upsell contando como venda e conta grande fora da régua (ela aparece na nota da linha). Meta = a que valia naquele mês: agendada, pela regra de crescimento ou o padrão. Contratos = fechamentos + upsells contra a meta de contratos (receita ÷ ticket médio do mês anterior ao atual, igual à Visão geral). Mês fechado mostra o veredito; o corrente mostra onde o pace pede hoje.")}
      </>}>
      <div className="metas-hist">
        {!hist && !histErr && <div className="mono dim" style={{ fontSize: 12 }}>carregando histórico…</div>}
        {histErr && <div role="alert" className="metas-notice" style={{ padding: 0, background: "transparent" }}>Histórico indisponível: {histErr} <button onClick={onRetry}>Tentar novamente</button></div>}
        {hist && rows.length === 0 && <div className="dim" style={{ fontSize: 12.5 }}>nenhum mês com venda ainda</div>}
        {rows.map((m) => {
          const { lvl, chip, expected } = histVeredito(m);
          const ka = m.keyAccount;
          const subParts = [
            m.contractsTarget != null ? `${int(m.soldN)} de ${int(m.contractsTarget)} contratos` : `${int(m.soldN)} contratos`,
            m.contracted > m.sold ? `contratado ${money(m.contracted)}` : null,
            ka ? `+ ${money(ka.revenue)} de conta grande fora da régua` : null,
          ].filter(Boolean);
          return (
            <div key={m.month} className="metas-hist-row">
              <Regua
                label={<span style={{ color: m.current ? "var(--fg-1)" : "var(--fg-2)" }}>{mesCurto(m.month)}{m.current && <span className="dim" style={{ fontWeight: 400, fontSize: 11.5 }}> · em andamento</span>}</span>}
                title={`${mesLabel(m.month)}: ${money(m.sold)} de ${money(m.target || 0)} (${META_SOURCE[m.source] || "meta"})${m.ended ? "" : ` · ${int((m.expectedProgress || 0) * 100)}% dos dias úteis passaram`}.`}
                valueText={<><strong className="tnum" style={{ color: "var(--fg-1)", fontWeight: 650 }}>{money(m.sold)}</strong> / {money(m.target || 0)} · {Math.round((m.progress || 0) * 100)}%</>}
                pct={m.progress} expectedPct={expected} lvl={lvl} chipLabel={chip}
                sub={subParts.join(" · ")} />
            </div>
          );
        })}
        {hist && (hist.years || []).slice().reverse().map((y) => (
          <div key={y.year} className="metas-hist-year">
            <b>{`${y.year}${y.closedMonths < y.months ? " até agora" : ""}`}</b>{` · ${money(y.sold)} de ${money(y.target)} (${Math.round((y.progress || 0) * 100)}%) · ${int(y.soldN)}${y.contractsTarget != null ? ` de ${int(y.contractsTarget)}` : ""} contratos · ${int(y.months)} ${y.months === 1 ? "mês" : "meses"}`}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Planejamento: o ano em quatro trimestres ─────────────────────────────────
// Cada coluna é um trimestre com os três meses: mês passado mostra a meta da
// época (e o realizado, quando o histórico já chegou), mês corrente e futuros
// têm o campo (vazio = segue a regra/placeholder). Trimestre, semestre e ano
// são SOMA dos meses — a edição continua mensal, porque a regra é "25% ao
// mês" e o total é consequência dela.
function PlanejamentoCard({ months, horizon, meses, setMeses, hist, ano, setAno, growth, setGrowth, aplicar, inp }) {
  const anos = [...new Set(months.map((m) => Number(m.month.slice(0, 4))))];
  const doAno = months.filter((m) => Number(m.month.slice(0, 4)) === ano);
  const histBy = Object.fromEntries((hist?.months || []).map((m) => [m.month, m]));
  // Meta que vale pro mês: o digitado no campo, senão o que o servidor resolve.
  const metaDe = (m) => { const v = Number(String(meses[m.month] ?? "").trim()); return v > 0 ? v : (m.effective || 0); };
  const soma = (list) => list.reduce((a, m) => a + metaDe(m), 0);
  // Realizado acumulado dos meses com histórico (fechados e o corrente).
  const realizado = (list) => {
    const com = list.filter((m) => histBy[m.month]);
    if (!com.length) return null;
    return { sold: com.reduce((a, m) => a + (histBy[m.month].sold || 0), 0), meta: soma(com), parcial: com.some((m) => histBy[m.month].current) };
  };
  const fmtReal = (r) => r ? `realizado${r.parcial ? " até agora" : ""} ${money(r.sold)} · ${Math.round((r.meta > 0 ? r.sold / r.meta : 0) * 100)}%` : null;
  const ultimo = months.at(-1);
  const quarters = [1, 2, 3, 4].map((q) => doAno.filter((m) => quarterOf(m.month) === q));
  const sem = [doAno.filter((m) => quarterOf(m.month) <= 2), doAno.filter((m) => quarterOf(m.month) >= 3)];
  return (
    <Card title="Planejamento"
      hint={<>
        trimestre, semestre e ano somam os meses · na virada do mês o valor novo assume sozinho
        {infoDot(`Escolha o crescimento e clique em definir: todos os meses futuros até ${mesCurto(ultimo?.month)} são preenchidos compondo a porcentagem por cima da meta do mês atual (nada é gravado até salvar metas). Valor digitado num mês vence sempre; mês vazio segue a regra de crescimento por cima do último agendado, e mês além do horizonte continua crescendo sozinho pela mesma regra. Meses passados mostram a meta que valia na época e o realizado do Histórico.`)}
      </>}
      action={
        <span className="metas-plan-actions">
          {anos.length > 1 && <Segmented value={ano} options={anos.map((y) => ({ value: y, label: String(y) }))} onChange={setAno} />}
          <label title="Porcentagem composta por cima da meta do mês atual (com 25%: 281 mil, 352 mil, 439 mil e assim por diante)."
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "var(--fg-2)", cursor: "help" }}>
            crescimento
            <input type="number" min="0" step="1" inputMode="decimal" aria-label="Crescimento ao mês" value={growth}
              onChange={(e) => setGrowth(e.target.value)} placeholder="ex.: 25"
              className="tnum" style={{ ...inp, height: 32, width: 68, textAlign: "right" }} />
            <span className="mono dim" style={{ fontSize: 12 }}>% ao mês</span>
          </label>
          <button onClick={aplicar} disabled={!(Number(growth) > 0)}
            title="Preenche os meses futuros a partir da meta do mês atual. Confira e clique em salvar metas."
            style={{ height: 32, padding: "0 13px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", boxShadow: "var(--shadow-1)", color: "var(--fg-2)", fontSize: 12.5, fontWeight: 600, opacity: Number(growth) > 0 ? 1 : 0.55 }}>
            definir até {mesCurto(ultimo?.month)}
          </button>
        </span>
      }>
      <div className="metas-plan">
        <div className="metas-plan-quarters">
          {quarters.map((list, qi) => {
            const r = realizado(list);
            return (
              <div key={qi} className="metas-plan-q">
                <div className="kicker" style={{ marginBottom: 4 }}>{`Q${qi + 1} · ${QUARTER_MONTHS[qi]}`}</div>
                {list.map((m) => {
                  const h = histBy[m.month];
                  const vazio = (meses[m.month] ?? "") === "";
                  if (m.past) {
                    const v = h ? histVeredito(h) : null;
                    return (
                      <div key={m.month} className="metas-plan-row past"
                        title={`${mesLabel(m.month)}: meta ${money(metaDe(m))} (${META_SOURCE[m.source] || "meta"})${h ? ` · realizado ${money(h.sold)}` : ""}`}>
                        <span className="mes">{mesCurto(m.month)}</span>
                        <span className="vals">
                          <span className="tnum" style={{ fontSize: 12.5, color: "var(--fg-3)", whiteSpace: "nowrap" }}>{money(metaDe(m))}</span>
                          {h && (
                            <span className="tnum" style={{ fontSize: 12.5, fontWeight: 650, color: LVL_COLOR[v.lvl] || "var(--fg-2)", whiteSpace: "nowrap" }}>
                              <span className="metas-dot" style={{ background: LVL_COLOR[v.lvl] || "var(--fg-4)" }} />{money(h.sold)}
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  }
                  return (
                    <label key={m.month} className={`metas-plan-row${m.current ? " current" : ""}`}
                      title={vazio ? `sem valor próprio: ${m.source === "growth" ? "segue a regra de crescimento" : META_SOURCE[m.source] || "mantém o valor atual"} (${money(m.effective)})` : undefined}>
                      <span className="mes">
                        {mesCurto(m.month)}{m.current && <span className="dim" style={{ fontWeight: 400 }}> · atual</span>}
                        {vazio && m.source === "growth" && <span className="dim" style={{ display: "block", fontSize: 10.5 }}>pela regra</span>}
                      </span>
                      <span className="mono dim" style={{ fontSize: 12 }}>R$</span>
                      <input type="number" min="0" step="1" inputMode="decimal" aria-label={`Meta de ${mesLabel(m.month)}`}
                        value={meses[m.month] ?? ""}
                        onChange={(e) => setMeses((p) => ({ ...p, [m.month]: e.target.value }))}
                        placeholder={String(m.effective)}
                        className="tnum" style={{ ...inp, textAlign: "right" }} />
                    </label>
                  );
                })}
                <div className="metas-plan-foot">
                  <span>trimestre <b className="tnum">{money(soma(list))}</b></span>
                  {r && <span className="tnum" style={{ color: r.sold >= r.meta ? "var(--pos)" : "var(--fg-4)" }}>{fmtReal(r)}</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="metas-plan-summary">
          {[["1º semestre", sem[0]], ["2º semestre", sem[1]], [`ano ${ano}`, doAno]].map(([nome, list]) => {
            const r = realizado(list);
            return (
              <span key={nome}>{nome} <b className="tnum">{money(soma(list))}</b>{r && <span className="dim"> · {fmtReal(r)}</span>}</span>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function MetasScreen() {
  const [product] = useActiveSaas();
  return <MetasWorkspace key={product?.id} product={product} />;
}

function Card({title, hint, action, children}) {
  return <section className="metas-card"><header><div><h3>{title}</h3>{hint && <div className="metas-hint">{hint}</div>}</div>{action}</header>{children}</section>;
}

function MetasWorkspace({product}) {
  const [data, setData] = useS(null);
  const [pace, setPace] = useS(null);          // vendido/pace do mês — alimenta as réguas
  const [roleVals, setRoleVals] = useS({});     // "role:metric" -> string
  const [overrides, setOverrides] = useS([]);   // [{ key, metric, target }]
  const [contratos, setContratos] = useS("");   // meta de contratos do mês (nº) — product.monthlyContractsTarget
  const [growth, setGrowth] = useS("");         // % de crescimento ao mês — product.monthlyCashGrowthPct
  const [orig, setOrig] = useS(null);           // snapshot pro dirty/descartar
  const [err, setErr] = useS(null);
  const [meses, setMeses] = useS({});   // agenda: "AAAA-MM" -> meta daquele mês
  const [saving, setSaving] = useS(false);
  const [note, setNote] = useS(null);
  const [reload, setReload] = useS(0), [paceErr, setPaceErr] = useS(null), [refreshNeeded, setRefreshNeeded] = useS(false), [levelBusy, setLevelBusy] = useS(false);
  const [hist, setHist] = useS(null), [histErr, setHistErr] = useS(null); // histórico meta × realizado (bloco próprio)
  const [anoPlano, setAnoPlano] = useS(null); // ano do card Planejamento (null = o corrente)
  const busy = React.useRef(false), alive = React.useRef(true);
  useE(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function readPace() {
    setPaceErr(null);
    try { const p = await api.pipelinePace(product.id); if (alive.current) setPace(p); }
    catch (e) { if (alive.current) { setPace(null); setPaceErr(e.message); } }
  }
  async function readHist() {
    setHistErr(null);
    try { const h = await api.metasHistory(product.id); if (alive.current) setHist(h); }
    catch (e) { if (alive.current) { setHist(null); setHistErr(e.message); } }
  }
  async function refreshSaved() {
    if (busy.current) return;
    busy.current = true; setSaving(true);
    try { applyData(await api.metas(product.id)); setRefreshNeeded(false); setNote({ok:true,text:"metas salvas · valem em todo campo que mostra meta"}); await Promise.all([readPace(), readHist()]); }
    catch (e) { setNote({ok:false,text:`Metas gravadas. Não foi possível atualizar a tela: ${e.message}`}); }
    finally { busy.current = false; setSaving(false); }
  }

  // Snapshot vindo da API → estados dos campos + baseline do dirty.
  const applyData = (d) => {
    const rv = {};
    for (const r of d.roles) for (const m of r.metrics) rv[rk(r.role, m.metric)] = m.target != null ? String(m.target) : "";
    const ov = (d.userGoals || []).map((g) => ({ key: g.key, metric: g.metric, target: String(g.target) }));
    const kt = d.company?.contractsTarget != null ? String(d.company.contractsTarget) : "";
    const gr = d.company?.growthPct != null ? String(d.company.growthPct) : "";
    const ms = Object.fromEntries((d.company?.months || []).map((m) => [m.month, m.target != null ? String(m.target) : ""]));
    setData(d); setRoleVals(rv); setOverrides(ov); setContratos(kt); setGrowth(gr); setMeses(ms);
    setOrig({ roleVals: JSON.stringify(rv), overrides: JSON.stringify(ov), contratos: kt, growth: gr, meses: JSON.stringify(ms) });
  };

  useE(() => {
    if (!product?.id) return;
    let alive = true;
    setData(null); setErr(null); setNote(null); setPace(null); setHist(null);
    api.metas(product.id).then((d) => alive && applyData(d)).catch((e) => alive && setErr(e.message));
    readPace();
    readHist();
    return () => { alive = false; };
  }, [product?.id, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = orig && (JSON.stringify(roleVals) !== orig.roleVals || JSON.stringify(overrides) !== orig.overrides || contratos !== orig.contratos || growth !== orig.growth || JSON.stringify(meses) !== orig.meses);

  // Mapa metric -> { label, unit } (pros rótulos dos overrides).
  const metricInfo = {};
  for (const r of data?.roles || []) for (const m of r.metrics) metricInfo[m.metric] = { label: m.label, unit: m.unit, role: r.role };
  const allMetrics = Object.entries(metricInfo);
  // O MÊS ATUAL é o campo principal (é o que a plataforma persegue agora); a
  // agenda dos seguintes vive no card do fim.
  const mesAtualInfo = (data?.company?.months || []).find((m) => m.current) || null;
  // Horizonte do planejamento (jan do ano corrente → dez do próximo): os meses
  // FUTUROS são os que o botão "definir" preenche; os passados ficam como estão.
  const todosMeses = data?.company?.months || [];
  const mesesFuturos = todosMeses.filter((m) => !m.past && !m.current);
  const horizon = data?.company?.horizon || null;
  // Métricas sem campo de vaga: as que seguem o plano de REMUNERAÇÃO
  // (contratos/receita do closer, por nível) e as que são a META DO MÊS DA
  // EQUIPE (contratos/receita do SDR) — o placar resolve as duas sozinho.
  const compKeys = new Set();
  for (const r of data?.roles || []) for (const m of r.metrics) if (m.compPlan || m.teamGoal) compKeys.add(rk(r.role, m.metric));

  // ── Réguas ao vivo: o vendido do pace contra o alvo que estiver no campo. ──
  // Digitar já move a barra (a conta é local); salvar é o que grava no produto.
  const mesAtualDraft = mesAtualInfo ? (meses[mesAtualInfo.month] ?? "") : "";
  const saleLive = (() => {
    const s = pace?.sale;
    if (!s) return null;
    const digitado = Number(String(mesAtualDraft).trim());
    const alvo = digitado > 0 ? digitado : s.target;
    if (!(alvo > 0)) return null;
    return {
      sold: s.sold || 0, alvo, progress: (s.sold || 0) / alvo, expected: s.expectedProgress,
      lvl: levelOf(s.sold, alvo, s.expectedProgress),
      title: `Receita reconhecida no mês (à vista conta cheio; faturado e recorrente, só o recebido). Hoje: ${money(s.soldToday)} · ritmo ${money(s.actualDailyPace)}/dia útil`
        + (s.requiredDailyPace != null ? ` · precisa ${money(s.requiredDailyPace)}/dia` : "")
        + ` · ${int(s.remainingBusinessDays)} dias úteis restantes · projeção do mês ${money(s.projected)}.`,
    };
  })();
  const contractsLive = (() => {
    if (!pace) return null;
    const c = pace.contracts || {};
    const digitado = Number(String(contratos).trim());
    const alvo = digitado > 0 ? Math.round(digitado) : (Number(c.target) > 0 ? c.target : null);
    if (!(alvo > 0)) return null;
    const expected = c.expectedProgress ?? pace.sale?.expectedProgress;
    return {
      sold: c.sold || 0, alvo, progress: (c.sold || 0) / alvo, expected,
      lvl: levelOf(c.sold || 0, alvo, expected),
      title: digitado > 0 || c.targetSource === "company"
        ? "Meta de contratos digitada (a mesma da remuneração)."
        : c.ticketMonth
          ? `Meta derivada: receita do mês ÷ ticket médio de ${mesCurto(c.ticketMonth)} (sem contas grandes).`
          : "Meta derivada: venda do mês ÷ ticket médio sem contas grandes.",
    };
  })();

  function setRole(role, metric, v) { setRoleVals((p) => ({ ...p, [rk(role, metric)]: v })); }

  // Preenche os campos de VOLUME com o desdobramento da meta do mês (não salva:
  // o Leo confere e clica em salvar). As taxas ficam como estão — são a ambição
  // que ALIMENTA a cadeia, não resultado dela.
  function applyDerived() {
    // Contratos/receita de SDR e closer ficam de fora: o closer segue o plano
    // de remuneração por pessoa, o SDR segue a meta do mês da equipe — nenhum
    // dos dois tem campo de vaga pra preencher.
    const list = (data?.derived?.goals || []).filter((g) => !compKeys.has(rk(g.role, g.metric)));
    if (!list.length) return;
    setRoleVals((p) => ({ ...p, ...Object.fromEntries(list.map((g) => [rk(g.role, g.metric), String(Math.round(g.target))])) }));
    setNote({ ok: true, text: "campos preenchidos pelo pace · confira e clique em salvar metas" });
  }
  // Define o PLANEJAMENTO inteiro de uma vez (pedido do Leo, 08/08; horizonte
  // anual em 07/10): meta do mês atual × (1 + g%)^k preenche os meses futuros
  // até dez do ano seguinte. k = distância em meses até o mês atual, em
  // POTÊNCIA DIRETA sobre a base (não arredonda em cadeia), que é exatamente a
  // conta do servidor (cashTargetFor) — então o que a tela mostra é o que a
  // regra daria se o campo ficasse vazio. Mês passado nunca é tocado. Não
  // salva nada: os valores ficam visíveis pra conferir e o salvar metas grava.
  function aplicarCrescimento() {
    const g = Number(String(growth).trim());
    const digitado = Number(String(mesAtualDraft).trim());
    const base = digitado > 0 ? digitado : (mesAtualInfo?.effective || 0);
    if (!(g > 0) || !(base > 0) || !mesesFuturos.length || !mesAtualInfo) return;
    const k0 = monthIndex(mesAtualInfo.month);
    const next = {};
    for (const m of mesesFuturos) next[m.month] = String(Math.round(base * Math.pow(1 + g / 100, monthIndex(m.month) - k0)));
    setMeses((p) => ({ ...p, ...next }));
    setNote({ ok: true, text: `planejamento definido até ${mesCurto(mesesFuturos.at(-1).month)}: ${money(base)} crescendo ${g}% ao mês · confira e clique em salvar metas` });
  }
  // ── Meta por PESSOA ────────────────────────────────────────────────────────
  // O placar cobra de cada um: plano de Remuneração (nível) > meta de vaga
  // repartida > derivada do mês. O ajuste por pessoa vence tudo isso, mas era um
  // formulário abstrato (escolhe pessoa, escolhe métrica) — quem queria mudar o
  // alvo de alguém não achava. Agora é uma LISTA do time com o alvo vigente no
  // placeholder: digitar cria o ajuste, apagar volta pro que valia.
  const PERSON_METRICS = ["won", "revenue"]; // contratos e receita (as duas pernas do plano)
  const roleOfUser = (u) => ["closer", "sdr", "integrator", "social"].find((r) => (u.roles || []).includes(r)) || "";
  const planOfUser = (u) => (data?.compPlan?.[roleOfUser(u)] || []).find((l) => l.n === u.compLevel) || null;
  // Elegibilidade a subir de nível, calculada no servidor a partir dos carimbos
  // mensais (comp_months) e devolvida nos cards de SDR/closer do placar.
  const promoDe = (uid) => (data?.users || []).find((u) => u.id === uid)?.promo || null;
  // De onde vem o número que a pessoa persegue hoje, sem ajuste.
  function vigente(u, metric) {
    const role = roleOfUser(u);
    // SDR: a meta do mês da equipe, inteira (contratos = receita ÷ ticket do
    // mês anterior; receita = meta do mês da empresa).
    if (role === "sdr") {
      const d = data?.derived;
      const v = metric === "won" ? d?.won : d?.target;
      return v > 0 ? { value: v, from: "meta do mês da equipe" } : null;
    }
    const plan = planOfUser(u);
    if (plan) {
      const v = metric === "won" ? plan.metaContracts : plan.metaRevenue;
      if (v > 0) return { value: v, from: `nível ${levelLabel(u.compLevel)} do plano de Remuneração` };
    }
    const m = (data?.roles || []).find((r) => r.role === role)?.metrics?.find((x) => x.metric === metric);
    const alvo = m?.target ?? m?.derived ?? null;
    if (!(alvo > 0)) return null;
    const n = Math.max(1, data?.people?.[role] || 1);
    return m?.team
      ? { value: alvo / n, from: `meta da vaga repartida entre ${n} ${n === 1 ? "pessoa" : "pessoas"}` }
      : { value: alvo, from: "meta da vaga" };
  }
  // Classificar alguém é cadastro da PESSOA, não meta do mês: salva na hora (o
  // mesmo PATCH da tela Equipe) e as metas da linha se mexem junto, porque o
  // placeholder lê o plano do nível novo.
  const podeClassificar = isAdminUser();
  async function setNivel(u, n) {
    if (busy.current) return;
    busy.current = true; setLevelBusy(true);
    setData((d) => ({ ...d, users: (d.users || []).map((x) => (x.id === u.id ? { ...x, compLevel: n } : x)) }));
    try {
      await api.updateUser(u.id, { compLevel: n });
      setNote({ ok: true, text: `${u.name} agora é ${levelLabel(n)} · as metas de contratos e receita seguem o plano desse nível` });
    } catch (e) {
      setNote({ ok: false, text: `nível não salvo: ${e.message}` });
      setData((d) => ({ ...d, users: (d.users || []).map((x) => (x.id === u.id ? { ...x, compLevel: u.compLevel } : x)) }));
    } finally { busy.current = false; setLevelBusy(false); }
  }

  const ovOf = (userId, metric) => overrides.find((o) => o.key === userId && o.metric === metric);
  function setPersonGoal(userId, metric, v) {
    setOverrides((p) => {
      const i = p.findIndex((o) => o.key === userId && o.metric === metric);
      if (String(v).trim() === "") return i < 0 ? p : p.filter((_, j) => j !== i); // apagou = volta pro vigente
      if (i < 0) return [...p, { key: userId, metric, target: v }];
      return p.map((o, j) => (j === i ? { ...o, target: v } : o));
    });
  }
  // Ajustes que NÃO são contratos/receita continuam na lista genérica embaixo.
  const outrosOverrides = overrides
    .map((o, i) => ({ o, i }))
    .filter(({ o }) => !PERSON_METRICS.includes(o.metric));

  function addOverride() {
    const firstUser = data?.users?.[0]?.id || "";
    const firstMetric = (allMetrics.find(([mk]) => !PERSON_METRICS.includes(mk)) || [])[0] || "";
    setOverrides((p) => [...p, { key: firstUser, metric: firstMetric, target: "" }]);
  }
  function setOv(i, field, v) { setOverrides((p) => p.map((o, j) => (j === i ? { ...o, [field]: v } : o))); }
  function rmOv(i) { setOverrides((p) => p.filter((_, j) => j !== i)); }

  async function save() {
    if (busy.current || refreshNeeded) return;
    busy.current = true;
    let accepted = false;
    setSaving(true); setNote(null);
    try {
      const goals = [];
      // metas por vaga: manda tudo (vazio = servidor apaga → volta pro padrão).
      // As do plano de remuneração não têm campo de vaga: não manda nem apaga.
      for (const r of data.roles) for (const m of r.metrics) {
        if (m.compPlan || m.teamGoal) continue;
        goals.push({ scope: "role", key: r.role, metric: m.metric, target: roleVals[rk(r.role, m.metric)] });
      }
      // overrides atuais
      const seen = new Set();
      for (const o of overrides) {
        if (!o.key || !o.metric) continue;
        seen.add(`${o.key}:${o.metric}`);
        goals.push({ scope: "user", key: o.key, metric: o.metric, target: o.target });
      }
      // overrides removidos (estavam no original, sumiram) → apaga
      for (const o of JSON.parse(orig.overrides)) {
        if (!seen.has(`${o.key}:${o.metric}`)) goals.push({ scope: "user", key: o.key, metric: o.metric, target: "" });
      }
      // Sem cashTarget de propósito: a "Meta padrão" saiu da tela (Leo, 08/08) e
      // o campo do produto fica quieto como último fallback do servidor.
      await api.saveMetas(product.id, goals, { contractsTarget: contratos, growthPct: growth, months: meses });
      accepted = true;
      applyData(await api.metas(product.id));
      // Meta nova = pace novo: as réguas, a cadeia e o histórico recalculam por cima do salvo.
      await Promise.all([readPace(), readHist()]);
      setNote({ ok: true, text: "metas salvas · valem em todo campo que mostra meta" });
    } catch (e) {
      setRefreshNeeded(accepted);
      setNote({ ok: false, text: accepted ? `Metas gravadas. Não foi possível atualizar a tela: ${e.message}` : e.message });
    }
    busy.current = false; setSaving(false);
  }
  function reset() {
    if (!orig) return;
    setRoleVals(JSON.parse(orig.roleVals)); setOverrides(JSON.parse(orig.overrides)); setContratos(orig.contratos); setGrowth(orig.growth); setMeses(JSON.parse(orig.meses));
  }

  const inp = { height: 34, padding: "0 10px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-inset)", color: "var(--fg-1)", fontSize: 13 };
  const nameOf = (id) => data?.users?.find((u) => u.id === id)?.name || id;
  // "12 por pessoa · 2 na vaga" — só faz sentido em métrica de time com mais de
  // uma pessoa na vaga (taxa e ticket não se repartem).
  const shareHint = (m, role) => {
    const n = Number(roleVals[rk(role, m.metric)]);
    const people = data?.people?.[role] || 0;
    if (!m.team || !(n > 0) || people <= 1) return null;
    const per = n / people;
    return `${m.unit === "R$" ? money(per) : int(per)} por pessoa · ${people} na vaga`;
  };

  return (
    <div className="metas-page">
      <PageHead title="Metas" sub="metas por vaga e por pessoa · valem em todo campo que mostra meta">
        <button onClick={reset} disabled={saving || levelBusy || refreshNeeded || !dirty} style={{ height: 32, padding: "0 13px", border: "1px solid var(--line-1)", borderRadius: 999, background: "var(--bg-1)", boxShadow: "var(--shadow-1)", color: "var(--fg-2)", fontSize: 12.5, fontWeight: 600, opacity: dirty ? 1 : .55 }}>descartar</button>
        <button onClick={save} disabled={saving || levelBusy || refreshNeeded || !dirty}
          style={{ height: 32, padding: "0 15px", borderRadius: 999, background: "var(--btn-bg)", color: "var(--btn-fg)", fontSize: 12.5, fontWeight: 600, opacity: saving || !dirty ? 0.55 : 1 }}>
          {saving ? "salvando…" : "salvar metas"}
        </button>
      </PageHead>

      <div className="metas-body">
        {err && <div role="alert" className="metas-notice">Não foi possível carregar as metas: {err} <button onClick={() => setReload(n => n + 1)}>Tentar novamente</button></div>}
        {note && <div role={note.ok ? "status" : "alert"} className="metas-notice" style={{ color: note.ok ? "var(--pos)" : "var(--neg)" }}>{note.text}{refreshNeeded && <button disabled={saving} onClick={refreshSaved}>Atualizar metas gravadas</button>}</div>}
        {paceErr && <div role="alert" className="metas-notice">Réguas indisponíveis: {paceErr} <button onClick={readPace}>Recarregar réguas</button></div>}
        {!data && !err && <div className="mono dim" style={{ fontSize: 12 }}>carregando metas…</div>}

        {data && (
          <fieldset className="metas-fields" disabled={saving || levelBusy || refreshNeeded}>
            {/* 1 · Meta do mês: as duas réguas da Visão geral com os campos que
                as editam logo abaixo. A régua usa o vendido real do pace contra
                o alvo digitado, então dá pra ver o efeito antes de salvar. */}
            <Card title="Meta do mês"
              hint={<>
                {mesAtualInfo ? mesLabel(mesAtualInfo.month) : "mês corrente"} · digitar move a régua na hora, salvar é o que grava
                {infoDot("A faixa Meta do mês da Visão geral e a Análise de Pace perseguem esse número pelo VENDIDO RECONHECIDO (à vista e cartão em 12x contam inteiro, porque a adquirente antecipa; boleto faturado, PIX parcelado, assinatura recorrente e condição personalizada contam só o que ENTROU no mês) e desdobram o que falta em ganhos, calls, contatos e leads por dia. Na virada do mês, o valor do mês novo assume sozinho: o agendado, se houver, senão a regra de crescimento. O caixa e o dinheiro futuro ficam na aba Clientes.")}
              </>}>
              <div className="metas-month-cols">
                <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
                  {saleLive && (
                    <Regua label="Régua de receita" title={saleLive.title}
                      valueText={<><strong className="tnum" style={{ color: "var(--fg-1)", fontWeight: 650 }}>{money(saleLive.sold)}</strong> / {money(saleLive.alvo)} · {Math.round((saleLive.progress || 0) * 100)}%</>}
                      pct={saleLive.progress} expectedPct={saleLive.expected} lvl={saleLive.lvl} sub="traço = onde o dia útil pede" />
                  )}
                  {mesAtualInfo && (
                    <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: "var(--fg-1)", minWidth: 0 }}>
                        Meta de venda do mês
                        {mesAtualDraft === "" && (
                          <span className="dim" style={{ display: "block", fontSize: 11.5, fontWeight: 400 }}>
                            sem valor próprio · {mesAtualInfo.source === "growth" ? "segue a regra de crescimento" : "vale o padrão do produto"} ({money(mesAtualInfo.effective)})
                          </span>
                        )}
                      </span>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <span className="mono dim" style={{ fontSize: 12 }}>R$</span>
                        <input type="number" min="0" step="1" inputMode="decimal"
                          aria-label="Meta de venda do mês" value={meses[mesAtualInfo.month] ?? ""}
                          onChange={(e) => setMeses((p) => ({ ...p, [mesAtualInfo.month]: e.target.value }))}
                          placeholder={String(mesAtualInfo.effective)}
                          className="tnum" style={{ ...inp, width: 128, textAlign: "right" }} />
                      </div>
                    </label>
                  )}
                </div>
                <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
                  {contractsLive ? (
                    <Regua label="Régua de contratos" title={contractsLive.title}
                      valueText={<><strong className="tnum" style={{ color: "var(--fg-1)", fontWeight: 650 }}>{int(contractsLive.sold)}</strong> / {int(contractsLive.alvo)} · {Math.round((contractsLive.progress || 0) * 100)}%</>}
                      pct={contractsLive.progress} expectedPct={contractsLive.expected} lvl={contractsLive.lvl} sub="traço = onde o dia útil pede" />
                  ) : pace != null ? (
                    <div style={{ fontSize: 12.5, color: "var(--fg-4)" }}>
                      Sem meta de contratos ainda: registre uma venda (pro ticket existir) ou digite abaixo.
                    </div>
                  ) : null}
                  {/* Nº de contratos do mês: a mesma meta em unidades de fechamento.
                      Vazio segue a venda ÷ ticket (o número que o pace já usa);
                      digitado vence a divisão — e, como todo digitado, não escala
                      em super meta. */}
                  <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: "var(--fg-1)", minWidth: 0 }}>
                      Meta de contratos no mês
                      {contratos === "" && data.derived?.wonFromTicket != null && (
                        <span style={{ display: "block", fontSize: 11.5, fontWeight: 400, color: "var(--accent)" }}>
                          seguindo a receita ÷ ticket{data.derived.ticketMonth ? ` de ${mesCurto(data.derived.ticketMonth)}` : ""}: {data.derived.wonFromTicket}
                        </span>
                      )}
                      {divergente(contratos, data.derived?.wonFromTicket) && (
                        <button type="button" onClick={() => setContratos(String(data.derived.wonFromTicket))}
                          style={{ display: "block", fontSize: 11.5, color: "var(--warn)", textAlign: "left", fontWeight: 600 }}>
                          a venda ÷ ticket dá {data.derived.wonFromTicket} · usar esse
                        </button>
                      )}
                    </span>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <input type="number" min="0" step="1" inputMode="numeric" aria-label="Meta de contratos no mês" value={contratos}
                        onChange={(e) => setContratos(e.target.value)}
                        placeholder={data.derived?.wonFromTicket != null ? `${data.derived.wonFromTicket} pela venda` : "digite"}
                        className="tnum" style={{ ...inp, width: 94, textAlign: "right" }} />
                      <span className="mono dim" style={{ fontSize: 12 }}>contratos</span>
                    </div>
                  </label>
                </div>
              </div>
              <div className="metas-chain-wrap">
                <CadeiaDaMeta data={data} applyDerived={applyDerived} />
              </div>
            </Card>


            {/* 3 · Metas por vaga: campo vazio segue a meta do mês pela cadeia
                (o placar usa o mesmo fallback); digitado vence, e quando briga
                com a cadeia a tela avisa em vez de deixar duas verdades
                convivendo caladas. */}
            <div className="metas-roles">
              {data.roles.map((r) => (
                <Card key={r.role} title={r.label} hint={r.hint}>
                  <div className="metas-role-fields">
                    {r.metrics.filter((m) => !m.compPlan && !m.teamGoal).map((m) => (
                      <label key={m.metric} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--line-faint)" }}>
                        <span style={{ flex: 1, fontSize: 13.5, color: "var(--fg-2)", minWidth: 0 }}>
                          {m.label}
                          {/* Denominador da taxa escrito por extenso: "25%" sem
                              dizer de quê foi o que deixou duas metas brigando. */}
                          {m.hint && <span className="dim" style={{ display: "block", fontSize: 11.5 }}>{m.hint}</span>}
                          {/* Meta de volume é do TIME: mostra a parte de cada um,
                              que é o que o placar vai cobrar da pessoa. */}
                          {shareHint(m, r.role) && <span className="dim" style={{ display: "block", fontSize: 11.5 }}>{shareHint(m, r.role)}</span>}
                          {roleVals[rk(r.role, m.metric)] === "" && m.derived != null && (
                            <span style={{ display: "block", fontSize: 11.5, color: "var(--accent)" }}>seguindo {data.derived?.superMode ? `a super meta ${data.derived.chasePct}%` : "a meta do mês"}: {Math.round(m.derived)}</span>
                          )}
                          {divergente(roleVals[rk(r.role, m.metric)], m.derived) && (
                            <button type="button" onClick={() => setRole(r.role, m.metric, String(Math.round(m.derived)))}
                              style={{ display: "block", fontSize: 11.5, color: "var(--warn)", textAlign: "left", fontWeight: 600 }}>
                              {data.derived?.superMode ? `a super meta ${data.derived.chasePct}%` : "a meta do mês"} pede {Math.round(m.derived)} · usar esse
                            </button>
                          )}
                        </span>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          {m.unit === "R$" && <span className="mono dim" style={{ fontSize: 12 }}>R$</span>}
                          <input type="number" min="0" step={m.unit === "%" ? "1" : "0.01"} inputMode="decimal"
                            aria-label={`${m.label} · ${r.label}`} value={roleVals[rk(r.role, m.metric)] ?? ""}
                            onChange={(e) => setRole(r.role, m.metric, e.target.value)}
                            placeholder={m.derived != null ? `${Math.round(m.derived)} pela meta` : m.default != null ? `padrão ${m.default}` : "—"}
                            title={m.derived != null ? `vazio = segue a meta do mês (${Math.round(m.derived)})` : undefined}
                            className="tnum" style={{ ...inp, width: m.unit === "R$" ? 90 : 76, textAlign: "right" }} />
                          <span className="mono dim" style={{ fontSize: 12, width: 26 }}>{m.unit === "%" ? "%" : ""}</span>
                        </div>
                      </label>
                    ))}
                    {/* Contratos e receita de SDR/closer NÃO são campo de vaga:
                        a meta é POR PESSOA, pelo nível dela no plano de
                        Remuneração (o placar aplica o plano por cima de vaga e
                        derivado). A régua aparece por pessoa; edita na tela
                        Remuneração, e o ajuste por pessoa abaixo ainda vence. */}
                    {/* SDR: contratos e receita são a META DO MÊS DA EQUIPE
                        (Leo, 06/10): a receita do mês da empresa e os contratos
                        que saem dela pelo ticket do mês anterior. Sem campo de
                        vaga e sem nível do plano; o ajuste por pessoa vence. */}
                    {r.metrics.some((m) => m.teamGoal) && (
                      <div title="Contratos e receita do SDR são a meta do mês da equipe: a meta de receita do mês (card Empresa) e a meta de contratos que sai dela (receita ÷ ticket médio do mês anterior). Não reparte por pessoa; só o ajuste por pessoa, no card mais abaixo, passa na frente."
                        style={{ marginTop: 12, background: "var(--bg-inset)", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", padding: "10px 12px", cursor: "help" }}>
                        <div className="kicker accent" style={{ fontWeight: 600, marginBottom: 7 }}>
                          Contratos e receita · meta do mês da equipe <span className="dim" style={{ letterSpacing: 0 }}>ⓘ</span>
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "3px 0", fontSize: 12.5 }}>
                          <span style={{ flex: 1 }} className="dim">
                            {data.derived?.ticketMonth ? `receita do mês ÷ ticket de ${mesCurto(data.derived.ticketMonth)}` : "receita do mês ÷ ticket médio"}
                          </span>
                          <span className="tnum" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                            {data.derived?.won != null ? `${int(data.derived.won)} contratos` : "— contratos"} · {money(data.derived?.target || 0)}
                          </span>
                        </div>
                      </div>
                    )}
                    {r.metrics.some((m) => m.compPlan) && (
                      <div title="Contratos e receita são meta POR PESSOA, pelo nível dela (1 jr · 2 pl · 3 sn) no plano de Remuneração: vencem a meta de vaga e a derivada do pace. Edita na tela Remuneração; só o ajuste por pessoa, no card mais abaixo, passa na frente."
                        style={{ marginTop: 12, background: "var(--bg-inset)", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", padding: "10px 12px", cursor: "help" }}>
                        <div className="kicker accent" style={{ fontWeight: 600, marginBottom: 7 }}>
                          Contratos e receita · plano de Remuneração <span className="dim" style={{ letterSpacing: 0 }}>ⓘ</span>
                        </div>
                        {(data.users || []).filter((u) => u.roles.includes(r.role)).map((u) => {
                          const lv = (data.compPlan?.[r.role] || []).find((l) => l.n === u.compLevel) || {};
                          return (
                            <div key={u.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "3px 0", fontSize: 12.5 }}>
                              <Avatar id={u.id} name={u.name} size={20} />
                              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name} <span className="dim" style={{ fontSize: 11 }}>{levelLabel(u.compLevel)}</span></span>
                              <span className="tnum" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{int(lv.metaContracts || 0)} contratos · {money(lv.metaRevenue || 0)}</span>
                            </div>
                          );
                        })}
                        {!(data.users || []).some((u) => u.roles.includes(r.role)) && (data.compPlan?.[r.role] || []).map((l) => (
                          <div key={l.n} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "3px 0", fontSize: 12.5 }}>
                            <span style={{ flex: 1 }} className="dim">nível {l.n}</span>
                            <span className="tnum" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{int(l.metaContracts || 0)} contratos · {money(l.metaRevenue || 0)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>

            {/* 4 · Meta por pessoa: a lista do time com o alvo vigente e o campo
                pra sobrescrever. Vence plano de remuneração, vaga e derivado —
                é o último a falar no goalFor do scoreboard. */}
            <Card title="Meta por pessoa"
              hint={<>classifique o nível e a meta segue · em branco segue o plano{infoDot("Cada pessoa persegue, nesta ordem: o ajuste digitado aqui, o nível dela no plano de Remuneração (júnior/pleno/sênior, com metas definidas na tela Remuneração), a meta da vaga repartida pelo time e, por último, a meta derivada do mês. O nível salva na hora; os números digitados só no botão salvar metas.")}</>}>
              <div className="metas-people">
                <div className="tbl-x">
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th className="kicker" style={{ textAlign: "left", padding: "0 8px 8px 0" }}>Pessoa</th>
                        <th className="kicker" style={{ textAlign: "left", padding: "0 8px 8px", whiteSpace: "nowrap" }}
                          title="Nível de carreira: júnior, pleno ou sênior. Vale pra SDR e closer, que têm meta de contratos e receita por nível no plano de Remuneração. Muda o nível e as metas da linha mudam junto.">Nível</th>
                        <th className="kicker" style={{ textAlign: "right", padding: "0 8px 8px", whiteSpace: "nowrap" }}>Contratos no mês</th>
                        <th className="kicker" style={{ textAlign: "right", padding: "0 0 8px 8px", whiteSpace: "nowrap" }}>Receita no mês</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data.users || []).filter((u) => roleOfUser(u)).map((u) => (
                        <tr key={u.id}>
                          <td style={{ padding: "6px 8px 6px 0", borderTop: "1px solid var(--line-1)" }}>
                            <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                              <Avatar id={u.id} name={u.name} size={22} />
                              <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.name}</span>
                              <span className="kicker" style={{ whiteSpace: "nowrap" }}>
                                {roleOfUser(u)}
                              </span>
                            </span>
                          </td>
                          <td style={{ padding: "6px 8px", borderTop: "1px solid var(--line-1)", whiteSpace: "nowrap" }}>
                            {!LEVELED_ROLES.includes(roleOfUser(u))
                              ? <span className="dim" style={{ fontSize: 12 }} title="Níveis valem pra SDR e closer (as vagas com meta de contratos e receita por nível). Essa vaga segue a meta da vaga.">—</span>
                              : podeClassificar
                                ? <select aria-label={`Nível de ${u.name}`} value={u.compLevel || 1} onChange={(e) => setNivel(u, Number(e.target.value))}
                                    title="Classificar salva na hora e vale também no plano de Remuneração"
                                    style={{ ...inp, height: 32, fontSize: 12.5, padding: "0 6px" }}>
                                    {CAREER_LEVELS.map((l) => <option key={l.n} value={l.n}>{l.label}</option>)}
                                  </select>
                                : <span style={{ fontSize: 12.5 }} title="Só admin classifica (o nível vale também no plano de Remuneração)">{levelLabel(u.compLevel)}</span>}
                            {/* Elegível a subir: 3 meses fechados seguidos com
                                100% da meta (a régua está escrita nas Regras da
                                casa, na tela Remuneração). Quem promove é gente,
                                o cockpit só não deixa passar batido. */}
                            {promoDe(u.id)?.eligible && (
                              <span className="chip" title={`Meses que contaram: ${(promoDe(u.id).months || []).join(", ")}. A promoção em si é decisão da gestão.`}
                                style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 600, color: "var(--accent)", background: "var(--accent-soft)", borderRadius: 999, padding: "2px 7px", whiteSpace: "nowrap" }}>
                                elegível a {levelLabel(promoDe(u.id).to)}
                              </span>
                            )}
                          </td>
                          {PERSON_METRICS.map((metric) => {
                            const vig = vigente(u, metric);
                            const ov = ovOf(u.id, metric);
                            const isMoney = metric === "revenue";
                            return (
                              <td key={metric} style={{ padding: "6px 0 6px 8px", borderTop: "1px solid var(--line-1)", textAlign: "right" }}>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                                  {isMoney && <span className="mono dim" style={{ fontSize: 11 }}>R$</span>}
                                  <input aria-label={`${isMoney ? "Receita" : "Contratos"} de ${u.name}`} type="number" min="0" step={isMoney ? "100" : "1"} value={ov?.target ?? ""}
                                    onChange={(e) => setPersonGoal(u.id, metric, e.target.value)}
                                    placeholder={vig ? String(Math.round(vig.value)) : "—"}
                                    title={vig
                                      ? `Hoje persegue ${isMoney ? money(vig.value) : int(Math.round(vig.value))} (${vig.from}). Digite pra dar outro alvo só pra ${u.name}; apague pra voltar.`
                                      : `Sem meta definida ainda pra ${u.name} nessa métrica.`}
                                    className="tnum" style={{ ...inp, width: isMoney ? 108 : 84, textAlign: "right" }} />
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!(data.users || []).some((u) => roleOfUser(u)) && (
                  <div className="dim" style={{ fontSize: 12.5 }}>ninguém com vaga ainda · dê SDR/closer/CS em Ajustes → Equipe</div>
                )}

                <div className="kicker" style={{ marginTop: 4 }}>Outras metas por pessoa</div>
                {outrosOverrides.length === 0 && <div className="dim" style={{ fontSize: 12.5 }}>nenhum ajuste · o resto segue a meta da vaga</div>}
                {outrosOverrides.map(({ o, i }) => {
                  const info = metricInfo[o.metric] || {};
                  return (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <select aria-label={`Pessoa do ajuste ${i + 1}`} value={o.key} onChange={(e) => setOv(i, "key", e.target.value)} style={{ ...inp, minWidth: 140 }}>
                        {(data.users || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                        {!data.users?.some((u) => u.id === o.key) && o.key && <option value={o.key}>{nameOf(o.key)}</option>}
                      </select>
                      <select aria-label={`Métrica do ajuste ${i + 1}`} value={o.metric} onChange={(e) => setOv(i, "metric", e.target.value)} style={{ ...inp, minWidth: 180, flex: 1 }}>
                        {allMetrics.filter(([mk]) => !PERSON_METRICS.includes(mk)).map(([mk, mi]) => <option key={mk} value={mk}>{mi.label}</option>)}
                      </select>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        {info.unit === "R$" && <span className="mono dim" style={{ fontSize: 11 }}>R$</span>}
                        <input aria-label={`Valor do ajuste ${i + 1}`} type="number" min="0" step={info.unit === "%" ? "1" : "0.01"} value={o.target}
                          onChange={(e) => setOv(i, "target", e.target.value)} placeholder="meta"
                          className="tnum" style={{ ...inp, width: 78, textAlign: "right" }} />
                        {info.unit === "%" && <span className="mono dim" style={{ fontSize: 11 }}>%</span>}
                      </div>
                      <button onClick={() => rmOv(i)} title="Remover ajuste" style={{ color: "var(--accent)", fontSize: 12.5, fontWeight: 600, padding: "0 4px" }}>remover</button>
                    </div>
                  );
                })}
                {data.users?.length > 0 && (
                  <button onClick={addOverride} style={{ alignSelf: "flex-start", height: 32, padding: "0 13px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", boxShadow: "var(--shadow-1)", color: "var(--fg-2)", fontSize: 12.5, fontWeight: 600 }}>
                    + outra meta por pessoa
                  </button>
                )}
              </div>
            </Card>

            {/* 5 · Histórico: meta × realizado mês a mês (acompanhamento da
                escada). Cada linha é a MESMA régua da Visão geral filtrada no
                mês (receita reconhecida, conta grande fora), vinda do
                /api/metas/:saas/history, que calcula todos os meses de uma vez. */}
            <HistoricoCard hist={hist} histErr={histErr} onRetry={readHist} />

            {/* 6 · Planejamento: a agenda virou ano inteiro em QUATRO TRIMESTRES
                (Leo, 07/10), com semestre e ano somando os meses. Planejamento
                mexe pouco, por isso no fim. O crescimento é uma AÇÃO (Leo,
                08/08): escolhe a %, clica em definir e os meses futuros são
                preenchidos compondo por cima da meta do mês atual — visíveis,
                conferíveis, gravados no salvar. A % também fica salva como
                regra: mês além do horizonte continua crescendo sozinho. */}
            {horizon && (
              <PlanejamentoCard
                months={todosMeses} horizon={horizon} meses={meses} setMeses={setMeses} hist={hist}
                ano={anoPlano || Number(horizon.current.slice(0, 4))} setAno={setAnoPlano}
                growth={growth} setGrowth={setGrowth} aplicar={aplicarCrescimento} inp={inp} />
            )}

            <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              campo vazio segue a meta do mês pela cadeia; sem cadeia, vale o benchmark padrão. As metas alimentam o placar de Desempenho do time e todo campo que compara com meta.
            </div>
          </fieldset>
        )}
      </div>
    </div>
  );
}

export { MetasScreen, HistoricoCard, PlanejamentoCard };
