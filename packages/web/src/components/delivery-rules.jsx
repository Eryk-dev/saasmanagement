import React from "react";
import { api } from "../lib/api.js";
import { Card } from "./viz.jsx";
// Regras de veiculação — a estratégia "anúncio existe pra encher a agenda de
// AMANHÃ" (Leo, 30/08) em quatro regras com liga/desliga e parâmetros:
// agenda cheia pausa · janela de fim de semana · sexta curta · orçamento alvo.
// Tudo roda no SERVIDOR (tick de 60s); este card configura, mostra o que as
// regras enxergam agora (agenda de amanhã, alvo, custo por call) e o histórico
// do que fizeram na Meta. Regra nasce DESLIGADA — nada acontece sem ligar aqui.

const { useState, useEffect } = React;

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const money = (v) => BRL.format(Number(v) || 0);
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const RULE_LABEL = { agendaFull: "Agenda cheia", weekendOff: "Janela morta", shortFriday: "Sexta curta", budget: "Orçamento", config: "Configuração" };

const numInp = { width: 64, height: 28, padding: "0 8px", borderRadius: "var(--r-1)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12.5, fontFamily: "var(--mono)", textAlign: "right" };

const ddmm = (day) => (day ? `${day.slice(8, 10)}/${day.slice(5, 7)}` : "");
const logWhen = (iso) => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
    : "";
};

// Campo numérico que só salva quando a pessoa TERMINA (blur/Enter) — cada save
// vai pro servidor e re-sincroniza o bloqueio de sexta, não é pra cada tecla.
function NumParam({ label, suffix, value, onCommit, min, max, disabled }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(v));
    if (Number.isFinite(n) && n !== value) onCommit(Math.min(max, Math.max(min, n)));
    else setV(String(value));
  };
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--fg-3)" }}>
      {label}
      <input type="number" value={v} min={min} max={max} disabled={disabled} style={{ ...numInp, opacity: disabled ? 0.5 : 1 }}
        onChange={(e) => setV(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }} />
      {suffix}
    </label>
  );
}

function RuleRow({ name, desc, on, busy, onToggle, children, status }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-1)", flexWrap: "wrap", opacity: busy ? 0.7 : 1 }}>
      <div style={{ flex: 1, minWidth: 230 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{name}</div>
        <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 3, lineHeight: 1.5 }}>{desc}</div>
        {status && <div className="mono" style={{ fontSize: 11, marginTop: 5, color: "var(--fg-2)" }}>{status}</div>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {children}
        <button onClick={onToggle} disabled={busy} className={"chip " + (on ? "pos" : "")} style={{ cursor: "pointer" }}
          title={on ? "desligar: a regra para de agir na hora" : "ligar: a regra começa a agir no próximo tick (1 min)"}>
          {on ? "ligada" : "desligada"}
        </button>
      </div>
    </div>
  );
}

export function DeliveryRulesCard({ saas }) {
  const [data, setData] = useState(null); // { rules, state, log, preview, metaConfigured } | { error }
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  const load = () => api.deliveryRules(saas).then(setData).catch((e) => setData({ error: e.message || "não deu pra carregar" }));
  useEffect(load, [saas]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(patch) {
    if (!data?.rules) return;
    setBusy(true);
    try {
      const rules = { ...data.rules };
      for (const [k, v] of Object.entries(patch)) rules[k] = { ...rules[k], ...v };
      setData(await api.saveDeliveryRules(saas, rules));
    } catch (e) { window.alert(e.message || "não deu pra salvar"); load(); }
    finally { setBusy(false); }
  }

  async function checkNow() {
    setChecking(true);
    try { await api.runDeliveryRules(saas); await load(); }
    catch (e) { window.alert(e.message || "a checagem falhou"); }
    finally { setChecking(false); }
  }

  const hint = "o anúncio existe pra encher a agenda de amanhã · as regras rodam no servidor a cada minuto · regra nasce desligada";
  if (data?.error) {
    return <Card title="Regras de veiculação" hint={hint}><div style={{ padding: "14px var(--inset-x)", fontSize: 13, color: "var(--fg-3)" }}>{data.error}</div></Card>;
  }
  if (!data) {
    return <Card title="Regras de veiculação" hint={hint}><div className="mono dim" style={{ padding: "14px var(--inset-x)", fontSize: 12 }}>carregando…</div></Card>;
  }

  const { rules: r, state, preview: p, log } = data;
  const paused = (state.pausedCampaigns || []).length;
  const shown = logOpen ? log : (log || []).slice(0, 5);

  return (
    <Card title="Regras de veiculação" hint={hint}>
      <div style={{ padding: "12px var(--inset-x) 16px", display: "flex", flexDirection: "column", gap: 10 }}>

        {/* O que as regras enxergam agora — a régua inteira à vista. */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12.5, color: "var(--fg-2)" }}>
          <span>
            amanhã ({ddmm(p.tomorrow)}): <b className="tnum">{p.booked}</b> de <b className="tnum">{p.target}</b> horários
            <span className="dim"> · {p.closersAtivos} closer{p.closersAtivos === 1 ? "" : "s"} × {r.agendaFull.callsPerCloser} · {p.capacity} desbloqueado{p.capacity === 1 ? "" : "s"}</span>
          </span>
          <span className="dim">·</span>
          <span title={`${p.cost.calls} calls de ${p.cost.leads} leads Meta · ${money(p.cost.spend)} gastos na janela de ${r.budget.windowDays} dias`}>
            custo por call ({r.budget.windowDays}d): <b className="tnum">{p.cost.costPerCall != null ? money(p.cost.costPerCall) : "sem base"}</b>
          </span>
          {p.offToday && <span className="chip warn">hoje é dia de janela morta</span>}
          {paused > 0 && (
            <span className="chip warn" title={state.pausedAt ? `desde ${logWhen(state.pausedAt)}` : ""}>
              {paused} campanha{paused > 1 ? "s" : ""} pausada{paused > 1 ? "s" : ""} pela regra ({state.pauseReason})
            </span>
          )}
          {!data.metaConfigured && <span className="chip">Meta não conectada · as regras só observam</span>}
          <button onClick={checkNow} disabled={checking} className="mono dim" style={{ fontSize: 11, marginLeft: "auto", cursor: "pointer" }}>
            {checking ? "checando…" : "↻ checar agora"}
          </button>
        </div>

        <RuleRow name="Pausa por agenda cheia" busy={busy} on={r.agendaFull.enabled}
          onToggle={() => save({ agendaFull: { enabled: !r.agendaFull.enabled } })}
          desc="bateu o alvo de calls amanhã (calls por closer × closers ativos, limitado aos horários desbloqueados), pausa todas as campanhas. Não religa no meio do dia; volta na virada."
          status={`alvo de amanhã: ${p.target} call${p.target === 1 ? "" : "s"} · marcadas: ${p.booked}`}>
          <NumParam label="calls por closer" value={r.agendaFull.callsPerCloser} min={1} max={20} disabled={busy}
            onCommit={(n) => save({ agendaFull: { callsPerCloser: n } })} />
        </RuleRow>

        <RuleRow name="Janela de fim de semana" busy={busy} on={r.weekendOff.enabled}
          onToggle={() => save({ weekendOff: { enabled: !r.weekendOff.enabled } })}
          desc="dias sem verba (a agenda do dia seguinte seria fim de semana). Religa na virada do primeiro dia fora da janela — sexta+sábado marcados = volta domingo 00:00 pra encher a segunda.">
          <div style={{ display: "flex", gap: 4 }}>
            {DIAS.map((d, i) => {
              const on = r.weekendOff.days.includes(i);
              return (
                <button key={d} disabled={busy} className={"chip " + (on ? "warn" : "")} style={{ cursor: "pointer" }}
                  title={on ? `tirar ${d} da janela` : `pausar anúncios na ${d}`}
                  onClick={() => save({ weekendOff: { days: on ? r.weekendOff.days.filter((x) => x !== i) : [...r.weekendOff.days, i].sort() } })}>
                  {d}
                </button>
              );
            })}
          </div>
        </RuleRow>

        <RuleRow name="Sexta curta" busy={busy} on={r.shortFriday.enabled}
          onToggle={() => save({ shortFriday: { enabled: !r.shortFriday.enabled } })}
          desc="bloqueia a agenda de TODOS os closers na sexta depois da última call — vale pro robô do SDR, pra marcação manual e aparece na tela Agenda. Quinta o alvo passa a ser essa agenda curta.">
          <NumParam label="última call às" suffix="h" value={r.shortFriday.lastCallHour} min={8} max={19} disabled={busy}
            onCommit={(n) => save({ shortFriday: { lastCallHour: n } })} />
        </RuleRow>

        <RuleRow name="Orçamento alvo" busy={busy} on={r.budget.enabled}
          onToggle={() => save({ budget: { enabled: !r.budget.enabled } })}
          desc="1x por dia (na virada) ajusta o orçamento diário na Meta rumo a: vagas restantes de amanhã × custo por call agendada. Fator único proporcional em cada campanha CBO/conjunto ABO — parte dos valores atuais e anda no máximo o passo por dia. Agenda cheia derruba o alvo e o orçamento também desce."
          status={p.cost.costPerCall != null
            ? `hoje: ${Math.max(0, p.target - p.booked)} vaga${Math.max(0, p.target - p.booked) === 1 ? "" : "s"} × ${money(p.cost.costPerCall)} = alvo ${money(Math.max(0, p.target - p.booked) * p.cost.costPerCall)}/dia`
            : `sem base: ${p.cost.calls} call${p.cost.calls === 1 ? "" : "s"} de origem Meta na janela (precisa de 3+)`}>
          <NumParam label="passo máx." suffix="%/dia" value={r.budget.maxStepPct} min={5} max={50} disabled={busy}
            onCommit={(n) => save({ budget: { maxStepPct: n } })} />
          <NumParam label="janela do custo" suffix="dias" value={r.budget.windowDays} min={7} max={30} disabled={busy}
            onCommit={(n) => save({ budget: { windowDays: n } })} />
        </RuleRow>

        {(log || []).length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="kicker">O que as regras fizeram</span>
            {shown.map((e, i) => (
              <div key={i} className="mono" style={{ fontSize: 11, color: "var(--fg-3)", lineHeight: 1.5 }}>
                <span className="dim">{logWhen(e.at)}</span> · <b>{RULE_LABEL[e.rule] || e.rule} {e.action}</b> · {e.detail}
              </div>
            ))}
            {log.length > 5 && (
              <button onClick={() => setLogOpen((v) => !v)} className="mono dim" style={{ fontSize: 11, alignSelf: "flex-start", cursor: "pointer" }}>
                {logOpen ? "ver menos" : `ver mais ${log.length - 5}`}
              </button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
