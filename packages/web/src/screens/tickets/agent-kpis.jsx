import React from "react";
import { UserAvatarRing } from "../../components/user-picker.jsx";
import { distance } from "../../lib/tickets.js";

// Perfil do atendente: quem está logado (avatar, nome, janela) e, na linha de
// baixo, os números SÓ dele em quatro métricas compactas, na ordem da
// história — o que está com ele, o que está em risco, como entrega (SLA) e
// quão rápido responde. O
// "time" aparece apenas como régua: a marca na barra do SLA e o texto de
// contexto. Fila e risco levam pros tickets dele. O alerta de SLA do topo
// saiu: a contagem do time mora nos filtros.

const pct = (r) => (r == null ? "—" : `${Math.round(r * 100)}%`);
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

const ICONS = {
  queue: <><path d="M4 13h4l1.5 3h5L16 13h4" /><path d="M5.5 5h13L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5z" /></>,
  risk: <><circle cx="12" cy="12.5" r="8" /><path d="M12 8v4.5l2.5 2" /></>,
  sla: <><path d="M12 3l7 3v5.5c0 4.2-3 7.7-7 9-4-1.3-7-4.8-7-9V6z" /><path d="M8.8 12l2.2 2.2 4.2-4.4" /></>,
  reply: <><path d="M20 12a8 8 0 0 1-8 8H5l-1 1v-4.2A8 8 0 1 1 20 12z" /><path d="M9 10.5h6M9 13.5h3.5" /></>,
};

function Metric({ icon, label, value, tone = "accent", context, onClick, title, hint, children }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} className="agent-metric" data-tone={tone} onClick={onClick} title={title || (typeof context === "string" ? context : undefined)}>
      <span className="agent-metric-icon" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICONS[icon]}</svg>
      </span>
      <span className="agent-metric-head">
        <span className="agent-metric-label">{label}</span>
        {hint && <span className="agent-metric-hint" title={hint}>ⓘ</span>}
      </span>
      {onClick && <span className="agent-metric-go" aria-hidden="true">›</span>}
      <span className="agent-metric-line">
        <span className="agent-metric-value">{value}</span>
        <span className="agent-metric-ctx">{context}</span>
      </span>
      {children}
    </Tag>
  );
}

// Barra do SLA (fio no pé do cartão): o preenchimento carrega a gravidade e o
// trilho é um passo claro da mesma cor; a marca vertical é o time.
function SlaMeter({ rate, team, tone }) {
  if (rate == null) return <span className="agent-meter" data-tone="empty" aria-hidden="true" />;
  const clamp = (v) => Math.max(0, Math.min(100, v * 100));
  return (
    <span className="agent-meter" data-tone={tone} role="img" aria-label={`SLA cumprido ${pct(rate)}${team != null ? `, time ${pct(team)}` : ""}`}
      title={team != null ? `você ${pct(rate)} · time ${pct(team)}` : `você ${pct(rate)}`}>
      <span className="agent-meter-fill" style={{ width: `${clamp(rate)}%` }} />
      {team != null && <span className="agent-meter-mark" style={{ left: `${clamp(team)}%` }} />}
    </span>
  );
}

export function AgentKpis({ stats, user, productName = "", onQueue, onRisk }) {
  if (!stats || !user) return null;
  const { me, team, days } = stats;
  const name = user.name || user.id;
  const risk = stats.breached + stats.warning;
  const riskTone = stats.breached ? "neg" : stats.warning ? "warn" : "pos";
  const slaTone = me.slaRate == null ? "accent"
    : me.slaRate < 0.7 ? "neg"
      : team.slaRate != null && me.slaRate < team.slaRate - 0.1 ? "warn" : "pos";
  const period = `nos últimos ${days} dias`;
  return (
    <section className="agent-profile" aria-label={`Seu atendimento: ${name}`}>
      <div className="agent-profile-who">
        <UserAvatarRing id={user.id} name={name} size={40} />
        <div style={{ minWidth: 0 }}>
          <div className="agent-profile-title">
            <span className="agent-profile-name">{name}</span>
            <span className="agent-profile-period">{`últimos ${days} dias`}</span>
          </div>
          <div className="agent-profile-sub">{`seu atendimento${productName ? ` em ${productName}` : ""}`}</div>
        </div>
      </div>
      <div className="agent-metrics">
        <Metric icon="queue" label="Na fila" value={stats.queue} onClick={onQueue} title="Ver os meus tickets"
          hint="Tickets abertos em que você é o responsável agora."
          context={stats.queue ? [stats.waiting ? `${stats.waiting} aguardando cliente` : null, stats.urgent ? plural(stats.urgent, "urgente", "urgentes") : null].filter(Boolean).join(" · ") || "todos em andamento" : "nada com você agora"} />
        <Metric icon="risk" label="Em risco" value={risk} tone={riskTone} onClick={risk ? onRisk : undefined} title={risk ? "Ver os meus tickets na lista, pelo SLA" : undefined}
          hint="Seus tickets abertos com o SLA estourado ou passando do aviso."
          context={risk ? [stats.breached ? plural(stats.breached, "estourado", "estourados") : null, stats.warning ? `${stats.warning} ${stats.warning === 1 ? "vence" : "vencem"} em breve` : null].filter(Boolean).join(" · ") : "tudo no prazo"} />
        <Metric icon="sla" label="SLA cumprido" value={pct(me.slaRate)} tone={slaTone}
          hint={`Seus tickets resolvidos ${period} sem estourar a 1ª resposta nem a resolução. A marca na barra e o "time" são o produto inteiro, só como comparação.`}
          context={me.slaBase ? `${plural(me.resolved, "resolvido", "resolvidos")} · time ${pct(team.slaRate)}` : "nenhum resolvido"}>
          <SlaMeter rate={me.slaRate} team={team.slaRate} tone={slaTone} />
        </Metric>
        <Metric icon="reply" label="1ª resposta" value={me.firstResponseMs != null ? distance(me.firstResponseMs) : "—"}
          hint={`Mediana do tempo corrido entre a abertura e a primeira resposta pública, nos seus tickets abertos ${period}. "Time" é o produto inteiro, só como comparação.`}
          context={me.firstResponseMs != null ? `mediana · time ${team.firstResponseMs != null ? distance(team.firstResponseMs) : "—"}` : "nenhuma resposta"} />
      </div>
    </section>
  );
}
