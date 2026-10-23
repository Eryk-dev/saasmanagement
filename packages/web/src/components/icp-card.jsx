import { REVENUE_BANDS, defaultRules, icpGradesOf } from "../../../api/src/shared/lead-grade.js";
import { gradeRulesFor } from "../lib/grade-rules.js";
import React from "react";
import { useActiveSaas } from "../lib/workspace.js";
import { GRADE_STYLE } from "../lib/ui.js";

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

function ListCol({ title, tone, mark, items }) {
  if (!items?.length) return null;
  return (
    <div style={{ flex: "1 1 260px", minWidth: 240 }}>
      <div className="kicker" style={{ color: tone, marginBottom: 6 }}>{title}</div>
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

// Faixas da régua do produto (o 1º método com faixas) e as notas de ICP. Na
// régua padrão do LeverAds os rótulos são os de sempre (REVENUE_BANDS).
const fmtShort = (n) => (n >= 1e6 ? `${(n / 1e6).toLocaleString("pt-BR")} mi` : n >= 1e3 ? `${(n / 1e3).toLocaleString("pt-BR")} mil` : n.toLocaleString("pt-BR"));
export function GradeCol({ product: productIn } = {}) {
  const [active] = useActiveSaas();
  const product = productIn || active;
  const rules = gradeRulesFor(product?.id);
  const method = (rules.methods || []).find((m) => Array.isArray(m.bands) && m.bands.length);
  if (!method) return null;
  const bands = [...method.bands].sort((a, b) => b.min - a.min);
  const v = rules.value || {};
  const money = (n) => `${v.prefix ? `${v.prefix} ` : ""}${fmtShort(n)}`;
  const labelOf = (b, i) => {
    const std = REVENUE_BANDS.find((x) => x.grade === b.grade && x.min === b.min);
    if (std && rules === defaultRules(product?.id)) return std.label;
    const upper = bands[i - 1];
    if (!upper) return `${money(b.min)} ou mais`;
    return b.min > 0 ? `${money(b.min)} a menos de ${money(upper.min)}` : `abaixo de ${money(upper.min)}`;
  };
  const icp = [...icpGradesOf(rules)].join("/");
  const legacy = (rules.methods || []).some((m) => m.legacy);
  return <div style={{ flex: "1 1 260px", minWidth: 240 }}>
    <div className="kicker accent" style={{ marginBottom: 8 }}>Nota · {v.label || method.label || "régua do produto"}</div>
    {bands.map((b, i) => <div key={b.grade} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, fontSize: 12 }}>
      <span style={{ color: GRADE_STYLE[b.grade].ink, fontWeight: 700, width: 14 }}>{b.grade}</span><span>{labelOf(b, i)}</span>
    </div>)}
    <p style={{ fontSize: 11.5, color: "var(--fg-3)", lineHeight: 1.5 }}>{method.label ? `${method.label[0].toUpperCase()}${method.label.slice(1)}, pelos valores representativos das faixas. ` : ""}ICP: {icp}. Intenção avaliada separadamente.</p>
    {legacy && <p style={{ fontSize: 11.5, color: "var(--fg-3)", lineHeight: 1.5 }}><b>L = Legado:</b> sem as respostas do método principal, preserva a nota anterior.</p>}
  </div>;
}

export function IcpCard({ compact, grade }) {
  const [product] = useActiveSaas();
  const icp = product?.icp;
  if (!icp || (!icp.headline && !(icp.profile || []).length)) return null;
  return (
    <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)", padding: compact ? "14px 18px" : "16px 24px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <div className="kicker accent">Nosso ICP · quem a gente caça</div>
        {icp.updatedAt && <span className="mono dim" style={{ fontSize: 10 }}>atualizado {icp.updatedAt}</span>}
      </div>
      {icp.headline && <div className="card-title" style={{ marginTop: 4 }}>{icp.headline}</div>}
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 12 }}>
        <ListCol title="Perfil ideal" tone="var(--pos)" mark="✓" items={icp.profile} />
        <ListCol title="Sinais vermelhos" tone="var(--neg)" mark="✕" items={icp.redFlags} />
        {/* `grade` liga a coluna de faixas (Treinamentos); a Visão geral segue
            só com as listas. As faixas vêm da régua do produto. */}
        {grade && <GradeCol product={product} />}
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
