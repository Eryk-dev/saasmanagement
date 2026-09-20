import React from "react";
import "./proposals.css";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { EmptyState, PrimaryButton, useEsc } from "../atoms.jsx";
import { inputStyle, sectionTitle, cardStyle, addBtnStyle, THEME_DEFAULTS, LabeledInput, LabeledTextarea, ThemeEditor } from "../components/theme-inputs.jsx";
import { useActiveSaas } from "../lib/workspace.js";
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

// Pisos da prancha; em telas estreitas as tabelas rolam internamente.
export const TPL_GRID = "minmax(220px,1.5fr) minmax(100px,.6fr) minmax(170px,1.1fr) minmax(100px,.7fr) minmax(170px,.9fr)";
export const PROP_GRID = "minmax(200px,1.4fr) minmax(190px,1fr) minmax(110px,.7fr) minmax(170px,1fr) minmax(210px,1fr)";
export const GRID_GAP = 12;
export const GRID_BUDGET = 928;

const publicBase = () => import.meta.env.VITE_API_BASE || window.location.origin;

function ProposalsScreen() {
  const { SAAS } = window.SEED;
  const { version } = useData();
  const [product] = useActiveSaas(), active=product?.id;
  const [filtro,setFiltroState]=useState(()=>{try{return localStorage.getItem('cockpit_proposals_filtro')||'todas';}catch{return 'todas';}});
  const setFiltro=value=>{setFiltroState(value);try{localStorage.setItem('cockpit_proposals_filtro',value);}catch{}};
  const [templates,setTemplates]=useState([]),[proposals,setProposals]=useState([]),[editing,setEditing]=useState(null),[copied,setCopied]=useState('');
  const [reads,setReads]=useState({key:null,loaded:false,error:null}),[busy,setBusy]=useState(''),[actionError,setActionError]=useState(null);
  const loadSeq=useRef(0),returnFocus=useRef(null);
  const load=useCallback(async()=>{
    if(!active)return;
    const seq=++loadSeq.current;
    setReads(r=>r.key===active?{...r,error:null}:{key:active,loaded:false,error:null});
    try {
      const [ts,ps]=await Promise.all([api.list('proposal_templates',{saas:active}),api.list('proposals',{saas:active})]);
      if(seq!==loadSeq.current)return;
      setTemplates(ts);setProposals([...ps].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))));setReads({key:active,loaded:true,error:null});
    }catch(error){if(seq===loadSeq.current)setReads({key:active,loaded:false,error});}
  },[active]);
  useEffect(()=>{load();return()=>{loadSeq.current++;};},[load,version]);
  useEffect(()=>{setEditing(null);setActionError(null);setCopied('');},[active]);
  useEffect(()=>{if(!editing&&returnFocus.current)document.querySelector(`[data-proposal-action="${CSS.escape(returnFocus.current)}"]`)?.focus({preventScroll:true});},[editing]);
  const edit=(template,event)=>{returnFocus.current=(event?.currentTarget||document.activeElement)?.getAttribute('data-proposal-action');setEditing({template});};
  async function removeTemplate(t) {
    if(busy||!window.confirm(`Excluir o template "${t.name||t.id}"? As propostas já geradas continuam de pé (cada uma é um snapshot), mas ninguém gera nada novo a partir dele.`))return;
    setBusy(t.id);setActionError(null);
    try{await api.remove('proposal_templates',t.id);await load();}catch(error){setActionError(error.message||'Não foi possível excluir o template.');}finally{setBusy('');}
  }
  function duplicate(t,event){const next=structuredClone(t);delete next.id;delete next.createdAt;delete next.updatedAt;next.name=`${next.name||'Template'} · cópia`;next.status='draft';edit(next,event);}
  async function copy(p){try{await navigator.clipboard.writeText(`${publicBase()}/p/${p.id}`);setCopied(p.id);setTimeout(()=>setCopied(''),1600);}catch{setActionError('Não foi possível copiar o link. Tente novamente.');}}
  if(!SAAS.length)return <EmptyState title="Nenhum SaaS ainda" hint="Crie um produto em Ajustes — templates de proposta pertencem a um SaaS."/>;
  if(editing)return <TemplateEditor template={editing.template} saasId={active} onDone={async()=>{setEditing(null);await load();}} onCancel={()=>setEditing(null)}/>;
  const recentCutoff=Date.now()-30*86400000,emJanela=p=>!p.createdAt||new Date(p.createdAt).getTime()>=recentCutoff;
  const period=proposals.filter(emJanela),fun={geradas:period.length,abertas:period.filter(p=>Number(p.views||0)>0).length,fecharam:period.filter(p=>p.accepted).length};
  const pct=(a,b)=>b>0?Math.round(a/b*100):null;
  const never=proposals.filter(p=>!p.accepted&&!(Number(p.views||0)>0));
  const filters=[['todas','Todas',proposals.length],['fechadas','Fecharam',proposals.filter(p=>p.accepted).length],['abertas','Abertas',proposals.filter(p=>!p.accepted&&Number(p.views||0)>0).length],['nunca','Não abertas',never.length]];
  const filtered=filtro==='fechadas'?proposals.filter(p=>p.accepted):filtro==='abertas'?proposals.filter(p=>!p.accepted&&Number(p.views||0)>0):filtro==='nunca'?never:proposals;
  const ordered=templates.map(t=>{const linked=proposals.filter(p=>p.template===t.id),g=linked.filter(emJanela).length,o=linked.filter(p=>Number(p.views||0)>0).length,c=linked.filter(p=>p.accepted).length;return {t,g,o,c,conv:pct(c,g)};}).sort((a,b)=>(b.conv??-1)-(a.conv??-1)||b.g-a.g);
  const templateById=new Map(templates.map(t=>[t.id,t]));
  return <div className="proposals-page">
    <header className="proposals-header"><h1>Propostas</h1><button data-proposal-action="new" onClick={event=>edit(null,event)}>Criar template</button></header>
    {reads.key!==active||(!reads.loaded&&!reads.error)?<div className="proposals-state" role="status">Carregando propostas…</div>:reads.error?<div className="proposals-state" role="alert">Não foi possível carregar as propostas. <button onClick={load}>Tentar novamente</button></div>:<>
      <section className="proposals-funnel capsule-navy">
        <svg className="proposals-mark" width="180" height="180" viewBox="355 525 455 590" aria-hidden="true"><polygon fill="currentColor" points="800.7 535.53 800.7 1103.92 763 983.8 749.25 939.91 691.16 754.61 501.54 817.84 457.65 832.42 362.47 864.14 443.6 803.33 481.22 775.08 800.7 535.53"/></svg>
        <h2><i/>o caminho da proposta</h2>
        <div className="proposals-path">{[
          ['Geradas em 30 dias',fun.geradas,null,null],['Abertas pelo lead',fun.abertas,pct(fun.abertas,fun.geradas),'abriram'],['Fecharam',fun.fecharam,pct(fun.fecharam,fun.abertas),'fecharam'],
        ].map(([label,value,rate,note],i)=><div key={label}>{i>0&&<div className="proposals-path-arrow"><b>{rate==null?'—':`${rate}%`}</b><span>→</span><small>{note}</small></div>}<div className="proposals-path-value"><span>{label}</span><strong style={i===2?{color:'var(--accent)'}:undefined}>{value}</strong></div></div>)}</div>
        {never.length>0&&<div className="proposals-never"><span><i/>{never.length} {never.length===1?'enviada e nunca aberta':'enviadas e nunca abertas'}</span><button onClick={()=>setFiltro('nunca')}>Ver quais</button></div>}
      </section>
      {actionError&&<div role="alert" className="proposals-state">{actionError}</div>}
      <section className="proposals-templates proposals-card">
        <div className="proposals-section-head"><div><h2><i/>templates</h2><p>ordenados por conversão de gerada a fechada</p></div></div>
        {!templates.length?<EmptyState title="Nenhum template neste SaaS" hint="Crie o template base usado para gerar propostas a partir dos leads." action={<PrimaryButton onClick={event=>edit(null,event)}>Criar template</PrimaryButton>}/>:<div className="tbl-x"><div style={{minWidth:820}}>
          <div className="proposals-table-head" style={{gridTemplateColumns:TPL_GRID}}><span>Template</span><span>Estado</span><span>Gerada → aberta → fechou</span><span>Conversão</span><span>Ação</span></div>
          {ordered.map(({t,g,o,c,conv})=>{const width=n=>g>0?Math.max(2,Math.min(100,n/g*100)):0;return <div className="proposals-template-row proposals-table-row" key={t.id} style={{gridTemplateColumns:TPL_GRID}}>
            <div className="proposals-template-name"><button data-proposal-action={`edit:${t.id}`} onClick={event=>edit(t,event)} aria-label={`Editar template: ${t.name||t.id}`}>{t.name||t.id}</button><a href={`${publicBase()}/p/t/${t.id}`} target="_blank" rel="noreferrer" aria-label={`Prévia de ${t.name||t.id}`}>{t.layout==='slides'?'apresentação em slides · montada pela tela zero, não por slide':`${(t.slides||[]).length} slides`}</a></div>
            <span><span className="proposals-pill" data-published={t.status==='published'}>{t.status==='published'?'base':'rascunho'}</span></span>
            <div><div className="proposals-template-bar"><i style={{width:`${width(c)}%`}}/><i style={{width:`${Math.max(0,width(o)-width(c))}%`}}/></div><small className="proposals-template-numbers">{g} · {o} · {c}</small></div>
            <b className="proposals-conversion" style={{color:conv==null?'var(--fg-4)':conv>=20?'var(--pos)':'var(--fg-1)'}}>{conv==null?'—':`${conv}%`}</b>
            <div className="proposals-row-actions"><button data-proposal-action={`duplicate:${t.id}`} disabled={!!busy} onClick={event=>duplicate(t,event)}>Duplicar</button><button disabled={!!busy} className="proposals-delete" onClick={()=>removeTemplate(t)}>{busy===t.id?'Excluindo…':'Excluir'}</button></div>
          </div>;})}
        </div></div>}
      </section>
      <section className="proposals-generated proposals-card">
        <div className="proposals-section-head"><div><h2><i/>propostas geradas</h2><p>o link entra no card do lead como “proposta ↗”</p></div><div className="proposals-filters">{filters.map(([id,label,n])=><button key={id} aria-pressed={filtro===id} onClick={()=>setFiltro(id)}>{label} <span>{n}</span></button>)}</div></div>
        <div className="tbl-x"><div style={{minWidth:880}}>
          <div className="proposals-table-head" style={{gridTemplateColumns:PROP_GRID}}><span>Lead</span><span>Template</span><span>Gerada</span><span>O que aconteceu</span><span>Ação</span></div>
          {filtered.map(p=>{
            const template=templateById.get(p.template),views=Number(p.views||0),at=p.createdAt?new Date(p.createdAt).getTime():NaN,days=Number.isFinite(at)?Math.max(0,Math.floor((Date.now()-at)/86400000)):null;
            const name=p.data?.lead?.name||p.lead||'Lead',company=p.data?.lead?.company,first=String(p.data?.lead?.firstName||name).trim().split(/\s+/)[0]||'',wa=waLink(p.data?.lead?.phone),url=`${publicBase()}/p/${p.id}`;
            const happened=p.accepted?`fechou${views>0?` · abriu ${views}x`:''}`:views>0?`abriu ${views} ${views===1?'vez':'vezes'}`:days==null?'nunca abriu':`nunca abriu · ${days} ${days===1?'dia':'dias'}`;
            return <div className="proposals-generated-row proposals-table-row" style={{gridTemplateColumns:PROP_GRID}} key={p.id}>
              <div className="proposals-lead"><strong>{name}</strong>{company&&<small>{company}</small>}</div>
              <span className="proposals-template-label" title={template?.name||p.name}>{template?.name||p.name||'Proposta'}</span>
              <div className="proposals-date"><span>{p.createdAt?new Date(p.createdAt).toLocaleDateString('pt-BR'):'—'}</span>{days!=null&&<small>{days===0?'hoje':`há ${days}d`}</small>}</div>
              <span className="proposals-result" data-state={p.accepted?'accepted':views>0?'opened':'never'}>{happened}</span>
              <div className="proposals-row-actions"><a className="proposals-open" href={cockpitProposalUrl(url)} target="_blank" rel="noreferrer">abrir ↗</a>{!p.accepted&&wa&&<a className="proposals-wa" href={`${wa}?text=${encodeURIComponent(`Oi${first?` ${first}`:''}, te mandei a proposta aqui: ${url}`)}`} target="_blank" rel="noopener noreferrer">{views>0?'Cobrar':'Reenviar'}</a>}<button onClick={()=>copy(p)}>{copied===p.id?'Copiado ✓':'Copiar'}</button></div>
            </div>;
          })}
          {!filtered.length&&<div className="proposals-empty">{proposals.length?'Nada neste filtro.':'Nenhuma proposta gerada ainda.'}</div>}
        </div></div>
      </section>
    </>}
  </div>;
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
  const original=useRef(JSON.stringify(draft));
  const dirty=JSON.stringify(draft)!==original.current;
  const cancel=()=>{if(!busy&&(!dirty||window.confirm("Descartar as alterações deste template?")))onCancel();};
  useEsc(busy?null:cancel);
  const editor=useRef(null);
  useEffect(()=>{editor.current?.querySelector('input')?.focus();},[]);

  const product = (window.SEED.SAAS || []).find((s) => s.id === draft.saas);
  const stages = (product?.funnel || []).map((f) => f.stage);

  const [previewHtml,setPreviewHtml]=useState(''),[previewError,setPreviewError]=useState(null),[previewAttempt,setPreviewAttempt]=useState(0);
  useEffect(()=>{
    let alive=true;
    const timer=setTimeout(async()=>{
      setPreviewError(null);
      try {const result=await api.proposalPreview({template:draft});if(alive)setPreviewHtml(result.html);}
      catch(error){if(alive)setPreviewError(error.message||'Não foi possível carregar a prévia.');}
    },600);
    return()=>{alive=false;clearTimeout(timer);};
  },[draft,previewAttempt]);

  async function save() {
    if (!String(draft.name).trim()) { setError("Dê um nome ao template"); return; }
    if (!(draft.slides || []).length) { setError("Adicione ao menos um slide"); return; }
    if(busy)return;
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
    <div ref={editor} className="editor-split proposal-editor" style={{ flex: 1, "--cols": "minmax(min(100%, 460px), 1fr) minmax(min(100%, 380px), 44%)", minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, borderRight: "1px solid var(--line-1)" }}>
        <div className="proposal-editor-head" style={{ padding: "12px 20px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="kicker">{isEdit ? "Editar template" : "Novo template"}</div>
            <div style={{ fontSize: 16, fontWeight: 500, marginTop: 2 }}>{draft.name || "Sem nome"}</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className={"chip " + (draft.status === "published" ? "pos" : "")} style={{ height: 20 }}>{draft.status === "published" ? "publicado" : "rascunho"}</span>
            <button onClick={cancel} disabled={busy} style={{ padding: "7px 12px", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: 999, fontSize: 12 }}>Cancelar</button>
            <button onClick={save} disabled={busy} style={{ padding: "7px 14px", background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", borderRadius: 999, fontSize: 12, fontWeight: 500, opacity: busy ? 0.6 : 1 }}>
              {busy ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "14px 20px 32px" }}>
          {error && <div role="alert" className="mono" style={{ fontSize: 11, color: "var(--neg)", marginBottom: 10 }}>{error}</div>}

          <div className="kicker" style={sectionTitle}>Básico</div>
          <div className="proposal-editor-basics" style={{ display: "flex", gap: 10 }}>
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
        {previewError&&<div role="alert" className="proposal-editor-preview-state">{previewError} <button onClick={()=>setPreviewAttempt(n=>n+1)}>Tentar novamente</button></div>}
        {!previewHtml&&!previewError&&<div role="status" className="proposal-editor-preview-state">Carregando prévia…</div>}
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
          <div className="proposal-editor-row" style={{ display: "flex", gap: 10 }}>
            <LabeledInput label="Mídia · URL (imagem, GIF ou vídeo .mp4)" value={slide.media?.url || ""} onChange={(v) => onChange(patchMedia(slide, "url", v))} />
            <LabeledInput label="Mídia · legenda (opcional)" value={slide.media?.caption || ""} onChange={(v) => onChange(patchMedia(slide, "caption", v))} />
          </div>
          <div className="proposal-editor-row" style={{ display: "flex", gap: 10 }}>
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
        <div className="proposal-list-row" key={i} style={{ display: "flex", gap: 6 }}>
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
        <div className="proposal-list-row" key={i} style={{ display: "flex", gap: 6 }}>
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
      <div className="proposal-calculator-grid" style={{ ...cardStyle, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        {CALC_FIELDS.map(([k, label]) => (
          <LabeledInput key={k} label={label} type="number" value={calc[k]} onChange={(v) => set(k, v === "" ? "" : Number(v))} />
        ))}
      </div>
      <div style={{ ...cardStyle }}>
        <div className="proposal-editor-row" style={{ display: "flex", gap: 10 }}>
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
        <div className="proposal-list-row" key={i} style={{ display: "flex", gap: 6 }}>
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
