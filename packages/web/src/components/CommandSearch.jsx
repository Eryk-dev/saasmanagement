import React from "react";
import { Avatar } from "../atoms.jsx";

// Busca de leads (⌘K ou clique no "Buscar…"). Filtra window.SEED.LEADS por
// nome, empresa, telefone e e-mail; ↑↓ navega, Enter abre a ficha do lead,
// Esc fecha. Abre o MESMO drawer de lead do resto do cockpit (onOpenLead).

const { useState, useEffect, useRef, useMemo } = React;

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const digits = (s) => String(s || "").replace(/\D/g, "");

function scoreLead(l, q, qDigits) {
  const name = norm(l.name), company = norm(l.company);
  let best = -1;
  if (name.startsWith(q)) best = Math.max(best, 100);
  else if (name.includes(q)) best = Math.max(best, 70);
  if (company.startsWith(q)) best = Math.max(best, 60);
  else if (company.includes(q)) best = Math.max(best, 45);
  if (norm(l.email).includes(q)) best = Math.max(best, 40);
  if (qDigits && digits(l.phone).includes(qDigits)) best = Math.max(best, 55);
  return best;
}

function CommandSearch({ open, onClose, onOpenLead, activeSaasId }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => { if (open) { setQ(""); setSel(0); setTimeout(() => inputRef.current?.focus(), 20); } }, [open]);

  const saasName = useMemo(() => Object.fromEntries((window.SEED?.SAAS || []).map((s) => [s.id, s.name])), []);

  const results = useMemo(() => {
    const all = (window.SEED?.LEADS || []).filter((l) => !l.internal && l.name);
    const query = norm(q.trim());
    const qDigits = digits(q);
    if (!query && !qDigits) {
      // Sem busca: os do produto ativo, mais recentes primeiro.
      return all
        .filter((l) => !activeSaasId || l.saas === activeSaasId)
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
        .slice(0, 8)
        .map((l) => ({ l, score: 0 }));
    }
    return all
      .map((l) => ({ l, score: scoreLead(l, query, qDigits) }))
      .filter((x) => x.score >= 0)
      // produto ativo ganha um empurrãozinho no empate
      .sort((a, b) => (b.score + (b.l.saas === activeSaasId ? 5 : 0)) - (a.score + (a.l.saas === activeSaasId ? 5 : 0)))
      .slice(0, 12);
  }, [q, activeSaasId]);

  useEffect(() => { setSel((s) => Math.min(s, Math.max(0, results.length - 1))); }, [results.length]);

  if (!open) return null;

  function onKey(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const r = results[sel]; if (r) onOpenLead(r.l); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  }

  const stageOf = (l) => l.stage || "";

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 120, background: "oklch(0 0 0 / 0.4)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "10vh 16px 16px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 100%)", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-pop)", overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "70vh" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--line-1)" }}>
          <span className="mono dim" style={{ fontSize: 13 }}>🔍</span>
          <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} onKeyDown={onKey}
            placeholder="Buscar lead por nome, empresa, telefone ou e-mail…"
            style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: "var(--fg-1)", fontSize: 15 }} />
          <span className="kbd" style={{ fontSize: 10 }}>Esc</span>
        </div>

        <div style={{ overflowY: "auto", padding: 6 }}>
          {results.length === 0 && (
            <div className="mono dim" style={{ padding: "18px 12px", fontSize: 12.5 }}>
              {q.trim() ? `nenhum lead pra "${q.trim()}"` : "digite pra buscar um lead"}
            </div>
          )}
          {results.map((r, i) => {
            const l = r.l;
            const on = i === sel;
            const other = l.saas && l.saas !== activeSaasId;
            return (
              <button key={l.id} onClick={() => onOpenLead(l)} onMouseEnter={() => setSel(i)}
                style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
                  padding: "8px 10px", borderRadius: "var(--r-2)", background: on ? "var(--accent-soft)" : "transparent",
                }}>
                <Avatar id={l.id} name={l.name} size={26} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
                    {l.company && <span className="dim" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.company}</span>}
                  </div>
                  <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-4)", display: "flex", gap: 8, marginTop: 1 }}>
                    {stageOf(l) && <span>{stageOf(l)}</span>}
                    {l.phone && <span>{l.phone}</span>}
                    {other && <span style={{ color: "var(--accent)" }}>{saasName[l.saas] || l.saas}</span>}
                  </div>
                </div>
                {on && <span className="kbd" style={{ fontSize: 10, flexShrink: 0 }}>↵</span>}
              </button>
            );
          })}
        </div>

        <div className="mono dim" style={{ fontSize: 10, padding: "7px 14px", borderTop: "1px solid var(--line-1)", display: "flex", gap: 14 }}>
          <span>↑ ↓ navegar</span><span>↵ abrir</span><span>Esc fechar</span>
        </div>
      </div>
    </div>
  );
}

export { CommandSearch };
