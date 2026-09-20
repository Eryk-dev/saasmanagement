import React from "react";
import { Segmented } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { AnalysisCard, AnalysisBar, CallDistribution, RecentCalls } from "../components/call-analysis.jsx";
import { api } from "../lib/api.js";
import { useActiveSaas } from "../lib/workspace.js";
import { displayName, canSeeScreen } from "../lib/users.js";
import { DEFAULT_SCRIPTS, applyScriptOverride } from "../lib/scripts.js";
import "./calls.css";

export function PersonFilter({people,value,onChange,allLabel="Todos"}) {
  const opts=[{id:undefined,count:people.reduce((n,p)=>n+(p.count||0),0),label:allLabel},...people.map(p=>({...p,label:p.id?displayName(p.id):"sem responsável"}))];
  return <div className="calls-people"><span>por pessoa</span>{opts.map(o=><button key={o.id??"__all__"} aria-pressed={value===o.id} onClick={()=>onChange(o.id)}>{o.label} <strong>{o.count}</strong></button>)}</div>;
}
function CallsScreen({onOpenLead}) {
  const [product]=useActiveSaas();
  if(!product)return <EmptyState title="Sem produto ativo" hint="Escolha um produto na barra lateral."/>;
  return <CallsWorkspace key={product.id} product={product} onOpenLead={onOpenLead}/>;
}
function CallsWorkspace({product,onOpenLead}) {
  const [data,setData]=React.useState(null),[error,setError]=React.useState(null),[attempt,setAttempt]=React.useState(0);
  const [ai,setAi]=React.useState(null),busy=ai==='loading',writing=React.useRef(false),generation=React.useRef(0);
  const [group,setGroupState]=React.useState(()=>{try{return localStorage.getItem('cockpit_calls_group')==='sdr'?'sdr':'venda';}catch{return 'venda';}});
  const [closer,setCloser]=React.useState(undefined),[closers,setClosers]=React.useState([]);
  function setGroup(g){if(g===group)return;generation.current++;setData(null);setAi(null);setGroupState(g);setCloser(undefined);try{localStorage.setItem('cockpit_calls_group',g);}catch{}}
  function chooseCloser(id){if(id===closer)return;generation.current++;setData(null);setAi(null);setCloser(id);}
  React.useEffect(()=>{let alive=true;const token=++generation.current;setData(null);setError(null);setAi(null);writing.current=false;
    api.pitchCalls(product.id,closer,group).then(d=>{if(alive){setData(d);if(Array.isArray(d.closers))setClosers(d.closers);}}).catch(e=>{if(alive)setError(e);});
    return()=>{alive=false;if(generation.current===token)generation.current++;};
  },[product.id,closer,group,attempt]);
  async function diagnosticar(){
    if(writing.current||!data?.count||data.aiConfigured===false)return;
    writing.current=true;setAi('loading');const token=generation.current;
    try{const key=group==='sdr'?'novo':'call',base=DEFAULT_SCRIPTS[key]||{},cur=applyScriptOverride(base,product.scripts?.[key])||base;
      const r=await api.improvePitch(product.id,{scriptKey:key,scriptLabel:group==='sdr'?'1º contato (SDR)':'Call de fechamento',currentScript:{resumo:cur.resumo,objetivo:cur.objetivo,passos:cur.passos},closer,group});
      if(generation.current===token)setAi({diagnostico:r.diagnostico||'',objecoes:r.objecoesRecorrentes||[]});
    }catch(e){if(generation.current===token)setAi({error:e?.status===422?'Ainda não há calls resumidas para analisar.':e?.message||'Não foi possível gerar o diagnóstico.'});}
    finally{if(generation.current===token)writing.current=false;}
  }
  const people=closers.filter(p=>(p.group||'venda')===group),temp=data?.temperatura||{quente:0,morno:0,frio:0};
  return <div className="call-analysis-page calls-page"><header className="call-analysis-head"><h1>Análise de Pitches</h1></header><div className="call-analysis-body">
    <fieldset className="calls-filters" disabled={busy}><Segmented value={group} onChange={setGroup} options={[{value:'venda',label:'Vendas · closer'},{value:'sdr',label:'Qualificação · SDR'}]}/>{people.length>=2&&<PersonFilter people={people} value={closer} onChange={chooseCloser}/>} {people.length===1&&<span className="calls-single-person">{people[0].id?displayName(people[0].id):'sem responsável'} · {people[0].count} calls</span>}</fieldset>
    {error?<div role="alert" className="call-analysis-state">Não foi possível carregar as calls. <button onClick={()=>setAttempt(n=>n+1)}>Tentar novamente</button></div>:!data?<div role="status" className="call-analysis-state">Carregando calls…</div>:!data.count?<EmptyState title={group==='sdr'?'Nenhuma call de qualificação resumida ainda':'Nenhuma call de venda resumida ainda'} hint="As calls agendadas pelo cockpit viram resumo automático quando o Meet gera a transcrição. Os padrões aparecem conforme as calls acontecem."/>:<>
      {data.count<5&&<div className="call-analysis-warning">Ainda juntando calls ({data.count}). Os padrões ficam confiáveis a partir de umas 10 calls. Considere esta uma amostra pequena.</div>}
      <CallDistribution title="Temperatura das calls" count={data.count} countLabel={`${data.count} calls resumidas · histórico do grupo`} items={[{label:'quentes',value:temp.quente,color:'var(--pos)'},{label:'mornas',value:temp.morno,color:'var(--warn)'},{label:'frias',value:temp.frio,color:'var(--fg-3)'}]} note="Temperatura é a leitura do interesse na call, não o resultado da venda."/>
      <div className="call-analysis-grid"><AnalysisCard title="Objeções recorrentes" hint="o que mais trava as calls · × vezes e quantas ficaram em aberto" tone="var(--neg)"><div className="call-analysis-bars">{!data.objecoes.length&&<p className="call-analysis-note">Nenhuma objeção registrada ainda.</p>}{data.objecoes.slice(0,12).map((o,i)=><div className="calls-objection" key={i}><AnalysisBar label={o.objecao} value={o.total} max={data.objecoes[0]?.total||1} tone={o.abertas>0?'var(--neg)':'var(--accent)'} sub={`${o.total}× · ${o.abertas} em aberto`}/>{canSeeScreen('training')&&<a href={`#training?objecao=${encodeURIComponent(o.objecao)}`} title={`Criar um card de treino: ${o.objecao}`}>virar treino →</a>}</div>)}</div></AnalysisCard>
        <AnalysisCard title="Dores mais citadas" hint="o que os leads mais trazem para a call" tone="var(--warn)"><div className="call-analysis-bars">{!data.dores.length&&<p className="call-analysis-note">Nenhuma dor registrada ainda.</p>}{data.dores.slice(0,12).map((d,i)=><AnalysisBar key={i} label={d.dor} value={d.total} max={data.dores[0]?.total||1} sub={`${d.total}×`}/>)}</div></AnalysisCard></div>
      <AnalysisCard className="capsule-navy calls-diagnosis" title={group==='sdr'?'Diagnóstico da qualificação (IA)':'Diagnóstico do pitch (IA)'} hint={group==='sdr'?'a IA lê as calls do SDR e diz o que ajustar no roteiro de 1º contato':'a IA lê as calls e diz o que ajustar no roteiro da call'} action={<button onClick={diagnosticar} disabled={busy||data.aiConfigured===false}>{busy?'Analisando…':ai?.error?'Tentar diagnóstico novamente':'Gerar diagnóstico'}</button>}>
        {data.aiConfigured===false&&<p className="call-analysis-note">IA não configurada para gerar o diagnóstico.</p>}
        {ai?.error&&<p role="alert" className="calls-ai-error">{ai.error}</p>}
        {ai?.diagnostico!=null&&<div className="calls-ai-result"><p>{ai.diagnostico||'Nenhum diagnóstico foi retornado.'}</p>{ai.objecoes?.map((o,i)=><div key={i}><strong>{o.objecao}{o.frequencia?` (${o.frequencia})`:''}</strong><p>{o.comoTratarNoPitch}</p></div>)}<footer>Para aplicar uma nova versão, abra Configurações → Scripts → {group==='sdr'?'1º contato':'Call de fechamento'} → IA das calls.{canSeeScreen('settings')&&<a href="#settings">Abrir Configurações →</a>}</footer></div>}
      </AnalysisCard>
      <AnalysisCard title="Calls recentes" hint="até 25 calls resumidas mais recentes · clique para abrir o lead" className="call-analysis-recent"><RecentCalls rows={data.recent} productId={product.id} onOpenLead={onOpenLead} statusKey="temperatura" statusColors={{quente:'var(--pos)',morno:'var(--warn)',frio:'var(--fg-3)'}} personLabel={c=>closer==null&&c.closer?displayName(c.closer):null}/></AnalysisCard>
    </>}
  </div></div>;
}
export {CallsScreen};
