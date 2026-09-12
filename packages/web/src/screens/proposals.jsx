import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { EmptyState, PrimaryButton, MoreMenu } from "../atoms.jsx";
import { inputStyle, sectionTitle, cardStyle, addBtnStyle, THEME_DEFAULTS, LabeledInput, LabeledTextarea, ThemeEditor } from "../components/theme-inputs.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import { PageHead, FilterTab } from "../components/viz.jsx";
import { waLink, cockpitProposalUrl } from "../lib/ui.js";
// Proposal builder — propostas comerciais por marca, no MESMO modelo do form
// builder: template = lista de SLIDES estruturados + tema + calculadora; cada
// lead ganha uma instância (snapshot) servida em /p/:id com trava magnética.
// Aba Templates (editor + preview ao vivo) e aba Propostas (geradas: views,
// aceite, links). O editor de slides é dirigido por SLIDE_SPECS — cada tipo
// declara seus campos e o form renderiza genericamente.

const { useState, useEffect, useRef, useCallback } = React;

const SLIDE_TYPES = [
  ["hero", "Hero (abertura)"], ["cards", "Cards (diagnóstico)"], ["receipt", "Fatura (custo oculto)"],
  ["steps", "Passos (solução)"], ["compare", "Antes × Depois"], ["bignum", "Número grande (ROI)"],
  ["pricing", "Investimento (preço)"], ["closer", "Bloco do closer"], ["custom", "HTML livre"],
];

// kind: text | textarea | strlist | objlist (com colunas). Caminhos com ponto
// (ex.: before.label) acessam objetos aninhados.
const SLIDE_SPECS = {
  hero: [
    ["tag", "Tag (pill do topo)", "text"],
    ["title", "Título (h1)", "textarea"],
    ["subtitle", "Subtítulo", "textarea"],
    ["meta", "Meta (grid de até 4)", "objlist", [["label", "rótulo"], ["value", "valor"]]],
  ],
  cards: [
    ["eyebrow", "Eyebrow", "text"], ["title", "Título", "textarea"], ["lead", "Texto de apoio", "textarea"],
    ["cards", "Cards", "objlist", [["label", "rótulo"], ["value", "valor"], ["tag", "tag"]]],
    ["highlight.label", "Destaque · rótulo", "text"], ["highlight.title", "Destaque · título", "text"], ["highlight.pill", "Destaque · pill", "text"],
  ],
  receipt: [
    ["eyebrow", "Eyebrow", "text"], ["title", "Título", "textarea"],
    ["body", "Texto à esquerda", "textarea"], ["note", "Nota (mono, embaixo)", "text"],
    ["header", "Cabeçalho do cupom", "text"], ["subheader", "Subcabeçalho", "text"],
    ["rows", "Linhas", "objlist", [["label", "item"], ["value", "valor"]]],
    ["totalLabel", "Rótulo do total", "text"], ["totalValue", "Valor do total", "text"], ["foot", "Rodapé do cupom", "text"],
  ],
  steps: [
    ["eyebrow", "Eyebrow", "text"], ["title", "Título", "textarea"],
    ["steps", "Passos (último ganha destaque)", "objlist", [["tag", "tag"], ["title", "título"], ["text", "texto"]]],
    ["pills", "Pills (✓ features)", "strlist"],
  ],
  compare: [
    ["eyebrow", "Eyebrow", "text"], ["title", "Título", "textarea"],
    ["before.label", "Antes · rótulo", "text"], ["before.num", "Antes · número", "text"], ["before.unit", "Antes · unidade", "text"], ["before.sub", "Antes · subtexto", "text"],
    ["before.points", "Antes · pontos (✕)", "strlist"],
    ["after.label", "Depois · rótulo", "text"], ["after.num", "Depois · número", "text"], ["after.unit", "Depois · unidade", "text"], ["after.sub", "Depois · subtexto", "text"],
    ["after.points", "Depois · pontos (✓)", "strlist"],
  ],
  bignum: [
    ["eyebrow", "Eyebrow", "text"], ["title", "Título", "textarea"],
    ["items", "Passos numerados", "strlist"], ["note", "Nota destacada", "textarea"],
    ["bigLabel", "Rótulo acima do número", "text"], ["bigValue", "Número grande", "text"],
    ["bigLabel2", "Rótulo abaixo do número", "text"], ["bigCaption", "Legenda", "textarea"],
  ],
  pricing: [
    ["eyebrow", "Eyebrow", "text"], ["title", "Título", "textarea"],
    ["planPill", "Pill do card", "text"], ["planTag", "Tag do plano", "text"],
    ["price", "Preço (vazio = {{calc.preco}})", "text"], ["per", "Sufixo (/ mês)", "text"],
    ["sub", "Subtexto do preço", "text"], ["cycles", "Linha de ciclos (vazio = {{calc.precoCiclos}})", "text"],
    ["optionsFeatured", "Grade de ciclos · destaque (ex.: semiannual; vazio = sem grade)", "text"],
    ["optionsBadge", "Grade de ciclos · selo do destaque", "text"],
    ["features", "Lista de features (✓)", "strlist"],
    ["guaranteeHead", "Garantia · cabeçalho", "text"], ["guaranteeTitle", "Garantia · título", "text"], ["guaranteeText", "Garantia · texto", "textarea"],
    ["paybackLabel", "Payback · rótulo", "text"], ["paybackNum", "Payback · número", "text"], ["paybackCaption", "Payback · legenda", "text"],
    ["closeLine", "Frase de fechamento", "textarea"], ["acceptLabel", "Botão de aceite (vazio = sem botão)", "text"],
  ],
  closer: [
    ["label", "Rótulo", "text"], ["name", "Nome do closer", "text"], ["photo", "Foto (URL)", "text"],
    ["ctaLabel", "Texto do CTA", "text"], ["ctaUrl", "URL do CTA (wa.me/…)", "text"],
  ],
  custom: [["html", "HTML do slide (interpolações {{...}} funcionam)", "textarea"]],
};

const CALC_FIELDS = [
  ["salaryMonthly", "Salário/mês (R$)"], ["workHours", "Horas/mês"], ["minCopy", "Min cópia/anúncio"],
  ["minCompatEdit", "Min compat/edição"], ["reworkPct", "Retrabalho (0–1)"], ["netMargin", "Margem líquida (0–1)"],
  ["revenueUpliftPct", "Uplift receita (%)"], ["maxSeats", "Máx. contas"], ["validDays", "Validade (dias)"],
];

const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
const setPath = (obj, path, val) => {
  const parts = path.split(".");
  const out = { ...obj };
  let cur = out;
  for (let i = 0; i < parts.length - 1; i++) { cur[parts[i]] = { ...(cur[parts[i]] || {}) }; cur = cur[parts[i]]; }
  cur[parts[parts.length - 1]] = val;
  return out;
};

// Campos comuns a TODO slide (fora do SLIDE_SPECS): mídia e condição de exibição.
// Objeto some do slide quando esvaziado — snapshot/render não veem lixo vazio.
const patchMedia = (slide, field, v) => {
  const media = { ...(slide.media || {}), [field]: v };
  if (!String(media.url || "").trim() && !String(media.caption || "").trim()) {
    const { media: _drop, ...rest } = slide;
    return rest;
  }
  return { ...slide, media };
};
const patchShowIf = (slide, field, v) => {
  const showIf = { ...(slide.showIf || {}) };
  if (field === "values") showIf.values = v.split(",").map((s) => s.trim()).filter(Boolean);
  else showIf[field] = v;
  if (!String(showIf.key || "").trim() && !(showIf.values || []).length) {
    const { showIf: _drop, ...rest } = slide;
    return rest;
  }
  return { ...slide, showIf };
};

// ── Orçamento de largura (mesma régua de Clientes/Pipeline/Meu dia) ───────
// 1024px de janela menos 220 de nav, 56 de pad-x e 32 de padding do cartão
// sobram 716px. A soma dos PISOS + gaps de cada tabela tem que caber aí, e o
// smoke-ssr falha se alguém alargar uma coluna sem perceber.
export const TPL_GRID = "minmax(150px,1.3fr) 92px minmax(120px,1fr) 76px 180px";
export const PROP_GRID = "minmax(140px,1.3fr) minmax(110px,1fr) 76px minmax(130px,1fr) 190px";
export const GRID_GAP = 12;
export const GRID_BUDGET = 716;

const publicBase = () => import.meta.env.VITE_API_BASE || window.location.origin;

function ProposalsScreen({ saasId }) {
  const { SAAS } = window.SEED;
  const { version } = useData();
  // Produto do WORKSPACE (seletor no pé da sidebar) — sem abas próprias.
  const [activeProduct] = useActiveSaas();
  const active = activeProduct?.id;
  // Filtro da tabela de geradas (era uma ABA que mostrava a mesma lista da
  // seção "Geradas recentemente" logo abaixo). Persiste como a aba persistia.
  const [filtro, setFiltroState] = useState(() => { try { return localStorage.getItem("cockpit_proposals_filtro") || "todas"; } catch { return "todas"; } }); // todas | fechadas | abertas | nunca
  const setFiltro = (f) => { setFiltroState(f); try { localStorage.setItem("cockpit_proposals_filtro", f); } catch { /* ignore */ } };
  const [templates, setTemplates] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [editing, setEditing] = useState(null); // { template } | null
  const [copied, setCopied] = useState(""); // id da proposta com link no clipboard

  const load = useCallback(async () => {
    if (!active) return;
    const [ts, ps] = await Promise.all([
      api.list("proposal_templates", { saas: active }),
      api.list("proposals", { saas: active }),
    ]);
    ps.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    setTemplates(ts); setProposals(ps);
  }, [active]);
  useEffect(() => { load(); }, [load, version]);

  // Troca de produto (workspace) fecha o editor e limpa as linhas antigas —
  // um template da outra marca não pode ficar aberto (nem ser salvo) sob o
  // workspace novo.
  useEffect(() => { setEditing(null); setTemplates([]); setProposals([]); }, [active]);

  if (!SAAS.length) return <EmptyState title="Nenhum SaaS ainda" hint="Crie um produto em Ajustes — templates de proposta pertencem a um SaaS." />;

  if (editing) return (
    <TemplateEditor
      template={editing.template} saasId={active}
      onDone={async () => { setEditing(null); await load(); }}
      onCancel={() => setEditing(null)}
    />
  );

  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "") : "—");
  const templateById = new Map(templates.map((t) => [t.id, t]));
  const recentCutoff = Date.now() - 30 * 86400000;
  const outlineButton = {
    height: 30, padding: "0 12px", border: "1px solid var(--line-2)",
    borderRadius: "var(--r-2)", background: "var(--bg-1)", color: "var(--fg-2)",
    fontSize: 12.5, fontWeight: 600, boxShadow: "var(--shadow-1)",
    display: "inline-flex", alignItems: "center", textDecoration: "none",
  };
  const removeTemplate = async (t) => {
    if (!window.confirm(`Excluir o template "${t.name || t.id}"? As propostas já geradas continuam de pé (cada uma é um snapshot), mas ninguém gera nada novo a partir dele.`)) return;
    await api.remove("proposal_templates", t.id);
    await load();
  };
  const duplicate = (template) => {
    const next = structuredClone(template);
    delete next.id;
    delete next.createdAt;
    delete next.updatedAt;
    next.name = `${next.name || "Template"} · cópia`;
    next.status = "draft";
    setEditing({ template: next });
  };

  // ── O funil da proposta (12/09) ──────────────────────────────────────────
  // Os três números viviam soltos numa caixa cinza dentro de cada card de
  // template — são os três PASSOS de um funil (gerada → aberta → fechou), e a
  // conversão entre eles é o que diz se o template funciona.
  const emJanela = (p) => !p.createdAt || new Date(p.createdAt).getTime() >= recentCutoff;
  const doPeriodo = proposals.filter(emJanela);
  const fun = {
    geradas: doPeriodo.length,
    abertas: doPeriodo.filter((p) => Number(p.views || 0) > 0).length,
    fecharam: doPeriodo.filter((p) => p.accepted).length,
  };
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);
  const diasDe = (iso) => {
    const t = iso ? new Date(iso).getTime() : NaN;
    return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 86400000)) : null;
  };
  // Enviadas e nunca abertas: é a fila de quem precisa de um empurrão.
  const nuncaAbertas = proposals.filter((p) => !p.accepted && !(Number(p.views || 0) > 0));

  const FILTROS = [
    ["todas", "Todas", proposals.length],
    ["fechadas", "Fecharam", proposals.filter((p) => p.accepted).length],
    ["abertas", "Abertas", proposals.filter((p) => !p.accepted && Number(p.views || 0) > 0).length],
    ["nunca", "Não abertas", nuncaAbertas.length],
  ];
  const filtrada = filtro === "fechadas" ? proposals.filter((p) => p.accepted)
    : filtro === "abertas" ? proposals.filter((p) => !p.accepted && Number(p.views || 0) > 0)
    : filtro === "nunca" ? nuncaAbertas
    : proposals;

  // Template ordenado pelo que ele ENTREGA: quem fecha mais fica em cima. Sem
  // proposta gerada ainda (conv null) vai pro fim, porque não há o que julgar.
  const templatesPorConversao = templates
    .map((t) => {
      const linked = proposals.filter((p) => p.template === t.id);
      const g = linked.filter(emJanela).length;
      const o = linked.filter((p) => Number(p.views || 0) > 0).length;
      const c = linked.filter((p) => p.accepted).length;
      return { t, g, o, c, conv: pct(c, g) };
    })
    .sort((a, b) => (b.conv ?? -1) - (a.conv ?? -1) || b.g - a.g);

  // Uma tabela só (a aba "Geradas" e a seção "Geradas recentemente" mostravam
  // a MESMA lista, a segunda sob um título que dizia "recentemente" enquanto
  // exibia tudo).
  const tabelaGeradas = (
    <section style={{ background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px var(--inset-x) 12px", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h3 className="card-title" style={{ margin: 0 }}>Propostas geradas</h3>
          <div className="card-sub" style={{ marginTop: 3 }}>o link entra no card do lead como “proposta ↗”</div>
        </div>
        <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          {FILTROS.map(([id, label, n]) => (
            <FilterTab key={id} active={filtro === id} count={n} onClick={() => setFiltro(id)}>{label}</FilterTab>
          ))}
        </div>
      </div>
      {!filtrada.length ? (
        <div style={{ padding: "26px var(--inset-x)", color: "var(--fg-4)", fontSize: 13, borderTop: "1px solid var(--line-1)" }}>
          {proposals.length ? "Nada neste filtro." : "Nenhuma proposta gerada ainda."}
        </div>
      ) : (
        <div className="tbl-x">
          <div>
            <div className="kicker" style={{ display: "grid", gridTemplateColumns: PROP_GRID, gap: 12, padding: "10px var(--inset-x)", fontWeight: 600, borderTop: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>
              <span>Lead</span><span>Template</span><span>Gerada</span><span>O que aconteceu</span><span style={{ textAlign: "right" }}>Ação</span>
            </div>
            {filtrada.map((p) => {
              const template = templateById.get(p.template);
              const views = Number(p.views || 0);
              const dias = diasDe(p.createdAt);
              const leadName = p.data?.lead?.name || p.lead || "Lead";
              const company = p.data?.lead?.company;
              const primeiroNome = String(p.data?.lead?.firstName || leadName).trim().split(/\s+/)[0] || "";
              const wa = waLink(p.data?.lead?.phone);
              const url = `${publicBase()}/p/${p.id}`;
              return (
                <div key={p.id} style={{ display: "grid", gridTemplateColumns: PROP_GRID, gap: 12, padding: "12px var(--inset-x)", alignItems: "center", borderTop: "1px solid var(--line-faint)" }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{leadName}</span>
                    {company && <span style={{ display: "block", fontSize: 11.5, color: "var(--fg-4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{company}</span>}
                  </span>
                  <span style={{ fontSize: 12.5, color: "var(--fg-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={template?.name || p.name}>{template?.name || p.name || "Proposta"}</span>
                  <span className="tnum" style={{ fontSize: 12.5, color: "var(--fg-3)", whiteSpace: "nowrap" }}>
                    {fmtDate(p.createdAt)}
                    {dias != null && <span style={{ display: "block", fontSize: 10.5, color: "var(--fg-4)" }}>{dias === 0 ? "hoje" : `há ${dias}d`}</span>}
                  </span>
                  {/* O estado agora tem NOÇÃO DE TEMPO: enviada há 40 dias e
                      nunca aberta não é a mesma coisa que a de ontem. */}
                  <span style={{ minWidth: 0, fontSize: 12.5 }}>
                    {p.accepted ? (
                      <>
                        <span className="chip pos">fechou</span>
                        {views > 0 && <span className="mono dim" style={{ fontSize: 10.5, marginLeft: 6 }}>{`abriu ${views}x`}</span>}
                      </>
                    ) : views > 0 ? (
                      <span style={{ color: "var(--fg-2)" }}>{`abriu ${views} ${views === 1 ? "vez" : "vezes"}`}</span>
                    ) : (
                      <span style={{ color: "var(--neg)", fontWeight: 600 }}>
                        {dias == null ? "nunca abriu" : `nunca abriu · ${dias} ${dias === 1 ? "dia" : "dias"}`}
                      </span>
                    )}
                  </span>
                  {/* Ação de verdade em cada linha. "abrir" leva ?from=cockpit
                      (o time conferindo não pode virar "o lead abriu", senão o
                      funil aqui em cima mente); o WhatsApp e o copiar levam o
                      link limpo. */}
                  <span style={{ textAlign: "right", whiteSpace: "nowrap", display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                    <a href={cockpitProposalUrl(url)} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 600 }}>abrir ↗</a>
                    {!p.accepted && wa && (
                      <a href={`${wa}?text=${encodeURIComponent(`Oi${primeiroNome ? ` ${primeiroNome}` : ""}, te mandei a proposta aqui: ${url}`)}`}
                        target="_blank" rel="noopener noreferrer" title={views > 0 ? "abriu e não respondeu: cobrar resposta" : "nunca abriu: reenviar o link"}
                        style={{ height: 26, display: "inline-flex", alignItems: "center", padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--wa-brand)", background: "var(--wa-brand)", color: "var(--wa-brand-fg)", fontSize: 11.5, fontWeight: 700, textDecoration: "none" }}>
                        {views > 0 ? "cobrar" : "reenviar"}
                      </a>
                    )}
                    <button onClick={() => { try { navigator.clipboard.writeText(url); setCopied(p.id); setTimeout(() => setCopied(""), 1600); } catch { /* ignore */ } }}
                      style={{ height: 26, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 11.5, cursor: "pointer" }}>
                      {copied === p.id ? "copiado ✓" : "copiar"}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead title="Propostas" sub="templates por marca · a proposta é gerada a partir do lead">
        <PrimaryButton onClick={() => setEditing({ template: null })}>+ novo template</PrimaryButton>
      </PageHead>

      <div style={{ flex: 1, overflow: "auto", padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Faixa do funil: os três passos com a conversão entre cada par. */}
        <section style={{ background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)", padding: "20px var(--inset-x)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            {[["Geradas · 30d", fun.geradas, null], ["Abertas", fun.abertas, pct(fun.abertas, fun.geradas)], ["Fecharam", fun.fecharam, pct(fun.fecharam, fun.abertas)]].map(([label, valor, conv], i) => (
              <React.Fragment key={label}>
                {i > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", color: "var(--fg-4)" }}>
                    <span style={{ fontSize: 14 }}>→</span>
                    <span className="tnum" style={{ fontSize: 11.5 }}>{conv == null ? "—" : `${conv}%`}</span>
                  </div>
                )}
                <div style={{ minWidth: 96 }}>
                  <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 26, fontWeight: 700, color: i === 2 ? "var(--pos)" : "var(--fg-1)" }}>{valor}</div>
                  <div style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{label}</div>
                </div>
              </React.Fragment>
            ))}
            {nuncaAbertas.length > 0 && (
              <div style={{ marginLeft: "auto", textAlign: "right" }}>
                <div style={{ fontSize: 12.5, color: "var(--neg)", fontWeight: 600 }}>
                  {`${nuncaAbertas.length} ${nuncaAbertas.length === 1 ? "enviada e nunca aberta" : "enviadas e nunca abertas"}`}
                </div>
                <button onClick={() => setFiltro("nunca")} className="mono"
                  style={{ background: "none", border: 0, padding: 0, fontSize: 12, color: "var(--accent)", fontWeight: 600, cursor: "pointer" }}>
                  ver quais →
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Templates em LINHAS, ordenados por conversão: card com três botões
            de peso igual não dizia qual template usar. */}
        {!templates.length ? (
          <div style={{ minHeight: 230, background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)" }}>
            <EmptyState title="Nenhum template neste SaaS" hint="Crie o template base usado para gerar propostas a partir dos leads." action={<PrimaryButton onClick={() => setEditing({ template: null })}>+ criar template</PrimaryButton>} />
          </div>
        ) : (
          <section style={{ background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)", overflow: "hidden" }}>
            <div style={{ padding: "18px var(--inset-x) 12px" }}>
              <h3 className="card-title" style={{ margin: 0 }}>Templates</h3>
              <div className="card-sub" style={{ marginTop: 3 }}>ordenados por conversão de gerada a fechada</div>
            </div>
            <div className="tbl-x">
              <div>
                <div className="kicker" style={{ display: "grid", gridTemplateColumns: TPL_GRID, gap: 12, padding: "8px var(--inset-x)", fontWeight: 600, background: "var(--bg-inset)", borderTop: "1px solid var(--line-1)" }}>
                  <span>Template</span><span>Estado</span><span>Gerada → aberta → fechou</span><span style={{ textAlign: "right" }}>Conversão</span><span style={{ textAlign: "right" }}>Ação</span>
                </div>
                {templatesPorConversao.map(({ t, g, o, c, conv }) => {
                  const pub = t.status === "published";
                  const largura = (n) => (g > 0 ? Math.max(2, Math.min(100, (n / g) * 100)) : 0);
                  return (
                    <div key={t.id} style={{ display: "grid", gridTemplateColumns: TPL_GRID, gap: 12, padding: "12px var(--inset-x)", alignItems: "center", borderTop: "1px solid var(--line-faint)" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name || t.id}</div>
                        <div style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{`${(t.slides || []).length} slides`}</div>
                      </div>
                      {/* Rascunho NÃO é esmaecido: o badge carrega o estado (o
                          opacity derrubava o contraste do texto de 12px). */}
                      <span><span className={pub ? "chip accent" : "chip"}>{pub ? "base" : "rascunho"}</span></span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", height: 7, borderRadius: 999, overflow: "hidden", background: "var(--bg-2)" }}>
                          <div style={{ width: `${largura(c)}%`, background: "var(--pos)" }} />
                          <div style={{ width: `${Math.max(0, largura(o) - largura(c))}%`, background: "var(--accent)" }} />
                        </div>
                        <div className="mono dim tnum" style={{ fontSize: 10.5, marginTop: 3 }}>{`${g} · ${o} · ${c}`}</div>
                      </div>
                      <span className="tnum" style={{ textAlign: "right", fontSize: 14, fontWeight: 700, color: conv == null ? "var(--fg-4)" : conv >= 20 ? "var(--pos)" : "var(--fg-1)" }}>
                        {conv == null ? "—" : `${conv}%`}
                      </span>
                      {/* O handoff pedia "usar →" como ação primária. A proposta
                          só nasce COM lead (POST /api/leads/:id/proposal, botão
                          no card), então aqui "usar" seria um botão que não usa
                          nada: a ação primária da linha é editar o template. */}
                      <span style={{ textAlign: "right", display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                        <button onClick={() => setEditing({ template: t })} style={{ ...outlineButton, background: "var(--btn-bg)", color: "var(--btn-fg)", borderColor: "transparent" }}>editar</button>
                        <a href={`${publicBase()}/p/t/${t.id}`} target="_blank" rel="noreferrer" style={outlineButton} title="abre o template como o lead vê">prévia ↗</a>
                        <MoreMenu items={[{ label: "duplicar template", onClick: () => duplicate(t) }, { label: "excluir template", tone: "neg", onClick: () => removeTemplate(t) }]} />
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {tabelaGeradas}
      </div>
    </div>
  );
}

// ── Editor de template ───────────────────────────────────────────────────────

function newTemplate(saasId) {
  return {
    name: "", saas: saasId, status: "draft",
    theme: { ...THEME_DEFAULTS },
    acceptStage: "",
    calc: { salaryMonthly: 3000, workHours: 176, minCopy: 10, minCompatEdit: 2, reworkPct: 0.10, netMargin: 0.10, revenueUpliftPct: 50, maxSeats: 20, validDays: 7, seatsKey: "", volumeKey: "", seatsMap: {}, volumeMid: {}, plans: {}, defaultCycle: "monthly" },
    slides: [
      { key: "hero", type: "hero", tag: "Proposta personalizada · confidencial", title: "Quanto a *{{lead.company}}* perde *todo mês*.", subtitle: "", meta: [{ label: "Apresentado a", value: "{{lead.name}}" }, { label: "Empresa", value: "{{lead.company}}" }] },
      { key: "preco", type: "pricing", eyebrow: "Investimento", title: "O investimento:", planTag: "PLANO · {{calc.plano}}", per: "/ mês", features: [], acceptLabel: "Aceitar proposta" },
    ],
  };
}

function TemplateEditor({ template, saasId, onDone, onCancel }) {
  const isEdit = !!template?.id;
  const [draft, setDraft] = useState(() => template
    ? { ...newTemplate(saasId), ...structuredClone(template), theme: { ...THEME_DEFAULTS, ...(template.theme || {}) } }
    : newTemplate(saasId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const product = (window.SEED.SAAS || []).find((s) => s.id === draft.saas);
  const stages = (product?.funnel || []).map((f) => f.stage);

  const [previewHtml, setPreviewHtml] = useState("");
  const timer = useRef(null);
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { setPreviewHtml((await api.proposalPreview({ template: draft })).html); }
      catch { /* best-effort */ }
    }, 600);
    return () => clearTimeout(timer.current);
  }, [draft]);

  async function save() {
    if (!String(draft.name).trim()) { setError("Dê um nome ao template"); return; }
    if (!(draft.slides || []).length) { setError("Adicione ao menos um slide"); return; }
    setBusy(true); setError(null);
    const payload = {
      name: draft.name.trim(), saas: draft.saas, status: draft.status,
      theme: draft.theme, acceptStage: draft.acceptStage || "",
      calc: draft.calc, slides: draft.slides,
    };
    try {
      if (isEdit) await api.update("proposal_templates", template.id, payload);
      else await api.create("proposal_templates", payload);
      await onDone();
    } catch (e) { setBusy(false); setError(e.message || String(e)); }
  }

  return (
    <div className="editor-split" style={{ flex: 1, "--cols": "minmax(min(100%, 460px), 1fr) minmax(min(100%, 380px), 44%)", minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, borderRight: "1px solid var(--line-1)" }}>
        <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="kicker">{isEdit ? "Editar template" : "Novo template"}</div>
            <div style={{ fontSize: 16, fontWeight: 500, marginTop: 2 }}>{draft.name || "Sem nome"}</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className={"chip " + (draft.status === "published" ? "pos" : "")} style={{ height: 20 }}>{draft.status === "published" ? "publicado" : "rascunho"}</span>
            <button onClick={onCancel} style={{ padding: "7px 12px", background: "var(--bg-2)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", fontSize: 12 }}>Cancelar</button>
            <button onClick={save} disabled={busy} style={{ padding: "7px 14px", background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", borderRadius: "var(--r-2)", fontSize: 12, fontWeight: 500, opacity: busy ? 0.6 : 1 }}>
              {busy ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "14px 20px 32px" }}>
          {error && <div className="mono" style={{ fontSize: 11, color: "var(--neg)", marginBottom: 10 }}>{error}</div>}

          <div className="kicker" style={sectionTitle}>Básico</div>
          <div style={{ display: "flex", gap: 10 }}>
            <LabeledInput label="Nome do template" value={draft.name} onChange={(v) => set({ name: v })} placeholder="Proposta · LeverAds" />
            <label style={{ display: "flex", flexDirection: "column", gap: 4, width: 220 }}>
              <span className="kicker">Aceite move o lead para</span>
              <select value={draft.acceptStage || ""} onChange={(e) => set({ acceptStage: e.target.value })} style={inputStyle}>
                <option value="">(não mover)</option>
                {stages.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <div className="mono dim" style={{ fontSize: 11, margin: "8px 0 0", lineHeight: 1.5 }}>
            Interpolações: {"{{lead.name}} {{lead.firstName}} {{lead.company}} {{answers.<chave>}} {{calc.preco}} {{calc.custoMes}} {{calc.custoAno}} {{calc.vendasEquiv}} {{calc.roi}} {{calc.plano}} {{calc.precoCiclos}} {{calc.fatTotal}} {{calc.horasMes}} {{state.validUntil}}"} · *palavra* = itálico na cor da marca.
          </div>

          <div className="kicker" style={sectionTitle}>Slides</div>
          <SlidesBuilder slides={draft.slides || []} onChange={(slides) => set({ slides })} />

          <div className="kicker" style={sectionTitle}>Calculadora (custo oculto / preço)</div>
          <CalcEditor calc={draft.calc || {}} onChange={(calc) => set({ calc })} />

          <div className="kicker" style={sectionTitle}>Tema da marca</div>
          <ThemeEditor theme={draft.theme} onChange={(theme) => set({ theme })} />
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, background: "var(--bg-inset)" }}>
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="kicker">Preview ao vivo (dados de exemplo)</span>
          {isEdit && (
            <a href={`${publicBase()}/p/t/${template.id}`} target="_blank" rel="noreferrer" className="mono code" style={{ fontSize: 11, color: "var(--accent)" }}>
              abrir preview ↗
            </a>
          )}
        </div>
        <iframe title="Preview da proposta" srcDoc={previewHtml} sandbox="allow-scripts allow-same-origin" style={{ flex: 1, border: 0, width: "100%", background: draft.theme.bg }} />
      </div>
    </div>
  );
}

// ── Editor de slides (dirigido por SLIDE_SPECS) ──────────────────────────────

function SlidesBuilder({ slides, onChange }) {
  const update = (i, next) => { const arr = [...slides]; arr[i] = next; onChange(arr); };
  const remove = (i) => onChange(slides.filter((_, j) => j !== i));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= slides.length) return;
    const arr = [...slides];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    onChange(arr);
  };
  const arrowStyle = (disabled) => ({ fontSize: 12, padding: "0 3px", color: "var(--fg-3)", opacity: disabled ? 0.3 : 1, fontFamily: "var(--mono)", cursor: disabled ? "default" : "pointer" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {slides.map((s, i) => (
        <SlideCard key={i} slide={s} index={i} total={slides.length}
          onChange={(next) => update(i, next)} onRemove={() => remove(i)} onMove={(d) => move(i, d)} arrowStyle={arrowStyle} />
      ))}
      <button type="button" style={addBtnStyle}
        onClick={() => onChange([...slides, { key: `slide_${slides.length + 1}`, type: "cards" }])}>+ adicionar slide</button>
    </div>
  );
}

function SlideCard({ slide, index, total, onChange, onRemove, onMove, arrowStyle }) {
  const [open, setOpen] = useState(false);
  const spec = SLIDE_SPECS[slide.type] || [];
  const typeName = (SLIDE_TYPES.find(([v]) => v === slide.type) || [])[1] || slide.type;
  const title = getPath(slide, "title") || getPath(slide, "name") || getPath(slide, "tag") || "";

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span className="mono dim tnum" style={{ fontSize: 11, width: 18 }}>{String(index + 1).padStart(2, "0")}</span>
        <button type="button" onClick={() => setOpen(!open)} style={{ flex: 1, textAlign: "left", display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span className="chip" style={{ height: 20, flexShrink: 0 }}>{typeName}</span>
          <span style={{ fontSize: 12.5, color: "var(--fg-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
          <span className="mono dim" style={{ marginLeft: "auto" }}>{open ? "▾" : "▸"}</span>
        </button>
        <div style={{ display: "flex" }}>
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0} style={arrowStyle(index === 0)}>↑</button>
          <button type="button" onClick={() => onMove(1)} disabled={index === total - 1} style={arrowStyle(index === total - 1)}>↓</button>
        </div>
        <button type="button" onClick={onRemove} className="mono dim" style={{ fontSize: 13, padding: "0 6px" }}>✕</button>
      </div>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 24 }}>
          <select value={slide.type} onChange={(e) => onChange({ key: slide.key, type: e.target.value })} style={{ ...inputStyle, width: 220 }}>
            {SLIDE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {spec.map(([path, label, kind, cols]) => {
            const val = getPath(slide, path);
            if (kind === "text") return <LabeledInput key={path} label={label} value={val} onChange={(v) => onChange(setPath(slide, path, v))} />;
            if (kind === "textarea") return <LabeledTextarea key={path} label={label} value={val} onChange={(v) => onChange(setPath(slide, path, v))} />;
            if (kind === "strlist") return <StrList key={path} label={label} items={val || []} onChange={(v) => onChange(setPath(slide, path, v))} />;
            if (kind === "objlist") return <ObjList key={path} label={label} cols={cols} items={val || []} onChange={(v) => onChange(setPath(slide, path, v))} />;
            return null;
          })}
          <div style={{ display: "flex", gap: 10 }}>
            <LabeledInput label="Mídia · URL (imagem, GIF ou vídeo .mp4)" value={slide.media?.url || ""} onChange={(v) => onChange(patchMedia(slide, "url", v))} />
            <LabeledInput label="Mídia · legenda (opcional)" value={slide.media?.caption || ""} onChange={(v) => onChange(patchMedia(slide, "caption", v))} />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <LabeledInput label="Mostrar só se · resposta do form (ex.: niche)" value={slide.showIf?.key || ""} onChange={(v) => onChange(patchShowIf(slide, "key", v))} />
            <LabeledInput label="…tiver um destes valores (vírgula)" value={(slide.showIf?.values || []).join(", ")} onChange={(v) => onChange(patchShowIf(slide, "values", v))} />
          </div>
        </div>
      )}
    </div>
  );
}

function StrList({ label, items, onChange }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span className="kicker">{label}</span>
      {items.map((it, i) => (
        <div key={i} style={{ display: "flex", gap: 6 }}>
          <input value={it} onChange={(e) => { const arr = [...items]; arr[i] = e.target.value; onChange(arr); }} style={inputStyle} />
          <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="mono dim" style={{ fontSize: 13, padding: "0 6px" }}>✕</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, ""])} style={addBtnStyle}>+ item</button>
    </div>
  );
}

function ObjList({ label, cols, items, onChange }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span className="kicker">{label}</span>
      {items.map((it, i) => (
        <div key={i} style={{ display: "flex", gap: 6 }}>
          {cols.map(([ck, cph]) => (
            <input key={ck} value={it[ck] ?? ""} placeholder={cph}
              onChange={(e) => { const arr = [...items]; arr[i] = { ...arr[i], [ck]: e.target.value }; onChange(arr); }}
              style={{ ...inputStyle, flex: 1 }} />
          ))}
          <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="mono dim" style={{ fontSize: 13, padding: "0 6px" }}>✕</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, {}])} style={addBtnStyle}>+ item</button>
    </div>
  );
}

// ── Calculadora ──────────────────────────────────────────────────────────────

function CalcEditor({ calc, onChange }) {
  const set = (k, v) => onChange({ ...calc, [k]: v });
  const cycles = [["monthly", "Mensal"], ["quarterly", "Trimestral"], ["semiannual", "Semestral"], ["annual", "Anual"]];
  const setPlan = (cycle, field, v) => {
    const plans = { ...(calc.plans || {}) };
    plans[cycle] = { ...(plans[cycle] || {}), [field]: v === "" ? "" : Number(v) };
    if (Object.values(plans[cycle]).every((x) => x === "" || x == null)) delete plans[cycle];
    onChange({ ...calc, plans });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ ...cardStyle, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        {CALC_FIELDS.map(([k, label]) => (
          <LabeledInput key={k} label={label} type="number" value={calc[k]} onChange={(v) => set(k, v === "" ? "" : Number(v))} />
        ))}
      </div>
      <div style={{ ...cardStyle }}>
        <div style={{ display: "flex", gap: 10 }}>
          <LabeledInput label="Chave da resposta de CONTAS (ex.: accounts)" value={calc.seatsKey} onChange={(v) => set("seatsKey", v)} />
          <LabeledInput label="Chave da resposta de VOLUME (ex.: volume)" value={calc.volumeKey} onChange={(v) => set("volumeKey", v)} />
          <label style={{ display: "flex", flexDirection: "column", gap: 4, width: 140 }}>
            <span className="kicker">Ciclo padrão</span>
            <select value={calc.defaultCycle || "monthly"} onChange={(e) => set("defaultCycle", e.target.value)} style={inputStyle}>
              {cycles.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>
        <MapEditor label="Faixa de contas → nº de contas na fórmula (topo da faixa)" map={calc.seatsMap || {}} onChange={(m) => set("seatsMap", m)} />
        <MapEditor label="Faixa de volume → anúncios/semana (volumeMid)" map={calc.volumeMid || {}} onChange={(m) => set("volumeMid", m)} />
      </div>
      <div style={{ ...cardStyle }}>
        <span className="kicker">Planos (R$/mês · contas incluídas · R$ por conta extra)</span>
        {cycles.map(([v, l]) => (
          <div key={v} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span className="mono dim" style={{ fontSize: 11, width: 76 }}>{l}</span>
            <input type="number" placeholder="base R$" value={calc.plans?.[v]?.base ?? ""} onChange={(e) => setPlan(v, "base", e.target.value)} style={{ ...inputStyle, width: 110 }} />
            <input type="number" placeholder="incluídas" value={calc.plans?.[v]?.included ?? ""} onChange={(e) => setPlan(v, "included", e.target.value)} style={{ ...inputStyle, width: 100 }} />
            <input type="number" placeholder="extra R$" value={calc.plans?.[v]?.extra ?? ""} onChange={(e) => setPlan(v, "extra", e.target.value)} style={{ ...inputStyle, width: 110 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function MapEditor({ label, map, onChange }) {
  const entries = Object.entries(map);
  const setEntry = (i, k, v) => {
    const arr = entries.map(([ek, ev]) => [ek, ev]);
    arr[i] = [k, v];
    onChange(Object.fromEntries(arr.filter(([ek]) => String(ek).trim() !== "")));
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
      <span className="kicker">{label}</span>
      {entries.map(([k, v], i) => (
        <div key={i} style={{ display: "flex", gap: 6 }}>
          <input value={k} placeholder="resposta" onChange={(e) => setEntry(i, e.target.value, v)} className="mono" style={{ ...inputStyle, width: 140, fontSize: 12 }} />
          <input type="number" value={v} placeholder="número" onChange={(e) => setEntry(i, k, e.target.value === "" ? "" : Number(e.target.value))} style={{ ...inputStyle, width: 110 }} />
          <button type="button" onClick={() => onChange(Object.fromEntries(entries.filter((_, j) => j !== i)))} className="mono dim" style={{ fontSize: 13, padding: "0 6px" }}>✕</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange({ ...map, "": 0 })} style={addBtnStyle}>+ par</button>
    </div>
  );
}

export { ProposalsScreen };
