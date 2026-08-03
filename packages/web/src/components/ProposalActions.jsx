import React from "react";
import { chromeBtnStyleSmall, cockpitProposalUrl, waLink } from "../lib/ui.js";
import { useData } from "../data.jsx";
import { api } from "../lib/api.js";
// Coluna de proposta do lead (reusada pelo Pipeline e pelo detalhe do lead).
// Para leads do SaaS do Levercopy (CONFIG.levercopy), oferece gerar/re-gerar a
// proposta dinâmica e abre os links (ver + editar). Demais leads mantêm o botão
// "contatar". O servidor decide a elegibilidade de fato.

const { useState, useEffect } = React;

const accentBtnStyle = { ...chromeBtnStyleSmall, borderColor: "var(--accent-line)", color: "var(--accent)" };
const linkBtnStyle = { ...accentBtnStyle, textDecoration: "none" };

// Templates de proposta do produto (pra escolher o deck ao gerar: Padrão × Starter).
// Cache por saas — o ProposalActions renderiza um por lead no Pipeline, não dá pra
// buscar a cada card. `selectable` marca os decks alternativos (o publicado é o padrão);
// backups (rascunho sem a flag) ficam de fora.
const _tplCache = {};
export function useProposalTemplates(saas) {
  const [list, setList] = useState(() => _tplCache[saas] || null);
  useEffect(() => {
    if (!saas) return;
    if (_tplCache[saas]) { setList(_tplCache[saas]); return; }
    let alive = true;
    api.list("proposal_templates").then((rows) => {
      const l = (rows || []).filter((t) => !t.saas || t.saas === saas);
      _tplCache[saas] = l; if (alive) setList(l);
    }).catch(() => { _tplCache[saas] = []; if (alive) setList([]); });
    return () => { alive = false; };
  }, [saas]);
  const all = list || _tplCache[saas] || [];
  // Padrão (publicado) + alternativos marcados; ordena padrão primeiro.
  return all.filter((t) => t.status === "published" || t.selectable);
}
const selectStyle = { height: 24, padding: "0 6px", borderRadius: "var(--r-1)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 11 };

// Texto único pro compartilhamento da proposta — o roteiro de Meu dia e o
// atalho do card precisam falar a mesma coisa. A URL recebida aqui é SEMPRE a
// versão compartilhada da oferta (showAll, sem editKey), nunca a proposta-mãe
// usada pelo closer na apresentação.
export function proposalWhatsappText(lead, brand, url) {
  const firstName = lead?.name ? ` ${String(lead.name).trim().split(/\s+/)[0]}` : "";
  return `Oi${firstName}! Aqui é da ${brand || "equipe"}. Segue a sua proposta com tudo o que a gente conversou: ${url}`;
}

// Ações compactas do CARD do Pipeline. O link abre a proposta específica do
// lead no modo de apresentação; "enviar no Whats" pede a oferta e só então
// cria o snapshot do cliente (preço/benefícios revelados, sem edição).
//
// O wrapper bloqueia click/drag de subir pro card: usar qualquer atalho não
// abre o drawer nem arrasta o lead por acidente.
export function ProposalCardActions({ lead }) {
  const [open, setOpen] = useState(false);
  const [offers, setOffers] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(null); // { offer, url, opened }

  useEffect(() => {
    setOpen(false); setOffers(null); setBusy(""); setErr(""); setSent(null);
  }, [lead?.id, lead?.proposta_id]);

  if (!lead?.proposalUrl) return null;

  const brand = (window.SEED?.SAAS || []).find((s) => s.id === lead.saas)?.name || "equipe";
  const wa = waLink(lead.phone);
  const liveUrl = lead.proposal_edit_url || cockpitProposalUrl(lead.proposalUrl);

  async function chooseOffer() {
    if (open) { setOpen(false); return; }
    setOpen(true); setErr("");
    if (offers !== null) return;
    setBusy("load");
    try {
      const r = await api.proposalOffers(lead.id);
      const list = Array.isArray(r?.offers) ? r.offers : [];
      setOffers(list);
      if (!list.length) setErr("essa proposta ainda não tem oferta configurada");
    } catch {
      setOffers([]);
      setErr("não deu pra carregar as ofertas");
    }
    setBusy("");
  }

  async function share(offer) {
    setBusy(`offer-${offer.offer}`); setErr(""); setSent(null);
    // A nova aba nasce no gesto do clique; se esperasse a API responder, Safari
    // e Chrome poderiam tratá-la como popup. `opener = null` evita que a aba do
    // WhatsApp mantenha acesso ao cockpit enquanto ainda permite redirecioná-la.
    const win = wa ? window.open("", "_blank") : null;
    if (win) win.opener = null;
    try {
      const r = await api.shareProposal(lead.id, offer.offer);
      const ready = { offer: offer.offer, url: r.url, opened: !!win };
      setSent(ready);
      if (win) {
        win.location.replace(`${wa}?text=${encodeURIComponent(proposalWhatsappText(lead, brand, r.url))}`);
      } else {
        // Sem telefone OU popup bloqueado: não perde o trabalho; o link fica
        // copiado e os botões de copiar/conferir continuam visíveis no card.
        try { await navigator.clipboard.writeText(r.url); } catch { /* botão copiar fica disponível */ }
      }
    } catch {
      if (win) win.close();
      setErr("não deu pra preparar o link da proposta");
    }
    setBusy("");
  }

  const actionStyle = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    minHeight: 24, padding: "0 7px", borderRadius: "var(--r-1)",
    border: "1px solid var(--line-2)", background: "var(--bg-1)",
    color: "var(--fg-3)", fontSize: 10.5, fontWeight: 600,
    textDecoration: "none", cursor: "pointer",
  };

  return (
    <div
      draggable={false}
      onClick={(e) => e.stopPropagation()}
      onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
      style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 9, paddingTop: 8, borderTop: "1px solid var(--line-1)" }}>
      <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
        <a href={liveUrl} target="_blank" rel="noopener noreferrer" draggable={false}
          title="Abrir a proposta específica deste lead para apresentar"
          style={{ ...actionStyle, borderColor: "var(--accent-line)", color: "var(--accent)" }}>
          proposta ↗
        </a>
        <button type="button" onClick={chooseOffer} disabled={!!busy}
          aria-expanded={open} title="Escolher a oferta revelada e encaminhar a proposta pelo WhatsApp"
          style={{ ...actionStyle, color: "#128c4b", borderColor: "color-mix(in srgb, #25D366 45%, var(--line-2))" }}>
          {busy === "load" ? "carregando…" : "enviar no Whats"}
        </button>
      </div>

      {open && offers?.length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {offers.map((offer) => (
            <button type="button" key={offer.offer} onClick={() => share(offer)} disabled={!!busy}
              title={`Enviar a oferta ${offer.label} com tudo revelado e sem edição`}
              style={{ ...actionStyle, maxWidth: "100%", color: sent?.offer === offer.offer ? "#128c4b" : "var(--fg-2)", borderColor: sent?.offer === offer.offer ? "#25D366" : "var(--line-2)" }}>
              {busy === `offer-${offer.offer}` ? "preparando…" : `${offer.label}${offer.price ? ` · ${offer.price}` : ""}`}
            </button>
          ))}
        </div>
      )}

      {err && <span className="mono" style={{ fontSize: 9.5, color: "var(--neg)", lineHeight: 1.35 }}>{err}</span>}
      {sent && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span className="mono" style={{ fontSize: 9.5, color: "var(--pos)" }}>{sent.opened ? "✓ WhatsApp aberto" : "✓ link pronto"}</span>
          <button type="button" style={{ ...actionStyle, minHeight: 21, fontSize: 9.5 }}
            onClick={() => { try { navigator.clipboard.writeText(sent.url); } catch { window.prompt("Link da proposta:", sent.url); } }}>
            copiar
          </button>
          <a href={cockpitProposalUrl(sent.url)} target="_blank" rel="noopener noreferrer" draggable={false}
            style={{ ...actionStyle, minHeight: 21, fontSize: 9.5 }}>conferir ↗</a>
        </div>
      )}
    </div>
  );
}

// Histórico de aberturas da proposta (só no drawer, showViews): busca o registro
// da proposta e mostra QUEM abriu (cliente × time), quando e de qual dispositivo.
function ProposalViews({ proposalId }) {
  const [p, setP] = useState(null);
  useEffect(() => {
    if (!proposalId) return;
    let alive = true;
    api.get("proposals", proposalId).then((x) => alive && setP(x)).catch(() => {});
    return () => { alive = false; };
  }, [proposalId]);
  if (!p) return null;
  const log = Array.isArray(p.viewLog) ? [...p.viewLog].reverse() : [];
  const clientViews = Number(p.views) || 0;
  const fmt = (iso) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""; };
  return (
    <div style={{ marginTop: 8, border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-inset)", padding: "8px 10px" }}>
      <div className="mono dim" style={{ fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 5 }}>
        Aberturas da proposta · {clientViews === 0 ? "o cliente ainda não abriu" : `cliente abriu ${clientViews}×`}
      </div>
      {log.length === 0 && <div className="mono dim" style={{ fontSize: 11 }}>nenhuma abertura registrada ainda</div>}
      {log.slice(0, 8).map((v, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 11.5, padding: "2px 0" }}>
          <span className="mono" style={{ flexShrink: 0, color: "var(--fg-3)", fontSize: 10.5 }}>{fmt(v.at)}</span>
          <span className="mono" style={{ flexShrink: 0, fontSize: 10, color: v.viewer === "cliente" ? "var(--pos)" : "var(--fg-4)" }}>{v.viewer === "cliente" ? "cliente" : "time"}</span>
          <span className="dim" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.device}</span>
        </div>
      ))}
    </div>
  );
}

function ProposalActions({ l, showViews = false }) {
  const { refresh } = useData();
  const cfg = window.SEED.CONFIG?.levercopy;
  // Provider disponível pro SaaS do lead: nativo (template publicado) ou Levercopy.
  const hasNative = (window.SEED.CONFIG?.proposals?.nativeSaas || []).includes(l.saas);
  const isLevercopy = (!!cfg?.enabled && l.saas === cfg.saas) || hasNative;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const templates = useProposalTemplates(l.saas);
  const alt = templates.filter((t) => t.selectable); // decks alternativos (ex.: Starter)
  const [tpl, setTpl] = useState(""); // "" = padrão (deck publicado)

  async function gen(force) {
    setBusy(true); setErr(false);
    try {
      const r = await api.generateProposal(l.id, { force: !!force, template: tpl });
      // Falha (fail-open: 200 com ok:false). Nada mudou no servidor, então NÃO
      // damos refresh — o refresh remonta a tela (key=dataVersion) e apagaria o
      // estado de erro. Mantemos err/busy locais pra mostrar "não gerada" + retry.
      if (!r || r.ok === false) { setErr(true); setBusy(false); return; }
      await refresh(); // sucesso: recarrega o SEED; o card remonta já com as URLs
    } catch { setErr(true); setBusy(false); }
  }

  if (l.proposalUrl) {
    // "apresentar ao vivo" = link de edição (?k), com a tela de setup do closer e
    // os campos editáveis. "ver como cliente" = link limpo (o que vai pro cliente).
    const liveUrl = l.proposal_edit_url || cockpitProposalUrl(l.proposalUrl);
    const proposalId = l.proposta_id || (String(l.proposalUrl || "").match(/\/p\/(pr_[a-z0-9]+)/i) || [])[1];
    // "apresentar ao vivo" e "ver como cliente" são o TIME conferindo — os dois
    // vão com from=cockpit pra não contarem como "o cliente abriu".
    return (
      <span style={{ display: showViews ? "flex" : "inline-flex", flexDirection: showViews ? "column" : "row", gap: 6, alignItems: showViews ? "stretch" : "center" }}>
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <a href={liveUrl} target="_blank" rel="noreferrer" style={linkBtnStyle}><span style={{ fontSize: 11 }}>apresentar ao vivo ↗</span></a>
          <a href={cockpitProposalUrl(l.proposalUrl)} target="_blank" rel="noreferrer" style={{ ...chromeBtnStyleSmall, textDecoration: "none" }}><span style={{ fontSize: 11 }}>ver como cliente ↗</span></a>
          {isLevercopy && <button onClick={() => gen(true)} disabled={busy} style={chromeBtnStyleSmall}><span style={{ fontSize: 11 }}>{busy ? "…" : "re-gerar"}</span></button>}
          {isLevercopy && err && <span className="mono" style={{ fontSize: 9, color: "var(--neg)" }}>re-geração falhou</span>}
        </span>
        {showViews && proposalId && <ProposalViews proposalId={proposalId} />}
      </span>
    );
  }
  if (isLevercopy) {
    return (
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {alt.length > 0 && (
          <select value={tpl} onChange={(e) => setTpl(e.target.value)} disabled={busy} title="Qual apresentação gerar" style={selectStyle}>
            <option value="">Padrão</option>
            {alt.map((t) => <option key={t.id} value={t.id}>{t.pickLabel || t.name || t.id}</option>)}
          </select>
        )}
        <button onClick={() => gen(false)} disabled={busy} style={accentBtnStyle}><span style={{ fontSize: 11 }}>{busy ? "gerando…" : err ? "tentar de novo" : "gerar proposta"}</span></button>
        {err && <span className="mono" style={{ fontSize: 9, color: "var(--neg)" }}>proposta não gerada</span>}
      </span>
    );
  }
  return <button style={accentBtnStyle}><span style={{ fontSize: 11 }}>contatar</span></button>;
}

export { ProposalActions };
