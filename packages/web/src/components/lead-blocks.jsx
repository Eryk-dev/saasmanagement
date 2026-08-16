// Blocos do LEAD compartilhados pelos dois painéis que a mesma pessoa abre no
// mesmo dia: o card do pipeline (screens/deal.jsx, drawer completo) e o painel
// de atividade do Meu dia (screens/today.jsx, o roteiro da vez).
//
// REGRA (pedido do Leo, 12/08): a informação que existe nos dois aparece IGUAL —
// mesmo título, mesma ordem, mesmo desenho. Antes cada painel montava o próprio
// "Resumo do cliente" (rótulos e ordem diferentes pro mesmo dado), o próprio
// checklist e o próprio passo a passo (um com botão de copiar, o outro sem), e
// bater o olho de um painel no outro dava trabalho. O que é exclusivo de um
// painel (GPS/timeline no drawer, atalhos da call no roteiro) continua lá.
//
// O inbox do WhatsApp (screens/whatsapp.jsx) usa o clientSummary daqui, mas
// desenha na coluna de 300px com densidade própria — fora desta régua.

import React from "react";
import { leadTier, leadScoreLabel, leadAge } from "../lib/ui.js";
import { cadenceOf, lossReasonLabel } from "../lib/funnel.js";
import { leadPain } from "../lib/pains.js";
import { displayName } from "../lib/users.js";
import { paymentLabel, closedPlanLabel, dealProductLabel, dealProductsOf } from "../lib/payments.js";
import { mentoriaFit, mentoriaOfferLine } from "../lib/mentoria.js";
import { scriptSegments } from "../lib/scripts.js";

const DAY = 86_400_000;

// Caixa padrão dos blocos do painel (tile interno: bg-inset + r-2).
export const leadBox = { border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: "10px 12px", background: "var(--bg-inset)" };

// Resumo compilado do cliente: a dor do anúncio (gancho da conversa), os fatos
// relevantes e a atribuição (de onde o lead veio). Só entra o que está
// preenchido. `cat` = catálogo de atribuição (id → nome de campanha/conjunto/
// anúncio) já resolvido no componente.
//
// `full` = painel que é a FICHA do lead (o drawer do pipeline): acrescenta no
// FIM os campos que só ele mostra (contato, integrador, perda). Os fatos de
// cima ficam idênticos aos do roteiro — é isso que faz os dois baterem.
export function clientSummary(saasCfg, lead, stage, cat, { full = false } = {}) {
  const tier = leadTier(lead);
  const daysInStage = lead.stageSince || lead.createdAt
    ? Math.max(0, Math.floor((Date.now() - new Date(lead.stageSince || lead.createdAt).getTime()) / DAY)) : null;
  const cad = cadenceOf(saasCfg, stage);
  const hasScore = lead.score != null && lead.score !== "";
  const icpPct = (lead.icp != null && lead.icp !== "") ? `${Math.round(Number(lead.icp) * 100)}%` : null;
  const utm = lead.utm || {};
  const money = (v) => (typeof window !== "undefined" && window.fmt?.money?.(v)) || v;
  // Lead da fila da Mentoria: a verba que ele declarou no form é o que decide a
  // oferta, então os dois aparecem juntos (o número sozinho não diz o que fazer).
  const fit = mentoriaFit(lead);
  const facts = [
    ...(fit ? [
      ["Verba pra começar", fit.declared ? fit.verbaLabel : "não declarada"],
      ["Oferta que encaixa", mentoriaOfferLine(fit) || null],
      ["Degrau de resgate", fit.rescue ? mentoriaOfferLine({ offer: fit.rescue }) : null],
      ["Upsell de importação", fit.upsell ? "candidato (+R$ 2.000 durante a mentoria)" : null],
    ] : []),
    ["Potencial", tier.grade ? `${tier.grade} · ${tier.label}` : null],
    ["Temperatura", hasScore ? `${leadScoreLabel(lead.score)} · ${lead.score}` : null],
    ["ICP (fit)", icpPct],
    ["Prioridade", lead.priority],
    ["Faixa de faturamento", lead.value],
    ["Etapa", `${stage}${daysInStage != null ? ` · ${daysInStage}d nela` : ""}`],
    ["Toques na etapa", Number(cad.maxAttempts) ? `${Number(lead.stageAttempts) || 0} de ${cad.maxAttempts}` : (Number(lead.stageAttempts) || 0) || null],
    // O que ele comprou: produto do catálogo da apresentação, escolhido no
    // fechamento (é o escopo que a entrega vai executar).
    ["Produto", dealProductLabel(lead.dealProduct, lead.saas) || null],
    ["Valor", lead.amount ? money(lead.amount) : null],
    // Registrada no movimento Call → Follow-up: é a oferta que o follow-up cobra.
    ["Proposta na mesa", lead.proposalOffer ? (lead.proposalOffer === "nenhuma" ? "não chegou na proposta" : closedPlanLabel(lead.proposalOffer) || lead.proposalOffer) : null],
    ["Pagamento", lead.paymentMethod ? paymentLabel(lead.paymentMethod) : null],
    ["Origem", lead.source],
    ["SDR / closer", [lead.owner && displayName(lead.owner), lead.closer && displayName(lead.closer)].filter(Boolean).join(" / ") || null],
    ["Próximo passo (nota)", lead.nextActionNote],
    ...(full ? [
      ["Idade", leadAge(lead)],
      ["Integrador", lead.integrator ? displayName(lead.integrator) : null],
      ["E-mail", lead.email],
      ["Telefone", lead.phone],
      ["Motivo", lead.reason],
      ["Perda", lead.lostReason ? `${lossReasonLabel(saasCfg, lead.lostReason)}${lead.lostNote ? ` · ${lead.lostNote}` : ""}` : null],
    ] : []),
  ].filter(([, v]) => v != null && v !== "");
  // De onde veio: só o anúncio basta. Com teste A/B no form, mostra também o
  // HEADLINE que o lead viu (denormalizado no submit; fallback pro id da versão).
  const headline = lead.formHeadline || (lead.formVariant ? `versão ${lead.formVariant}` : null);
  const attribution = [
    ["Anúncio", cat?.ads?.[utm.content]?.name || utm.content],
    ["Headline do formulário", headline],
  ].filter(([, v]) => v != null && v !== "");
  return { pain: leadPain(lead, cat, saasCfg?.painMap), facts, attribution };
}

// Linha chave→valor dos grids de fato/atribuição.
export function FactRow({ k, v }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12, padding: "3px 0", borderBottom: "1px solid var(--line-1)" }}>
      <span className="mono dim" style={{ flexShrink: 0, fontSize: 10.5 }}>{k}</span>
      <span style={{ fontWeight: 500, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{v}</span>
    </div>
  );
}

// Resumo do cliente: dor do anúncio em destaque + os fatos num grid.
// `action` = botão do cabeçalho (o "✎ editar" do drawer). `facts` nulo esconde
// o grid (o drawer troca por um formulário durante a edição). `children` entra
// depois do grid (registrar contato / últimos contatos, no roteiro).
export function ClientSummaryCard({ pain, facts, action = null, children = null, style = null }) {
  return (
    <div style={{ ...leadBox, ...(style || {}) }}>
      <div className="kicker" style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
        <span>Resumo do cliente</span>
        {action}
      </div>
      {pain && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 9px", marginBottom: 8, borderRadius: "var(--r-2)", background: "var(--accent-soft)", border: "1px solid var(--accent-line)" }}>
          <span className="kicker accent" style={{ flexShrink: 0 }}>dor do anúncio</span>
          <span style={{ fontSize: 12.5, fontWeight: 600, minWidth: 0 }}>[{pain.code}] {pain.label}</span>
        </div>
      )}
      {facts && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "4px 14px" }}>
          {facts.map(([k, v]) => <FactRow key={k} k={k} v={v} />)}
        </div>
      )}
      {children}
    </div>
  );
}

// De onde veio · atribuição do anúncio. Recolhível quando o painel passa
// `onToggle` (o drawer, que lista campanha/conjunto/página e é consulta).
export function AttributionCard({ rows, open = true, onToggle = null }) {
  if (!rows.length) return null;
  return (
    <div style={leadBox}>
      {onToggle ? (
        <button onClick={onToggle} title={open ? "Recolher" : "Abrir a atribuição (campanha, conjunto, anúncio, origem)"}
          className="kicker" style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
          De onde veio · atribuição do anúncio
          <span style={{ marginLeft: "auto", fontSize: 10, flexShrink: 0 }}>{open ? "▴ recolher" : "▾ abrir"}</span>
        </button>
      ) : (
        <div className="kicker" style={{ marginBottom: 6 }}>De onde veio · atribuição do anúncio</div>
      )}
      {open && (
        <div style={onToggle ? { marginTop: 6 } : null}>
          {rows.map(([k, v]) => <FactRow key={k} k={k} v={v} />)}
        </div>
      )}
    </div>
  );
}

// Dados do lead: o checklist da conversa (lib/scripts.js) com o campo editável
// à direita — select com as opções do formulário, texto livre pro resto. Grava
// na hora (onPatch). Amarelo = ainda falta descobrir.
export function LeadChecklist({ checklist, onPatch, leadId, title = "Dados do lead · na ordem da conversa" }) {
  if (!checklist.length) return null;
  return (
    <div>
      <div className="kicker" style={{ marginBottom: 6 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {checklist.map((c) => (
          <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "5px 9px", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: c.value ? "var(--bg-1)" : "var(--warn-soft)" }}>
            <span style={{ color: c.value ? "var(--pos)" : "var(--warn)", flexShrink: 0, fontSize: 12 }}>{c.value ? "✓" : "○"}</span>
            <span className="dim" style={{ flex: 1, minWidth: 0, fontSize: 11, lineHeight: 1.35 }}>{c.label}</span>
            {c.type === "select" ? (
              <select value={c.raw || ""} onChange={(e) => onPatch({ [c.key]: e.target.value })}
                style={{ flexShrink: 0, maxWidth: "48%", height: 26, padding: "0 6px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: c.raw ? "var(--fg-1)" : "var(--fg-4)", fontSize: 12, fontWeight: 500 }}>
                <option value="">selecionar…</option>
                {c.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                {c.raw && !c.options.some((o) => o.value === c.raw) && <option value={c.raw}>{c.raw}</option>}
              </select>
            ) : (
              <input key={leadId + c.key} type="text" defaultValue={c.raw || ""} placeholder="preencher…"
                onBlur={(e) => { if (e.target.value !== (c.raw || "")) onPatch({ [c.key]: e.target.value }); }}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                style={{ flexShrink: 0, width: "48%", height: 26, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12, fontWeight: 500 }} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Fechamento: O QUE foi vendido ──────────────────────────────────────────
// O card só chega na Integração depois de fechar, e a entrega precisa saber o
// ESCOPO: qual produto da apresentação o cliente comprou. O select sai do
// catálogo real (SEED → template no banco) e os preços viram atalho pro valor
// do negócio — clicar preenche, e dá pra ajustar. Some sozinho no SaaS sem
// catálogo (UniqueKids fecha pacote de consultas).
//
// Usado no gate do board/card (stage-move.jsx) e no "Depois da ação" do Meu dia
// (today.jsx): fechar por qualquer um dos dois registra a mesma coisa.

// Opções do select de produto vendido, compartilhadas com o modal de link de
// pagamento. Linhas de produto que convivem no mesmo SaaS (a Mentoria dentro do
// leverads) vêm do catálogo com `group` e ganham um bloco próprio; sem `group`,
// a opção fica solta no topo, como sempre foi.
export function ProductOptions({ products }) {
  const map = new Map();
  for (const p of products) {
    if (!p.group) continue;
    if (!map.has(p.group)) map.set(p.group, []);
    map.get(p.group).push(p);
  }
  return (
    <>
      {products.filter((p) => !p.group).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      {[...map.entries()].map(([g, rows]) => (
        <optgroup key={g} label={g}>
          {rows.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </optgroup>
      ))}
    </>
  );
}

export function DealProductField({ saas, value, onChange, plan = "", amount = null, onPick, fieldStyle, labelStyle = null, required = true }) {
  const products = dealProductsOf(saas);
  if (!products.length) return null;
  const cur = products.find((p) => p.id === value) || null;
  // Só os preços do PLANO selecionado: o período já é escolhido no "Plano
  // fechado" logo abaixo — listar os dois ciclos duplicava o leque e o destaque
  // por ciclo acendia todos os chips do plano juntos (Leo, 16/08). O rótulo
  // perde o prefixo do ciclo ("Semestral · 50 anúncios" → "50 anúncios");
  // produto sem leque de cotas fica só com o preço. Destacado = o chip cujo
  // valor É o valor do negócio atual.
  // Plano SEM preço no catálogo (assinatura mensal): o leque inteiro fica como
  // referência em vez de sumir — sem ele parecia que o produto tinha sumido
  // (Leo, 16/08). Nesse fallback o ciclo volta pro rótulo (é ele que
  // diferencia) e clicar resolve valor + plano de uma vez (onPick).
  const all = cur?.prices || [];
  const scoped = plan ? all.filter((r) => r.plan === plan) : [];
  const prices = scoped.length ? scoped : all;
  const money = (v) => (typeof window !== "undefined" && window.fmt?.money?.(v)) || `R$${v}`;
  const chipLabel = (r) => {
    let l = String(r.label || "");
    const cyc = closedPlanLabel(r.plan);
    if (scoped.length && cyc && l.startsWith(cyc)) l = l.slice(cyc.length).replace(/^\s*·\s*/, "").trim();
    return l ? `${l} · ${money(r.value)}` : money(r.value);
  };
  return (
    <div>
      <label className="kicker" style={labelStyle || { display: "block", marginBottom: 4 }}>Produto vendido {required ? "*" : ""}</label>
      <select value={value} onChange={(e) => onChange(e.target.value, products.find((p) => p.id === e.target.value) || null)} style={fieldStyle}>
        <option value="">— o que ele comprou na apresentação —</option>
        <ProductOptions products={products} />
      </select>
      {!!prices.length && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
          <span className="mono dim" style={{ fontSize: 10, flexShrink: 0 }}>preço do catálogo</span>
          {prices.map((r) => {
            const on = amount != null && amount !== "" && Number(amount) === r.value;
            return (
              <button key={`${r.plan}-${r.label}-${r.value}`} onClick={() => onPick && onPick(r)}
                title={`Usar ${money(r.value)} como valor do negócio`}
                style={{ height: 24, padding: "0 9px", borderRadius: "var(--r-2)",
                  border: "1px solid " + (on ? "var(--accent-line)" : "var(--line-2)"),
                  background: on ? "var(--accent-soft)" : "var(--bg-1)",
                  color: on ? "var(--accent)" : "var(--fg-2)", fontSize: 11, fontWeight: on ? 600 : 500 }}>
                {chipLabel(r)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
// Produto de SERVIÇO ÚNICO (clonagem avulsa): o plano é sempre "unico", não faz
// sentido perguntar ciclo. Quem consome usa pra travar o select de plano.
export const isOneOffProduct = (saas, id) => !!dealProductsOf(saas).find((p) => p.id === id)?.oneOff;

// Roteiro do estágio: como se comportar + objetivo + passo a passo. A fala vem
// com os dados do lead interpolados (scriptSegments): valor preenchido fica em
// destaque, buraco vira etiqueta amarela ("descubra nesta conversa"). Cada fala
// tem o botão de copiar pra colar no WhatsApp.
export function ScriptBlocks({ script, tokens }) {
  const [copiedStep, setCopiedStep] = React.useState(null);
  const renderFala = (text) => scriptSegments(text, tokens).map((s, i) => {
    if (s.text != null) return <React.Fragment key={i}>{s.text}</React.Fragment>;
    if (s.value != null) return <strong key={i} style={{ color: "var(--accent)", fontWeight: 600 }}>{s.value}</strong>;
    return (
      <span key={i} className="mono" title="dado não preenchido no lead: descubra nesta conversa"
        style={{ background: "var(--warn-soft)", color: "var(--warn)", borderRadius: 4, padding: "0 5px", fontSize: "0.85em", whiteSpace: "nowrap" }}>{s.gap}</span>
    );
  });
  const falaText = (text) => scriptSegments(text, tokens).map((s) => (s.text != null ? s.text : s.value != null ? s.value : s.gap || "")).join("");
  const copyFala = async (text, i) => {
    const t = falaText(text);
    try { await navigator.clipboard.writeText(t); setCopiedStep(i); setTimeout(() => setCopiedStep((c) => (c === i ? null : c)), 1500); }
    catch { window.prompt("Copie a mensagem:", t); }
  };
  return (
    <>
      <div style={{ ...leadBox, background: "var(--accent-soft)", border: "1px solid var(--accent-line)" }}>
        <div className="kicker accent" style={{ marginBottom: 4 }}>Como se comportar</div>
        <div style={{ fontSize: 12, lineHeight: 1.45 }}>{script.resumo}</div>
      </div>
      <div style={leadBox}>
        <div className="kicker" style={{ marginBottom: 4 }}>Objetivo do contato</div>
        <div style={{ fontSize: 12, lineHeight: 1.45, fontWeight: 500 }}>{script.objetivo}</div>
      </div>
      <div>
        <div className="kicker" style={{ marginBottom: 6 }}>Passo a passo</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {(script.passos || []).map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 10 }}>
              <span className="mono tnum" style={{
                width: 20, height: 20, borderRadius: 999, flexShrink: 0, marginTop: 1,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                background: "var(--bg-inset)", border: "1px solid var(--line-2)", fontSize: 10.5, fontWeight: 700, color: "var(--fg-3)",
              }}>{i + 1}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                {p.t && <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 1 }}>{p.t}</div>}
                {/* Passo sem fala é ação pura (ex.: "ligar 2 vezes"): só a dica. */}
                {p.fala && (
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.5, color: "var(--fg-1)", borderLeft: "3px solid var(--accent-line)", paddingLeft: 10, whiteSpace: "pre-wrap" }}>
                      {renderFala(p.fala)}
                    </div>
                    <button onClick={() => copyFala(p.fala, i)} title="Copiar a mensagem (com os dados preenchidos) pra colar no WhatsApp"
                      style={{ flexShrink: 0, height: 24, padding: "0 9px", borderRadius: "var(--r-2)", border: "1px solid " + (copiedStep === i ? "var(--pos)" : "var(--line-2)"),
                        background: "var(--bg-2)", color: copiedStep === i ? "var(--pos)" : "var(--fg-3)", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                      {copiedStep === i ? "copiado ✓" : "⧉ copiar"}
                    </button>
                  </div>
                )}
                {p.dica && <div className="dim" style={{ fontSize: 10.5, marginTop: 2, paddingLeft: 13 }}>{renderFala(p.dica)}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
