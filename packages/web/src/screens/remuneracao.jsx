import React from "react";
import { PageHead } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { isAdminUser } from "../lib/users.js";

// Remuneração — tela SÓ DE ADMIN (dono): modelos de remuneração por cargo,
// direto do Receita Previsível (caps. 10-11), + o NOSSO plano em cada vaga
// (editável, salvo na collection comp_plans) e um simulador de quanto a
// pessoa leva no mês. Dupla proteção: o item de menu só aparece pra admin
// (chrome.jsx) e a API /api/comp_plans exige a etiqueta admin (screens.js),
// então nem usuário sem restrição de telas (ex.: acesso total) enxerga salário.

const { useState: useS, useEffect: useE } = React;

const money = (v) => window.fmt.money(Number(v) || 0);
const box = { border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)", padding: "16px 22px" };
const kicker = { fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" };
const inputS = { height: 30, padding: "0 9px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", fontSize: 12.5, width: 110 };
const btnPrimary = { height: 30, padding: "0 14px", borderRadius: "var(--r-2)", border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--accent-fg, #fff)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };

// Princípios do livro que valem pra TODOS os cargos (a régua da casa).
const PRINCIPLES = [
  ["Nunca 100% comissionado", "vale pra ~95% das empresas: com ciclo acima de 1-2 meses o vendedor passa fome, você atrai gente desesperada e o desespero chega no cliente (p.228-229)."],
  ["Variável do SDR ≈ até 50% do fixo", "ou seja, 1/3 da remuneração total. Foi o desenho que funcionou na Salesforce depois de testar vários (p.230)."],
  ["Metade por oportunidade ACEITA, metade pelo fechado", "a variável do SDR paga volume (oportunidades que o closer aceitou) E qualidade (receita que virou contrato), sem precisar de fiscal (p.230-231)."],
  ["Só paga o que está no sistema", "oportunidade fora do cockpit não existe e não remunera; é o que mantém o dado confiável (p.217 e 271)."],
  ["Transparência total", "todo mundo vê o resultado e a comissão de todo mundo (planilha única): corta ~80% do trabalho de apuração e acaba com desconfiança de folha (p.233-235)."],
  ["Time participa do desenho", "quem ajuda a criar o plano defende o plano; na Salesforce as reclamações morreram sem mudar uma vírgula (p.232-233)."],
  ["Promova cedo nos níveis iniciais", "6 a 8 meses nas funções de entrada; a trilha SDR → closer é o plano de carreira (p.226-227). Líder de subtime: 20% da variável atrelada ao resultado do subtime (p.284)."],
];

// Catálogo por cargo: o modelo SUGERIDO (livro adaptado pra nós) + quais campos
// do plano aparecem + como o simulador calcula. Campos moram num doc por cargo
// na collection comp_plans.
const ROLES = [
  {
    key: "sdr",
    title: "SDR · inbound (MRR)",
    suggestion: [
      "Fixo mensal + variável com teto de ~50% do fixo.",
      "Variável em 2 metades: 50% pelas oportunidades ACEITAS pelo closer no mês (vs meta; aceite agora existe no drawer) e 50% pela receita fechada das oportunidades que ele passou.",
      "Meta de aceitas sai da tela Metas (calls agendadas ÷ aceite); SLA de 1º toque em 5 min entra como critério de qualidade, não de bônus.",
    ],
    fields: ["fixed", "variableCap"],
    sim: "sdr",
  },
  {
    key: "sdr_outbound",
    title: "SDR · outbound (novo)",
    suggestion: [
      "Mesmo desenho do SDR inbound: fixo + variável de até 50% do fixo, split 50/50 aceitas/fechado.",
      "Rampa de meta (não cobrar meta cheia no mês 1): mês 1 = 5 oportunidades aceitas, mês 2 = 10, mês 3 = 15.",
      "Nunca pagar por lead cru ou e-mail enviado: só oportunidade aceita conta (senão o radar vira fábrica de reunião ruim).",
    ],
    fields: ["fixed", "variableCap"],
    sim: "sdr",
  },
  {
    key: "closer",
    title: "Closer · Executivo de Contas",
    suggestion: [
      "Fixo + comissão % sobre a receita FECHADA (paga pelo caixa, não pela promessa).",
      "Acelerador acima da meta: até 100% da meta paga a alíquota cheia; o que passar da meta paga a alíquota acelerada (ex.: 1,5x).",
      "Sem comissão por proposta enviada (proposta é merecida, não distribuída) e o closer segue dono do cliente até a integração terminar.",
    ],
    fields: ["fixed", "commissionPct", "acceleratorPct"],
    sim: "closer",
  },
  {
    key: "integrator",
    title: "Integrador · CS",
    suggestion: [
      "Fixo + variável em 2 partes: metade por retenção/NPS no alvo (a base não pode vazar) e metade em % sobre upsell que ELE gerar.",
      "Bônus fixo por INDICAÇÃO que fechar (o pedido das 2 indicações agora é passo do roteiro).",
      "É o cargo que protege o balde de renovação das 3 receitas; churn zero vale mais que upsell pontual.",
    ],
    fields: ["fixed", "variableCap", "upsellPct", "referralBonus"],
    sim: "cs",
  },
  {
    key: "social",
    title: "Mídia social",
    suggestion: [
      "Fixo + bônus por metas de produção batidas (posts/stories/anúncios da tela Metas) e por leads orgânicos gerados (form com origem social).",
      "Métricas de resultado, nunca de atividade: alcance não paga, lead e ganho atribuído pagam.",
    ],
    fields: ["fixed", "variableCap"],
    sim: "social",
  },
];

const FIELD_LABELS = {
  fixed: ["Fixo mensal (R$)", "salário base"],
  variableCap: ["Variável teto (R$)", "o máximo da variável no mês (livro: ~50% do fixo)"],
  commissionPct: ["Comissão (%)", "% sobre a receita fechada até a meta"],
  acceleratorPct: ["Acelerador (%)", "% sobre o que passar da meta"],
  upsellPct: ["% sobre upsell", "comissão sobre upsell gerado por ele"],
  referralBonus: ["Bônus por indicação fechada (R$)", "pago quando a indicação vira cliente"],
};

function blankPlan(role) {
  return { id: null, role, fixed: 0, variableCap: 0, commissionPct: 0, acceleratorPct: 0, upsellPct: 0, referralBonus: 0, notes: "", updatedAt: "" };
}

// ── Simuladores (quanto a pessoa leva no mês, com o plano preenchido) ─────────
function SimRow({ label, children }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
      <span style={{ flex: 1, color: "var(--fg-3)" }}>{label}</span>
      {children}
    </label>
  );
}
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const att = (real, meta) => (meta > 0 ? Math.min(real / meta, 1.5) : 0); // atinge até 150%

function Simulator({ kind, plan }) {
  const [s, setS] = useS({ aceitas: 12, metaAceitas: 15, receita: 60000, metaReceita: 90000, upsell: 5000, indicacoes: 1, reteve: true, metas: true });
  const set = (k) => (e) => setS((p) => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const inp = (k, w = 84) => <input type="number" value={s[k]} onChange={set(k)} style={{ ...inputS, width: w, height: 26, fontSize: 12 }} />;

  let variable = 0, lines = [];
  if (kind === "sdr") {
    const a = att(num(s.aceitas), num(s.metaAceitas));
    const b = att(num(s.receita), num(s.metaReceita));
    variable = num(plan.variableCap) * (0.5 * a + 0.5 * b);
    lines = [
      <SimRow key="a" label="oportunidades aceitas no mês / meta">{inp("aceitas", 64)} / {inp("metaAceitas", 64)}</SimRow>,
      <SimRow key="b" label="receita fechada das suas oportunidades / meta">{inp("receita")} / {inp("metaReceita")}</SimRow>,
    ];
  } else if (kind === "closer") {
    const rec = num(s.receita), meta = num(s.metaReceita);
    variable = (num(plan.commissionPct) / 100) * Math.min(rec, meta) + (num(plan.acceleratorPct) / 100) * Math.max(rec - meta, 0);
    lines = [
      <SimRow key="a" label="receita fechada no mês (R$)">{inp("receita")}</SimRow>,
      <SimRow key="b" label="meta do mês (R$)">{inp("metaReceita")}</SimRow>,
    ];
  } else if (kind === "cs") {
    variable = (s.reteve ? num(plan.variableCap) / 2 : 0) + (num(plan.upsellPct) / 100) * num(s.upsell) + num(plan.referralBonus) * num(s.indicacoes);
    lines = [
      <SimRow key="a" label="bateu retenção/NPS do mês?"><input type="checkbox" checked={!!s.reteve} onChange={set("reteve")} /></SimRow>,
      <SimRow key="b" label="upsell gerado (R$)">{inp("upsell")}</SimRow>,
      <SimRow key="c" label="indicações que fecharam">{inp("indicacoes", 64)}</SimRow>,
    ];
  } else {
    variable = s.metas ? num(plan.variableCap) : 0;
    lines = [<SimRow key="a" label="metas de produção batidas?"><input type="checkbox" checked={!!s.metas} onChange={set("metas")} /></SimRow>];
  }
  const total = num(plan.fixed) + variable;
  return (
    <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: "var(--r-2)", background: "var(--bg-inset)", border: "1px solid var(--line-1)", display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="mono" style={{ ...kicker, color: "var(--fg-3)" }}>Simulador · quanto leva no mês</div>
      {lines}
      <div style={{ fontSize: 12.5, marginTop: 2 }}>
        variável <b>{money(variable)}</b> + fixo <b>{money(plan.fixed)}</b> = <b style={{ color: "var(--pos)" }}>{money(total)}</b>
        <span style={{ color: "var(--fg-4)" }}> · atingimento acima da meta conta até 150%</span>
      </div>
    </div>
  );
}

function RoleCard({ role, plan, onSave }) {
  const [draft, setDraft] = useS(plan);
  const [saving, setSaving] = useS(false);
  useE(() => setDraft(plan), [plan]); // eslint-disable-line
  const set = (k) => (e) => setDraft((p) => ({ ...p, [k]: e.target.value }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(plan);
  return (
    <div style={box}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: "-0.01em" }}>{role.title}</div>
        {plan.updatedAt && <span className="mono" style={{ fontSize: 9.5, color: "var(--fg-4)" }}>plano salvo em {new Date(plan.updatedAt).toLocaleDateString("pt-BR")}</span>}
      </div>
      <div className="mono" style={{ ...kicker, color: "var(--accent)", margin: "10px 0 6px" }}>Modelo sugerido (livro)</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {role.suggestion.map((s, i) => (
          <div key={i} style={{ display: "flex", gap: 7, fontSize: 12.5, lineHeight: 1.5 }}>
            <span style={{ color: "var(--accent)", flexShrink: 0 }}>•</span><span>{s}</span>
          </div>
        ))}
      </div>
      <div className="mono" style={{ ...kicker, color: "var(--fg-3)", margin: "12px 0 6px" }}>Nosso plano (salva pra referência do time de gestão)</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {role.fields.map((f) => (
          <label key={f} style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: "var(--fg-3)" }} title={FIELD_LABELS[f][1]}>
            {FIELD_LABELS[f][0]}
            <input type="number" value={draft[f] ?? 0} onChange={set(f)} style={inputS} />
          </label>
        ))}
        <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: "var(--fg-3)", flex: "1 1 200px" }}>
          Observações
          <input value={draft.notes || ""} onChange={set("notes")} placeholder="acordos, exceções…" style={{ ...inputS, width: "100%" }} />
        </label>
      </div>
      {dirty && (
        <button style={{ ...btnPrimary, marginTop: 10 }} disabled={saving}
          onClick={async () => {
            setSaving(true);
            try { await onSave(draft); } catch (e) { window.alert(e?.message || "não salvou"); }
            setSaving(false);
          }}>
          {saving ? "salvando…" : "salvar plano"}
        </button>
      )}
      <Simulator kind={role.sim} plan={draft} />
    </div>
  );
}

function RemuneracaoScreen() {
  const [plans, setPlans] = useS(null);
  const load = () => api.list("comp_plans").then((all) => {
    const by = {};
    for (const p of all || []) by[p.role] = p;
    setPlans(by);
  }).catch(() => setPlans({}));
  useE(() => { load(); }, []); // eslint-disable-line

  if (!isAdminUser()) return <EmptyState title="Área da gestão" hint="Esta tela é só pra quem tem a etiqueta admin." />;

  async function save(draft) {
    const clean = {
      role: draft.role,
      fixed: num(draft.fixed), variableCap: num(draft.variableCap),
      commissionPct: num(draft.commissionPct), acceleratorPct: num(draft.acceleratorPct),
      upsellPct: num(draft.upsellPct), referralBonus: num(draft.referralBonus),
      notes: draft.notes || "", updatedAt: new Date().toISOString(),
    };
    if (draft.id) await api.update("comp_plans", draft.id, clean);
    else await api.create("comp_plans", clean);
    load();
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      <PageHead title="Remuneração" sub="modelos por cargo (Receita Previsível) · visível só pra admins" />
      <div style={{ padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 14, maxWidth: 980 }}>
        <div style={box}>
          <div className="mono" style={{ ...kicker, color: "var(--accent)", marginBottom: 8 }}>Princípios · direto do livro</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {PRINCIPLES.map(([t, d], i) => (
              <div key={i} style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                <b>{t}.</b> <span style={{ color: "var(--fg-2)" }}>{d}</span>
              </div>
            ))}
          </div>
        </div>
        {plans == null && <div className="mono dim" style={{ fontSize: 12 }}>carregando…</div>}
        {plans != null && ROLES.map((r) => (
          <RoleCard key={r.key} role={r} plan={plans[r.key] || blankPlan(r.key)} onSave={save} />
        ))}
        <div style={{ fontSize: 11.5, color: "var(--fg-4)" }}>
          Quando o plano do SDR for aprovado, o próximo passo é amarrar a metade das "aceitas" ao aceite do closer que já roda no drawer (hoje é telemetria).
        </div>
      </div>
    </div>
  );
}

export { RemuneracaoScreen };
