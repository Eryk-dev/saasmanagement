import React from "react";
import { PageHead, StatTile, FilterTab, Pill } from "../components/viz.jsx";
import { EmptyState, PrimaryButton, SecondaryButton, SectionHead, toast } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useActiveSaas } from "../lib/workspace.js";
import { useData } from "../data.jsx";
import { PaymentLinkModal } from "../components/payment-link-modal.jsx";
import { linkStatusOf, linkOriginLabel, mpMethodLabel } from "../lib/payments.js";
import { waLink } from "../lib/ui.js";

// Links de pagamento — a tela do dinheiro que ainda não entrou.
//
// 1. HISTÓRICO (o grosso da tela): todo link gerado no nome de um lead ou
//    cliente, tenha nascido aqui, no card do lead ou na ficha do cliente, com o
//    status do dinheiro do lado (pago / aguardando / recusado). O status vem do
//    espelho do Mercado Pago no servidor (payment-links.js) — a tela só mostra.
// 2. GERAR: o mesmo modal do card do lead, aberto com o seletor de quem paga.
// 3. LINKS FIXOS das ofertas (anual / semestral / avulso): a ferramenta antiga,
//    pra quando não há card pra vincular. Fica recolhida no pé da tela.

const { useState: useS, useEffect: useE, useRef: useR, useMemo: useM, useCallback: useCb } = React;

// Dinheiro de COBRANÇA é valor exato (o closer confere contra o combinado) —
// o compacto do fmt.money fica só nos totais lá em cima.
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fmtAt = (iso) => (iso
  ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
  : "—");

// Grupos das abas: o que o time pergunta é "quem falta pagar?" e "quem pagou?".
const WAITING = new Set(["waiting", "pending", "in_process", "authorized"]);
const FAILED = new Set(["rejected", "cancelled", "refunded", "charged_back"]);
const GROUPS = {
  todos: () => true,
  aguardando: (s) => WAITING.has(s),
  pagos: (s) => s === "paid",
  recusados: (s) => FAILED.has(s),
};

// Mensagem pronta pra mandar o link no WhatsApp (o closer escolhe o contato).
function waShare(offer, brand) {
  const msg = `Oi! Segue o link pra fechar a *${offer.label}*${brand ? ` da ${brand}` : ""}:\n${offer.link}`;
  return `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
}

function OffersScreen({ onOpenLead }) {
  const [product] = useActiveSaas();
  const { version } = useData();
  const mpOn = !!window.SEED?.CONFIG?.mp?.configured;
  const money = window.fmt.money;

  // ── Histórico ────────────────────────────────────────────────────────────
  const [links, setLinks] = useS(null);
  const [linksErr, setLinksErr] = useS(null);
  const [tab, setTab] = useS("todos");
  const [q, setQ] = useS("");
  const [creating, setCreating] = useS(false);
  const [copied, setCopied] = useS("");
  const copyTimer = useR(null);

  const load = useCb(() => {
    if (!product?.id) return;
    api.paymentLinks(product.id)
      .then((r) => { setLinks(r.links || []); setLinksErr(null); })
      .catch((e) => setLinksErr(e.message));
  }, [product?.id]);
  // Troca de produto zera a tabela (é outro histórico); o refresh do tempo real
  // (version) recarrega POR BAIXO, sem piscar "carregando" a cada evento do SSE.
  useE(() => { setLinks(null); }, [product?.id]);
  useE(() => { load(); }, [load, version]);

  const stats = useM(() => {
    const rows = links || [];
    const since = Date.now() - 30 * 86_400_000;
    const paid = rows.filter((l) => l.status === "paid");
    const waiting = rows.filter((l) => WAITING.has(l.status));
    return {
      // O que entrou é o valor do PAGAMENTO (pode diferir do link em centavos).
      received: paid.reduce((a, l) => a + (Number(l.payment?.amount) || Number(l.amount) || 0), 0),
      paidCount: paid.length,
      waiting: waiting.reduce((a, l) => a + (Number(l.amount) || 0), 0),
      waitingCount: waiting.length,
      total: rows.length,
      last30: rows.filter((l) => Date.parse(l.createdAt || "") >= since).length,
    };
  }, [links]);

  const rows = useM(() => {
    const term = q.trim().toLowerCase();
    return (links || [])
      .filter((l) => GROUPS[tab](l.status))
      .filter((l) => !term || `${l.targetName || ""} ${l.title || ""} ${l.payerEmail || ""}`.toLowerCase().includes(term));
  }, [links, tab, q]);

  const counts = useM(() => {
    const rowsAll = links || [];
    return Object.fromEntries(Object.keys(GROUPS).map((k) => [k, rowsAll.filter((l) => GROUPS[k](l.status)).length]));
  }, [links]);

  async function copyLink(url, key) {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); }
    catch { window.prompt("Link de pagamento:", url); return; }
    setCopied(key);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(""), 1600);
  }
  useE(() => () => clearTimeout(copyTimer.current), []);

  // ── Links fixos das ofertas (ferramenta antiga, recolhida) ───────────────
  const [showOffers, setShowOffers] = useS(false);
  const [items, setItems] = useS(null);
  const [orig, setOrig] = useS(null);
  const [err, setErr] = useS(null);
  const [saving, setSaving] = useS(false);
  const offersFor = useR(""); // produto já buscado — recolher e abrir de novo não refaz (nem perde edição)

  // Busca só quando o time ABRE a seção: é o pé da tela, o dia a dia é o
  // histórico aí de cima.
  useE(() => {
    if (!showOffers || !product?.id || offersFor.current === product.id) return;
    offersFor.current = product.id;
    let alive = true;
    setItems(null); setErr(null);
    api.offers(product.id)
      .then((r) => { if (alive) { setItems(r.items || []); setOrig(JSON.stringify(r.items || [])); } })
      .catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [showOffers, product?.id]);

  const dirty = items && JSON.stringify(items) !== orig;

  function patch(i, field, value) {
    setItems((prev) => prev.map((it, j) => (j === i ? { ...it, [field]: value } : it)));
  }
  function addOffer() {
    setShowOffers(true);
    setItems((prev) => [...(prev || []), { key: `oferta_${(prev?.length || 0) + 1}`, label: "Nova oferta", price: "", link: "", proposalUrl: "" }]);
  }
  function removeOffer(i) {
    setItems((prev) => prev.filter((_, j) => j !== i));
  }
  function reset() { if (orig) setItems(JSON.parse(orig)); }
  async function save() {
    setSaving(true);
    try {
      const r = await api.saveOffers(product.id, items);
      setItems(r.items); setOrig(JSON.stringify(r.items));
      toast("links das ofertas salvos pro time", "pos");
    } catch (e) {
      toast(e.message || "não deu pra salvar os links · tente de novo", "neg");
    }
    setSaving(false);
  }

  const inp = { width: "100%", height: 38, padding: "0 12px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 13 };
  const btn = { height: 32, padding: "0 13px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12.5, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", boxShadow: "var(--shadow-1)" };
  const th = { textAlign: "left", padding: "10px 14px", borderBottom: "1px solid var(--line-1)", background: "var(--bg-inset)", whiteSpace: "nowrap" };
  const td = { padding: "10px 14px", fontSize: 12.5, borderBottom: "1px solid var(--line-faint)", verticalAlign: "top" };
  const act = { height: 26, padding: "0 9px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 11.5, fontWeight: 600, cursor: "pointer", textDecoration: "none", display: "inline-flex", alignItems: "center" };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead title="Links de pagamento" sub="gere a cobrança no nome do lead ou do cliente e acompanhe quem já pagou">
        <PrimaryButton onClick={() => setCreating(true)} disabled={!mpOn}>+ gerar link</PrimaryButton>
      </PageHead>

      <div style={{ flex: 1, overflow: "auto", padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
        {!mpOn && (
          <div className="mono" style={{ fontSize: 12, color: "var(--warn)" }}>
            Mercado Pago não conectado (MERCADOPAGO_ACCESS_TOKEN no servidor) — dá pra ver o histórico, mas não gerar link novo.
          </div>
        )}

        <div className="resp-cols" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 14 }}>
          <StatTile label="Recebido pelos links" value={money(stats.received)}
            delta={`${stats.paidCount} link(s) pagos · histórico completo`}
            title="soma dos pagamentos aprovados que casaram com um link gerado — o restante do dinheiro da conta fica no Financeiro" />
          <StatTile label="Aguardando pagamento" value={money(stats.waiting)}
            delta={`${stats.waitingCount} link(s) esperando`} tone={stats.waitingCount ? "down" : "flat"}
            title="links gerados que ainda não têm pagamento aprovado (inclui boleto/PIX emitido e não pago)" />
          <StatTile label="Links gerados" value={String(stats.total)}
            delta={`${stats.last30} nos últimos 30 dias`}
            title="cada geração vira uma linha: gerar de novo pro mesmo cliente guarda os dois" />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
            {[["todos", "Todos"], ["aguardando", "Aguardando"], ["pagos", "Pagos"], ["recusados", "Recusados"]].map(([id, label]) => (
              <FilterTab key={id} active={tab === id} count={counts[id] || 0} onClick={() => setTab(id)}>{label}</FilterTab>
            ))}
          </div>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="buscar por cliente, cobrança ou e-mail…"
            className="inp" style={{ marginLeft: "auto", minWidth: 240, flex: "0 1 300px" }} />
        </div>

        {linksErr && <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>não deu pra carregar o histórico: {linksErr}</div>}
        {!links && !linksErr && <div className="mono dim" style={{ fontSize: 12 }}>carregando histórico…</div>}

        {links && !links.length && (
          <div style={{ minHeight: 240, background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)" }}>
            <EmptyState title="Nenhum link de pagamento ainda"
              hint="Gere a cobrança no nome de um lead ou cliente: o pagamento volta casado com ele e aparece aqui como pago."
              action={<PrimaryButton onClick={() => setCreating(true)} disabled={!mpOn}>+ gerar link</PrimaryButton>} />
          </div>
        )}

        {links && !!links.length && !rows.length && (
          <div className="mono dim" style={{ fontSize: 12 }}>
            nenhum link com esse filtro ·{" "}
            <button className="mono" style={{ color: "var(--accent)" }} onClick={() => { setTab("todos"); setQ(""); }}>limpar</button>
          </div>
        )}

        {links && !!rows.length && (
          <div className="tbl-x" style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)" }}>
            <table style={{ width: "100%", minWidth: 900, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th className="kicker" style={th}>Quem paga</th>
                  <th className="kicker" style={th}>Cobrança</th>
                  <th className="kicker" style={{ ...th, textAlign: "right" }}>Valor</th>
                  <th className="kicker" style={th}>Gerado</th>
                  <th className="kicker" style={th}>Status</th>
                  <th className="kicker" style={th}>Link</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => {
                  const st = linkStatusOf(l.status);
                  const leadDoc = l.lead ? (window.SEED?.LEADS || []).find((x) => x.id === l.lead) : null;
                  const faded = l.status === "superseded";
                  const wa = waLink(l.targetPhone);
                  const how = l.payment ? mpMethodLabel(l.payment) : "";
                  return (
                    <tr key={l.id} style={{ opacity: faded ? 0.6 : 1 }}>
                      <td style={td}>
                        {leadDoc && onOpenLead ? (
                          <button onClick={() => onOpenLead(leadDoc)} title="abrir o card deste lead"
                            style={{ fontSize: 13, fontWeight: 500, color: "var(--accent)", textAlign: "left" }}>
                            {l.targetName || "(sem nome)"}
                          </button>
                        ) : (
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{l.targetName || "(sem nome)"}</div>
                        )}
                        <div className="mono dim" style={{ fontSize: 10.5 }}>
                          {[l.kind === "lead" ? "lead" : "cliente", linkOriginLabel(l.origin)].filter(Boolean).join(" · ")}
                        </div>
                      </td>
                      <td style={{ ...td, maxWidth: 280 }}>
                        <div title={l.title} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.title || "—"}</div>
                        {l.payerEmail && (
                          <div className="mono dim" title={l.payerEmail}
                            style={{ fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.payerEmail}</div>
                        )}
                      </td>
                      <td className="tnum" style={{ ...td, textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>{BRL.format(Number(l.amount) || 0)}</td>
                      <td className="mono dim tnum" style={{ ...td, whiteSpace: "nowrap" }}>{fmtAt(l.createdAt)}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        <Pill tone={st.tone} title={st.hint}>{st.label}</Pill>
                        {l.paidAt && <div className="mono dim" style={{ fontSize: 10.5, marginTop: 2 }}>{fmtAt(l.paidAt)}{how ? ` · ${how}` : ""}</div>}
                        {!l.paidAt && l.payment && <div className="mono dim" style={{ fontSize: 10.5, marginTop: 2 }}>tentativa em {fmtAt(l.payment.dateCreated)}</div>}
                      </td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        {l.url ? (
                          <span style={{ display: "inline-flex", gap: 6 }}>
                            <button onClick={() => copyLink(l.url, l.id)} style={{ ...act, color: copied === l.id ? "var(--pos)" : "var(--fg-2)" }}>
                              {copied === l.id ? "✓ copiado" : "copiar"}
                            </button>
                            <a href={l.url} target="_blank" rel="noopener noreferrer" style={act} title="abrir o checkout">abrir ↗</a>
                            {wa && (
                              <a href={`${wa}?text=${encodeURIComponent(`Segue o link pra pagamento: ${l.url}`)}`} target="_blank" rel="noopener noreferrer"
                                style={{ ...act, color: "var(--wa-brand-deep)", borderColor: "var(--wa-brand)" }} title="mandar o link no WhatsApp">Whats ↗</a>
                            )}
                          </span>
                        ) : <span className="mono dim" style={{ fontSize: 11 }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {links && !!rows.length && (
          <div className="mono dim" style={{ fontSize: 10.5, lineHeight: 1.5 }}>
            {rows.length} de {links.length} link(s), mais recentes primeiro · o status vem do Mercado Pago: o pagamento casa pelo link (referência do lead/fatura) ou pelo e-mail do pagador · “substituído” = link antigo de quem gerou de novo pelo mesmo valor
          </div>
        )}

        {/* Ferramenta antiga: os links FIXOS das ofertas, sem cliente vinculado.
            Fica recolhida — o dia a dia agora é gerar link no nome de alguém. */}
        <div style={{ marginTop: 8 }}>
          <SectionHead
            title="Links fixos das ofertas"
            sub="os mesmos pra todo mundo (sem cliente vinculado) — pagamento não casa sozinho no Financeiro"
            action={
              <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {showOffers && dirty && (
                  <>
                    <button onClick={reset} disabled={saving} className="mono dim" style={{ fontSize: 11.5 }}>descartar</button>
                    <SecondaryButton onClick={save} disabled={saving} size="sm">{saving ? "salvando…" : "salvar links"}</SecondaryButton>
                  </>
                )}
                {showOffers && <SecondaryButton onClick={addOffer} size="sm">+ adicionar oferta</SecondaryButton>}
                <SecondaryButton onClick={() => setShowOffers((v) => !v)} size="sm">
                  {showOffers ? "ocultar" : `mostrar${items?.length ? ` (${items.length})` : ""}`}
                </SecondaryButton>
              </span>
            } />

          {showOffers && (
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
              {err && <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>{err}</div>}
              {!items && !err && <div className="mono dim" style={{ fontSize: 12 }}>carregando ofertas…</div>}

              {items && items.length === 0 && (
                <div style={{ minHeight: 200, background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)" }}>
                  <EmptyState title="Nenhuma oferta fixa" hint="Adicione a primeira oferta com o link de pagamento."
                    action={<SecondaryButton onClick={addOffer}>+ adicionar oferta</SecondaryButton>} />
                </div>
              )}

              {items && items.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 340px), 1fr))", gap: 14 }}>
                  {items.map((o, i) => {
                    const hasLink = /^https?:\/\//i.test(o.link || "");
                    const hasProposal = /^https?:\/\//i.test(o.proposalUrl || "");
                    return (
                      <div key={i} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)", padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <input value={o.label} onChange={(e) => patch(i, "label", e.target.value)}
                              placeholder="Nome da oferta"
                              style={{ ...inp, height: 24, border: "1px solid transparent", background: "transparent", padding: 0, fontSize: 15.5, fontWeight: 600, letterSpacing: "-.01em", fontFamily: "var(--display)" }} />
                            <input value={o.price} onChange={(e) => patch(i, "price", e.target.value)}
                              placeholder="preço (ex.: 12x 599 · 7.188 no ano)"
                              className="tnum" style={{ ...inp, height: 22, border: "1px solid transparent", background: "transparent", padding: 0, fontSize: 12.5, color: "var(--accent)" }} />
                          </div>
                          <button onClick={() => removeOffer(i)} title="Remover oferta" className="dim" style={{ fontSize: 13, flexShrink: 0, padding: 2 }}>✕</button>
                        </div>

                        <div>
                          <span className="kicker" style={{ display: "block", marginBottom: 8 }}>Link de pagamento</span>
                          <input value={o.link} onChange={(e) => patch(i, "link", e.target.value)}
                            placeholder="https://mpago.la/…"
                            className="mono" style={{ ...inp, fontSize: 12 }} />
                        </div>

                        <div>
                          <span className="kicker" style={{ display: "block", marginBottom: 8 }}>Link da proposta</span>
                          <input value={o.proposalUrl || ""} onChange={(e) => patch(i, "proposalUrl", e.target.value)}
                            placeholder="https://levermoney.com.br/p/…"
                            className="mono" style={{ ...inp, fontSize: 12 }} />
                        </div>

                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button onClick={() => copyLink(o.link, o.key || `of_${i}`)} disabled={!hasLink}
                            style={{ ...btn, background: copied === (o.key || `of_${i}`) ? "var(--pos-soft)" : "var(--btn-bg)", color: copied === (o.key || `of_${i}`) ? "var(--pos)" : "var(--btn-fg)", borderColor: "transparent", opacity: hasLink ? 1 : 0.5 }}>
                            {copied === (o.key || `of_${i}`) ? "✓ copiado" : "Copiar"}
                          </button>
                          <a href={hasLink ? o.link : undefined} target="_blank" rel="noopener noreferrer"
                            style={{ ...btn, textDecoration: "none", opacity: hasLink ? 1 : 0.4, pointerEvents: hasLink ? "auto" : "none" }}>Abrir ↗</a>
                          <a href={hasLink ? waShare(o, product?.name) : undefined} target="_blank" rel="noopener noreferrer"
                            style={{ ...btn, textDecoration: "none", opacity: hasLink ? 1 : 0.4, pointerEvents: hasLink ? "auto" : "none" }}>WhatsApp ↗</a>
                          <a href={hasProposal ? o.proposalUrl : undefined} target="_blank" rel="noopener noreferrer"
                            style={{ ...btn, textDecoration: "none", opacity: hasProposal ? 1 : 0.4, pointerEvents: hasProposal ? "auto" : "none" }}>Proposta ↗</a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {creating && (
        <PaymentLinkModal
          saas={product?.id}
          origin="tela"
          onClose={() => setCreating(false)}
          onSaved={() => { toast("link gerado — copie e mande pro cliente", "pos"); load(); }}
        />
      )}
    </div>
  );
}

export { OffersScreen };
