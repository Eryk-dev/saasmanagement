import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { EmptyState, PrimaryButton, useEsc } from "../atoms.jsx";

const { useState } = React;

// "Conectar" das telas Publicidade e Redes sociais — produto sem conta de
// anúncio (kind="ads" → product.metaAdAccount) ou sem página/Instagram
// (kind="social" → product.metaPageId/metaIgUser) ganha este cartão: lista o
// que o META_ACCESS_TOKEN alcança no Business Manager e grava a escolha no
// cadastro do produto. Vale pra qualquer produto do portfólio (UniqueKids,
// Elo e os futuros); sem token, o cartão explica o passo do servidor.
export function MetaConnectCard({ kind, product, metaOn, onConnected }) {
  const { refresh } = useData();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null); // null = consultando a Meta
  const [error, setError] = useState("");
  const [sel, setSel] = useState("");
  const [saving, setSaving] = useState(false);
  useEsc(open && !saving ? () => setOpen(false) : null);

  const ads = kind === "ads";
  const title = ads ? "Conta de anúncio não conectada" : "Instagram e página não conectados";
  const hint = metaOn
    ? (ads
      ? `Escolha qual conta de anúncio do Business Manager alimenta a Publicidade de ${product?.name || "este produto"}.`
      : `Escolha qual página (com o Instagram vinculado) alimenta as Redes sociais de ${product?.name || "este produto"}.`)
    : "Antes, defina META_ACCESS_TOKEN no servidor (token do Business Manager, com as permissões de anúncios e Instagram/página). Depois volte aqui pra escolher a conta.";

  async function openPicker() {
    setOpen(true); setError(""); setItems(null); setSel("");
    try {
      const r = ads ? await api.metaAdAccounts() : await api.socialPages();
      setItems((ads ? r.accounts : r.pages) || []);
    } catch (e) {
      setError(e.message || "não deu pra consultar a Meta");
      setItems([]);
    }
  }

  async function save() {
    const key = ads ? "id" : "pageId";
    const item = (items || []).find((x) => String(x[key]) === sel);
    if (!item) return;
    setSaving(true); setError("");
    try {
      const patch = ads
        ? { metaAdAccount: item.id }
        : { metaPageId: item.pageId, metaIgUser: item.igUserId || "" };
      await api.update("products", product.id, patch);
      await refresh(); // SEED novo → a tela relê o produto já conectado
      setOpen(false);
      onConnected?.();
    } catch (e) {
      setError(e.message || "não salvou");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={{ background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)" }}>
      <EmptyState title={title} hint={hint}
        action={metaOn ? <PrimaryButton onClick={openPicker}>Conectar</PrimaryButton> : null} />

      {open && (
        <div onClick={() => !saving && setOpen(false)}
          style={{ position: "fixed", inset: 0, background: "oklch(0 0 0 / 0.4)", zIndex: 120, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: 460, maxWidth: "100%", maxHeight: "80vh", overflow: "auto", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-pop)", padding: "20px 22px" }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{ads ? "Escolha a conta de anúncio" : "Escolha a página"}</div>
            <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
              {ads ? "Contas que o token do Business Manager alcança." : "Páginas que o token administra — o Instagram vinculado vem junto."}
            </div>

            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
              {items == null && <div className="mono dim" style={{ fontSize: 12 }}>consultando a Meta…</div>}
              {items != null && items.length === 0 && !error && (
                <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                  {ads ? "Nenhuma conta de anúncio visível pra esse token." : "Nenhuma página visível pra esse token."}{" "}
                  Confira as permissões do token no Business Manager.
                </div>
              )}
              {(items || []).map((it) => {
                const value = ads ? String(it.id) : String(it.pageId);
                const on = sel === value;
                return (
                  <button key={value} onClick={() => setSel(value)} style={{
                    display: "flex", alignItems: "center", gap: 10, textAlign: "left", padding: "9px 12px",
                    borderRadius: "var(--r-2)", border: "1px solid " + (on ? "var(--accent-line)" : "var(--line-1)"),
                    background: on ? "var(--accent-soft)" : "var(--bg-inset)",
                  }}>
                    <span style={{ width: 8, height: 8, borderRadius: 99, flexShrink: 0, background: on ? "var(--accent)" : "var(--line-2)" }} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
                      <span className="mono dim" style={{ display: "block", fontSize: 10.5, marginTop: 1 }}>
                        {ads
                          ? `act_${it.id}${it.business ? ` · ${it.business}` : ""}${it.active === false ? " · inativa" : ""}`
                          : (it.igUsername ? `@${it.igUsername}` : "sem Instagram vinculado")}
                      </span>
                    </span>
                  </button>
                );
              })}
              {error && <div className="mono" style={{ fontSize: 11.5, color: "var(--neg)" }}>{error}</div>}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button onClick={() => setOpen(false)} disabled={saving}
                style={{ height: 32, padding: "0 12px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 13 }}>
                Cancelar
              </button>
              <PrimaryButton onClick={save} disabled={!sel || saving}>{saving ? "Conectando…" : "Conectar"}</PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
