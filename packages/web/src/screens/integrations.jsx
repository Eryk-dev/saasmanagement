import React from "react";
import { EmptyState } from "../atoms.jsx";
import { AnalysisCard, AnalysisBar, CallDistribution, RecentCalls } from "../components/call-analysis.jsx";
import { api } from "../lib/api.js";
import { useActiveSaas } from "../lib/workspace.js";
import { useData } from "../data.jsx";
import "./integrations.css";

function IntegrationsScreen({onOpenLead}) {
  const [product]=useActiveSaas();
  if(!product)return <EmptyState title="Sem produto ativo" hint="Escolha um produto na barra lateral."/>;
  return <IntegrationsWorkspace key={product.id} product={product} onOpenLead={onOpenLead}/>;
}
function IntegrationsWorkspace({product,onOpenLead}) {
  const {version}=useData();
  const [read,setRead]=React.useState({}),[attempt,setAttempt]=React.useState(0);
  React.useEffect(()=>{let alive=true;setRead({});api.integrationAnalysis(product.id).then(data=>{if(alive)setRead({data});}).catch(error=>{if(alive)setRead({error});});return()=>{alive=false;};},[product.id,attempt,version]);
  const {data,error}=read,sent=data?.sentimento||{satisfeito:0,neutro:0,'em risco':0};
  const leadFor=id=>(window.SEED?.LEADS||[]).find(l=>l.id===id&&l.saas===product.id);
  const canOpen=id=>!!onOpenLead&&!!leadFor(id),open=id=>{const lead=leadFor(id);if(lead&&onOpenLead)onOpenLead(lead);};
  const risk=(data?.recent||[]).filter(c=>c.sentimento==='em risco'),firstRisk=risk[0],oldest=data?.atrasos?.itens?.[0];
  return <div className="call-analysis-page integrations-page"><header className="call-analysis-head"><h1>Análise de Integração</h1></header><div className="call-analysis-body">
    {error?<div role="alert" className="call-analysis-state">Não foi possível carregar a análise de integração. <button onClick={()=>setAttempt(n=>n+1)}>Tentar novamente</button></div>:!data?<div role="status" className="call-analysis-state">Carregando integrações…</div>:!data.count?<EmptyState title="Nenhuma integração resumida ainda" hint="As calls de integração agendadas pelo cockpit viram resumo de onboarding quando o Meet gera a transcrição. O sentimento e as pendências aparecem conforme elas acontecem."/>:<>
      {data.count<5&&<div className="call-analysis-warning">Ainda juntando integrações ({data.count}). Os padrões ficam confiáveis a partir de umas 10, mas já dá para olhar.</div>}
      {sent['em risco']>0&&<AnalysisCard className="capsule-navy integrations-risk" title="Churn começa aqui" tone="var(--neg)" hint={<><strong>{sent['em risco']} {sent['em risco']===1?'cliente saiu da integração em risco':'clientes saíram da integração em risco'}</strong><span>{risk.length?`${risk.slice(0,3).map(c=>c.leadName||c.company||'cliente').join(' · ')}${risk.length>3?` +${risk.length-3}`:''}`:'Nenhum registro de risco entre as 25 integrações mais recentes.'}</span></>} action={firstRisk&&<button disabled={!canOpen(firstRisk.leadId)} onClick={()=>open(firstRisk.leadId)} title={!canOpen(firstRisk.leadId)?'Lead indisponível neste produto':undefined}>{risk.length===1?'Abrir o cliente':`Abrir o primeiro dos ${risk.length}`}</button>}/>}
      {(data.atrasos?.cliente>0||data.atrasos?.nosso>0)&&<><section className="integrations-delays"><strong>Atrasos: {data.atrasos.cliente} do cliente · {data.atrasos.nosso} {data.atrasos.nosso===1?'nosso':'nossos'}</strong><span title={(data.atrasos.itens||[]).map(i=>`${i.leadName||'cliente'} (${i.dias}d)`).join(' · ')}>{(data.atrasos.itens||[]).slice(0,3).map(i=>`${i.leadName||'cliente'} (${i.dias}d)`).join(' · ')}</span>{oldest&&<button disabled={!canOpen(oldest.leadId)} onClick={()=>open(oldest.leadId)}>Abrir o mais antigo</button>}</section><p className="integrations-delay-note">Esperar o cliente não é dever: a fila que o time trabalha é a dos atrasos nossos.</p></>}
      <CallDistribution title="Como saíram da integração" count={data.count} countLabel={`${data.count} integrações resumidas · histórico`} items={[{label:'satisfeitos',value:sent.satisfeito,color:'var(--pos)'},{label:'neutros',value:sent.neutro,color:'var(--fg-3)'},{label:'em risco',value:sent['em risco'],color:'var(--neg)'}]}/>
      <div className="call-analysis-grid"><AnalysisCard title="Pendências do onboarding" tone="var(--neg)"><div className="call-analysis-bars">{!data.pendencias.length&&<p className="call-analysis-note">Nenhuma pendência registrada ainda.</p>}{data.pendencias.slice(0,12).map((p,i)=><AnalysisBar key={i} label={p.item} value={p.total} max={data.pendencias[0]?.total||1} tone={p.cliente>=p.equipe?'var(--warn)':'var(--accent)'} sub={`${p.total}×${p.cliente?` · ${p.cliente} cliente`:''}${p.equipe?` · ${p.equipe} equipe`:''}`}/>)}</div></AnalysisCard>
        <AnalysisCard title="O que mais é configurado"><div className="call-analysis-bars">{!data.configurado.length&&<p className="call-analysis-note">Nada registrado ainda.</p>}{data.configurado.slice(0,12).map((c,i)=><AnalysisBar key={i} label={c.item} value={c.total} max={data.configurado[0]?.total||1} sub={`${c.total}×`}/>)}</div></AnalysisCard></div>
      <AnalysisCard title="Integrações recentes" hint="até 25 integrações resumidas mais recentes · clique para abrir o lead" className="call-analysis-recent"><RecentCalls rows={data.recent} productId={product.id} onOpenLead={onOpenLead} statusKey="sentimento" statusColors={{satisfeito:'var(--pos)',neutro:'var(--fg-3)','em risco':'var(--neg)'}}/></AnalysisCard>
    </>}
  </div></div>;
}
export {IntegrationsScreen};
