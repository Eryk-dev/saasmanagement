import React from "react";
import { PageHead } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useActiveSaas } from "../lib/workspace.js";

// Links de pagamento — pega rápido o link de cada oferta (anual / semestral /
// serviço único) pra mandar pro cliente depois de fechar. Copiar, abrir e
// enviar no WhatsApp; os links são editáveis e salvos pro time todo.

const { useState: useS, useEffect: useE, useRef: useR } = React;

// Mensagem pronta pra mandar o link no WhatsApp (o closer escolhe o contato).
function waShare(offer, brand) {
  const msg = `Oi! Segue o link pra fechar a *${offer.label}*${brand ? ` da ${brand}` : ""}:\n${offer.link}`;
  return `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
}

function OffersScreen() {
  const [product] = useActiveSaas();
  const [items, setItems] = useS(null);
  const [orig, setOrig] = useS(null);
  const [err, setErr] = useS(null);
  const [saving, setSaving] = useS(false);
  const [note, setNote] = useS(null);
  const [copied, setCopied] = useS("");
  const copyTimer = useR(null);

  useE(() => {
    if (!product?.id) return;
    let alive = true;
    setItems(null); setErr(null); setNote(null);
    api.offers(product.id)
      .then((r) => { if (alive) { setItems(r.items || []); setOrig(JSON.stringify(r.items || [])); } })
      .catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [product?.id]);

  const dirty = items && JSON.stringify(items) !== orig;

  function patch(i, field, value) {
    setItems((prev) => prev.map((it, j) => (j === i ? { ...it, [field]: value } : it)));
  }
  function addOffer() {
    setItems((prev) => [...(prev || []), { key: `oferta_${(prev?.length || 0) + 1}`, label: "Nova oferta", price: "", link: "" }]);
  }
  function removeOffer(i) {
    setItems((prev) => prev.filter((_, j) => j !== i));
  }
  async function save() {
    setSaving(true); setNote(null);
    try {
      const r = await api.saveOffers(product.id, items);
      setItems(r.items); setOrig(JSON.stringify(r.items));
      setNote({ ok: true, text: "links salvos pro time" });
    } catch (e) {
      setNote({ ok: false, text: e.message });
    }
    setSaving(false);
  }
  function reset() { if (orig) setItems(JSON.parse(orig)); }

  async function copy(link, key) {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = link; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
    setCopied(key);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(""), 1600);
  }

  const kicker = { fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" };
  const inp = { width: "100%", height: 30, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 13 };
  const btn = { height: 30, padding: "0 12px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg-2)", fontSize: 12, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead title="Link pagamento" sub="links de pagamento das ofertas · copie e envie pro cliente">
        {dirty && (
          <>
            <button onClick={reset} disabled={saving} className="mono dim" style={{ fontSize: 11.5 }}>descartar</button>
            <button onClick={save} disabled={saving}
              style={{ height: 26, padding: "0 12px", borderRadius: "var(--r-2)", background: "var(--accent)", color: "var(--accent-fg)", fontSize: 12, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
              {saving ? "salvando…" : "salvar links"}
            </button>
          </>
        )}
      </PageHead>

      <div style={{ flex: 1, overflow: "auto", padding: "14px var(--pad-x)", display: "flex", flexDirection: "column", gap: 14 }}>
        {err && <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>{err}</div>}
        {note && <div className="mono" style={{ fontSize: 12, color: note.ok ? "var(--pos)" : "var(--neg)" }}>{note.text}</div>}
        {!items && !err && <div className="mono dim" style={{ fontSize: 12 }}>carregando ofertas…</div>}

        {items && items.length === 0 && (
          <EmptyState title="Nenhuma oferta ainda" hint="Adicione a primeira oferta com o link de pagamento." />
        )}

        {items && items.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12 }}>
            {items.map((o, i) => {
              const hasLink = /^https?:\/\//i.test(o.link || "");
              return (
                <div key={i} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <input value={o.label} onChange={(e) => patch(i, "label", e.target.value)}
                        placeholder="Nome da oferta"
                        style={{ ...inp, height: 28, border: "1px solid transparent", background: "transparent", padding: "0 2px", fontSize: 15, fontWeight: 700, fontFamily: "var(--display)" }} />
                      <input value={o.price} onChange={(e) => patch(i, "price", e.target.value)}
                        placeholder="preço (ex.: 12x 599 · 7.188 no ano)"
                        className="mono" style={{ ...inp, height: 24, border: "1px solid transparent", background: "transparent", padding: "0 2px", fontSize: 11.5, color: "var(--accent)" }} />
                    </div>
                    <button onClick={() => removeOffer(i)} title="Remover oferta" className="mono dim" style={{ fontSize: 13, flexShrink: 0, padding: 2 }}>✕</button>
                  </div>

                  <div>
                    <span className="mono" style={{ ...kicker, display: "block", marginBottom: 4 }}>Link de pagamento</span>
                    <input value={o.link} onChange={(e) => patch(i, "link", e.target.value)}
                      placeholder="https://mpago.la/…"
                      className="mono" style={{ ...inp, fontSize: 12 }} />
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={() => copy(o.link, o.key || i)} disabled={!hasLink}
                      style={{ ...btn, background: copied === (o.key || i) ? "var(--pos-soft)" : "var(--accent)", color: copied === (o.key || i) ? "var(--pos)" : "var(--accent-fg)", border: "1px solid transparent", fontWeight: 600, opacity: hasLink ? 1 : 0.5 }}>
                      {copied === (o.key || i) ? "✓ copiado" : "⧉ copiar"}
                    </button>
                    <a href={hasLink ? o.link : undefined} target="_blank" rel="noopener noreferrer"
                      style={{ ...btn, textDecoration: "none", opacity: hasLink ? 1 : 0.4, pointerEvents: hasLink ? "auto" : "none" }}>↗ abrir</a>
                    <a href={hasLink ? waShare(o, product?.name) : undefined} target="_blank" rel="noopener noreferrer"
                      style={{ ...btn, textDecoration: "none", color: "#128c4b", borderColor: "#25D36655", opacity: hasLink ? 1 : 0.4, pointerEvents: hasLink ? "auto" : "none" }}>WhatsApp ↗</a>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {items && (
          <div>
            <button onClick={addOffer} style={{ ...btn, borderStyle: "dashed" }}>＋ adicionar oferta</button>
          </div>
        )}

        <div className="mono dim" style={{ fontSize: 10.5, lineHeight: 1.5, marginTop: 4 }}>
          os links ficam salvos no servidor: qualquer um do time vê sempre o link atual. "copiar" cola o link; "WhatsApp" abre com a mensagem pronta pra escolher o contato.
        </div>
      </div>
    </div>
  );
}

export { OffersScreen };
