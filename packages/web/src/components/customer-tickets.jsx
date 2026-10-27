// Histórico de suporte do cliente (27/10/2026): os pedidos de suporte da
// EMPRESA, não só do cadastro. A API junta os cadastros da mesma org
// (orgId/leveradsOrgId/leverpriceOrgId) nos produtos que a pessoa atende
// (GET /api/tickets/by-customer/:id) e já devolve o resumo calculado.
// Abre pela aba Clientes da tela Tickets (screens/tickets/customers-view.jsx):
// resumo à esquerda, filtros e a lista completa à direita. A API responde 404
// quando nenhum produto da empresa está no escopo.
import React from "react";
import { api } from "../lib/api.js";
import { Segmented } from "./viz.jsx";
import { SelectPopover } from "./select-popover.jsx";
import { canSeeScreen } from "../lib/users.js";
import { getActiveSaasId, setActiveSaas } from "../lib/workspace.js";
import { STATUS_BY_KEY, CHANNEL_LABEL, handlesSaas, isDone, hermesChip, ticketHash } from "../lib/tickets.js";
import { NewTicketModal } from "../screens/tickets/new-ticket.jsx";
import "./customer-history.css";

const { useState, useEffect, useMemo } = React;

const TZ = "America/Sao_Paulo";
const dateOf = (iso) => { const d = new Date(iso || ""); return Number.isFinite(d.getTime()) ? d : null; };
const fmtDay = (iso) => dateOf(iso)?.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" }) || "—";
const fmtFull = (iso) => dateOf(iso)?.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }) || "";
const fmtMonth = (iso) => dateOf(iso)?.toLocaleDateString("pt-BR", { timeZone: TZ, month: "long", year: "numeric" }) || "";
const productName = (saas) => (window.SEED?.SAAS || []).find((s) => s.id === saas)?.name || saas || "";
const channelName = (c) => CHANNEL_LABEL[c] || c || "sem canal";
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

// Horas corridas entre abrir e resolver, em palavras curtas.
export function fmtResolution(hours) {
  if (hours == null || !Number.isFinite(Number(hours))) return "—";
  const h = Number(hours);
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${(Math.round(h * 10) / 10).toLocaleString("pt-BR")} h`;
  return plural(Math.round(h / 24), "dia", "dias");
}

// Abre o ticket na fila, trocando o produto ativo quando o pedido é de outro
// produto da mesma empresa (o mesmo que o sino faz).
function openTicket(t, onLeave) {
  if (t.saas && t.saas !== getActiveSaasId()) setActiveSaas(t.saas);
  onLeave?.();
  location.hash = ticketHash(t.id);
}

// `initial` ({ data } | { error } | { notFound }) monta sem buscar: é o que o
// smoke de SSR usa, já que efeito não roda lá.
function useSupportHistory(customerId, initial) {
  const [state, setState] = useState(() => initial || null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!customerId || (initial && reload === 0)) return undefined;
    let alive = true;
    setState(null);
    api.ticketsByCustomer(customerId)
      .then((data) => { if (alive) setState({ data: data || { tickets: [], summary: {} } }); })
      .catch((err) => { if (alive) setState(err?.status === 404 ? { notFound: true } : { error: err?.message || "erro" }); });
    return () => { alive = false; };
  }, [customerId, reload]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...(state || {}), loading: !state, reload: () => setReload((n) => n + 1) };
}

function Status({ ticket }) {
  const st = STATUS_BY_KEY[ticket.status] || STATUS_BY_KEY.new;
  return <span className="chist-status" style={{ color: st.tone }}>{st.label}</span>;
}

// ── Histórico de suporte da empresa (modal da aba Clientes de Tickets) ───────
function Stat({ label, value, tone, title, hint }) {
  return (
    <div className="csup-stat" title={title}>
      <span className="chist-kicker">{label}</span>
      <strong data-tone={tone}>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function Breakdown({ title, rows }) {
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className="csup-breakdown">
      <span className="chist-kicker">{title}</span>
      <ul>
        {rows.map((r) => (
          <li key={r.label}>
            <span>{r.label}</span>
            <b className="tnum">{r.count}</b>
            <i aria-hidden="true"><em style={{ width: `${Math.max(6, (r.count / max) * 100)}%` }} /></i>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Números da empresa (topo) e o perfil dos pedidos (do que pedem, por onde
// chegam, por produto). No desktop os dois ficam na coluna da esquerda; no
// celular o perfil desce pra depois da lista, que é o que se procura.
function SupportSummary({ data }) {
  const s = data.summary || {};
  const products = [...new Set((data.companies || []).map((c) => c.saas).filter(Boolean))];
  return (
    <section className="chist-card csup-summary" aria-label="Resumo do suporte">
      <header className="chist-card-head"><h3>Resumo</h3>{s.lastAt && <span>{`último em ${fmtFull(s.lastAt)}`}</span>}</header>
      {products.length > 1 && (
        <p className="csup-companies">{`Empresa em ${products.length} produtos: ${products.map(productName).join(" · ")}. Os números somam todos.`}</p>
      )}
      <div className="csup-stats">
        <Stat label="pedidos" value={s.total ?? 0} />
        <Stat label="em aberto" value={s.open ?? 0} tone={s.open ? "warn" : ""} />
        <Stat label="resolução" value={fmtResolution(s.avgResolutionHours)} hint="média, em horas corridas" title="Média entre abrir e resolver, nos pedidos concluídos" />
        <Stat label="SLA estourado" value={s.breached ?? 0} tone={s.breached ? "neg" : ""} title="Pedidos que passaram do prazo de 1ª resposta ou de resolução" />
      </div>
      {s.hermes > 0 && <p className="csup-note">{`${plural(s.hermes, "pedido passou", "pedidos passaram")} pelo Hermes.`}</p>}
    </section>
  );
}

function SupportProfile({ data }) {
  const s = data.summary || {};
  const byCategory = (s.byCategory || []).slice(0, 6).map((c) => ({ label: c.category, count: c.count }));
  const byChannel = Object.entries(s.byChannel || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ label: channelName(k), count: n }));
  const byProduct = Object.entries(s.byProduct || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ label: productName(k), count: n }));
  if (!byCategory.length && !byChannel.length && byProduct.length < 2) return null;
  return (
    <section className="chist-card csup-profile" aria-label="Perfil dos pedidos">
      <Breakdown title="do que pedem" rows={byCategory} />
      <Breakdown title="por onde chegam" rows={byChannel} />
      {byProduct.length > 1 && <Breakdown title="por produto" rows={byProduct} />}
    </section>
  );
}

function TicketRow({ t, customer, onLeave }) {
  const hermes = hermesChip(t);
  const other = t.saas && t.saas !== customer.saas;
  const late = !!(t.sla?.breached?.resolution || t.sla?.breached?.firstResponse);
  return (
    <li className="csup-row">
      <button type="button" className="csup-open" onClick={() => openTicket(t, onLeave)} title={`Abrir o ticket #${t.number}`}>
        <span className="chist-meeting-date">{fmtDay(t.createdAt)}</span>
        <span className="csup-row-body">
          <strong><span className="mono tnum">{`#${t.number}`}</span>{t.subject || "(sem assunto)"}</strong>
          <span className="csup-row-meta">
            <Status ticket={t} />
            {t.category && <span>{t.category}</span>}
            <span>{channelName(t.channel)}</span>
            {other && <span>{productName(t.saas)}</span>}
            {late && <span className="csup-late">SLA estourado</span>}
          </span>
        </span>
      </button>
      {(t.linear?.identifier || hermes) && (
        <span className="csup-row-side">
          {t.linear?.identifier && (t.linear.url
            ? <a className="chist-link mono" href={t.linear.url} target="_blank" rel="noopener noreferrer" title="Abrir a issue no Linear">{`${t.linear.identifier} ↗`}</a>
            : <span className="mono csup-lev">{t.linear.identifier}</span>)}
          {hermes && <span className={`chip ${hermes.tone}`} title={hermes.title}>{hermes.text}</span>}
        </span>
      )}
    </li>
  );
}

export function CustomerSupportHistory({ customer, onLeave, initial }) {
  const { data, error, notFound, loading, reload } = useSupportHistory(customer?.id || "", initial);
  const [scope, setScope] = useState("all");
  const [product, setProduct] = useState("");
  const [channel, setChannel] = useState("");
  const [creating, setCreating] = useState(false);
  const tickets = data?.tickets || [];
  const canCreate = handlesSaas(customer.saas);

  const products = useMemo(() => [...new Set(tickets.map((t) => t.saas).filter(Boolean))], [tickets]);
  const channels = useMemo(() => [...new Set(tickets.map((t) => t.channel || ""))], [tickets]);
  const openCount = tickets.filter((t) => !isDone(t)).length;
  const shown = tickets.filter((t) => (scope === "all" || !isDone(t))
    && (!product || t.saas === product) && (!channel || (t.channel || "") === channel));
  const filtered = scope !== "all" || !!product || !!channel;

  const createButton = canCreate && <button type="button" className="chist-btn is-small" onClick={() => setCreating(true)}>+ Abrir ticket</button>;
  const modal = creating && (
    <NewTicketModal saasId={customer.saas} initial={{ customerId: customer.id }} onClose={() => setCreating(false)}
      onCreated={(t) => { setCreating(false); openTicket({ ...t, saas: t.saas || customer.saas }, onLeave); }} />
  );

  if (loading) return <div className="chist-card"><p className="chist-empty">carregando o histórico de suporte…</p></div>;
  if (error) {
    return (
      <div className="chist-card chist-error" role="alert">
        <span>Não foi possível carregar o histórico de suporte.</span>
        <button type="button" className="chist-btn is-small" onClick={reload}>Tentar novamente</button>
      </div>
    );
  }
  if (notFound) return <p className="chist-empty is-card">Nenhum produto desta empresa está no seu atendimento de suporte.</p>;
  if (!tickets.length) {
    return (
      <div className="chist-card csup-empty">
        <h3>Nenhum pedido de suporte desta empresa</h3>
        <p>Quando o cliente pedir ajuda (WhatsApp, portal ou e-mail) ou alguém da equipe abrir um ticket por ele, o pedido aparece aqui.</p>
        {createButton}
        {modal}
      </div>
    );
  }

  let month = "";
  return (
    <div className="csup">
      <SupportSummary data={data} />
      <SupportProfile data={data} />
      <section className="chist-card csup-list" aria-label="Pedidos de suporte">
        <header className="chist-card-head">
          <h3>Pedidos</h3>
          <span>{filtered ? `${shown.length} de ${tickets.length}` : plural(tickets.length, "pedido", "pedidos")}</span>
          {createButton}
        </header>
        <div className="csup-filters">
          <Segmented value={scope} onChange={setScope} options={[
            { value: "all", label: `Todos · ${tickets.length}` },
            { value: "open", label: `Em aberto · ${openCount}` },
          ]} />
          {products.length > 1 && (
            <div className="csup-pick"><SelectPopover size="sm" label="Produto" value={product} onChange={setProduct}
              options={[{ value: "", label: "Todos os produtos" }, ...products.map((p) => ({ value: p, label: productName(p) }))]} /></div>
          )}
          {channels.length > 1 && (
            <div className="csup-pick"><SelectPopover size="sm" label="Canal" value={channel} onChange={setChannel}
              options={[{ value: "", label: "Todos os canais" }, ...channels.map((c) => ({ value: c, label: channelName(c) }))]} /></div>
          )}
        </div>
        {shown.length === 0 ? (
          <div className="csup-none">
            <p className="chist-empty">{scope === "open" && !product && !channel ? "Nenhum pedido em aberto agora." : "Nenhum pedido com esses filtros."}</p>
            <button type="button" className="chist-btn is-ghost" onClick={() => { setScope("all"); setProduct(""); setChannel(""); }}>Limpar filtros</button>
          </div>
        ) : (
          <ol className="csup-rows">
            {shown.map((t) => {
              const m = fmtMonth(t.createdAt);
              const head = m && m !== month ? (month = m) : "";
              return (
                <React.Fragment key={t.id}>
                  {head && <li className="chist-month csup-month">{head}</li>}
                  <TicketRow t={t} customer={customer} onLeave={onLeave} />
                </React.Fragment>
              );
            })}
          </ol>
        )}
      </section>
      {modal}
    </div>
  );
}
