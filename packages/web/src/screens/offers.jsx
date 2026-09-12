import React from "react";
import { PageHead, StatTile, FilterTab, Pill } from "../components/viz.jsx";
import { EmptyState, PrimaryButton, toast } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useActiveSaas } from "../lib/workspace.js";
import { useData } from "../data.jsx";
import { usePeriod } from "../components/period-picker.jsx";
import { PaymentLinkModal } from "../components/payment-link-modal.jsx";
import { ManualPaidModal } from "../components/manual-paid-modal.jsx";
import { linkStatusOf, linkOriginLabel, linkPaidByLabel, mpMethodLabel, manualPayLabel } from "../lib/payments.js";
import { displayName, usersByRole, isAdminUser } from "../lib/users.js";
import { waLink } from "../lib/ui.js";

// Links de pagamento — quem já pagou e quem ainda deve, cliente por cliente.
//
// 1. Uma linha por CLIENTE (ou lead ainda sem Ganho) com o saldo: gerado, pago,
//    em aberto. Lead que virou cliente entra no cliente. Expandir mostra cada
//    link gerado (pelo card, por esta tela ou pela ficha do cliente) com o
//    status do dinheiro do lado. Tudo vem PRONTO do servidor
//    (payment-links.js): status do espelho do Mercado Pago, agrupamento e
//    somas. A tela só escolhe a aba e pinta.
// 2. Período = o filtro global do topo (o mesmo das outras telas); vendedor =
//    quem gerou o link. Link em aberto de ANTES do período avisa numa linha.
//    Closer vê SÓ os links que ele mesmo gerou (o servidor filtra, a tela só
//    esconde o seletor); admin vê todos e filtra por closer.
// 3. "Marcar pago": dinheiro que entrou fora do link (PIX direto, boleto).
//    Link com fatura dá baixa na fatura (ficha do cliente); o resto grava a
//    baixa manual no próprio link. Desfazer volta pra em aberto.
// 4. GERAR: o mesmo modal do card do lead, com o seletor de quem paga.
//
// Os links FIXOS das ofertas (iguais pra todo mundo) saíram em 10/09/2026:
// todo link nasce no nome de alguém, senão o pagamento não casa.

const { useState: useS, useEffect: useE, useRef: useR, useMemo: useM, useCallback: useCb } = React;

// Dinheiro de COBRANÇA é valor exato (o closer confere contra o combinado) —
// o compacto do fmt.money fica só nos totais lá em cima.
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fmtAt = (iso) => (iso
  ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
  : "—");
const fmtDay = (ymd) => (ymd ? ymd.slice(8, 10) + "/" + ymd.slice(5, 7) : "");

// Recorrência de link ANTIGO (preapproval): só leitura, não se gera mais.
const RECURRING_LABEL = { 1: "mensal", 3: "trimestral", 6: "semestral", 12: "anual" };

// Abas: o que o time pergunta é "quem falta pagar?" e "quem pagou?". A régua é
// POR CLIENTE (saldo do grupo), a mesma que o servidor usa em counts.groups.
const TABS = [["aguardando", "Devendo"], ["pagos", "Pagos"], ["recusados", "Recusados"], ["todos", "Todos"]];
const TAB_OF = {
  todos: () => true,
  aguardando: (g) => g.totals.waiting > 0,
  pagos: (g) => g.totals.paid > 0,
  recusados: (g) => g.totals.failed > 0,
};

const th = { textAlign: "left", padding: "10px 14px", borderBottom: "1px solid var(--line-1)", background: "var(--bg-inset)", whiteSpace: "nowrap" };
const td = { padding: "10px 14px", fontSize: 12.5, borderBottom: "1px solid var(--line-faint)", verticalAlign: "top" };
const act = { height: 26, padding: "0 9px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 11.5, fontWeight: 600, cursor: "pointer", textDecoration: "none", display: "inline-flex", alignItems: "center" };

function OffersScreen({ onOpenLead }) {
  const [product] = useActiveSaas();
  const { version } = useData();
  const { win } = usePeriod();
  const mpOn = !!window.SEED?.CONFIG?.mp?.configured;
  const money = window.fmt.money;
  const admin = isAdminUser();

  const [data, setData] = useS(null);      // { groups, totals, counts, sellers, backlog }
  const [err, setErr] = useS(null);
  // O padrão era "todos" numa tela cuja pergunta é "quem falta pagar?": abre
  // em quem está devendo (Leo, 12/09 — confirmar com quem cobra).
  const [tab, setTab] = useS("aguardando");
  const [q, setQ] = useS("");
  const [by, setBy] = useS("");
  const [open, setOpen] = useS(() => new Set());
  const [creating, setCreating] = useS(false);
  const [paying, setPaying] = useS(null);  // link do modal de baixa manual
  const [busy, setBusy] = useS("");        // id do link com chamada em voo
  const [copied, setCopied] = useS("");
  const copyTimer = useR(null);

  const load = useCb(() => {
    if (!product?.id) return;
    api.paymentLinks({ saas: product.id, since: win.since, until: win.until, by })
      .then((r) => { setData(r); setErr(null); })
      .catch((e) => setErr(e.message));
  }, [product?.id, win.since, win.until, by]);
  // Troca de produto zera a tabela (é outro histórico); o refresh do tempo real
  // (version) e o período recarregam POR BAIXO, sem piscar "carregando".
  useE(() => { setData(null); setOpen(new Set()); }, [product?.id]);
  useE(() => { load(); }, [load, version]);

  const rows = useM(() => {
    const term = q.trim().toLowerCase();
    return (data?.groups || [])
      .filter(TAB_OF[tab])
      .filter((g) => !term || `${g.name} ${g.phone} ${g.links.map((l) => `${l.title || ""} ${l.payerEmail || ""}`).join(" ")}`.toLowerCase().includes(term));
  }, [data, tab, q]);

  const sellers = useM(() => {
    const fromServer = data?.sellers || [];
    if (fromServer.length) return fromServer.map((s) => ({ id: s.id, name: displayName(s.id) || s.name }));
    return usersByRole("closer").map((u) => ({ id: u.id, name: u.name }));
  }, [data]);

  function toggle(key) {
    setOpen((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  async function copyLink(url, key) {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); }
    catch { window.prompt("Link de pagamento:", url); return; }
    setCopied(key);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(""), 1600);
  }
  useE(() => () => clearTimeout(copyTimer.current), []);

  // Marcar pago: link com fatura dá baixa na fatura (a mesma da ficha do
  // cliente); sem fatura, abre o modal da baixa manual do link.
  async function markPaid(l) {
    if (l.invoice) {
      if (!window.confirm(`Dar baixa na fatura deste link (${BRL.format(Number(l.amount) || 0)})? O mesmo que marcar paga na ficha do cliente.`)) return;
      setBusy(l.id);
      try { await api.payInvoice(l.invoice); toast("fatura baixada", "pos"); load(); }
      catch (e) { toast(e.message || "não deu pra dar baixa na fatura", "neg"); }
      finally { setBusy(""); }
      return;
    }
    setPaying(l);
  }
  async function undoPaid(l) {
    setBusy(l.id);
    try {
      if (l.paidBy === "invoice" && l.invoice) await api.unpayInvoice(l.invoice);
      else await api.unpayPaymentLink(l.id);
      toast("baixa desfeita: o link voltou pra em aberto", "pos");
      load();
    } catch (e) { toast(e.message || "não deu pra desfazer", "neg"); }
    finally { setBusy(""); }
  }

  const totals = data?.totals || { generated: 0, paid: 0, waiting: 0, failed: 0 };
  const counts = data?.counts || { links: 0, groups: {} };
  const backlog = data?.backlog || { count: 0, waiting: 0 };
  const hasFilter = tab !== "todos" || !!q || !!by;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead title="Links de pagamento" sub={admin
        ? "quem já pagou e quem ainda deve, cliente por cliente · o status vem do Mercado Pago"
        : "os links que você gerou: quem já pagou e quem ainda deve · o status vem do Mercado Pago"}>
        <PrimaryButton onClick={() => setCreating(true)} disabled={!mpOn}>+ gerar link</PrimaryButton>
      </PageHead>

      <div style={{ flex: 1, overflow: "auto", padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
        {!mpOn && (
          <div className="mono" style={{ fontSize: 12, color: "var(--warn)" }}>
            Mercado Pago não conectado (MERCADOPAGO_ACCESS_TOKEN no servidor): dá pra ver o histórico, mas não gerar link novo.
          </div>
        )}

        {/* ── Faixa de dinheiro (12/09) ───────────────────────────────────
            Eram três StatTile de peso igual. O número que EXIGE ação é o em
            aberto, então ele vem primeiro e maior; a barra mostra a proporção
            dos três estados sobre o gerado, que é a soma deles. */}
        {(() => {
          const ger = Number(totals.generated) || 0;
          const pct = (v) => (ger > 0 ? Math.max(0, Math.min(100, (Number(v) || 0) / ger * 100)) : 0);
          const dot = (color) => ({ width: 6, height: 6, borderRadius: 999, background: color, flexShrink: 0 });
          return (
            <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)", padding: "20px var(--inset-x)" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 28, flexWrap: "wrap" }}>
                <div style={{ minWidth: 180 }}
                  title="links gerados no período que ainda não têm pagamento (inclui boleto/PIX emitido e não pago)">
                  <div style={{ fontSize: 12.5, color: "var(--fg-3)" }}>Em aberto</div>
                  <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 34, fontWeight: 700, lineHeight: 1.05, marginTop: 3, color: totals.waiting > 0 ? "var(--warn)" : "var(--fg-1)" }}>{money(totals.waiting)}</div>
                  <div style={{ fontSize: 11.5, color: "var(--fg-4)", marginTop: 2 }}>
                    {`${counts.groups?.aguardando || 0} ${(counts.groups?.aguardando || 0) === 1 ? "cliente devendo" : "clientes devendo"}`}
                  </div>
                </div>
                <div style={{ minWidth: 150 }} title="pagamentos aprovados no Mercado Pago + baixas manuais + faturas baixadas, dos links gerados no período">
                  <div style={{ fontSize: 12.5, color: "var(--fg-3)" }}>Recebido</div>
                  <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 700, marginTop: 3, color: "var(--pos)" }}>{money(totals.paid)}</div>
                  <div style={{ fontSize: 11.5, color: "var(--fg-4)", marginTop: 2 }}>{`${counts.paid || 0} ${(counts.paid || 0) === 1 ? "link pago" : "links pagos"}`}</div>
                </div>
                <div style={{ minWidth: 140 }} title="cada geração vira uma linha; link substituído (gerou de novo pelo mesmo valor) não conta no pedido">
                  <div style={{ fontSize: 12.5, color: "var(--fg-3)" }}>Links gerados</div>
                  <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 700, marginTop: 3 }}>{counts.links || 0}</div>
                  <div style={{ fontSize: 11.5, color: "var(--fg-4)", marginTop: 2 }}>{`${money(ger)} pedidos`}</div>
                </div>
                {totals.failed > 0 && (
                  <div style={{ minWidth: 130 }} title="links recusados pelo Mercado Pago (cartão negado, pagamento cancelado)">
                    <div style={{ fontSize: 12.5, color: "var(--fg-3)" }}>Recusado</div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 5 }}>
                      <span style={dot("var(--neg)")} />
                      <span className="tnum" style={{ fontSize: 15, fontWeight: 700, color: "var(--neg)" }}>{money(totals.failed)}</span>
                    </div>
                  </div>
                )}
                <button onClick={() => setTab("aguardando")} title="filtrar só quem está devendo"
                  style={{ marginLeft: "auto", alignSelf: "center", height: 32, padding: "0 13px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                  ver quem está devendo →
                </button>
              </div>
              {ger > 0 && (
                <>
                  <div style={{ display: "flex", height: 12, borderRadius: 999, overflow: "hidden", background: "var(--bg-2)", marginTop: 16 }}>
                    <div style={{ width: `${pct(totals.paid)}%`, background: "var(--pos)" }} />
                    <div style={{ width: `${pct(totals.waiting)}%`, background: "var(--warn)" }} />
                    <div style={{ width: `${pct(totals.failed)}%`, background: "var(--neg)" }} />
                  </div>
                  <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--fg-3)" }}><span style={dot("var(--pos)")} />pago</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--fg-3)" }}><span style={dot("var(--warn)")} />em aberto</span>
                    {totals.failed > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--fg-3)" }}><span style={dot("var(--neg)")} />recusado</span>}
                    {/* O rodapé de seis linhas em mono 10,5px virou isto: o
                        mesmo texto, no title, onde a dúvida aparece. */}
                    <span className="mono dim" style={{ marginLeft: "auto", fontSize: 11, cursor: "help" }}
                      title="O status vem do Mercado Pago: o pagamento casa pelo link (referência do lead/fatura) ou pelo e-mail do pagador. “Baixa manual” = dinheiro que entrou por fora e foi marcado à mão. “Substituído” = link antigo de quem gerou de novo pelo mesmo valor. Link com fatura dá baixa na fatura (a mesma da ficha do cliente).">
                      como o status funciona ⓘ
                    </span>
                  </div>
                </>
              )}
            </div>
          );
        })()}

        {backlog.count > 0 && (
          <div className="mono" style={{ fontSize: 11.5, color: "var(--warn)" }}>
            {backlog.count} link(s) em aberto de antes de {fmtDay(win.since)} ({money(backlog.waiting)}) fora do período: amplie o período no topo pra ver.
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
            {TABS.map(([id, label]) => (
              <FilterTab key={id} active={tab === id} count={counts.groups?.[id] || 0} onClick={() => setTab(id)}>{label}</FilterTab>
            ))}
          </div>
          {admin && (
            <select value={by} onChange={(e) => setBy(e.target.value)} className="inp" style={{ height: 34, minWidth: 160 }} title="quem gerou o link">
              <option value="">todos os vendedores</option>
              {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="buscar por cliente, telefone, cobrança ou e-mail…"
            className="inp" style={{ marginLeft: "auto", minWidth: 240, flex: "0 1 320px" }} />
        </div>

        {err && <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>não deu pra carregar o histórico: {err}</div>}
        {!data && !err && <div className="mono dim" style={{ fontSize: 12 }}>carregando histórico…</div>}

        {data && !data.groups.length && !hasFilter && (
          <div style={{ minHeight: 240, background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)" }}>
            <EmptyState title={admin ? "Nenhum link de pagamento no período" : "Você ainda não gerou link neste período"}
              hint="Gere a cobrança no nome de um lead ou cliente: o pagamento volta casado com ele e aparece aqui como pago. Pra ver links antigos, amplie o período no topo."
              action={<PrimaryButton onClick={() => setCreating(true)} disabled={!mpOn}>+ gerar link</PrimaryButton>} />
          </div>
        )}

        {data && !rows.length && hasFilter && (
          <div className="mono dim" style={{ fontSize: 12 }}>
            nenhum cliente com esse filtro ·{" "}
            <button className="mono" style={{ color: "var(--accent)" }} onClick={() => { setTab("aguardando"); setQ(""); setBy(""); }}>limpar</button>
          </div>
        )}

        {data && !!rows.length && (
          <div className="tbl-x" style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)" }}>
            <table style={{ width: "100%", minWidth: 780, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th className="kicker" style={{ ...th, width: 28 }}></th>
                  <th className="kicker" style={th}>Cliente</th>
                  <th className="kicker" style={{ ...th, textAlign: "right" }}>Links</th>
                  <th className="kicker" style={{ ...th, textAlign: "right" }}>Pago</th>
                  <th className="kicker" style={{ ...th, textAlign: "right" }}>Em aberto</th>
                  <th className="kicker" style={th}>Último link</th>
                  <th className="kicker" style={{ ...th, textAlign: "right" }}>Ação</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((g) => {
                  const isOpen = open.has(g.key);
                  const leadDoc = g.lead ? (window.SEED?.LEADS || []).find((x) => x.id === g.lead) : null;
                  const pill = g.totals.waiting > 0 ? { tone: "warn", label: "em aberto" }
                    : g.totals.paid > 0 ? { tone: "pos", label: "pago" }
                    : g.totals.failed > 0 ? { tone: "neg", label: "recusado" }
                    : { tone: "mut", label: "sem cobrança ativa" };
                  return (
                    <React.Fragment key={g.key}>
                      <tr onClick={() => toggle(g.key)} style={{ cursor: "pointer", background: isOpen ? "var(--bg-inset)" : undefined }} aria-expanded={isOpen}>
                        <td style={{ ...td, color: "var(--fg-4)", fontSize: 11, textAlign: "center" }}>{isOpen ? "▾" : "▸"}</td>
                        <td style={td}>
                          {leadDoc && onOpenLead ? (
                            <button onClick={(e) => { e.stopPropagation(); onOpenLead(leadDoc); }} title="abrir o card deste lead"
                              style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)", textAlign: "left" }}>
                              {g.name}
                            </button>
                          ) : (
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{g.name}</div>
                          )}
                          <div className="mono dim" style={{ fontSize: 10.5 }}>
                            {[g.kind === "customer" ? "cliente" : g.kind === "lead" ? "lead" : "", g.phone].filter(Boolean).join(" · ")}
                          </div>
                        </td>
                        <td className="tnum mono dim" style={{ ...td, textAlign: "right" }}>{g.counts.links}</td>
                        <td className="tnum" style={{ ...td, textAlign: "right", whiteSpace: "nowrap", color: g.totals.paid > 0 ? "var(--pos)" : "var(--fg-4)", fontWeight: g.totals.paid > 0 ? 600 : 400 }}>{BRL.format(g.totals.paid)}</td>
                        <td className="tnum" style={{ ...td, textAlign: "right", whiteSpace: "nowrap", color: g.totals.waiting > 0 ? "var(--warn)" : "var(--fg-4)", fontWeight: g.totals.waiting > 0 ? 600 : 400 }}>
                          {BRL.format(g.totals.waiting)}
                          <div style={{ marginTop: 2 }}><Pill tone={pill.tone}>{pill.label}</Pill></div>
                        </td>
                        <td className="mono dim tnum" style={{ ...td, whiteSpace: "nowrap" }}>
                          {fmtAt(g.lastAt)}
                          {(() => {
                            const t = g.lastAt ? new Date(g.lastAt).getTime() : NaN;
                            if (!Number.isFinite(t)) return null;
                            const d = Math.floor((Date.now() - t) / 86400000);
                            return <div style={{ fontSize: 10.5 }}>{d <= 0 ? "hoje" : `há ${d}d`}</div>;
                          })()}
                        </td>
                        {/* AÇÃO: faltava a principal — cobrar. O link em aberto
                            vai pronto pro WhatsApp do cliente; sem telefone o
                            botão não aparece (em vez de ficar cinza sem dizer
                            por quê). */}
                        <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                          {(() => {
                            const aberto = (g.links || []).find((l) => linkStatusOf(l) === "waiting" || linkStatusOf(l) === "pending");
                            const wa = waLink(g.phone);
                            const texto = aberto
                              ? `Oi${g.name ? ` ${String(g.name).split(" ")[0]}` : ""}, segue o link do pagamento: ${aberto.url || ""}`
                              : "";
                            return (
                              <span style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end" }}>
                                {aberto && wa && (
                                  <a href={`${wa}?text=${encodeURIComponent(texto)}`} target="_blank" rel="noopener noreferrer"
                                    title="abrir o WhatsApp com o link da cobrança em aberto"
                                    style={{ height: 26, display: "inline-flex", alignItems: "center", padding: "0 11px", borderRadius: "var(--r-2)", border: "1px solid var(--wa-brand)", background: "var(--wa-brand)", color: "var(--wa-brand-fg)", fontSize: 11.5, fontWeight: 700, textDecoration: "none" }}>
                                    cobrar
                                  </a>
                                )}
                                {aberto?.url && (
                                  <button onClick={() => copyLink(aberto.url, `g-${g.key}`)}
                                    style={{ height: 26, padding: "0 11px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 11.5, cursor: "pointer" }}>
                                    {copied === `g-${g.key}` ? "copiado ✓" : "copiar"}
                                  </button>
                                )}
                                {!aberto && <span className="mono dim" style={{ fontSize: 10.5 }}>—</span>}
                              </span>
                            );
                          })()}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={7} style={{ padding: 0, background: "var(--bg-inset)", borderBottom: "1px solid var(--line-1)" }}>
                            <LinksTable links={g.links} copied={copied} busy={busy} onCopy={copyLink} onPay={markPaid} onUndo={undoPaid} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {data && !!rows.length && (
          <div className="mono dim" style={{ fontSize: 10.5 }}>
            {`${rows.length} ${rows.length === 1 ? "cliente" : "clientes"} · ${counts.links} ${counts.links === 1 ? "link" : "links"} no período`}
          </div>
        )}
      </div>

      {creating && (
        <PaymentLinkModal
          saas={product?.id}
          origin="tela"
          onClose={() => setCreating(false)}
          onSaved={() => { toast("link gerado: copie e mande pro cliente", "pos"); load(); }}
        />
      )}
      {paying && (
        <ManualPaidModal
          link={paying}
          onClose={() => setPaying(null)}
          onDone={() => { setPaying(null); toast("marcado como pago", "pos"); load(); }}
        />
      )}
    </div>
  );
}

// Os links de UM cliente, mais novos primeiro.
function LinksTable({ links, copied, busy, onCopy, onPay, onUndo }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th className="kicker" style={{ ...th, paddingLeft: 42 }}>Cobrança</th>
          <th className="kicker" style={{ ...th, textAlign: "right" }}>Valor</th>
          <th className="kicker" style={th}>Gerado</th>
          <th className="kicker" style={th}>Status</th>
          <th className="kicker" style={th}>Ações</th>
        </tr>
      </thead>
      <tbody>
        {links.map((l) => <LinkRow key={l.id} l={l} copied={copied === l.id} busy={busy === l.id} onCopy={onCopy} onPay={onPay} onUndo={onUndo} />)}
      </tbody>
    </table>
  );
}

function LinkRow({ l, copied, busy, onCopy, onPay, onUndo }) {
  const st = linkStatusOf(l.status);
  const faded = l.status === "superseded";
  const wa = waLink(l.targetPhone);
  const how = l.paidBy === "mp" && l.payment ? mpMethodLabel(l.payment)
    : l.paidBy === "manual" ? manualPayLabel(l.manualPaid?.method)
    : l.paidBy === "invoice" ? "" : "";
  const via = linkPaidByLabel(l.paidBy);
  const canPay = l.status !== "paid" && l.status !== "superseded";
  const canUndo = l.paidBy === "manual" || l.paidBy === "invoice";
  return (
    <tr style={{ opacity: faded ? 0.6 : 1 }}>
      <td style={{ ...td, paddingLeft: 42, maxWidth: 320 }}>
        <div title={l.title} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {l.title || "—"}
          {l.recurring && (
            <span className="mono" style={{ marginLeft: 6, fontSize: 10, color: "var(--accent)" }}
              title="assinatura recorrente antiga no Mercado Pago (não se gera mais)">
              ↻ {RECURRING_LABEL[l.frequencyMonths] || "recorrente"}
            </span>
          )}
        </div>
        <div className="mono dim" style={{ fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {[linkOriginLabel(l.origin), l.createdBy ? `por ${displayName(l.createdBy) || l.createdBy}` : "", l.payerEmail].filter(Boolean).join(" · ")}
        </div>
      </td>
      <td className="tnum" style={{ ...td, textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>{BRL.format(Number(l.amount) || 0)}</td>
      <td className="mono dim tnum" style={{ ...td, whiteSpace: "nowrap" }}>{fmtAt(l.createdAt)}</td>
      <td style={{ ...td, whiteSpace: "nowrap" }}>
        <Pill tone={st.tone} title={st.hint}>{st.label}</Pill>
        {l.paidAt && (
          <div className="mono dim" style={{ fontSize: 10.5, marginTop: 2 }} title={l.manualPaid?.note || ""}>
            {fmtAt(l.paidAt)}{how ? ` · ${how}` : ""}{via ? ` · ${via}` : ""}
            {l.paidBy === "manual" && l.manualPaid?.by ? ` (${displayName(l.manualPaid.by) || l.manualPaid.by})` : ""}
          </div>
        )}
        {!l.paidAt && l.payment && <div className="mono dim" style={{ fontSize: 10.5, marginTop: 2 }}>tentativa em {fmtAt(l.payment.dateCreated)}</div>}
        {l.paidBy === "manual" && l.payment && <div className="mono dim" style={{ fontSize: 10.5 }}>tentativa recusada em {fmtAt(l.payment.dateCreated)}</div>}
      </td>
      <td style={{ ...td, whiteSpace: "nowrap" }}>
        <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
          {l.url && (
            <>
              <button onClick={() => onCopy(l.url, l.id)} style={{ ...act, color: copied ? "var(--pos)" : "var(--fg-2)" }}>
                {copied ? "✓ copiado" : "copiar"}
              </button>
              <a href={l.url} target="_blank" rel="noopener noreferrer" style={act} title="abrir o checkout">abrir ↗</a>
              {wa && (
                <a href={`${wa}?text=${encodeURIComponent(`Segue o link pra pagamento: ${l.url}`)}`} target="_blank" rel="noopener noreferrer"
                  style={{ ...act, color: "var(--wa-brand-deep)", borderColor: "var(--wa-brand)" }} title="mandar o link no WhatsApp">Whats ↗</a>
              )}
            </>
          )}
          {canPay && (
            <button onClick={() => onPay(l)} disabled={busy} style={{ ...act, color: "var(--pos)", borderColor: "var(--pos)", opacity: busy ? 0.6 : 1 }}
              title={l.invoice ? "dar baixa na fatura deste link" : "o dinheiro entrou por fora do link: marcar à mão"}>
              marcar pago
            </button>
          )}
          {canUndo && (
            <button onClick={() => onUndo(l)} disabled={busy} className="mono dim" style={{ ...act, opacity: busy ? 0.6 : 1 }} title="voltar pra em aberto">
              desfazer
            </button>
          )}
        </span>
      </td>
    </tr>
  );
}

export { OffersScreen };
