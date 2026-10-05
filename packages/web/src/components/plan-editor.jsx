import React from "react";
import "./plan-editor.css";
import { api } from "../lib/api.js";
import { PrimaryButton, SecondaryButton } from "../atoms.jsx";
import { Modal } from "./overlay.jsx";
import { CYCLE_MONTHS, CYCLE_TITLE } from "../lib/payments.js";
import { Checkbox } from "./form-controls.jsx";
import { PLAN_LIMITS as LIMITS, PLAN_FEATURES, PLAN_PRODUCTS, planProductOf, planAccessOf } from "../../../api/src/shared/plan-resources.js";

// Formulário de PLANO do catálogo (coleção `plans`, v2): criar e editar o que
// se vende, com o produto, o preço de cada ciclo, os limites, os recursos do
// LeverAds e os entregáveis que a apresentação mostra. Usado pela tela Planos
// (screens/plans.jsx). Só admin salva: o servidor recusa o resto.
//
// Toda escolha de poucas opções é um seletor segmentado (`Choice`), no desenho
// da plataforma: nada de <select> nativo, que abre a lista do navegador.
//
// O total do período sai do valor mensal (12× no anual, 6× no semestral): é o
// TOTAL que vira o valor do negócio, então os dois não são digitados separados.

const { useState } = React;

const SELL_CYCLES = ["annual", "semiannual"];
const KIND_LABEL = { subscription: "Assinatura", one_off: "Compra única", legacy: "Catálogo anterior" };
const KINDS = [{ value: "subscription", label: "Assinatura" }, { value: "one_off", label: "Compra única" }];
const PRICINGS = [{ value: "table", label: "Preço de tabela" }, { value: "custom", label: "Sob consulta" }];
const LIMIT_MODES = [{ value: "none", label: "Não se aplica" }, { value: "number", label: "Até" }, { value: "unlimited", label: "Ilimitado" }];
const money = (v) => window.fmt.moneyFull(Number(v) || 0);
const num = (v) => (v === "" || v == null ? "" : Number(v));

// Estado de um limite no formulário: fora do plano, ilimitado ou um número.
const limitMode = (limits, key) => (!(key in (limits || {})) ? "none" : limits[key] == null ? "unlimited" : "number");
const toLines = (items) => (items || []).join("\n");
const fromLines = (text) => String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);

// Seletor segmentado de uma opção (grupo de rádio): o mesmo desenho do
// `Segmented` das telas, com botões que não enviam o formulário.
export function Choice({ label, value, options, onChange, size = "md" }) {
  return (
    <div className="plan-choice" data-size={size} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

const Field = ({ label, hint, children, grow = 1 }) => (
  <label className="plan-field" style={{ flex: grow }}>
    <span className="kicker">{label}</span>
    {children}
    {hint && <small>{hint}</small>}
  </label>
);

const Section = ({ title, sub, children }) => (
  <section className="plan-section">
    <header><h3>{title}</h3>{sub && <p>{sub}</p>}</header>
    {children}
  </section>
);

export function PlanModal({ plan, saas, defaultProduct = "leverads", onClose, onSaved }) {
  const isNew = !plan.id;
  const [f, setF] = useState(() => ({
    code: plan.code || "", name: plan.name || "", kind: plan.kind || "subscription",
    pricing: plan.pricing || "table",
    product: plan.id ? planProductOf(plan) : defaultProduct,
    per: Object.fromEntries(SELL_CYCLES.map((c) => [c, plan.prices?.[c]?.per ?? ""])),
    once: plan.prices?.once?.total ?? "",
    options: (plan.options || []).map((o) => ({ ...o })),
    limits: Object.fromEntries(LIMITS.map((l) => [l.key, { mode: limitMode(plan.limits, l.key), value: plan.limits?.[l.key] ?? "" }])),
    features: Object.fromEntries(PLAN_FEATURES.map((x) => [x.key, plan.features?.[x.key] === true])),
    motor: toLines(plan.deliverables?.motor), plataforma: toLines(plan.deliverables?.plataforma),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setF((cur) => ({ ...cur, ...patch }));
  const dirty = JSON.stringify(f) !== React.useRef(JSON.stringify(f)).current;
  const legacy = f.kind === "legacy";
  const subscription = f.kind === "subscription";
  const priced = f.pricing !== "custom" && !legacy;
  // O produto vendido define em que sistema a assinatura libera acesso.
  const access = planAccessOf(f.product, f.kind);
  const hasModules = subscription && f.pricing !== "custom" && access === "leverads";
  const limitsShown = subscription ? LIMITS.filter((l) => l.product === access) : [];
  const productLabel = PLAN_PRODUCTS.find((x) => x.id === f.product)?.label || "";

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    const prices = {};
    if (priced && subscription) {
      for (const c of SELL_CYCLES) {
        if (f.per[c] === "") continue;
        // Mantém o que o plano já guardava no ciclo; o total é sempre derivado.
        prices[c] = { ...(plan.prices?.[c] || {}), per: Number(f.per[c]), total: Math.round(Number(f.per[c]) * CYCLE_MONTHS[c]) };
      }
    }
    if (priced && !subscription && !f.options.length && f.once !== "") prices.once = { total: Number(f.once) };
    const limits = {};
    for (const l of limitsShown) {
      const cur = f.limits[l.key];
      if (cur.mode === "unlimited") limits[l.key] = null;
      else if (cur.mode === "number" && cur.value !== "") limits[l.key] = Number(cur.value);
    }
    // Recursos (módulos) só valem pra plano que libera o LeverAds; o que o plano
    // já guardava fora desta lista (campos do deck) é preservado.
    const features = { ...(plan.features || {}) };
    for (const x of PLAN_FEATURES) {
      if (hasModules) features[x.key] = !!f.features[x.key]; else delete features[x.key];
    }
    // O agrupamento interno (usado no select do fechamento) segue o produto: o
    // plano que já tinha o dele mantém, a menos que troque de produto.
    const group = !isNew && plan.group ? plan.group : productLabel;
    const body = {
      name: f.name.trim(), pricing: f.pricing, group,
      prices, limits, features,
      ...(subscription ? { deliverables: { ...(plan.deliverables || {}), motor: fromLines(f.motor), plataforma: fromLines(f.plataforma) } } : {}),
      options: priced && !subscription ? f.options.filter((o) => o.qty !== "" && o.price !== "").map((o) => ({ ...o, qty: Number(o.qty), price: Number(o.price) })) : [],
    };
    try {
      if (isNew) await api.create("plans", { ...body, saas, code: f.code.trim(), kind: f.kind, product: f.product, access: { product: access } });
      else await api.update("plans", plan.id, body);
      await onSaved();
    } catch (err) {
      setBusy(false);
      setError(err?.message || "não deu pra salvar o plano");
    }
  }

  const setLimit = (key, patch) => set({ limits: { ...f.limits, [key]: { ...f.limits[key], ...patch } } });
  const setOption = (i, patch) => set({ options: f.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) });

  return (
    <Modal onClose={onClose} fechavel={!busy && !dirty} label={isNew ? "criar plano" : "editar plano"} largura={720} painelStyle={{ padding: 0, borderRadius: 24, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <form onSubmit={submit} className="plan-form">
        <header className="plan-form-head">
          <div>
            <div className="kicker accent">{isNew ? "Novo plano" : KIND_LABEL[f.kind] || "Plano"}</div>
            <h2>{isNew ? "Criar plano" : plan.name}</h2>
            <p>
              {isNew
                ? "O código identifica o plano em todo o sistema e não muda depois."
                : <>código <span className="mono">{plan.code}</span> · versão de preço {plan.priceVersion || 1}. Quem já contratou mantém o preço e os limites da venda.</>}
            </p>
          </div>
          <button type="button" aria-label="Fechar formulário" onClick={onClose} disabled={busy}>✕</button>
        </header>

        <div className="plan-form-body">
          <Section title="Produto e identificação">
            <div className="plan-row">
              {/* O produto se escolhe ao CRIAR e não muda depois: plano de outro
                  produto é outro plano. */}
              <div className="plan-field"><span className="kicker">Produto</span>
                {isNew
                  ? <Choice label="Produto" value={f.product} options={PLAN_PRODUCTS.map((x) => ({ value: x.id, label: x.label }))} onChange={(v) => set({ product: v })} />
                  : <div className="plan-fixed" aria-label="Produto">{productLabel}<small>definido na criação do plano</small></div>}
              </div>
              {isNew && (
                <div className="plan-field"><span className="kicker">Tipo</span>
                  <Choice label="Tipo" value={f.kind} options={KINDS} onChange={(v) => set({ kind: v })} />
                </div>
              )}
            </div>
            <div className="plan-row">
              <Field label="Nome" grow={2}>
                <input className="inp" required value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ads Escala" />
              </Field>
              {isNew && (
                <Field label="Código" hint="letras, números e _">
                  <input className="inp mono" required pattern="[a-zA-Z0-9_]+" title="só letras, números e _" value={f.code} onChange={(e) => set({ code: e.target.value })} placeholder="ads_escala" />
                </Field>
              )}
            </div>
          </Section>

          {!legacy && (
            <Section title="Preço" sub={subscription ? "O valor mensal de cada ciclo; o total do período é calculado." : "Pagamento único."}>
              <Choice label="Preço" value={f.pricing} options={PRICINGS} onChange={(v) => set({ pricing: v })} />
              {priced && subscription && (
                <div className="plan-row">
                  {SELL_CYCLES.map((c) => (
                    <Field key={c} label={`${CYCLE_TITLE[c]} · R$ por mês (${CYCLE_MONTHS[c]}×)`}
                      hint={f.per[c] === "" ? "não vende neste ciclo" : `${money(Math.round(Number(f.per[c]) * CYCLE_MONTHS[c]))} no período`}>
                      <input className="inp" type="number" min="0" step="any" value={f.per[c]} onChange={(e) => set({ per: { ...f.per, [c]: num(e.target.value) } })} />
                    </Field>
                  ))}
                </div>
              )}
              {priced && !subscription && (f.options.length ? (
                <div className="plan-options">
                  <span className="kicker">Opções (quantidade e preço)</span>
                  {f.options.map((o, i) => (
                    <div key={i}>
                      <input className="inp" type="number" min="0" aria-label="quantidade" value={o.qty ?? ""} onChange={(e) => setOption(i, { qty: num(e.target.value) })} />
                      <span>{plan.labels?.optionUnit || "unidades"} por R$</span>
                      <input className="inp" type="number" min="0" step="any" aria-label="preço" value={o.price ?? ""} onChange={(e) => setOption(i, { price: num(e.target.value) })} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="plan-row"><Field label="Preço único (R$)"><input className="inp" type="number" min="0" step="any" value={f.once} onChange={(e) => set({ once: num(e.target.value) })} style={{ maxWidth: 220 }} /></Field></div>
              ))}
              {!priced && <p className="plan-note">Sem preço de tabela: o valor é negociado e informado no fechamento.</p>}
            </Section>
          )}

          {limitsShown.length > 0 && (
            <Section title="Limites" sub={`O que o plano dá no ${productLabel}.`}>
              {limitsShown.map((l) => (
                <div className="plan-limit" key={l.key}>
                  <span>{l.label}{l.hint ? <small>{l.hint}</small> : null}</span>
                  <Choice size="sm" label={l.label} value={f.limits[l.key].mode} options={LIMIT_MODES} onChange={(v) => setLimit(l.key, { mode: v })} />
                  {f.limits[l.key].mode === "number" && (
                    <input className="inp" type="number" min="0" aria-label={`${l.label}: quantidade`} required value={f.limits[l.key].value}
                      onChange={(e) => setLimit(l.key, { value: num(e.target.value) })} />
                  )}
                </div>
              ))}
            </Section>
          )}

          {hasModules && (
            <Section title="Recursos incluídos" sub="Módulos do LeverAds que o plano liga.">
              <div className="plan-modules-grid">
                {PLAN_FEATURES.map((x) => (
                  <Checkbox key={x.key} checked={!!f.features[x.key]} onChange={(v) => set({ features: { ...f.features, [x.key]: v } })}>
                    <span style={{ fontSize: 12.5 }}>{x.label}</span>
                  </Checkbox>
                ))}
              </div>
            </Section>
          )}

          {subscription && priced && (
            <Section title="Entregáveis na apresentação" sub="Um por linha. É o que aparece no slide de investimento.">
              <div className="plan-row">
                <Field label="Motor">
                  <textarea className="inp" aria-label="Entregáveis: motor" rows={4} value={f.motor} onChange={(e) => set({ motor: e.target.value })} />
                </Field>
                <Field label="Plataforma">
                  <textarea className="inp" aria-label="Entregáveis: plataforma" rows={4} value={f.plataforma} onChange={(e) => set({ plataforma: e.target.value })} />
                </Field>
              </div>
            </Section>
          )}
        </div>

        <footer className="plan-form-foot">
          {error && <div role="alert">{error}</div>}
          <SecondaryButton type="button" onClick={onClose} disabled={busy}>Cancelar</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy}>{busy ? "Salvando…" : isNew ? "Criar plano" : "Salvar plano"}</PrimaryButton>
        </footer>
      </form>
    </Modal>
  );
}
