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
  // ── A apresentação de hoje × o que sobrou ────────────────────────────────
  // O template PUBLICADO do produto é a apresentação oficial: é ela que nasce
  // sozinha quando o lead entra pelo formulário e a que o botão "gerar
  // apresentação" usa. Ela era uma linha igual às outras numa tabela que
  // também listava os decks APOSENTADOS em 18/09 — que não geram mais nada,
  // mas não dá pra apagar (o catálogo de preço mora no pt_leverads e cada
  // proposta enviada é uma cópia fechada). Agora a oficial é o cartão do topo
  // e os aposentados ficam recolhidos, continuando editáveis.
  const oficial=ordered.find(({t})=>t.officialSince)||ordered.find(({t})=>t.status==='published'&&t.layout==='slides')||ordered.find(({t})=>t.status==='published')||null;
  // Arquivado = o que a migração carimbou no NOME ([ARQUIVO]/[BACKUP]) e não
  // está publicado. Pelo estado não dava: rascunho é também o deck que alguém
  // acabou de duplicar e ainda está escrevendo, e esse não pode sumir.
  const arquivado=t=>/^\[(arquivo|backup)/i.test(String(t.name||''))&&t.status!=='published';
  const resto=ordered.filter(({t})=>t.id!==oficial?.t.id);
  const outras=resto.filter(({t})=>!arquivado(t));
  const arquivados=resto.filter(({t})=>arquivado(t));
  const acoes={busy,onEdit:edit,onDuplicate:duplicate,onRemove:removeTemplate};
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
      {oficial&&<CurrentDeck row={oficial} onEdit={event=>edit(oficial.t,event)}/>}
      <QuickPreview templates={templates}/>
      {!templates.length&&<section className="proposals-templates proposals-card">
        <EmptyState title="Nenhum template neste SaaS" hint="Crie o template base usado para gerar propostas a partir dos leads." action={<PrimaryButton onClick={event=>edit(null,event)}>Criar template</PrimaryButton>}/>
      </section>}
      {!!outras.length&&<section className="proposals-templates proposals-card">
        <div className="proposals-section-head"><div><h2><i/>outras apresentações</h2><p>decks alternativos e rascunhos em edição</p></div></div>
        <TemplateTable rows={outras} {...acoes}/>
      </section>}
      {!!arquivados.length&&<details className="proposals-archive proposals-card">
        <summary><h2><i/>arquivados · {arquivados.length}</h2><span>fora de uso: não geram apresentação nova. Seguem aqui porque o que já foi enviado é cópia fechada e o catálogo de preço mora no template antigo.</span></summary>
        <TemplateTable rows={arquivados} {...acoes}/>
      </details>}
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

// ── A apresentação de hoje ──────────────────────────────────────────────────
// O cartão responde "qual é a nossa apresentação?" sem abrir o editor: o nome,
// desde quando é a oficial, as telas que o cliente vê e o que ela já fez. As
// telas do deck de slides vêm do PRÓPRIO renderer (CONFIG.proposals.slidesDeck,
// lido do HTML do deck) — slide novo aparece aqui sem uma segunda lista pra
// alguém esquecer de atualizar. Nos decks campo a campo, saem dos slides do
// template.
const COND_LABEL={oem:'com OEM no plano',ads:'com Lever Ads no plano',price:'com Lever Price no plano',pratica:'com ticket e pedidos preenchidos',resultados:'com cases publicados'};
const semToken=s=>String(s||'').replace(/\{\{[^}]*\}\}/g,'…').replace(/\*/g,'').trim();
export function deckScreens(t,outline){
  const telas=outline||window.SEED?.CONFIG?.proposals?.slidesDeck||[];
  if(t.layout==='slides')return telas.map(s=>({label:s.label,nota:COND_LABEL[s.cond]||''}));
  return (t.slides||[]).map((s,i)=>({label:semToken(s.title||s.tag||s.name).slice(0,42)||`slide ${i+1}`,nota:s.showIf?.key?`só com ${s.showIf.key}`:''}));
}

export function CurrentDeck({row,outline,onEdit}){
  const {t,g,o,c}=row;
  const telas=deckScreens(t,outline);
  const desde=/^\d{4}-\d{2}-\d{2}$/.test(t.officialSince||'')?t.officialSince.split('-').reverse().join('/'):'';
  return <section className="proposals-current proposals-card">
    <div className="proposals-current-head">
      <div>
        <h2><i/>a apresentação de hoje</h2>
        <strong>{t.name||t.id}</strong>
        <p>Nasce sozinha quando o lead entra pelo formulário e é a que o botão “gerar apresentação” usa.{desde?` Oficial desde ${desde}.`:''}</p>
      </div>
      <div className="proposals-current-actions">
        <a href={`${publicBase()}/p/t/${t.id}`} target="_blank" rel="noreferrer" title="abre o deck como o closer apresenta, com a tela zero">Abrir prévia ↗</a>
        <button data-proposal-action={`edit:${t.id}`} onClick={onEdit}>Editar</button>
      </div>
    </div>
    {!!telas.length&&<ol className="proposals-screens">{telas.map((s,i)=><li key={i} className={s.nota?'is-cond':undefined} title={s.nota?`só entra ${s.nota}`:undefined}>{s.label}{s.nota&&<em>{s.nota}</em>}</li>)}</ol>}
    <div className="proposals-current-facts">
      {!!telas.length&&<span><b>{telas.length}</b> telas{t.layout==='slides'?' · o texto mora no código; preço e entregáveis, na tabela':''}</span>}
      <span><b>{g}</b> geradas em 30 dias</span>
      <span><b>{o}</b> abertas</span>
      <span><b>{c}</b> fecharam</span>
    </div>
  </section>;
}

// ── Formulário do deck (prévia rápida e editor) ─────────────────────────────
// Os decks com TELA ZERO (a apresentação em slides e a de criação de anúncios)
// não se editam campo a campo: o que muda de cliente pra cliente são os poucos
// campos da tela zero. Este formulário é o mesmo nos dois lugares onde ele
// aparece — o cartão "prévia rápida" da tela e o editor do template —, e é
// dele que saem tanto a prévia quanto o link que vai pro cliente.
const PREVIEW_NUM = {
  oem: [["qtd", "Quantidade de anúncios", "na call"], ["valor", "Valor por anúncio (R$)", "na call"]],
  slides: [["contas", "Contas", "2"], ["pedidos", "Pedidos/mês", "na call"], ["ticket", "Ticket médio (R$)", "na call"], ["vistaPct", "Desc. à vista (%)", "20"]],
};
const TIER_NOME = { essencial: "Essencial", escala: "Escala", enterprise: "Enterprise" };
const LINHA_NOME = { ads: "Lever Ads", oem: "Lever OEM (autopeças)" };
export const DECK_FORM_VAZIO = { nome: "", empresa: "", contas: "", pedidos: "", ticket: "", vistaPct: "", qtd: "", valor: "", linha: "", tier: "", price: false, priceTier: "", oem: false, oemPack: "", periodo: "anual" };
export const temTelaZero = t => t?.layout === "slides" || t?.layout === "oem";

// As opções vêm do catálogo DO DECK, como na tela zero. Toggle sem opção no
// catálogo não entra: caixa com select vazio é botão que não faz nada.
function deckOpcoes(deck, f) {
  const products = deck.calc?.catalog?.products || {};
  const linhas = ["ads", "oem"].filter(l => products[`${l}_essencial`] || products[`${l}_escala`]);
  const linha = f.linha || linhas[0] || "ads";
  return {
    products, linhas, linha,
    tiers: ["essencial", "escala"].filter(t => products[`${linha}_${t}`]),
    priceTiers: ["essencial", "escala", "enterprise"].filter(t => products[`price_${t}`]),
    packs: deck.calc?.catalog?.oemPacks || [],
  };
}

// O que a tela zero do deck guarda, a partir do formulário. Campo vazio fica
// vazio: quem decide o padrão é o deck, não esta tela.
export function deckPayload(deck, f) {
  const base = { nome: f.nome.trim(), empresa: f.empresa.trim() };
  if (deck.layout === "oem") return { ...base, qtd: f.qtd, valor: f.valor };
  const { linha, tiers, priceTiers, packs } = deckOpcoes(deck, f);
  const out = { ...base, contas: f.contas, pedidos: f.pedidos, ticket: f.ticket, vistaPct: f.vistaPct, linha, tier: f.tier || tiers[0] || "", periodo: f.periodo };
  if (f.price) { out.price = true; out.priceTier = f.priceTier || priceTiers[0] || ""; }
  if (f.oem) { out.oem = true; out.oemPack = f.oemPack || packs[0]?.qty || ""; }
  return out;
}
export function deckPreviewHref(deck, f) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(deckPayload(deck, f))) if (v !== "" && v != null && v !== false) q.set(k, String(v));
  const qs = q.toString();
  return `${publicBase()}/p/t/${deck.id}${qs ? `?${qs}` : ""}`;
}

export function DeckForm({ deck, value: f, onChange }) {
  const set = (k, v) => onChange({ ...f, [k]: v });
  const { products, linhas, linha, tiers, priceTiers, packs } = deckOpcoes(deck, f);
  const num = ([k, label, ph]) => <label key={k}><span>{label}</span><input type="number" min="0" inputMode="decimal" placeholder={ph} value={f[k]} onChange={e => set(k, e.target.value)}/></label>;
  return <div className="proposals-deck-form">
    <label><span>Cliente</span><input value={f.nome} placeholder="nome do lead" onChange={e => set("nome", e.target.value)}/></label>
    <label><span>Empresa</span><input value={f.empresa} placeholder="empresa" onChange={e => set("empresa", e.target.value)}/></label>
    {(PREVIEW_NUM[deck.layout] || []).map(num)}
    {deck.layout === "slides" && <>
      <label><span>Linha</span><select value={linha} onChange={e => { onChange({ ...f, linha: e.target.value, tier: "" }); }}>{linhas.map(l => <option key={l} value={l}>{LINHA_NOME[l] || l}</option>)}</select></label>
      <label><span>Pacote</span><select value={f.tier || tiers[0] || ""} onChange={e => set("tier", e.target.value)}>{tiers.map(t => <option key={t} value={t}>{TIER_NOME[t]} · {products[`${linha}_${t}`]?.contas || 0} contas</option>)}</select></label>
      <label><span>Período</span><select value={f.periodo} onChange={e => set("periodo", e.target.value)}><option value="anual">Anual · 12×</option><option value="semestral">Semestral · 6×</option></select></label>
      {!!priceTiers.length && <label className="proposals-deck-check"><span><input type="checkbox" checked={f.price} onChange={e => set("price", e.target.checked)}/>Lever Price</span>
        <select disabled={!f.price} value={f.priceTier || priceTiers[0] || ""} onChange={e => set("priceTier", e.target.value)}>{priceTiers.map(t => <option key={t} value={t}>{TIER_NOME[t]}</option>)}</select></label>}
      {!!packs.length && <label className="proposals-deck-check"><span><input type="checkbox" checked={f.oem} onChange={e => set("oem", e.target.checked)}/>Pacote de OEM</span>
        <select disabled={!f.oem} value={f.oemPack || packs[0]?.qty || ""} onChange={e => set("oemPack", e.target.value)}>{packs.map(pk => <option key={pk.qty} value={pk.qty}>{Number(pk.qty).toLocaleString("pt-BR")} anúncios</option>)}</select></label>}
    </>}
  </div>;
}

// ── Prévia rápida ───────────────────────────────────────────────────────────
// Responde "como fica a apresentação com os dados DESTE cliente?" sem gerar
// proposta pra ninguém: os campos viram query da /p/t/:id, que abre o deck no
// modo closer com a fita de "nada aqui é salvo". Deck sem tela zero (os campo a
// campo) não aparece aqui: a prévia deles é o link de sempre na tabela.
export function QuickPreview({ templates }) {
  const ordem = t => (t.officialSince ? 0 : t.status === "published" ? 1 : 2);
  const decks = templates.filter(temTelaZero).sort((a, b) => ordem(a) - ordem(b));
  const [deckId, setDeckId] = useState("");
  const [f, setF] = useState(DECK_FORM_VAZIO);
  const deck = decks.find(t => t.id === deckId) || decks[0];
  if (!deck) return null;
  return <section className="proposals-preview proposals-card">
    <div className="proposals-section-head">
      <div><h2><i/>prévia rápida</h2><p>preencha e abra a apresentação como o cliente vai ver. Nada é salvo e nenhuma proposta é gerada.</p></div>
      {decks.length > 1 && <select className="proposals-preview-deck" value={deck.id} onChange={e => setDeckId(e.target.value)} aria-label="Apresentação">
        {decks.map(t => <option key={t.id} value={t.id}>{t.pickLabel || t.name || t.id}</option>)}
      </select>}
    </div>
    <DeckForm deck={deck} value={f} onChange={setF}/>
    <div className="proposals-preview-foot">
      <a href={deckPreviewHref(deck, f)} target="_blank" rel="noreferrer">Abrir prévia ↗</a>
      <small>abre em aba nova, no modo closer, com a tela zero já preenchida</small>
    </div>
  </section>;
}

// Tabela de templates (a mesma linha serve as duas listas: em uso e arquivados).
function TemplateTable({rows,busy,onEdit,onDuplicate,onRemove}){
  return <div className="tbl-x"><div style={{minWidth:820}}>
    <div className="proposals-table-head" style={{gridTemplateColumns:TPL_GRID}}><span>Template</span><span>Estado</span><span>Gerada → aberta → fechou</span><span>Conversão</span><span>Ação</span></div>
    {rows.map(({t,g,o,c,conv})=>{const width=n=>g>0?Math.max(2,Math.min(100,n/g*100)):0;return <div className="proposals-template-row proposals-table-row" key={t.id} style={{gridTemplateColumns:TPL_GRID}}>
      <div className="proposals-template-name"><button data-proposal-action={`edit:${t.id}`} onClick={event=>onEdit(t,event)} aria-label={`Editar template: ${t.name||t.id}`}>{t.name||t.id}</button><a href={`${publicBase()}/p/t/${t.id}`} target="_blank" rel="noreferrer" aria-label={`Prévia de ${t.name||t.id}`}>{t.layout==='slides'?'apresentação em slides · montada pela tela zero, não por slide':`${(t.slides||[]).length} slides`}</a></div>
      <span><span className="proposals-pill" data-published={t.status==='published'}>{t.status==='published'?'base':'rascunho'}</span></span>
      <div><div className="proposals-template-bar"><i style={{width:`${width(c)}%`}}/><i style={{width:`${Math.max(0,width(o)-width(c))}%`}}/></div><small className="proposals-template-numbers">{g} · {o} · {c}</small></div>
      <b className="proposals-conversion" style={{color:conv==null?'var(--fg-4)':conv>=20?'var(--pos)':'var(--fg-1)'}}>{conv==null?'—':`${conv}%`}</b>
      <div className="proposals-row-actions"><button data-proposal-action={`duplicate:${t.id}`} disabled={!!busy} onClick={event=>onDuplicate(t,event)}>Duplicar</button><button disabled={!!busy} className="proposals-delete" onClick={()=>onRemove(t)}>{busy===t.id?'Excluindo…':'Excluir'}</button></div>
    </div>;})}
  </div></div>;
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

const draftCatalogo = t => t?.calc?.catalog || null;

function TemplateEditor({ template, saasId, onDone, onCancel }) {
  const isEdit = !!template?.id;
  // Deck com TELA ZERO (apresentação em slides e criação de anúncios) não se
  // edita campo a campo: as telas e os textos moram no renderer. O que muda sem
  // deploy é a TABELA de preço (quando o deck tem uma), o tema e os dados do
  // cliente. O editor de slides + calculadora do deck antigo, aberto num deles,
  // mostrava uma lista vazia e travava o salvar.
  const telaZero = temTelaZero(template);
  const temCatalogo = !!draftCatalogo(template);
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

  // Dados do cliente pra este deck: alimentam a prévia e o link avulso. Ficam
  // FORA do draft de propósito — não são do template, são desta apresentação.
  const [deckForm,setDeckForm]=useState(DECK_FORM_VAZIO);
  const [link,setLink]=useState(''),[linkBusy,setLinkBusy]=useState(false),[linkErro,setLinkErro]=useState(null),[linkCopiado,setLinkCopiado]=useState(false);
  async function gerarLink() {
    if(linkBusy)return;
    setLinkBusy(true);setLinkErro(null);
    try {
      const r=await api.proposalLink(template.id,{config:deckPayload(draft,deckForm)});
      setLink(`${publicBase()}/p/${r.id}`);setLinkCopiado(false);
    } catch(e){setLinkErro(e.message||String(e));}
    setLinkBusy(false);
  }
  async function copiarLink() {
    try{await navigator.clipboard.writeText(link);setLinkCopiado(true);setTimeout(()=>setLinkCopiado(false),1600);}
    catch{setLinkErro('Não foi possível copiar. Selecione o link e copie na mão.');}
  }

  const [previewHtml,setPreviewHtml]=useState(''),[previewError,setPreviewError]=useState(null),[previewAttempt,setPreviewAttempt]=useState(0);
  useEffect(()=>{
    let alive=true;
    const timer=setTimeout(async()=>{
      setPreviewError(null);
      try {
        // A prévia do iframe acompanha o formulário: o closer vê o deck com os
        // dados que acabou de digitar, não com o cliente de exemplo.
        const payload=telaZero?{template:draft,state:draft.layout==='oem'?{deckOem:deckPayload(draft,deckForm)}:{deckC:deckPayload(draft,deckForm)}}:{template:draft};
        const result=await api.proposalPreview(payload);if(alive)setPreviewHtml(result.html);
      }
      catch(error){if(alive)setPreviewError(error.message||'Não foi possível carregar a prévia.');}
    },600);
    return()=>{alive=false;clearTimeout(timer);};
  },[draft,deckForm,telaZero,previewAttempt]);

  async function save() {
    if (!String(draft.name).trim()) { setError("Dê um nome ao template"); return; }
    if (!telaZero && !(draft.slides || []).length) { setError("Adicione ao menos um slide"); return; }
    if(busy)return;
    setBusy(true); setError(null);
    const payload = {
      name: draft.name.trim(), saas: draft.saas, status: draft.status,
      theme: draft.theme, acceptStage: draft.acceptStage || "",
      calc: draft.calc, slides: draft.slides,
    };
    if (draft.layout) payload.layout = draft.layout; // o PATCH é merge, mas duplicar um deck de slides precisa levar o layout junto
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
          {telaZero ? (
            <>
              <p className="proposal-editor-note">
                As telas e os textos desta apresentação moram no código, no palco de slides: o deck é montado pela tela zero, não slide a slide.
                {temCatalogo
                  ? " Aqui se edita o que muda sem deploy: os dados do cliente desta apresentação, a tabela de preço, os entregáveis e o tema da marca. O preço novo vale para as apresentações geradas daqui pra frente; as que já estão com o cliente são cópias fechadas (re-gere pelo card do lead para atualizar)."
                  : " Aqui se preenchem os dados desta apresentação e o tema da marca. O link gerado é uma cópia fechada: mexer no template depois não muda o que o cliente já viu."}
              </p>

              {isEdit && <>
                <div className="kicker" style={sectionTitle}>Dados desta apresentação</div>
                <DeckForm deck={draft} value={deckForm} onChange={setDeckForm}/>
                <div className="proposal-deck-actions">
                  <a href={deckPreviewHref(draft, deckForm)} target="_blank" rel="noreferrer">Abrir prévia ↗</a>
                  <button type="button" onClick={gerarLink} disabled={linkBusy||dirty} title={dirty?'Salve o template antes de gerar o link':undefined}>{linkBusy?'Gerando…':'Gerar link do cliente'}</button>
                  <small>{dirty?'salve as alterações do template antes de gerar o link':'o link abre a apresentação pronta: sem tela de edição e sem fita de prévia'}</small>
                </div>
                {linkErro && <div role="alert" className="mono" style={{ fontSize: 11, color: "var(--neg)", marginTop: 8 }}>{linkErro}</div>}
                {link && <div className="proposal-deck-link">
                  <input readOnly value={link} onFocus={e => e.target.select()} aria-label="Link da apresentação"/>
                  <button type="button" onClick={copiarLink}>{linkCopiado?'Copiado ✓':'Copiar'}</button>
                  <a href={link} target="_blank" rel="noreferrer">abrir ↗</a>
                </div>}
              </>}

              {temCatalogo && <>
                <div className="kicker" style={sectionTitle}>Tabela de preço e entregáveis</div>
                <CatalogEditor catalog={draft.calc?.catalog || null} onChange={(catalog) => set({ calc: { ...(draft.calc || {}), catalog } })} />
              </>}
            </>
          ) : (
            <>
              <div className="mono dim" style={{ fontSize: 11, margin: "8px 0 0", lineHeight: 1.5 }}>
                Interpolações: {"{{lead.name}} {{lead.firstName}} {{lead.company}} {{answers.<chave>}} {{calc.preco}} {{calc.custoMes}} {{calc.custoAno}} {{calc.vendasEquiv}} {{calc.roi}} {{calc.plano}} {{calc.precoCiclos}} {{calc.fatTotal}} {{calc.horasMes}} {{state.validUntil}}"} · *palavra* = itálico na cor da marca.
              </div>

              <div className="kicker" style={sectionTitle}>Slides</div>
              <SlidesBuilder slides={draft.slides || []} onChange={(slides) => set({ slides })} />

              <div className="kicker" style={sectionTitle}>Calculadora (custo oculto / preço)</div>
              <CalcEditor calc={draft.calc || {}} onChange={(calc) => set({ calc })} />
            </>
          )}

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

// ── Tabela de preço (catálogo v2) ───────────────────────────────────────────
// É o que a apresentação em slides tem de editável: o slide de investimento e o
// de entregáveis leem TUDO daqui (calc.catalog), nada é escrito no texto do
// deck. O total do período sai do mensal (12× no anual, 6× no semestral),
// porque é assim que o catálogo nasce e é o TOTAL que vira o valor do negócio
// no gate de Ganho e no link de pagamento — digitar os dois convidaria a
// divergência.
//
// Ordem canônica das linhas (espelho do PRODUCT_KEYS da API); produto que
// exista só no banco entra depois, sem sumir da tela.
const CATALOG_ORDER = ["oem_essencial", "oem_escala", "ads_essencial", "ads_escala", "price_essencial", "price_escala", "price_enterprise"];
const brl = (n) => "R$ " + Math.round(Number(n) || 0).toLocaleString("pt-BR");
const parcelas = (cycle) => (cycle === "anu" ? 12 : 6);

function CatalogEditor({ catalog, onChange }) {
  if (!catalog || !catalog.products) {
    return <p className="proposal-editor-note">Este template não tem tabela de preço (catálogo v2) — a apresentação em slides depende dela para montar o investimento e os entregáveis.</p>;
  }
  const products = catalog.products;
  const keys = [...CATALOG_ORDER.filter((k) => products[k]), ...Object.keys(products).filter((k) => !CATALOG_ORDER.includes(k))];
  const setProduct = (k, patch) => onChange({ ...catalog, products: { ...products, [k]: { ...products[k], ...patch } } });
  const addons = catalog.addons || {};
  const setExtra = (v) => onChange({ ...catalog, addons: { ...addons, contaExtra: { ...(addons.contaExtra || {}), per: v } } });
  const packs = catalog.oemPacks || [];
  const setPack = (i, patch) => onChange({ ...catalog, oemPacks: packs.map((pk, j) => (j === i ? { ...pk, ...patch } : pk)) });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {keys.map((k) => <ProductCard key={k} id={k} product={products[k]} onChange={(patch) => setProduct(k, patch)} />)}
      <div style={cardStyle}>
        <span className="kicker">Adicionais</span>
        <div className="proposal-editor-row" style={{ display: "flex", gap: 10 }}>
          <LabeledInput label="Conta extra no Escala (R$ por conta, em cada parcela)" type="number"
            value={addons.contaExtra?.per ?? ""} onChange={(v) => setExtra(v === "" ? "" : Number(v))} />
        </div>
        <span className="kicker" style={{ marginTop: 10 }}>Pacote de OEM avulso (pagamento único)</span>
        {packs.map((pk, i) => (
          <div key={i} className="proposal-list-row" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="number" aria-label="anúncios do pacote" value={pk.qty ?? ""} style={{ ...inputStyle, width: 120 }}
              onChange={(e) => setPack(i, { qty: e.target.value === "" ? "" : Number(e.target.value) })} />
            <span className="mono dim" style={{ fontSize: 11 }}>anúncios por R$</span>
            <input type="number" aria-label="preço do pacote" value={pk.price ?? ""} style={{ ...inputStyle, width: 130 }}
              onChange={(e) => setPack(i, { price: e.target.value === "" ? "" : Number(e.target.value) })} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductCard({ id, product, onChange }) {
  const [open, setOpen] = useState(false);
  const setPer = (cycle, v) => {
    const per = v === "" ? "" : Number(v);
    onChange({ [cycle]: { ...(product[cycle] || {}), per, total: per === "" ? "" : Math.round(per * parcelas(cycle)) } });
  };
  const setInclui = (bloco, itens) => onChange({ inclui: { ...(product.inclui || {}), [bloco]: itens } });
  const resumo = `${brl(product.anu?.per)}/mês no anual · ${brl(product.anu?.total)} no total`;

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button type="button" onClick={() => setOpen(!open)} style={{ flex: 1, textAlign: "left", display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span className="chip" style={{ height: 20, flexShrink: 0 }}>{id}</span>
          <span style={{ fontSize: 12.5, color: "var(--fg-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{product.name || id} · {resumo}</span>
          <span className="mono dim" style={{ marginLeft: "auto" }}>{open ? "▾" : "▸"}</span>
        </button>
      </div>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 12 }}>
          <div className="proposal-editor-row" style={{ display: "flex", gap: 10 }}>
            <LabeledInput label="Nome do plano (aparece no deck)" value={product.name || ""} onChange={(v) => onChange({ name: v })} />
            {product.line !== "price" && (
              <LabeledInput label="Contas incluídas" type="number" value={product.contas ?? ""} onChange={(v) => onChange({ contas: v === "" ? "" : Number(v) })} />
            )}
          </div>
          <div className="proposal-editor-row" style={{ display: "flex", gap: 10 }}>
            <LabeledInput label="Anual · R$ por mês (12×)" type="number" value={product.anu?.per ?? ""} onChange={(v) => setPer("anu", v)} />
            <LabeledInput label="Semestral · R$ por mês (6×)" type="number" value={product.sem?.per ?? ""} onChange={(v) => setPer("sem", v)} />
          </div>
          <div className="mono dim" style={{ fontSize: 11 }}>
            Total do período (o valor do negócio): anual {brl(product.anu?.total)} · semestral {brl(product.sem?.total)}
          </div>
          <StrList label="Entregáveis · motor" items={product.inclui?.motor || []} onChange={(v) => setInclui("motor", v)} />
          <StrList label="Entregáveis · plataforma" items={product.inclui?.plataforma || []} onChange={(v) => setInclui("plataforma", v)} />
        </div>
      )}
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
