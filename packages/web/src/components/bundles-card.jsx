// Pacotes (Lever CRM, Fase 2) na tela de Planos: planos de produtos
// diferentes vendidos juntos por um preço só. Na lista, quanto o pacote sai
// contra a tabela e como o preço se divide entre os produtos (é essa parcela
// que vira a assinatura de cada um no Ganho). O admin cria e arquiva aqui; o
// closer aplica no card do Negócio.

import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Modal } from "./overlay.jsx";
import { SelectPopover } from "./select-popover.jsx";
import { toast } from "../atoms.jsx";

const money = (v) => (window.fmt?.moneyFull ? window.fmt.moneyFull(v) : `R$ ${Math.round(v)}`);
const CYCLES = [{ value: "anual", label: "Anual" }, { value: "semestral", label: "Semestral" }];

function BundleForm({ saas, plans, onClose, onSaved }) {
  const options = plans.filter((p) => p.v === 2 && p.status !== "archived" && p.kind === "subscription").map((p) => ({ value: p.code, label: p.name }));
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [items, setItems] = useState([{ product: "", planClosed: "anual" }, { product: "", planClosed: "anual" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (i, patch) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  async function save() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api.createBundle({ saas, name, price: Number(String(price).replace(/\./g, "").replace(",", ".")), items: items.filter((x) => x.product) });
      toast("Pacote criado", "pos");
      onSaved();
    } catch (e) { setError(e.message || "Não foi possível criar o pacote."); } finally { setBusy(false); }
  }
  return <Modal onClose={onClose} fechavel={!busy} label="Novo pacote" painelStyle={{ padding: "20px 22px" }} largura={560} padding={20}>
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 17 }}>Novo pacote</h2>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--fg-3)" }}>Junte planos de produtos diferentes. No Ganho, cada produto vira uma assinatura com a sua parte do preço, dividida pela tabela.</p>
      <div><div className="kicker">Nome</div><input className="inp" style={{ width: "100%", marginTop: 4 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="ex.: Ads + Price anual" /></div>
      <div><div className="kicker">Planos</div>
        {items.map((it, i) => <div key={i} style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <div style={{ flex: 2, minWidth: 0 }}><SelectPopover value={it.product} options={options} onChange={(v) => set(i, { product: v })} label={`Plano ${i + 1}`} placeholder="escolher plano…" /></div>
          <div style={{ flex: 1, minWidth: 0 }}><SelectPopover value={it.planClosed} options={CYCLES} onChange={(v) => set(i, { planClosed: v })} label={`Ciclo do plano ${i + 1}`} /></div>
          {items.length > 2 && <button type="button" aria-label="Tirar plano" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))} style={{ color: "var(--fg-4)" }}>✕</button>}
        </div>)}
        <button type="button" className="customer-peek-link" style={{ marginTop: 6 }} onClick={() => setItems((xs) => [...xs, { product: "", planClosed: "anual" }])}>+ plano</button>
      </div>
      <div><div className="kicker">Preço do pacote (total do ciclo)</div><input className="inp" style={{ width: 200, marginTop: 4 }} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="15.000,00" /></div>
      {error && <p role="alert" style={{ margin: 0, color: "var(--neg)", fontSize: 12.5 }}>{error}</p>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" style={{ padding: "8px 14px", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", fontSize: 13 }} onClick={onClose} disabled={busy}>Cancelar</button>
        <button type="button" style={{ padding: "8px 14px", background: "var(--btn-bg)", color: "var(--btn-fg)", borderRadius: "var(--r-2)", fontSize: 13, fontWeight: 600 }} onClick={save} disabled={busy}>{busy ? "Criando…" : "Criar pacote"}</button>
      </div>
    </div>
  </Modal>;
}

export function BundlesCard({ saas, plans }) {
  const [rows, setRows] = useState(null);
  const [creating, setCreating] = useState(false);
  const load = () => api.bundles(saas).then((r) => setRows((r && r.bundles) || [])).catch(() => setRows([]));
  useEffect(() => { if (saas) load(); }, [saas]); // eslint-disable-line react-hooks/exhaustive-deps
  const nameOf = (code) => plans.find((p) => p.code === code)?.name || code;
  async function archive(b) {
    if (!window.confirm(`Arquivar o pacote "${b.name}"? Negócios que já usaram continuam como estão.`)) return;
    try { await api.updateBundle(b.id, { status: "archived" }); await load(); } catch (e) { toast(`${e.message || "Não foi possível arquivar"} · tente de novo`, "neg"); }
  }
  const active = (rows || []).filter((b) => b.status === "active");
  return <section className="plans-card" style={{ padding: "18px 20px" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div><div className="kicker accent">Pacotes</div><div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 2 }}>planos de produtos diferentes por um preço só · o closer aplica no card do negócio</div></div>
      <button className="plans-create" style={{ marginLeft: "auto" }} onClick={() => setCreating(true)}>Criar pacote</button>
    </div>
    {rows === null && <p className="mono dim" style={{ fontSize: 12 }}>carregando…</p>}
    {rows && !active.length && <p style={{ fontSize: 12.5, color: "var(--fg-4)", margin: "12px 0 0" }}>Nenhum pacote ainda.</p>}
    {active.map((b) => <div key={b.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 0", borderTop: "1px solid var(--line-1)", marginTop: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>{b.name}</div>
        <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 2 }}>{b.dealItems.map((i) => `${nameOf(i.product)} ${i.planClosed} · ${money(i.amount)}`).join(" + ")}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div className="tnum" style={{ fontWeight: 700 }}>{money(b.price)}</div>
        {b.listTotal > b.price && <div className="tnum" style={{ fontSize: 11.5, color: "var(--pos)" }}>{Math.round((1 - b.price / b.listTotal) * 100)}% abaixo da tabela ({money(b.listTotal)})</div>}
      </div>
      <button type="button" className="customer-peek-link" style={{ color: "var(--fg-3)" }} onClick={() => archive(b)}>arquivar</button>
    </div>)}
    {creating && <BundleForm saas={saas} plans={plans} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
  </section>;
}
