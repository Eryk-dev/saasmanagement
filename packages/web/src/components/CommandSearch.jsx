import React from "react";
import { Avatar } from "../atoms.jsx";
import { NAV, GROUP_LABELS } from "../chrome.jsx";
import { canSeeScreen } from "../lib/users.js";
import { Modal } from "./overlay.jsx";

// Busca ⌘K. Até 13/09 só achava LEAD; com 35 telas no menu, ir pra tela é
// metade do uso (decisão do Leo, 13/09: telas + ações). Agora devolve três
// grupos, nesta ordem: leads e clientes · ir para (telas que a pessoa pode ver,
// respeitando o produto ativo) · ações (o que dá pra fazer com o que foi
// digitado). ↑↓ navega, Enter abre, Esc fecha.

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

function CommandSearch({ open, onClose, onOpenLead, onNav, onNewLead, activeSaasId }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement;
    setQ(""); setSel(0);
    const timer = setTimeout(() => inputRef.current?.focus(), 20);
    return () => { clearTimeout(timer); if (trigger?.isConnected) trigger.focus(); };
  }, [open]);
  useEffect(() => {
    if (open) panelRef.current?.querySelector(`[data-result="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel, open]);

  const saasName = useMemo(() => Object.fromEntries((window.SEED?.SAAS || []).map((s) => [s.id, s.name])), []);

  const results = useMemo(() => {
    const all = (window.SEED?.LEADS || []).filter((l) => !l.internal && l.name);
    const query = norm(q.trim());
    const qDigits = digits(q);
    const leads = (!query && !qDigits
      ? all.filter((l) => !activeSaasId || l.saas === activeSaasId)
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
        .slice(0, 6)
        .map((l) => ({ kind: "lead", l, score: 0 }))
      : all.map((l) => ({ kind: "lead", l, score: scoreLead(l, query, qDigits) }))
        .filter((x) => x.score >= 0)
        .sort((a, b) => (b.score + (b.l.saas === activeSaasId ? 5 : 0)) - (a.score + (a.l.saas === activeSaasId ? 5 : 0)))
        .slice(0, 8));

    // Telas: as MESMAS regras do menu (permissão da pessoa, produto ativo,
    // ocultas de fora) — a busca não pode abrir porta que o menu tranca.
    const telas = !query ? [] : NAV
      .filter((n) => !n.hidden && canSeeScreen(n.id)
        && (!n.saas || n.saas === activeSaasId) && (!n.notSaas || n.notSaas !== activeSaasId))
      .filter((n) => norm(n.label).includes(query) || norm(GROUP_LABELS[n.group] || "").includes(query))
      .sort((a, b) => (norm(a.label).startsWith(query) ? -1 : 0) - (norm(b.label).startsWith(query) ? -1 : 0))
      .slice(0, 6)
      .map((n) => ({ kind: "tela", nav: n }));

    // Ações: o que dá pra FAZER com o texto digitado.
    const acoes = !query ? [] : [{ kind: "acao", id: "novo-lead", label: `Criar lead “${q.trim()}”`, sub: "abre o cadastro com o nome preenchido" }];

    return [...leads, ...telas, ...acoes];
  }, [q, activeSaasId]);

  useEffect(() => { setSel((s) => Math.min(s, Math.max(0, results.length - 1))); }, [results.length]);

  if (!open) return null;

  function onKey(e) {
    if (e.key === "Enter" && e.target !== inputRef.current) return;
    if (e.key === "Tab") {
      const controls = panelRef.current?.querySelectorAll('input, button');
      if (!controls?.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.max(0, Math.min(s + 1, results.length - 1))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); escolher(results[sel]); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  }

  const stageOf = (l) => l.stage || "";
  function escolher(r) {
    if (!r) return;
    if (r.kind === "lead") return onOpenLead(r.l);
    if (r.kind === "tela") { onClose(); return onNav?.(r.nav.id); }
    if (r.kind === "acao") { onClose(); return onNewLead?.(q.trim()); }
  }
  // Cabeçalho de grupo antes do primeiro item de cada tipo.
  const TITULO = { lead: "Leads e clientes", tela: "Ir para", acao: "Ações" };

  return (
    <Modal onClose={onClose} label="Busca global" largura={520}
      style={{ zIndex: "var(--z-command)", background: "var(--scrim-soft)", alignItems: "flex-start", padding: "14vh 16px 16px" }}
      painelStyle={{ border: "1px solid var(--line-2)", borderRadius: "var(--r-4)", overflow: "hidden" }}>
      <div ref={panelRef} onKeyDown={onKey} style={{ display: "flex", flexDirection: "column", maxHeight: "70dvh" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--line-1)" }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m16 16 5 5" /></svg>
          <input ref={inputRef} value={q} aria-label="Buscar lead, cliente ou tela" onChange={(e) => { setQ(e.target.value); setSel(0); }}
            placeholder="Buscar lead, cliente, tela…"
            style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", color: "var(--fg-1)", fontSize: 15 }} />
          <button onClick={onClose} className="kbd" aria-label="Fechar busca" style={{ fontSize: 11, flexShrink: 0 }}>esc</button>
        </div>

        <div style={{ overflowY: "auto", maxHeight: 360, minHeight: 0, padding: "8px 6px" }}>
          {results.length === 0 && (
            <div className="mono dim" style={{ padding: "18px 12px", fontSize: 12.5 }}>
              {q.trim() ? `nada pra "${q.trim()}"` : "digite pra buscar lead, cliente ou tela"}
            </div>
          )}
          {results.map((r, i) => {
            const on = i === sel;
            const primeiroDoGrupo = i === 0 || results[i - 1].kind !== r.kind;
            const linha = (conteudo, chave) => (
              <React.Fragment key={chave}>
                {primeiroDoGrupo && <div className="kicker" style={{ padding: "8px 10px 4px", color: "var(--fg-4)" }}>{TITULO[r.kind]}</div>}
                <button data-result={i} onClick={() => escolher(r)} onMouseEnter={() => setSel(i)}
                  style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
                    padding: "8px 10px", borderRadius: "var(--r-2)", background: on ? "var(--accent-soft)" : "transparent" }}>
                  {conteudo}
                  {on && <span className="kbd" style={{ fontSize: 10, flexShrink: 0 }}>↵</span>}
                </button>
              </React.Fragment>
            );

            if (r.kind === "tela") {
              return linha(
                <>
                  <span style={{ width: 26, textAlign: "center", fontSize: 13, color: "var(--fg-3)" }}>{r.nav.icon || "▸"}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg-1)" }}>{r.nav.label}</div>
                    {GROUP_LABELS[r.nav.group] && <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-4)" }}>{GROUP_LABELS[r.nav.group]}</div>}
                  </div>
                </>, `tela-${r.nav.id}`);
            }
            if (r.kind === "acao") {
              return linha(
                <>
                  <span style={{ width: 26, textAlign: "center", fontSize: 15, color: "var(--accent)" }}>+</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg-1)" }}>{r.label}</div>
                    <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-4)" }}>{r.sub}</div>
                  </div>
                </>, `acao-${r.id}`);
            }
            const l = r.l;
            const other = l.saas && l.saas !== activeSaasId;
            return linha(
              <>
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
              </>, `lead-${l.id}`);
          })}
        </div>

        <div className="mono dim" style={{ fontSize: 10, padding: "7px 14px", borderTop: "1px solid var(--line-1)", display: "flex", gap: 14 }}>
          <span>↑ ↓ navegar</span><span>↵ abrir</span><span>Esc fechar</span>
          <span style={{ marginLeft: "auto" }}>lead · cliente · tela · ação</span>
        </div>
      </div>
    </Modal>
  );
}

export { CommandSearch };
