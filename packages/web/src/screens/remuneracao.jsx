import React from "react";
import { PageHead } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { isAdminUser } from "../lib/users.js";

// Remuneração — tela SÓ DE ADMIN com o plano OFICIAL da casa, definido pelo
// Leo em 04/08/2026 (folhas amarelas + decisões no chat): 3 trilhas (SDR,
// Closer, CS), 3 NÍVEIS cada (1 júnior · 2 pleno · 3 sênior). SDR e Closer têm
// DUAS PERNAS de variável, avaliadas separadamente e SOMADAS ("bônus em
// dobro"): perna CONTRATOS (nº de fechamentos) e perna RECEITA (R$ fechado).
// Regras das pernas: abaixo de 80% da meta = ZERO; entre as âncoras
// 80/100/120/140 é proporcional; TRAVA em 140% (o bônus 140% é o teto).
// Closer escolhe regime CLT ou PJ (muda só o fixo). CS não tem banda: fixo +
// R$100 por indicação que vira REUNIÃO FEITA (R$250 no lugar, se fechar; não
// soma) + bônus por NPS ≥ 80 + bônus por churn do mês abaixo de 15%, ambos
// conforme o nível.
// Os números abaixo são o PADRÃO (o plano aprovado); editar e salvar grava um
// doc por trilha na collection comp_plans (admin-only na API, screens.js).

const { useState: useS, useEffect: useE } = React;

const money = (v) => window.fmt.money(Number(v) || 0);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const box = { border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)", padding: "16px 22px" };
const inputS = { height: 28, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", fontSize: 12.5, width: 92 };
const cellIn = { ...inputS, width: 78, height: 26, fontSize: 12 };
const btnPrimary = { height: 30, padding: "0 14px", borderRadius: "var(--r-2)", border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--accent-fg, #fff)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const thS = { padding: "6px 8px", textAlign: "left", whiteSpace: "nowrap", borderBottom: "1px solid var(--line-1)" };
const tdS = { padding: "5px 8px", borderBottom: "1px solid var(--line-faint)", whiteSpace: "nowrap" };

// ── As regras da casa (decisões do Leo, 04/08) ───────────────────────────────
const RULES = [
  ["Duas pernas que somam", "contratos e receita são avaliados separados e cada perna paga o bônus da banda: bater as duas metas em 100% paga o valor da tabela em DOBRO (ex.: 20 contratos + R$90k no nível 1 do closer = 1.000 + 1.000)."],
  ["Abaixo de 80% = zero", "a perna que não chega a 80% da meta não paga nada."],
  ["Proporcional até 140%", "entre as âncoras 80, 100, 120 e 140% o valor é proporcional; 140% é o teto (acima disso não paga mais)."],
  ["A receita do SDR é a das oportunidades DELE", "a perna de R$ do SDR conta a receita FECHADA das oportunidades que ele gerou (desenho do Receita Previsível)."],
  ["SDR e closer perseguem o mesmo número", "metas iguais por nível de propósito: a dupla fecha junto (2 pessoas nível 1 a 90k = a meta de agosto)."],
  ["CLT ou PJ só muda o fixo", "a variável do closer é a mesma nos dois regimes."],
  ["CS por evento, sem banda", "R$100 quando a indicação vira reunião FEITA; se converter, R$250 no lugar (não soma). Bônus de NPS pago com NPS ≥ 80 e bônus de churn pago com churn do mês abaixo de 15%."],
  ["Subir de nível é o plano de carreira", "promoção sobe fixo, meta e bônus juntos (1 júnior · 2 pleno · 3 sênior)."],
];

// ── O plano aprovado (padrão da tela; salvar sobrescreve por trilha) ─────────
const DEFAULT_PLAN = {
  sdr: {
    levels: [
      { n: 1, fixed: 2200, metaContracts: 20, metaRevenue: 90000, b80: 300, b100: 550, b120: 750, b140: 950 },
      { n: 2, fixed: 2600, metaContracts: 25, metaRevenue: 120000, b80: 450, b100: 750, b120: 1000, b140: 1250 },
      { n: 3, fixed: 3000, metaContracts: 35, metaRevenue: 180000, b80: 650, b100: 1000, b120: 1300, b140: 1600 },
    ],
    notes: "",
  },
  closer: {
    levels: [
      { n: 1, fixed: 3000, fixedPj: 4200, metaContracts: 20, metaRevenue: 90000, b80: 600, b100: 1000, b120: 1500, b140: 2000 },
      { n: 2, fixed: 4000, fixedPj: 5500, metaContracts: 25, metaRevenue: 120000, b80: 1000, b100: 1500, b120: 2100, b140: 2700 },
      { n: 3, fixed: 5500, fixedPj: 7500, metaContracts: 35, metaRevenue: 180000, b80: 1500, b100: 2500, b120: 3700, b140: 4900 },
    ],
    notes: "",
  },
  cs: {
    levels: [
      { n: 1, fixed: 2200, npsBonus: 500, churnBonus: 500 },
      { n: 2, fixed: 2600, npsBonus: 700, churnBonus: 700 },
      { n: 3, fixed: 3000, npsBonus: 1000, churnBonus: 1000 },
    ],
    referralMeeting: 100,
    referralClosed: 250,
    npsFloor: 80,
    churnMax: 15,
    notes: "",
  },
};

// Bônus de UMA perna: att = realizado ÷ meta (1 = 100%). Cliff em 80%,
// proporcional entre as âncoras (80→b80, 100→b100, 120→b120, 140→b140) e trava
// em 140% (decisões 1 a 3 do Leo). Plano salvo sem b140 (anterior à coluna)
// herda a extrapolação antiga da inclinação 100→120.
export function legBonus(att, b80, b100, b120, b140) {
  if (!Number.isFinite(att) || att < 0.8) return 0;
  const a = Math.min(att, 1.4);
  if (a <= 1) return b80 + (b100 - b80) * ((a - 0.8) / 0.2);
  if (a <= 1.2) return b100 + (b120 - b100) * ((a - 1) / 0.2);
  const top = Number.isFinite(b140) ? b140 : b120 + (b120 - b100);
  return b120 + (top - b120) * ((a - 1.2) / 0.2);
}
const pctS = (att) => (Number.isFinite(att) ? `${Math.round(att * 100)}%` : "—");

// ── Simulador de SDR/Closer: duas pernas + fixo ──────────────────────────────
function SimVendas({ plan, isCloser }) {
  const [s, setS] = useS({ n: 1, pj: false, contratos: 20, receita: 90000 });
  const lv = (plan.levels || []).find((l) => l.n === Number(s.n)) || plan.levels?.[0] || {};
  const attC = num(lv.metaContracts) > 0 ? num(s.contratos) / num(lv.metaContracts) : 0;
  const attR = num(lv.metaRevenue) > 0 ? num(s.receita) / num(lv.metaRevenue) : 0;
  const legC = legBonus(attC, num(lv.b80), num(lv.b100), num(lv.b120), lv.b140 == null ? undefined : num(lv.b140));
  const legR = legBonus(attR, num(lv.b80), num(lv.b100), num(lv.b120), lv.b140 == null ? undefined : num(lv.b140));
  const fixed = isCloser && s.pj ? num(lv.fixedPj) : num(lv.fixed);
  const set = (k) => (e) => setS((p) => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  return (
    <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: "var(--r-2)", background: "var(--bg-inset)", border: "1px solid var(--line-1)", display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
      <div className="kicker" style={{ color: "var(--fg-3)" }}>Simulador · quanto leva no mês</div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label>nível <select value={s.n} onChange={set("n")} style={{ ...inputS, width: 56, height: 26 }}>{(plan.levels || []).map((l) => <option key={l.n} value={l.n}>{l.n}</option>)}</select></label>
        {isCloser && <label style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><input type="checkbox" checked={!!s.pj} onChange={set("pj")} /> regime PJ</label>}
        <label>contratos <input type="number" value={s.contratos} onChange={set("contratos")} style={{ ...inputS, width: 64, height: 26 }} /></label>
        <label>receita R$ <input type="number" value={s.receita} onChange={set("receita")} style={{ ...inputS, width: 100, height: 26 }} /></label>
      </div>
      <div style={{ color: "var(--fg-2)" }}>
        perna contratos {pctS(attC)} → <b>{money(legC)}</b> · perna receita {pctS(attR)} → <b>{money(legR)}</b>
      </div>
      <div>
        fixo{isCloser ? (s.pj ? " (PJ)" : " (CLT)") : ""} <b>{money(fixed)}</b> + variável <b>{money(legC + legR)}</b> = <b style={{ color: "var(--pos)" }}>{money(fixed + legC + legR)}</b>
        <span style={{ color: "var(--fg-4)" }}> · abaixo de 80% a perna zera · teto 140%</span>
      </div>
    </div>
  );
}

// ── Simulador do CS: eventos + NPS ───────────────────────────────────────────
function SimCs({ plan }) {
  const [s, setS] = useS({ n: 1, nps: true, churn: true, reunioes: 4, fechadas: 1 });
  const lv = (plan.levels || []).find((l) => l.n === Number(s.n)) || plan.levels?.[0] || {};
  // Indicação fechada paga o valor CHEIO no lugar do de reunião (não soma):
  // "reuniões" aqui são as que NÃO converteram.
  const varTotal = num(s.reunioes) * num(plan.referralMeeting) + num(s.fechadas) * num(plan.referralClosed) + (s.nps ? num(lv.npsBonus) : 0) + (s.churn ? num(lv.churnBonus) : 0);
  const set = (k) => (e) => setS((p) => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  return (
    <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: "var(--r-2)", background: "var(--bg-inset)", border: "1px solid var(--line-1)", display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
      <div className="kicker" style={{ color: "var(--fg-3)" }}>Simulador · quanto leva no mês</div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label>nível <select value={s.n} onChange={set("n")} style={{ ...inputS, width: 56, height: 26 }}>{(plan.levels || []).map((l) => <option key={l.n} value={l.n}>{l.n}</option>)}</select></label>
        <label style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><input type="checkbox" checked={!!s.nps} onChange={set("nps")} /> NPS ≥ {num(plan.npsFloor) || 80}</label>
        <label style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><input type="checkbox" checked={!!s.churn} onChange={set("churn")} /> churn &lt; {num(plan.churnMax) || 15}%</label>
        <label>indicações c/ reunião feita (sem fechar) <input type="number" value={s.reunioes} onChange={set("reunioes")} style={{ ...inputS, width: 56, height: 26 }} /></label>
        <label>indicações fechadas <input type="number" value={s.fechadas} onChange={set("fechadas")} style={{ ...inputS, width: 56, height: 26 }} /></label>
      </div>
      <div>
        fixo <b>{money(lv.fixed)}</b> + variável <b>{money(varTotal)}</b> = <b style={{ color: "var(--pos)" }}>{money(num(lv.fixed) + varTotal)}</b>
        <span style={{ color: "var(--fg-4)" }}> · fechada paga {money(plan.referralClosed)} no lugar dos {money(plan.referralMeeting)} (não soma)</span>
      </div>
    </div>
  );
}

// ── Card por trilha: tabela de níveis editável + simulador ───────────────────
const ROLE_META = {
  sdr: { title: "SDR", sub: "duas pernas: contratos fechados das SUAS oportunidades + receita fechada delas" },
  closer: { title: "Closer · Executivo de Contas", sub: "duas pernas: contratos fechados + receita fechada · CLT ou PJ (muda só o fixo)" },
  cs: { title: "Integrador · CS", sub: "fixo + indicação (reunião feita / fechada) + bônus NPS" },
};

function RoleCard({ role, saved, onSave }) {
  const [draft, setDraft] = useS(saved);
  const [saving, setSaving] = useS(false);
  useE(() => setDraft(saved), [saved]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const isCs = role === "cs";
  const isCloser = role === "closer";
  const setLevel = (n, k) => (e) => setDraft((p) => ({ ...p, levels: (p.levels || []).map((l) => (l.n === n ? { ...l, [k]: num(e.target.value) } : l)) }));
  const setTop = (k) => (e) => setDraft((p) => ({ ...p, [k]: k === "notes" ? e.target.value : num(e.target.value) }));

  return (
    <div style={box}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: "-0.01em" }}>{ROLE_META[role].title}</div>
        <span style={{ fontSize: 11.5, color: "var(--fg-3)" }}>{ROLE_META[role].sub}</span>
        {saved.updatedAt && <span className="mono" style={{ fontSize: 9.5, color: "var(--fg-4)", marginLeft: "auto" }}>salvo em {new Date(saved.updatedAt).toLocaleDateString("pt-BR")}</span>}
      </div>

      <div className="tbl-x" style={{ marginTop: 10, overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", minWidth: isCs ? 500 : 720 }}>
          <thead>
            <tr>
              <th className="kicker" style={thS}>Nível</th>
              <th className="kicker" style={thS}>{isCloser ? "Fixo CLT" : "Fixo"}</th>
              {isCloser && <th className="kicker" style={thS}>Fixo PJ</th>}
              {!isCs && <th className="kicker" style={thS}>Meta contratos</th>}
              {!isCs && <th className="kicker" style={thS}>Meta receita</th>}
              {!isCs && <th className="kicker" style={thS}>Bônus 80%</th>}
              {!isCs && <th className="kicker" style={thS}>Bônus 100%</th>}
              {!isCs && <th className="kicker" style={thS}>Bônus 120%</th>}
              {!isCs && <th className="kicker" style={thS}>Bônus 140%</th>}
              {isCs && <th className="kicker" style={thS}>Bônus NPS ≥ {num(draft.npsFloor) || 80}</th>}
              {isCs && <th className="kicker" style={thS}>Bônus churn &lt; {num(draft.churnMax) || 15}%</th>}
            </tr>
          </thead>
          <tbody>
            {(draft.levels || []).map((l) => (
              <tr key={l.n}>
                <td style={{ ...tdS, fontWeight: 700 }}>{l.n} <span style={{ fontWeight: 400, color: "var(--fg-4)", fontSize: 10.5 }}>{l.n === 1 ? "jr" : l.n === 2 ? "pl" : "sn"}</span></td>
                <td style={tdS}><input type="number" value={l.fixed} onChange={setLevel(l.n, "fixed")} style={cellIn} /></td>
                {isCloser && <td style={tdS}><input type="number" value={l.fixedPj ?? 0} onChange={setLevel(l.n, "fixedPj")} style={cellIn} /></td>}
                {!isCs && <td style={tdS}><input type="number" value={l.metaContracts ?? 0} onChange={setLevel(l.n, "metaContracts")} style={{ ...cellIn, width: 60 }} /></td>}
                {!isCs && <td style={tdS}><input type="number" value={l.metaRevenue ?? 0} onChange={setLevel(l.n, "metaRevenue")} style={{ ...cellIn, width: 96 }} /></td>}
                {!isCs && <td style={tdS}><input type="number" value={l.b80 ?? 0} onChange={setLevel(l.n, "b80")} style={cellIn} /></td>}
                {!isCs && <td style={tdS}><input type="number" value={l.b100 ?? 0} onChange={setLevel(l.n, "b100")} style={cellIn} /></td>}
                {!isCs && <td style={tdS}><input type="number" value={l.b120 ?? 0} onChange={setLevel(l.n, "b120")} style={cellIn} /></td>}
                {!isCs && <td style={tdS}><input type="number" value={l.b140 ?? 0} onChange={setLevel(l.n, "b140")} style={cellIn} /></td>}
                {isCs && <td style={tdS}><input type="number" value={l.npsBonus ?? 0} onChange={setLevel(l.n, "npsBonus")} style={cellIn} /></td>}
                {isCs && <td style={tdS}><input type="number" value={l.churnBonus ?? 0} onChange={setLevel(l.n, "churnBonus")} style={cellIn} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isCs && (
        <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap", fontSize: 11.5, color: "var(--fg-3)", alignItems: "center" }}>
          <label>indicação · reunião feita R$ <input type="number" value={draft.referralMeeting ?? 0} onChange={setTop("referralMeeting")} style={{ ...cellIn, width: 64 }} /></label>
          <label>indicação · fechada R$ <input type="number" value={draft.referralClosed ?? 0} onChange={setTop("referralClosed")} style={{ ...cellIn, width: 64 }} /></label>
          <span style={{ color: "var(--fg-4)" }}>fechada substitui a de reunião (não soma)</span>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ flex: "1 1 240px", fontSize: 11, color: "var(--fg-3)", display: "flex", flexDirection: "column", gap: 3 }}>
          Observações
          <input value={draft.notes || ""} onChange={setTop("notes")} placeholder="acordos, exceções…" style={{ ...inputS, width: "100%" }} />
        </label>
        {dirty && (
          <button style={btnPrimary} disabled={saving}
            onClick={async () => {
              setSaving(true);
              try { await onSave(role, draft); } catch (e) { window.alert(e?.message || "não salvou"); }
              setSaving(false);
            }}>
            {saving ? "salvando…" : "salvar plano"}
          </button>
        )}
      </div>

      {isCs ? <SimCs plan={draft} /> : <SimVendas plan={draft} isCloser={isCloser} />}
    </div>
  );
}

function RemuneracaoScreen() {
  const [docs, setDocs] = useS(null); // comp_plans salvos, por role
  const load = () => api.list("comp_plans").then((all) => {
    const by = {};
    for (const d of all || []) if (d.role) by[d.role] = d;
    setDocs(by);
  }).catch(() => setDocs({}));
  useE(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isAdminUser()) return <EmptyState title="Área da gestão" hint="Esta tela é só pra quem tem a etiqueta admin." />;

  // Plano vigente por trilha: doc salvo (campo plan) por cima do padrão aprovado.
  const planOf = (role) => {
    const doc = docs?.[role];
    const plan = doc?.plan ? { ...DEFAULT_PLAN[role], ...doc.plan, updatedAt: doc.updatedAt } : { ...DEFAULT_PLAN[role] };
    // Doc salvo antes da coluna 140% não tem b140: mostra a extrapolação antiga.
    if (role !== "cs") plan.levels = (plan.levels || []).map((l) => (l.b140 == null ? { ...l, b140: num(l.b120) + (num(l.b120) - num(l.b100)) } : l));
    // Doc do CS salvo antes do bônus de churn: herda o valor padrão do nível.
    if (role === "cs") plan.levels = (plan.levels || []).map((l) => (l.churnBonus == null ? { ...l, churnBonus: num(DEFAULT_PLAN.cs.levels.find((d) => d.n === l.n)?.churnBonus) } : l));
    return plan;
  };
  async function save(role, plan) {
    const doc = docs?.[role];
    const { updatedAt, ...clean } = plan;
    const payload = { role, plan: clean, updatedAt: new Date().toISOString() };
    if (doc?.id) await api.update("comp_plans", doc.id, payload);
    else await api.create("comp_plans", payload);
    load();
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      <PageHead title="Remuneração" sub="plano oficial por cargo e nível (aprovado 04/08) · visível só pra admins" />
      <div style={{ padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={box}>
          <div className="kicker" style={{ color: "var(--accent)", marginBottom: 8 }}>Regras da casa</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {RULES.map(([t, d], i) => (
              <div key={i} style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                <b>{t}.</b> <span style={{ color: "var(--fg-2)" }}>{d}</span>
              </div>
            ))}
          </div>
        </div>
        {docs == null && <div className="mono dim" style={{ fontSize: 12 }}>carregando…</div>}
        {docs != null && ["sdr", "closer", "cs"].map((role) => (
          <RoleCard key={role} role={role} saved={planOf(role)} onSave={save} />
        ))}
        <div style={{ fontSize: 11.5, color: "var(--fg-4)" }}>
          Contratos e receita saem da mesma régua do placar (fechamentos por wonAt). Próximo passo natural: o cockpit calcular a variável do mês de cada pessoa sozinho, a partir do nível dela.
        </div>
      </div>
    </div>
  );
}

export { RemuneracaoScreen };
