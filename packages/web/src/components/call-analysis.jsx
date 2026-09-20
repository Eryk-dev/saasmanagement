import React from "react";
import { fmtDateTime } from "../lib/format.js";
import "./call-analysis.css";

export function AnalysisCard({title,hint,children,tone,className="",action}) {
  return <section className={`call-analysis-card ${className}`} style={{"--analysis-tone":tone||"var(--accent)"}}><header><div><h2>{title}</h2>{hint&&<p>{hint}</p>}</div>{action}</header>{children}</section>;
}
export function AnalysisBar({label,value,max,sub,tone}) {
  return <div className="call-analysis-bar"><div><strong>{label}</strong><span>{sub}</span></div><div aria-hidden="true"><i style={{width:`${max>0?Math.max(value>0?4:0,Math.round(value/max*100)):0}%`,background:tone||"var(--accent)"}}/></div></div>;
}
export function CallDistribution({title,count,countLabel,items,note}) {
  return <AnalysisCard title={title} className="call-distribution" action={<span>{countLabel}</span>}><div className="call-distribution-bar" aria-hidden="true">{items.map(item=>item.value>0&&<i key={item.label} style={{width:`${item.value/Math.max(1,count)*100}%`,background:item.color}}/>)}</div><div className="call-distribution-legend">{items.map(item=><span key={item.label}><i style={{background:item.color}}/><strong>{item.value}</strong><span>{item.label} · {count?Math.round(item.value/count*100):0}%</span></span>)}</div>{note&&<p className="call-analysis-note">{note}</p>}</AnalysisCard>;
}
export function RecentCalls({rows,productId,onOpenLead,statusKey,statusColors,personLabel}) {
  return <div className="call-recent-list">{rows.length===0&&<p className="call-analysis-note">Nenhuma call recente disponível.</p>}{rows.map((c,i)=>{
    const lead=(window.SEED?.LEADS||[]).find(l=>l.id===c.leadId&&l.saas===productId),canOpen=!!lead&&!!onOpenLead,status=c[statusKey]||"sem classificação";
    return <div className="call-recent-row" key={`${c.leadId}:${c.at}:${i}`}><button disabled={!canOpen} onClick={()=>onOpenLead(lead)} aria-label={`Abrir lead: ${c.leadName||c.company||"cliente"}`} title={!canOpen?"Lead indisponível neste produto":undefined}><strong>{c.leadName||c.company||"cliente"}</strong><span className="call-recent-status" style={{color:statusColors[status]||"var(--fg-3)"}}>{status}</span>{personLabel?.(c)&&<span className="call-recent-person">{personLabel(c)}</span>}<span className="call-recent-summary" title={c.resumo}>{c.resumo}</span>{c.at&&<time dateTime={c.at}>{fmtDateTime(c.at)}</time>}</button>{c.recordingUrl&&<a href={c.recordingUrl} target="_blank" rel="noopener noreferrer" aria-label={`Abrir gravação de ${c.leadName||"cliente"} no Drive`}>Vídeo no Drive ↗</a>}</div>;
  })}</div>;
}
