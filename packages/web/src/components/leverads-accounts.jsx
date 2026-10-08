import React from "react";
import { api } from "../lib/api.js";
import { Popover } from "./popover.jsx";
import { Card, FilterTab } from "./viz.jsx";
import { EmptyState } from "../atoms.jsx";
import "./leverads-accounts.css";
// Contas do LeverAds na tela Clientes (espelho `leverads_orgs` da API,
// customers/leverads-orgs.js):
//   · FreeAccountsTab   aba Gratuitas: contas sem venda e as pagantes sem
//                       cliente, com "Vincular a cliente";
//   · CustomerOrgLink   bloco da ficha: a conta vinculada (e por onde veio),
//                       desfazer e "Vincular conta" com as mais novas primeiro.
// Conta gratuita não é cliente: não entra em KPI, churn nem régua.

const { useCallback, useEffect, useMemo, useRef, useState } = React;

const norm = (v) => String(v || "").trim().toLowerCase();
const RECENT_MS = 48 * 3600 * 1000;
const isRecent = (o) => Date.now() - new Date(o.createdAt || 0).getTime() < RECENT_MS;

function whenLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return `hoje, ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  if (days === 1) return "ontem";
  if (days < 30) return `há ${days} dias`;
  return d.toLocaleDateString("pt-BR");
}

// Espelho compartilhado entre a aba e a ficha (uma busca por sessão de tela;
// `reload` depois de vincular, `refresh` pede ao LeverAds agora).
let mirrorPromise = null;
export function useLeveradsMirror() {
  const [state, setState] = useState({ loading: true, error: "", configured: true, orgs: [] });
  const apply = (p) => p
    .then((res) => setState({ loading: false, error: "", configured: res?.configured !== false, orgs: res?.orgs || [] }))
    .catch((e) => { mirrorPromise = null; setState((s) => ({ ...s, loading: false, error: e?.message || "não deu pra carregar as contas" })); });
  useEffect(() => { apply(mirrorPromise ||= api.leveradsOrgs()); }, []);
  const reload = useCallback(() => apply(mirrorPromise = api.leveradsOrgs()), []);
  const refresh = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    return apply(mirrorPromise = api.refreshLeveradsOrgs());
  }, []);
  return { ...state, reload, refresh };
}

const emailsOf = (customer, lead) => [norm(customer?.email), norm(lead?.email)].filter((e) => e.includes("@"));
const orgMatches = (org, emails) => emails.length > 0 && [norm(org.email), ...(org.members || []).map(norm)].some((e) => emails.includes(e));

// ── Seletor de org (ficha) ──────────────────────────────────────────────────
function OrgPicker({ anchor, orgs, emails, busy, onPick, onRefresh, refreshing, onClose }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const term = norm(q);
    return orgs
      .filter((o) => !o.customerId && o.active !== false)
      .filter((o) => !term || norm(o.name).includes(term) || norm(o.email).includes(term) || (o.members || []).some((m) => m.includes(term)))
      .map((o) => ({ o, match: orgMatches(o, emails), recent: isRecent(o) }))
      .sort((a, b) => (b.match - a.match) || String(b.o.createdAt || "").localeCompare(String(a.o.createdAt || "")))
      .slice(0, 60);
  }, [orgs, q, emails]);
  return (
    <Popover anchor={anchor} onClose={onClose} width={380} label="Vincular conta do LeverAds">
      <div className="lva-picker">
        <div className="lva-picker-head">
          <input className="inp" autoFocus placeholder="buscar por nome ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="button" onClick={onRefresh} disabled={refreshing} title="buscar contas novas no LeverAds agora">{refreshing ? "atualizando…" : "atualizar"}</button>
        </div>
        <p className="lva-picker-hint">Contas sem cliente, as mais novas primeiro. Criou agora na call? Toque em atualizar.</p>
        {!list.length ? <p className="lva-empty">Nenhuma conta sem cliente{q ? " com essa busca" : ""}.</p> : (
          <ul>
            {list.map(({ o, match, recent }) => (
              <li key={o.id}>
                <button type="button" disabled={!!busy} onClick={() => onPick(o)}>
                  <span className="lva-name">{o.name || "sem nome"}{recent && <em>nova</em>}{match && <em data-tone="pos">e-mail bate</em>}</span>
                  <small>{o.email || "sem e-mail"} · criada {whenLabel(o.createdAt)}{o.paymentActive ? " · pagante" : ""}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Popover>
  );
}

const VIA = { email: "vinculada pelo e-mail", manual: "vinculada na ficha" };

export function CustomerOrgLink({ customer, lead, onChanged }) {
  const mirror = useLeveradsMirror();
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const orgId = norm(customer.leveradsOrgId);
  const org = orgId ? mirror.orgs.find((o) => o.id === orgId) : null;
  const emails = emailsOf(customer, lead);

  async function link(o) {
    setBusy(o.id); setErr("");
    try { await api.linkLeveradsOrg(customer.id, o.id); setOpen(false); mirror.reload(); onChanged?.(); }
    catch (e) { setErr(e?.message || "não deu pra vincular"); }
    finally { setBusy(""); }
  }
  async function unlink() {
    setBusy("unlink"); setErr("");
    try { await api.unlinkLeveradsOrg(customer.id); mirror.reload(); onChanged?.(); }
    catch (e) { setErr(e?.message || "não deu pra desfazer"); }
    finally { setBusy(""); }
  }

  return (
    <section className="customer-peek-orglink">
      <div className="customer-peek-kicker"><span>conta do LeverAds</span>
        {orgId && customer.orgLink?.via && VIA[customer.orgLink.via] && <span className="customer-peek-state">{VIA[customer.orgLink.via]}</span>}
      </div>
      {orgId ? (
        <div className="lva-linked">
          <div>
            <strong>{org?.name || "org vinculada"}</strong>
            <small>{org ? `${org.email || "sem e-mail"} · criada ${whenLabel(org.createdAt)}` : `org ${orgId.slice(0, 8)}…`}</small>
          </div>
          <button type="button" onClick={unlink} disabled={!!busy}>{busy === "unlink" ? "…" : "desfazer"}</button>
        </div>
      ) : (
        <div className="lva-linked">
          <div><small>{mirror.configured ? "Sem conta vinculada. O sync de acesso, os resultados e a badge de LeverId dependem dela." : "Lista de contas do LeverAds desligada neste ambiente."}</small></div>
          {mirror.configured && <button ref={ref} type="button" className="lva-primary" onClick={() => setOpen(true)} disabled={!!busy}>Vincular conta</button>}
        </div>
      )}
      {err && <p className="lva-err" role="alert">{err}</p>}
      {open && <OrgPicker anchor={ref} orgs={mirror.orgs} emails={emails} busy={busy} onPick={link}
        onRefresh={mirror.refresh} refreshing={mirror.loading} onClose={() => setOpen(false)} />}
    </section>
  );
}

// ── Seletor de cliente (aba Gratuitas) ──────────────────────────────────────
function CustomerPicker({ anchor, org, customers, leadsById, busy, onPick, onClose }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const term = norm(q);
    return customers
      .filter((c) => !norm(c.leveradsOrgId))
      .filter((c) => !term || norm(c.name).includes(term) || norm(c.email).includes(term) || norm(c.contact).includes(term))
      .map((c) => ({ c, match: orgMatches(org, emailsOf(c, leadsById.get(c.leadId))) }))
      .sort((a, b) => (b.match - a.match) || String(a.c.name).localeCompare(String(b.c.name), "pt-BR"))
      .slice(0, 60);
  }, [customers, q, org, leadsById]);
  return (
    <Popover anchor={anchor} onClose={onClose} width={360} label={`Vincular ${org.name || "conta"} a um cliente`}>
      <div className="lva-picker">
        <div className="lva-picker-head"><input className="inp" autoFocus placeholder="buscar cliente" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <p className="lva-picker-hint">Clientes sem conta do LeverAds vinculada.</p>
        {!list.length ? <p className="lva-empty">Nenhum cliente sem conta{q ? " com essa busca" : ""}.</p> : (
          <ul>
            {list.map(({ c, match }) => (
              <li key={c.id}>
                <button type="button" disabled={!!busy} onClick={() => onPick(c)}>
                  <span className="lva-name">{c.name}{match && <em data-tone="pos">e-mail bate</em>}</span>
                  <small>{[c.contact, c.email].filter(Boolean).join(" · ") || "—"}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Popover>
  );
}

function FreeRow({ org, customers, leadsById, onLinked }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function link(c) {
    setBusy(true); setErr("");
    try { await api.linkLeveradsOrg(c.id, org.id); setOpen(false); onLinked(c); }
    catch (e) { setErr(e?.message || "não deu pra vincular"); }
    finally { setBusy(false); }
  }
  const n = (org.members || []).length;
  return (
    <div className="lva-row">
      <div className="lva-who">
        <strong>{org.name || "sem nome"}{isRecent(org) && <em>nova</em>}</strong>
        <small>{org.email || "sem e-mail"}</small>
      </div>
      <span className="lva-when">{whenLabel(org.createdAt)}</span>
      <span className="lva-count">{n ? `${n} ${n === 1 ? "conta" : "contas"}` : "—"}</span>
      <div className="lva-act">
        <button ref={ref} type="button" onClick={() => setOpen(true)} disabled={busy}>Vincular a cliente</button>
        {err && <small className="lva-err" role="alert">{err}</small>}
      </div>
      {open && <CustomerPicker anchor={ref} org={org} customers={customers} leadsById={leadsById} busy={busy} onPick={link} onClose={() => setOpen(false)} />}
    </div>
  );
}

export function FreeAccountsTab({ customers, leads, onOpenCustomer }) {
  const mirror = useLeveradsMirror();
  const [bucket, setBucket] = useState("free"); // free | paying
  const leadsById = useMemo(() => new Map((leads || []).map((l) => [l.id, l])), [leads]);
  const live = mirror.orgs.filter((o) => o.active !== false && !o.customerId);
  const free = live.filter((o) => !o.paymentActive);
  const paying = live.filter((o) => o.paymentActive);
  const rows = bucket === "free" ? free : paying;

  if (!mirror.configured) return <div className="lva-tab"><EmptyState title="Contas do LeverAds desligadas" hint="Defina LEVERADS_SERVICE_KEY (ou LEVERADS_ADMIN_*) na API para espelhar as contas." /></div>;
  if (mirror.error && !mirror.orgs.length) return <div className="lva-tab"><EmptyState title="Contas indisponíveis" hint={mirror.error} /><button onClick={mirror.reload}>Tentar novamente</button></div>;

  return (
    <div className="lva-tab">
      <div className="lva-filters">
        <FilterTab active={bucket === "free"} count={free.length} onClick={() => setBucket("free")}>Gratuitas</FilterTab>
        <FilterTab active={bucket === "paying"} count={paying.length} onClick={() => setBucket("paying")}>Pagantes sem cliente</FilterTab>
        <span className="lva-note">{bucket === "free"
          ? "Contas criadas no LeverAds sem venda. Não entram nos números da base."
          : "Pagam no LeverAds mas não têm cliente no Cockpit: vincule ao cliente certo ou cadastre."}</span>
        <button type="button" className="lva-refresh" onClick={mirror.refresh} disabled={mirror.loading}>{mirror.loading ? "atualizando…" : "atualizar"}</button>
      </div>
      {mirror.loading && !mirror.orgs.length ? <div className="customers-load" role="status">Carregando contas…</div> : !rows.length ? (
        <EmptyState title={bucket === "free" ? "Nenhuma conta gratuita" : "Nenhuma conta pagante sem cliente"} hint="Contas novas do LeverAds aparecem aqui em até 10 minutos." />
      ) : (
        <Card style={{ overflow: "hidden" }}>
          <div className="tbl-x">
            <div>
              <div className="lva-row lva-head">
                <span className="kicker">Conta</span><span className="kicker">Criada</span><span className="kicker">Contas</span><span className="kicker" style={{ textAlign: "right" }}>Ação</span>
              </div>
              {rows.map((o) => <FreeRow key={o.id} org={o} customers={customers} leadsById={leadsById}
                onLinked={(c) => { mirror.reload(); onOpenCustomer?.(c.id); }} />)}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
