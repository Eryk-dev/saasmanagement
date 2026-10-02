import React from "react";
import { createPortal } from "react-dom";
import "./plans.css";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import { isAdminUser } from "../lib/users.js";
import { EmptyState, MoreMenu } from "../atoms.jsx";
import { Drawer } from "../components/overlay.jsx";
import { BarraComposicao } from "../components/story.jsx";
import { PlanModal } from "../components/plan-editor.jsx";
import { CYCLE_TITLE } from "../lib/payments.js";
import { PLAN_LIMITS, PLAN_FEATURES, PLAN_PRODUCTS, planProductOf, limitsSummary, featuresIncluded } from "../../../api/src/plan-resources.js";

// Planos (Comercial → Planos): gestão do catálogo do produto pelo admin. Cada
// plano com o que ele vende (preço por ciclo, limites, recursos do LeverAds) e
// o que ele rende (assinantes, contratado, recebido). A linha abre a ficha do
// plano; criar e editar é no mesmo formulário. Só admin entra: a tela mostra
// receita por cliente e o servidor recusa a escrita de quem não é.

const { useState, useEffect, useCallback, useMemo } = React;

const KIND_LABEL = { subscription: "Assinatura", one_off: "Compra única", legacy: "Catálogo anterior" };
const CLOSED_LABEL = { anual: "Anual", semestral: "Semestral", mensal: "Mensal", unico: "Serviço único" };
const SLICE_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--info)", "var(--warn)", "var(--pos)", "var(--accent)"];
export const PLANS_GRID = "minmax(190px,1.5fr) minmax(130px,1fr) minmax(170px,1.3fr) minmax(90px,.7fr) minmax(100px,.8fr) minmax(100px,.8fr) 92px";

const money = (v) => window.fmt.moneyFull(Number(v) || 0);
const day = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const EMPTY = { active: 0, churned: 0, arr: 0, mrr: 0, received: 0, customers: [] };

// Preço de tabela de um plano, em uma linha.
function priceText(plan) {
  if (plan.pricing === "custom") return { main: "sob consulta", sub: "valor negociado na venda" };
  if (plan.kind === "one_off") {
    const opts = plan.options || [];
    if (opts.length) return { main: `a partir de ${money(Math.min(...opts.map((o) => Number(o.price) || 0)))}`, sub: plural(opts.length, "opção", "opções") };
    return { main: money(plan.prices?.once?.total), sub: "pagamento único" };
  }
  const a = plan.prices?.annual, s = plan.prices?.semiannual;
  if (!a && !s) return { main: "sem preço", sub: "" };
  return {
    main: a ? `${money(a.per)}/mês` : `${money(s.per)}/mês`,
    sub: [a ? `anual ${money(a.total)}` : "", s ? `semestral ${money(s.total)}` : ""].filter(Boolean).join(" · "),
  };
}

export function PlansScreen() {
  const [product] = useActiveSaas();
  const { version, refresh, openForm, openDelete } = useData();
  const admin = isAdminUser();
  const saas = product?.id;
  const [plans, setPlans] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState("active"); // active | archived | legacy
  const [productFilter, setProductFilter] = useState("all"); // all | id do produto
  const [open, setOpen] = useState(null);     // código do plano ou "custom" | "none" na ficha
  const [editing, setEditing] = useState(null); // plano no formulário ({} = novo)
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    if (!saas || !admin) { setLoading(false); return; }
    setError(null);
    try {
      const [pp, st] = await Promise.all([api.list("plans", { saas }), api.planStats(saas)]);
      setPlans(pp); setStats(st);
    } catch (err) { setError(err?.message || "Não foi possível carregar os planos."); }
    finally { setLoading(false); }
  }, [saas, admin]);
  useEffect(() => { setLoading(true); load(); }, [load, version]);

  const catalog = useMemo(() => plans.filter((p) => p.code).sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)), [plans]);
  const legacy = plans.filter((p) => !p.code);
  const active = catalog.filter((p) => p.status !== "archived");
  const archived = catalog.filter((p) => p.status === "archived");
  const statOf = (code) => stats?.plans?.[code] || EMPTY;
  const changed = async () => { await refresh(); await load(); };

  async function run(plan, action) {
    if (busy) return;
    setBusy(plan.id); setError(null);
    try { await action(); await changed(); }
    catch (err) { setError(err?.message || "não deu pra salvar o plano"); }
    finally { setBusy(null); }
  }
  const setStatus = (p, status) => run(p, () => api.update("plans", p.id, { status }));
  const remove = (p) => {
    if (!window.confirm(`Excluir o plano "${p.name}"? Plano em uso não é excluído: arquive.`)) return;
    run(p, () => api.remove("plans", p.id));
  };

  if (!product) return <EmptyState title="Nenhum produto" hint="Crie um produto em Configurações para cadastrar planos." />;
  if (!admin) return <EmptyState title="Planos é uma tela de administrador" hint="Aqui se define preço, limites e recursos de cada plano. Peça acesso a quem administra o Cockpit." />;

  // PRODUTO → linha → plano. O produto é o primeiro nível: cada um com os
  // seus planos e o que ele soma de assinantes e MRR.
  const shown = view === "archived" ? archived : active;
  const products = PLAN_PRODUCTS.map((prod) => {
    const rows = shown.filter((p) => planProductOf(p) === prod.id);
    const all = catalog.filter((p) => planProductOf(p) === prod.id);
    return {
      ...prod, rows,
      active: all.reduce((a, p) => a + statOf(p.code).active, 0),
      mrr: all.reduce((a, p) => a + statOf(p.code).mrr, 0),
    };
  });
  const total = stats?.total || EMPTY;
  const off = { active: (stats?.custom.active || 0) + (stats?.none.active || 0), mrr: (stats?.custom.mrr || 0) + (stats?.none.mrr || 0) };
  const slices = [
    ...catalog.filter((p) => statOf(p.code).mrr > 0).map((p, i) => ({ rotulo: p.name, valor: statOf(p.code).mrr, texto: money(statOf(p.code).mrr), cor: SLICE_COLORS[i % SLICE_COLORS.length] })),
    stats?.custom.mrr > 0 && { rotulo: "Personalizado", valor: stats.custom.mrr, texto: money(stats.custom.mrr), cor: "var(--fg-4)" },
    stats?.none.mrr > 0 && { rotulo: "Sem plano", valor: stats.none.mrr, texto: money(stats.none.mrr), cor: "var(--line-strong)" },
  ].filter(Boolean);
  const openPlan = open && !["custom", "none"].includes(open) ? catalog.find((p) => p.code === open) : null;

  return (
    <div className="plans-page">
      <header className="plans-header">
        <div>
          <h1 className="page-title">Planos</h1>
          <p className="page-sub">O que {product.name} vende: preço, limites e recursos de cada plano, e quanto cada um rende.</p>
        </div>
        <button className="plans-create" onClick={() => setEditing({})}>Criar plano</button>
      </header>

      {error && <div role="alert" className="plans-card plans-error">{error} <button onClick={load}>Tentar novamente</button></div>}
      {loading ? <div role="status" className="plans-card plans-loading">Carregando planos…</div> : <>
        <section className="plans-card plans-summary">
          <div className="plans-summary-main">
            <div className="kicker accent">Receita por plano</div>
            <div className="plans-summary-figure"><strong>{money(total.mrr)}</strong><span>de MRR em {plural(total.active, "cliente ativo", "clientes ativos")}</span></div>
            <p>{money(total.arr)} contratados por ano · {money(total.received)} já recebidos</p>
            {slices.length > 0
              ? <BarraComposicao bare fina fatias={slices} total={total.mrr} style={{ marginTop: 14 }} />
              : <p className="plans-muted">Nenhum cliente ativo com valor contratado ainda.</p>}
            <div className="plans-products">
              {products.map((prod) => (
                <div key={prod.id}>
                  <span>{prod.label}</span>
                  <strong>{money(prod.mrr)}</strong>
                  <small>{plural(prod.active, "assinante", "assinantes")}</small>
                </div>
              ))}
            </div>
          </div>
          <div className="plans-summary-side">
            <div className="kicker">Fora do catálogo</div>
            {off.active ? <>
              <div className="plans-summary-figure small"><strong data-tone="warn">{off.active}</strong><span>{off.active === 1 ? "cliente ativo" : "clientes ativos"} · {money(off.mrr)} de MRR</span></div>
              <p>Sem plano do catálogo, o acesso e os limites desses clientes são acertados à mão.</p>
              <div className="plans-summary-links">
                {stats.custom.active > 0 && <button onClick={() => setOpen("custom")}>{plural(stats.custom.active, "venda personalizada", "vendas personalizadas")}</button>}
                {stats.none.active > 0 && <button onClick={() => setOpen("none")}>{stats.none.active} sem plano</button>}
              </div>
            </> : <p>Todos os clientes ativos estão em um plano do catálogo.</p>}
          </div>
        </section>

        <section className="plans-card plans-table">
          <div className="plans-filters">
            {view !== "legacy" && (
              <div className="plans-segment" role="group" aria-label="Produto">
                {[["all", "Todos os produtos", shown.length], ...products.map((x) => [x.id, x.label, x.rows.length])].map(([id, label, n]) => (
                  <button key={id} aria-pressed={productFilter === id} onClick={() => setProductFilter(id)}>{label} <span>{n}</span></button>
                ))}
              </div>
            )}
            <div className="plans-segment" role="group" aria-label="Situação">
              {[["active", "Ativos", active.length], ["archived", "Arquivados", archived.length], ...(legacy.length ? [["legacy", "Avulsos", legacy.length]] : [])].map(([id, label, n]) => (
                <button key={id} aria-pressed={view === id} onClick={() => setView(id)}>{label} <span>{n}</span></button>
              ))}
            </div>
            {view === "legacy" && <span>cadastro antigo: nome e preço usados por assinaturas criadas à mão</span>}
          </div>

          {view === "legacy" ? legacy.map((p) => (
            <div className="plans-row" style={{ gridTemplateColumns: "minmax(180px,1.5fr) minmax(140px,1fr) 92px" }} key={p.id}>
              <span><strong>{p.name || p.id}</strong></span>
              <span><b>{money(p.price)}</b><small>{CYCLE_TITLE[p.cycle] || p.cycle}</small></span>
              <div className="plans-actions">
                <button onClick={() => openForm("plans", p)}>Editar</button>
                <MoreMenu size={22} items={[{ label: "Excluir", tone: "neg", onClick: () => openDelete("plans", p) }]} />
              </div>
            </div>
          )) : !shown.length ? (
            <div className="plans-empty">{view === "archived" ? "Nenhum plano arquivado" : "Nenhum plano no catálogo deste produto"}</div>
          ) : (
            <div className="tbl-x"><div style={{ minWidth: 980 }}>
              <div className="plans-head" style={{ gridTemplateColumns: PLANS_GRID }}>
                {["Plano", "Preço de tabela", "Limites e recursos", "Assinantes", "MRR", "Recebido", ""].map((h, i) => <span key={i}>{h}</span>)}
              </div>
              {products.filter((prod) => prod.rows.length && (productFilter === "all" || productFilter === prod.id)).map((prod) => (
                <React.Fragment key={prod.id}>
                <div className="plans-product">
                  <h2>{prod.label}</h2>
                  <span>{plural(prod.rows.length, "plano", "planos")} · {plural(prod.active, "assinante", "assinantes")} · {money(prod.mrr)} de MRR</span>
                </div>
                  {prod.rows.map((p) => {
                    const st = statOf(p.code), price = priceText(p), mods = featuresIncluded(p.features);
                    return (
                      <div className="plans-row" role="button" tabIndex={0} aria-label={`Abrir ${p.name}`} style={{ gridTemplateColumns: PLANS_GRID }} key={p.id}
                        onClick={() => setOpen(p.code)} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) setOpen(p.code); }}>
                        <span><strong>{p.name}</strong><small><i className="mono">{p.code}</i> · {KIND_LABEL[p.kind] || p.kind}</small></span>
                        <span><b>{price.main}</b><small>{price.sub}</small></span>
                        <span title={[limitsSummary(p.limits), mods.join(" · ")].filter(Boolean).join("\n")}>{limitsSummary(p.limits) || "—"}{mods.length > 0 && <small>{plural(mods.length, "recurso", "recursos")}</small>}</span>
                        <span><b>{st.active}</b><small>{st.churned ? plural(st.churned, "saiu", "saíram") : st.active ? "nenhuma saída" : "sem assinantes"}</small></span>
                        <span><b>{money(st.mrr)}</b><small>{money(st.arr)}/ano</small></span>
                        <span><b>{money(st.received)}</b><small>preço v{p.priceVersion || 1}</small></span>
                        <div className="plans-actions" onClick={(e) => e.stopPropagation()}>
                          <button disabled={!!busy} onClick={() => setEditing(p)}>{busy === p.id ? "Salvando…" : "Editar"}</button>
                          <MoreMenu size={22} items={[
                            p.status === "archived" ? { label: "Reativar plano", onClick: () => setStatus(p, "active") } : { label: "Arquivar plano", onClick: () => setStatus(p, "archived") },
                            { label: "Excluir plano", tone: "neg", onClick: () => remove(p) },
                          ]} />
                        </div>
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
              {productFilter !== "all" && !products.find((x) => x.id === productFilter)?.rows.length && <div className="plans-empty">Nenhum plano deste produto {view === "archived" ? "arquivado" : "ativo"}</div>}
            </div></div>
          )}
        </section>
      </>}

      {openPlan && <PlanDrawer plan={openPlan} stat={statOf(openPlan.code)} onClose={() => setOpen(null)} onEdit={() => setEditing(openPlan)} />}
      {open && !openPlan && stats?.[open] && (
        <BucketDrawer title={open === "custom" ? "Vendas personalizadas" : "Clientes sem plano"} stat={stats[open]} onClose={() => setOpen(null)}
          hint={open === "custom" ? "Fecharam fora do catálogo. Para o acesso e os limites seguirem um plano, escolha o plano na edição do cliente." : "Cadastro sem plano informado. Escolha o plano na edição do cliente."} />
      )}
      {/* No body, como a ficha: aberto a partir dela, o formulário fica por cima. */}
      {editing && createPortal(
        <PlanModal plan={editing} saas={saas} defaultProduct={productFilter === "all" ? "leverads" : productFilter}
          onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await changed(); }} />, document.body)}
    </div>
  );
}

const Fact = ({ label, children }) => <div className="plans-fact"><span>{label}</span><strong>{children}</strong></div>;

function Subscribers({ rows }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 8);
  if (!rows.length) return <p className="plans-muted">Nenhum cliente neste plano.</p>;
  return <>
    {shown.map((c) => (
      <div className="plans-sub" key={c.id} data-ended={c.endedAt ? "1" : undefined}>
        <span><strong>{c.name}</strong><small>{[CLOSED_LABEL[c.cycle] || c.cycle, c.endedAt ? `saiu em ${day(c.endedAt)}` : c.startedAt ? `desde ${day(c.startedAt)}` : ""].filter(Boolean).join(" · ")}</small></span>
        <span><b>{money(c.arr)}/ano</b><small>{money(c.received)} recebidos</small></span>
      </div>
    ))}
    {rows.length > 8 && <button className="plans-more" onClick={() => setAll(!all)}>{all ? "mostrar menos" : `+${rows.length - 8} clientes`}</button>}
  </>;
}

function PlanDrawer({ plan, stat, onClose, onEdit }) {
  const price = priceText(plan);
  const limits = PLAN_LIMITS.filter((l) => l.key in (plan.limits || {}));
  const modules = PLAN_FEATURES.filter((f) => typeof plan.features?.[f.key] === "boolean");
  const deliverables = [...(plan.deliverables?.motor || []), ...(plan.deliverables?.plataforma || [])];
  const log = [...(plan.priceLog || [])].reverse();
  // Quanto os assinantes pagam por ano, em média, contra a tabela anual de hoje.
  const avg = stat.active ? stat.arr / stat.active : 0;
  const table = plan.prices?.annual?.total;
  return createPortal(
    <Drawer onClose={onClose} label={`Plano · ${plan.name}`} largura={460}>
      <div className="plans-drawer">
        <header>
          <div>
            <div className="kicker accent">{KIND_LABEL[plan.kind] || "Plano"}{plan.status === "archived" ? " · arquivado" : ""}</div>
            <h2>{plan.name}</h2>
            <p>{PLAN_PRODUCTS.find((x) => x.id === planProductOf(plan))?.label} · <span className="mono">{plan.code}</span> · preço v{plan.priceVersion || 1}</p>
          </div>
          <button aria-label="Fechar plano" onClick={onClose}>✕</button>
        </header>
        <div className="plans-drawer-body">
          <section>
            <div className="kicker">Quanto rende</div>
            <Fact label="Assinantes ativos">{stat.active}{stat.churned ? ` · ${plural(stat.churned, "saiu", "saíram")}` : ""}</Fact>
            <Fact label="MRR">{money(stat.mrr)}</Fact>
            <Fact label="Contratado por ano">{money(stat.arr)}</Fact>
            <Fact label="Já recebido">{money(stat.received)}</Fact>
            {stat.active > 0 && table > 0 && <Fact label="Média por cliente">{money(avg)}/ano · tabela {money(table)}</Fact>}
          </section>
          <section>
            <div className="kicker">Preço de tabela</div>
            {plan.kind === "subscription" && plan.pricing !== "custom"
              ? ["annual", "semiannual"].filter((c) => plan.prices?.[c]).map((c) => <Fact key={c} label={CYCLE_TITLE[c]}>{money(plan.prices[c].per)}/mês · {money(plan.prices[c].total)}</Fact>)
              : (plan.options || []).length
                ? plan.options.map((o, i) => <Fact key={i} label={`${window.fmt.int(o.qty)} ${plan.labels?.optionUnit || ""}`}>{money(o.price)}</Fact>)
                : <Fact label="Preço">{price.main}</Fact>}
          </section>
          {(limits.length > 0 || modules.length > 0) && (
            <section>
              <div className="kicker">Limites e recursos</div>
              {limits.map((l) => <Fact key={l.key} label={l.label}>{plan.limits[l.key] == null ? "ilimitado" : window.fmt.int(plan.limits[l.key])}</Fact>)}
              {modules.length > 0 && (
                <div className="plans-modules">
                  {modules.map((f) => <span key={f.key} data-on={plan.features[f.key] ? "1" : undefined}><i aria-hidden="true" />{f.label}{plan.features[f.key] ? "" : " (fora do plano)"}</span>)}
                </div>
              )}
            </section>
          )}
          {deliverables.length > 0 && (
            <section>
              <div className="kicker">Entregáveis na apresentação</div>
              <ul className="plans-list">{deliverables.map((d, i) => <li key={i}>{d}</li>)}</ul>
            </section>
          )}
          <section>
            <div className="kicker">Assinantes</div>
            <Subscribers rows={stat.customers} />
          </section>
          {log.length > 0 && (
            <section>
              <div className="kicker">Histórico de preço e limites</div>
              {log.map((e) => (
                <div className="plans-sub" key={e.v}>
                  <span><strong>versão {e.v}</strong><small>{day(e.at)}{e.by && e.by !== "migration" ? ` · ${e.by}` : ""}</small></span>
                  <span><b>{e.prices?.annual ? `${money(e.prices.annual.per)}/mês` : e.prices?.once ? money(e.prices.once.total) : "—"}</b><small>{limitsSummary(e.limits)}</small></span>
                </div>
              ))}
            </section>
          )}
        </div>
        <footer><button onClick={onEdit}>Editar plano</button></footer>
      </div>
    </Drawer>, document.body);
}

function BucketDrawer({ title, hint, stat, onClose }) {
  return createPortal(
    <Drawer onClose={onClose} label={title} largura={460}>
      <div className="plans-drawer">
        <header>
          <div><div className="kicker">Fora do catálogo</div><h2>{title}</h2><p>{hint}</p></div>
          <button aria-label="Fechar lista" onClick={onClose}>✕</button>
        </header>
        <div className="plans-drawer-body">
          <section>
            <Fact label="Clientes ativos">{stat.active}</Fact>
            <Fact label="MRR">{money(stat.mrr)}</Fact>
          </section>
          <section><div className="kicker">Clientes</div><Subscribers rows={stat.customers} /></section>
        </div>
        <footer><button onClick={() => { onClose(); window.location.hash = "customers"; }}>Abrir Clientes</button></footer>
      </div>
    </Drawer>, document.body);
}
