import React from "react";
import { useActiveSaas } from "../lib/workspace.js";
import { GRADE_GRID, GRADE_STYLE, GRADE_ACCOUNTS, GRADE_LISTINGS } from "../lib/ui.js";

// Quem é o nosso ICP (Perfil Ideal de Cliente) — o cartão vive na Visão geral
// e nos Treinamentos pra régua ficar na cabeça do time inteiro. Regra do livro
// (Receita Previsível, cap. 5): perfil em UMA página, espelhado nos 5-10%
// melhores clientes, com SINAIS VERMELHOS explícitos; o SDR nunca desiste de
// quem TEM perfil (até um não do decisor) e desiste rápido de quem NÃO tem.
//
// O conteúdo mora no PRODUTO (product.icp = { headline, profile[], redFlags[],
// contact, updatedAt }), então é dado vivo: dá pra ajustar via API/Ajustes sem
// deploy, e cada produto do portfólio tem o seu (sem ICP definido, o cartão
// não aparece — UniqueKids só ganha o dela quando alguém escrever).

const kicker = { fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" };

function ListCol({ title, tone, mark, items }) {
  if (!items?.length) return null;
  return (
    <div style={{ flex: "1 1 260px", minWidth: 240 }}>
      <div className="mono" style={{ ...kicker, color: tone, marginBottom: 6 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {items.map((it, i) => (
          <div key={i} style={{ display: "flex", gap: 7, fontSize: 12.5, lineHeight: 1.45 }}>
            <span style={{ color: tone, flexShrink: 0 }}>{mark}</span>
            <span style={{ minWidth: 0 }}>{it}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// A matriz da NOTA do lead (a MESMA GRADE_GRID que o leadTier usa, importada de
// lib/ui.js: mudou a régua, a legenda acompanha sozinha): linha = contas de
// marketplace, coluna = anúncios na maior conta. Régua do diagnóstico LeverAds.
function GradeCol() {
  return (
    <div style={{ flex: "1 1 260px", minWidth: 240, maxWidth: 360 }}>
      <div className="mono" style={{ ...kicker, color: "var(--accent)", marginBottom: 6 }}>Nota do lead · contas × anúncios</div>
      <div className="mono" style={{ fontSize: 8.5, color: "var(--fg-4)", textAlign: "center", marginBottom: 3, paddingLeft: 34 }}>anúncios na maior conta →</div>
      <div style={{ display: "grid", gridTemplateColumns: "34px repeat(5, 1fr)", gap: 3, alignItems: "center" }}>
        <span />
        {GRADE_LISTINGS.map((l) => <span key={l} className="mono" style={{ fontSize: 8, color: "var(--fg-4)", textAlign: "center", lineHeight: 1.1 }}>{l}</span>)}
        {GRADE_GRID.map((row, r) => (
          <React.Fragment key={r}>
            <span className="mono" style={{ fontSize: 9, color: "var(--fg-4)", textAlign: "right", paddingRight: 4, whiteSpace: "nowrap" }}>{GRADE_ACCOUNTS[r]}</span>
            {row.map((g, c) => {
              const s = GRADE_STYLE[g];
              return <span key={c} title={`${GRADE_ACCOUNTS[r]} conta(s) · ${GRADE_LISTINGS[c]} anúncios = ${s.label}`}
                style={{ height: 22, borderRadius: 4, background: s.tone, color: s.badgeFg, fontSize: 10.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{g}</span>;
            })}
          </React.Fragment>
        ))}
      </div>
      <div className="mono" style={{ fontSize: 8.5, color: "var(--fg-4)", marginTop: 4 }}>↑ contas de marketplace</div>
    </div>
  );
}

export function IcpCard({ compact, grade }) {
  const [product] = useActiveSaas();
  const icp = product?.icp;
  if (!icp || (!icp.headline && !(icp.profile || []).length)) return null;
  return (
    <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)", padding: compact ? "14px 18px" : "16px 24px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <div className="mono" style={{ ...kicker, color: "var(--accent)" }}>Nosso ICP · quem a gente caça</div>
        {icp.updatedAt && <span className="mono" style={{ fontSize: 9.5, color: "var(--fg-4)" }}>atualizado {icp.updatedAt}</span>}
      </div>
      {icp.headline && <div style={{ fontSize: compact ? 14.5 : 16, fontWeight: 700, letterSpacing: "-0.01em", marginTop: 6 }}>{icp.headline}</div>}
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 12 }}>
        <ListCol title="Perfil ideal" tone="var(--pos)" mark="✓" items={icp.profile} />
        <ListCol title="Sinais vermelhos" tone="var(--neg)" mark="✕" items={icp.redFlags} />
        {/* `grade` liga a coluna da matriz (Treinamentos); a Visão geral segue
            só com as listas. A régua é a do diagnóstico LeverAds. */}
        {grade && product?.id === "leverads" && <GradeCol />}
      </div>
      {icp.contact && (
        <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--fg-2)" }}>
          <b>Contato ideal:</b> {icp.contact}
        </div>
      )}
      <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--fg-4)" }}>
        Regra: nunca desista de quem TEM perfil até um não do decisor · desista rápido de quem NÃO tem · máximo 5 perfis por produto.
      </div>
    </div>
  );
}
