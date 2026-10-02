import React from "react";
import { api } from "../lib/api.js";
import { displayName } from "../lib/users.js";
import { CYCLE_TITLE, plansOf } from "../lib/payments.js";
import { PrimaryButton, SecondaryButton } from "../atoms.jsx";
import { SelectPopover } from "./select-popover.jsx";
import { Choice } from "./plan-editor.jsx";
import { limitsSummary, featuresIncluded, PLAN_PRODUCTS, ORG_FIELD_LABEL as FIELD_LABEL } from "../../../api/src/plan-resources.js";

// Plano do cliente na ficha: o que foi contratado (plano do catálogo, preço de
// tabela e limites do dia da venda), o que isso dá de acesso em cada produto e
// o histórico das mudanças (painel, só leitura), e o formulário do contrato de
// "Gerenciar cobranças". O catálogo em si é a tela Planos.

const { useState, useEffect } = React;

const BOX = { border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: "12px 14px", background: "var(--bg-inset)" };
const CLOSED_LABEL = { anual: "Anual", semestral: "Semestral", mensal: "Mensal", unico: "Serviço único" };
const cycleLabel = (c) => CLOSED_LABEL[c] || CYCLE_TITLE[c] || c || "";
const PRODUCT_LABEL = { leverads: "LeverAds", leverprice: "Lever Price" };
const TYPE_LABEL = {
  start: "Contratou", deal_edit: "Fechamento reeditado", upgrade: "Upgrade", downgrade: "Downgrade",
  cycle_change: "Troca de ciclo", scheduled: "Mudança agendada", applied: "Mudança aplicada",
  upsell: "Upsell", paused: "Assinatura pausada", canceled: "Assinatura cancelada",
  churn: "Churn", reactivation: "Churn desfeito", manual_edit: "Plano editado", backfill: "Plano registrado",
};
const day = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "");
const money = (v) => window.fmt.moneyFull(Number(v) || 0);
const val = (v) => (v === null ? "sem limite" : v === true ? "ligado" : v === false ? "desligado" : String(v));

// "Ads Escala · Anual → Ads Essencial · Anual" ou só o destino.
function changeText(e) {
  const name = (s) => (s ? [s.planName || s.planCode, s.planName ? "" : cycleLabel(s.cycle)].filter(Boolean).join(" · ") : "");
  const from = name(e.from), to = name(e.to);
  const price = e.to?.price != null && e.from?.price != null && e.to.price !== e.from.price ? ` · ${money(e.from.price)} → ${money(e.to.price)}` : "";
  if (e.type === "upsell") return [e.note, e.amount ? money(e.amount) : ""].filter(Boolean).join(" · ");
  if (e.type === "churn" || e.type === "reactivation") return e.note || to;
  if (from && to && from !== to) return `${from} → ${to}${price}`;
  return (to || from || "sem plano") + price;
}

const Row = ({ label, children }) => (
  <div style={{ display: "flex", gap: 10, fontSize: 12.5, padding: "3px 0" }}>
    <span style={{ width: 118, flexShrink: 0, color: "var(--fg-3)" }}>{label}</span>
    <span style={{ minWidth: 0, color: "var(--fg-1)", overflowWrap: "anywhere" }}>{children}</span>
  </div>
);

export function CustomerPlanPanel({ customer, subs = [] }) {
  const [data, setData] = useState(null); // { history, access }
  const [error, setError] = useState(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null); setError(null);
    Promise.all([api.planHistory(customer.id), api.customerEntitlements(customer.id).catch(() => null)])
      .then(([history, access]) => { if (alive) setData({ history, access }); })
      .catch((err) => { if (alive) setError(err?.message || "não deu pra carregar o histórico de plano"); });
    return () => { alive = false; };
  }, [customer.id, customer.planCode, customer.planCycle, customer.planCustom, customer.endedAt, subs.map((s) => `${s.id}:${s.planCode}:${s.status}`).join("|")]);

  // Um retrato por produto: o de cada assinatura viva com plano; sem nenhuma,
  // o do cadastro do cliente.
  const planned = subs.filter((s) => s.status !== "canceled" && s.planSnapshot);
  const snaps = planned.length ? planned.map((s) => ({ key: s.id, snap: s.planSnapshot, label: [s.planSnapshot.name, CYCLE_TITLE[s.cycle] || s.cycle].filter(Boolean).join(" · ") }))
    : [{ key: "cliente", snap: customer.planSnapshot, label: customer.plan || "sem plano" }];
  const history = data?.history || [];
  const shown = all ? history : history.slice(0, 5);
  const report = data?.access?.lastReport;

  return (
    <div style={BOX}>
      <div className="kicker" style={{ marginBottom: 8 }}>{snaps.length > 1 ? "Planos contratados" : "Plano contratado"}</div>
      {snaps.map(({ key, snap, label }, i) => (
        <div key={key} style={i ? { marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--line-1)" } : undefined}>
      <Row label="Plano">
        {label}
        {!planned.length && !customer.planCode && customer.planCustom ? <span style={{ color: "var(--fg-3)" }}> · fora do catálogo</span> : null}
      </Row>
      {snap && <Row label="Preço de tabela">{snap.listPrice == null ? "não registrado (cliente anterior ao catálogo)" : `${money(snap.listPrice)} · tabela v${snap.priceVersion}`}</Row>}
      {snap && <Row label="Limites">{limitsSummary(snap.limits) || "sem limite definido no plano"}</Row>}
      {snap?.features && featuresIncluded(snap.features).length > 0 && <Row label="Recursos">{featuresIncluded(snap.features).join(" · ")}</Row>}
      {!snap && <Row label="Limites">acertados à mão (sem plano do catálogo)</Row>}
        </div>
      ))}

      <div className="kicker" style={{ margin: "12px 0 6px" }}>Acesso e limites nos produtos</div>
      {!data && !error && <div className="mono dim" style={{ fontSize: 12 }}>carregando…</div>}
      {data && !data.access && <div style={{ fontSize: 12.5, color: "var(--fg-3)" }}>Sem leitura do acesso deste cliente.</div>}
      {data?.access && data.access.entitlements === null && <div style={{ fontSize: 12.5, color: "var(--fg-3)" }}>Sem assinatura: o acesso deste cliente não é controlado pelo Cockpit.</div>}
      {data?.access && Array.isArray(data.access.entitlements) && !data.access.entitlements.length && <div style={{ fontSize: 12.5, color: "var(--fg-3)" }}>O plano contratado não libera acesso a produto.</div>}
      {(data?.access?.entitlements || []).map((ent) => {
        const org = data.access.orgs?.[ent.product] || (ent.product === "leverprice" ? data.access.orgs?.leverads : "");
        const planned = (report?.limits?.planned || []).filter((p) => p.product === ent.product);
        const skipped = (report?.limits?.skipped || []).filter((p) => p.product === ent.product);
        return (
          <div key={ent.product} style={{ padding: "4px 0" }}>
            <Row label={PRODUCT_LABEL[ent.product] || ent.product}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 999, background: ent.access.active ? "var(--pos)" : "var(--neg)" }} />
                {ent.access.active ? "acesso liberado" : "acesso cortado"} · {ent.access.reason}
              </span>
            </Row>
            <Row label="Org vinculada">{org || <span style={{ color: "var(--warn)" }}>sem vínculo: o acesso não é sincronizado</span>}</Row>
            {planned.map((p, i) => (
              <Row key={i} label="Fora do plano">
                {Object.entries(p.changes).map(([field, c]) => `${FIELD_LABEL[field] || field}: ${val(c.from)} no produto, plano dá ${val(c.to)}`).join(" · ")}
              </Row>
            ))}
            {skipped.map((s, i) => <Row key={i} label="Limites">{s.reason}</Row>)}
          </div>
        );
      })}
      {report && <div style={{ fontSize: 11, color: "var(--fg-4)", marginTop: 4 }}>última conferência {new Date(report.at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · limites são só relatório, nada é alterado no produto</div>}

      <div className="kicker" style={{ margin: "12px 0 6px" }}>Histórico de plano</div>
      {error && <div role="alert" style={{ fontSize: 12.5, color: "var(--neg)" }}>{error}</div>}
      {data && !history.length && <div style={{ fontSize: 12.5, color: "var(--fg-3)" }}>Nenhuma mudança registrada.</div>}
      {shown.map((e) => (
        <div key={e.id} style={{ display: "flex", gap: 10, fontSize: 12.5, padding: "5px 0", borderTop: "1px solid var(--line-1)" }}>
          <span className="tnum" style={{ width: 118, flexShrink: 0, color: "var(--fg-3)" }}>{day(e.type === "scheduled" ? e.at : e.effectiveAt || e.at)}</span>
          <span style={{ minWidth: 0 }}>
            <span style={{ fontWeight: 600, color: "var(--fg-1)" }}>{TYPE_LABEL[e.type] || e.type}</span>
            <span style={{ display: "block", color: "var(--fg-2)", overflowWrap: "anywhere" }}>{changeText(e)}</span>
            <span style={{ display: "block", fontSize: 11, color: "var(--fg-4)" }}>
              {[e.type === "scheduled" ? `vale em ${day(e.effectiveAt)}` : "", e.author && !["migration", "billing", "api"].includes(e.author) ? displayName(e.author) : ""].filter(Boolean).join(" · ")}
            </span>
          </span>
        </div>
      ))}
      {history.length > 5 && (
        <button type="button" onClick={() => setAll(!all)} style={{ marginTop: 6, fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>
          {all ? "mostrar menos" : `+${history.length - 5} mudanças anteriores`}
        </button>
      )}
    </div>
  );
}

// Produtos contratados (Gerenciar cobranças): UMA assinatura por produto. Um
// cliente pode ter o LeverAds num plano e o LeverPrice em outro; cada linha é a
// assinatura de um produto, com o plano dela. "Mudar plano" troca o plano
// dentro do mesmo produto (upgrade fatura o pró-rata; downgrade vale no fim do
// ciclo). "Adicionar produto" abre a assinatura de um produto que o cliente
// ainda não tem: nasce com a 1ª fatura em aberto e soma no ARR.
const SUB_STATUS = { active: ["ativa", "var(--pos)"], past_due: ["em atraso", "var(--neg)"], paused: ["pausada", "var(--warn)"], canceled: ["cancelada", "var(--fg-4)"] };
const ADD_CYCLES = [{ value: "anual", label: "Anual" }, { value: "semestral", label: "Semestral" }];
const CYCLE_OF = { anual: "annual", semestral: "semiannual" };
const productOf = (plans, s) => s.planSnapshot?.product || plans.find((p) => p.code === s.planCode)?.product || "";

export function CustomerProducts({ customer, subs = [], churned = false, onChangePlan, onAdded }) {
  const plans = plansOf(customer.saas);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ plan: "", cycle: "anual", price: "", startAt: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const rows = [...subs].sort((a, b) => (a.status === "canceled") - (b.status === "canceled") || String(a.periodStart || "").localeCompare(String(b.periodStart || "")));
  const taken = new Set(subs.filter((s) => s.status !== "canceled").map((s) => productOf(plans, s)).filter(Boolean));
  const label = (id) => PLAN_PRODUCTS.find((x) => x.id === id)?.label || "";
  // Só plano de assinatura, com preço, de produto que o cliente ainda não tem.
  const options = plans.filter((p) => p.kind === "subscription" && p.status !== "archived" && !taken.has(p.product))
    .map((p) => ({ value: p.code, label: p.name, hint: label(p.product) }));
  const plan = plans.find((p) => p.code === f.plan) || null;
  const table = plan?.prices?.[CYCLE_OF[f.cycle]]?.total;
  const pick = (patch) => {
    const next = { ...f, ...patch };
    const p = plans.find((x) => x.code === next.plan);
    const t = p?.prices?.[CYCLE_OF[next.cycle]]?.total;
    // Trocar plano ou ciclo sugere o preço de tabela; o valor segue editável.
    if ("plan" in patch || "cycle" in patch) next.price = t != null ? String(t) : "";
    setF(next); setError(null);
  };

  async function submit(e) {
    e.preventDefault();
    if (busy || !f.plan) return;
    setBusy(true); setError(null);
    try {
      const r = await api.addCustomerSubscription(customer.id, {
        plan: f.plan, cycle: f.cycle, ...(f.price === "" ? {} : { price: Number(f.price) }), ...(f.startAt ? { startAt: f.startAt } : {}),
      });
      setAdding(false); setF({ plan: "", cycle: "anual", price: "", startAt: "" });
      await onAdded?.(r);
    } catch (err) { setError(err?.message || "não deu pra adicionar o produto"); }
    finally { setBusy(false); }
  }

  return (
    <div style={BOX} className="plan-form contract-form">
      <div className="kicker" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span>Produtos contratados</span>
        {!churned && options.length > 0 && !adding && (
          <button type="button" className="contract-add" onClick={() => setAdding(true)}>Adicionar produto</button>
        )}
      </div>
      {!rows.length && <div style={{ fontSize: 12.5, color: "var(--fg-4)" }}>Nenhuma assinatura. Adicione um produto para o cliente ter plano, acesso e cobrança recorrente.</div>}
      {rows.map((s) => {
        const [stLabel, stColor] = SUB_STATUS[s.status] || [s.status, "var(--fg-4)"];
        const name = s.planSnapshot?.name || plans.find((p) => p.id === s.plan)?.name || "sem plano do catálogo";
        return (
          <div className="contract-sub" key={s.id} data-off={s.status === "canceled" ? "1" : undefined}>
            <span>
              <strong>{name}</strong>
              <small>{[label(productOf(plans, s)), CYCLE_TITLE[s.cycle] || s.cycle, s.periodEnd ? `ciclo até ${day(s.periodEnd)}` : ""].filter(Boolean).join(" · ")}</small>
            </span>
            <span>
              <b>{money(s.price)}</b>
              <small><i aria-hidden="true" style={{ background: stColor }} />{stLabel}</small>
            </span>
            {s.status !== "canceled" && onChangePlan && <button type="button" onClick={() => onChangePlan(s)}>Mudar plano</button>}
          </div>
        );
      })}
      {adding && (
        <form onSubmit={submit} className="contract-add-form" aria-label="Adicionar produto">
          <div className="plan-row">
            <div className="plan-field" style={{ flex: "1 1 240px" }}><span className="kicker">Plano do novo produto</span>
              <SelectPopover label="Plano do novo produto" value={f.plan} options={options} placeholder="Escolha o plano" onChange={(v) => pick({ plan: v })} style={{ height: 38, borderRadius: 999, padding: "0 14px", fontSize: 13 }} />
            </div>
            <div className="plan-field" style={{ flex: "0 0 auto" }}><span className="kicker">Ciclo</span>
              <Choice label="Ciclo do novo produto" value={f.cycle} options={ADD_CYCLES} onChange={(v) => pick({ cycle: v })} />
            </div>
          </div>
          <div className="plan-row">
            <label className="plan-field"><span className="kicker">Valor do ciclo (R$)</span>
              <input className="inp" type="number" min="0" step="any" required value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
              <small>{plan ? (table != null ? `tabela: ${money(table)}` : "sem preço de tabela neste ciclo: informe o valor") : "o preço de tabela entra ao escolher o plano"}</small>
            </label>
            <label className="plan-field"><span className="kicker">Início</span>
              <input className="inp" type="date" value={f.startAt} onChange={(e) => setF({ ...f, startAt: e.target.value })} />
              <small>em branco = hoje</small>
            </label>
          </div>
          {plan && <div className="contract-plan-summary">
            <Row label="Limites">{limitsSummary(plan.limits) || "sem limite definido"}</Row>
            {featuresIncluded(plan.features).length > 0 && <Row label="Recursos">{featuresIncluded(plan.features).join(" · ")}</Row>}
          </div>}
          <div className="contract-form-foot">
            {error && <span role="alert" data-error="1">{error}</span>}
            <SecondaryButton type="button" onClick={() => { setAdding(false); setError(null); }} disabled={busy}>Cancelar</SecondaryButton>
            <PrimaryButton type="submit" disabled={busy || !f.plan}>{busy ? "Adicionando…" : "Adicionar produto"}</PrimaryButton>
          </div>
          <small style={{ fontSize: 11, color: "var(--fg-4)" }}>A assinatura nasce com a 1ª fatura em aberto: a cobrança é pelas faturas, abaixo.</small>
        </form>
      )}
    </div>
  );
}

// Contrato do cliente, no topo de "Gerenciar cobranças": tudo que é do
// contrato se edita num lugar só. Plano do catálogo e ciclo (ou o nome da venda
// personalizada), status do pagamento, valor anual, cliente desde e a data de
// churn. Salva só o que mudou. Trocar o plano faz o servidor refazer o rótulo,
// guardar o retrato do plano (preço de tabela, limites e recursos de hoje) e
// registrar a troca no histórico; não cria nem altera cobrança.
const EDIT_CYCLES = ["anual", "semestral", "unico"];
const PAY_STATUSES = [{ value: "", label: "Automático" }, { value: "paid", label: "Pago" }, { value: "partial", label: "Parcial" }, { value: "unpaid", label: "Não pago" }];
const dateOnly = (v) => String(v || "").slice(0, 10);

export function CustomerContractForm({ customer, hasSubscription = false, hasLiveSubscription = hasSubscription, onSaved }) {
  // Com assinatura, o plano é o DELA (bloco "Produtos contratados"); o plano no
  // cadastro só se informa à mão pra cliente sem assinatura (compra única).
  const plans = hasLiveSubscription ? [] : plansOf(customer.saas);
  const initial = () => ({
    code: customer.planCode || "", cycle: customer.planCycle || "", custom: customer.planCustom || "",
    paymentStatus: PAY_STATUSES.some((x) => x.value === customer.paymentStatus) ? customer.paymentStatus : "",
    arr: customer.arr ?? "", startedAt: dateOnly(customer.startedAt), endedAt: dateOnly(customer.endedAt),
  });
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (patch) => { setF((cur) => ({ ...cur, ...patch })); setMsg(null); };
  const base = initial();

  // Só o que mudou vai pro servidor.
  const patch = {};
  if (plans.length && (f.code !== base.code || f.cycle !== base.cycle || (!f.code && f.custom.trim() !== base.custom))) {
    Object.assign(patch, { planCode: f.code, planCycle: f.cycle, planCustom: f.code ? "" : f.custom.trim() });
  }
  if (f.paymentStatus !== base.paymentStatus) patch.paymentStatus = f.paymentStatus;
  if (String(f.arr) !== String(base.arr) && f.arr !== "") patch.arr = Number(f.arr);
  if (f.startedAt !== base.startedAt && f.startedAt) patch.startedAt = f.startedAt;
  // Data de churn: aqui só se AJUSTA a data de quem já saiu (ou se registra a
  // saída sem motivo). Desfazer o churn é pelo menu da ficha.
  if (f.endedAt !== base.endedAt && f.endedAt) patch.endedAt = f.endedAt;
  const dirty = Object.keys(patch).length > 0;

  const plan = plans.find((p) => p.code === f.code) || null;
  const productLabel = (p) => PLAN_PRODUCTS.find((x) => x.id === p.product)?.label || "";
  const options = [
    { value: "", label: "Sem plano do catálogo", hint: "venda personalizada" },
    ...plans.filter((p) => (p.status !== "archived" && p.kind !== "legacy") || p.code === customer.planCode)
      .map((p) => ({ value: p.code, label: p.status === "archived" ? `${p.name} (arquivado)` : p.name, hint: productLabel(p) })),
  ];
  const cycles = (EDIT_CYCLES.includes(f.cycle) || !f.cycle ? EDIT_CYCLES : [...EDIT_CYCLES, f.cycle]).map((c) => ({ value: c, label: cycleLabel(c) }));
  const table = plan?.prices?.[{ anual: "annual", semestral: "semiannual" }[f.cycle]]?.total ?? plan?.prices?.once?.total;
  const modules = plan ? featuresIncluded(plan.features) : [];

  async function submit(e) {
    e.preventDefault();
    if (!dirty || busy) return;
    setBusy(true); setMsg(null);
    try {
      const saved = await api.update("customers", customer.id, patch);
      await onSaved?.(saved);
      setMsg({ text: "Contrato atualizado." });
    } catch (err) {
      setMsg({ error: true, text: err?.message || "não deu pra salvar o contrato" });
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="plan-form contract-form" aria-label="Contrato do cliente" style={BOX}>
      <div className="kicker" style={{ marginBottom: 2 }}>Contrato</div>
      {plans.length > 0 && <>
        <div className="plan-row">
          <div className="plan-field" style={{ flex: "1 1 240px" }}><span className="kicker">Plano</span>
            <SelectPopover label="Plano" value={f.code} options={options} onChange={(v) => set({ code: v })} style={{ height: 38, borderRadius: 999, padding: "0 14px", fontSize: 13 }} />
          </div>
          <div className="plan-field" style={{ flex: "0 0 auto" }}><span className="kicker">Ciclo</span>
            <Choice label="Ciclo" value={f.cycle} options={cycles} onChange={(v) => set({ cycle: v })} />
          </div>
        </div>
        {!f.code && (
          <label className="plan-field"><span className="kicker">Nome da venda personalizada</span>
            <input className="inp" value={f.custom} onChange={(e) => set({ custom: e.target.value })} placeholder="ex.: Combo sob medida" maxLength={80} />
            <small>fora do catálogo: o acesso e os limites são acertados à mão</small>
          </label>
        )}
        {/* Só na TROCA: o que o cliente já tem está no painel "Plano contratado" abaixo. */}
        {plan && (f.code !== base.code || f.cycle !== base.cycle) && (
          <div className="contract-plan-summary">
            <div className="kicker" style={{ marginBottom: 4 }}>O que o plano escolhido dá</div>
            <Row label="Preço de tabela">{plan.pricing === "custom" ? "sob consulta" : table != null ? money(table) : "escolha o ciclo"}</Row>
            <Row label="Limites">{limitsSummary(plan.limits) || "sem limite definido"}</Row>
            {modules.length > 0 && <Row label="Recursos">{modules.join(" · ")}</Row>}
          </div>
        )}
      </>}
      <div className="plan-field"><span className="kicker">Status do pagamento</span>
        <Choice label="Status do pagamento" value={f.paymentStatus} options={PAY_STATUSES} onChange={(v) => set({ paymentStatus: v })} />
        <small>automático = o dinheiro registrado no MP e nas faturas decide; marque na mão quando o pagamento entra por fora</small>
      </div>
      <div className="plan-row">
        <label className="plan-field"><span className="kicker">Valor anual (ARR)</span>
          <input className="inp" type="number" min="0" step="any" value={f.arr} onChange={(e) => set({ arr: e.target.value })} />
          <small>{hasSubscription ? "com assinatura ativa é recalculado sozinho pelo preço dela" : `é o valor do ANO: mensalidade × 12 · MRR ${money((Number(f.arr) || 0) / 12)}`}</small>
        </label>
        <label className="plan-field"><span className="kicker">Cliente desde</span>
          <input className="inp" type="date" value={f.startedAt} onChange={(e) => set({ startedAt: e.target.value })} />
          <small>base da linha do tempo de marcos</small>
        </label>
        <label className="plan-field"><span className="kicker">Churn (saída)</span>
          <input className="inp" type="date" value={f.endedAt} onChange={(e) => set({ endedAt: e.target.value })} />
          <small>prefira "Registrar churn" no menu da ficha (grava o motivo e cancela as assinaturas); aqui só ajusta a data</small>
        </label>
      </div>
      <div className="contract-form-foot">
        {msg && <span role={msg.error ? "alert" : "status"} data-error={msg.error ? "1" : undefined}>{msg.text}</span>}
        <PrimaryButton type="submit" disabled={busy || !dirty}>{busy ? "Salvando…" : "Salvar contrato"}</PrimaryButton>
      </div>
    </form>
  );
}
