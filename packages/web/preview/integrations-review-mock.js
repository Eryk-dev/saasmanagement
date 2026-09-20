const params=new URLSearchParams(location.search);
export const integrationsReview=params.get('review')==='integrations';
export function setupIntegrationsReview(seed){window.__integrationReads=[];}
export const integrationsReviewMock={integrationAnalysis:async saas=>{
 window.__integrationReads.push(saas);const empty=params.has('empty')||saas==='elo',safe=params.has('safe');
 const rows=empty?[]:window.SEED.LEADS.slice(0,params.has('small')?3:10).map((l,i)=>({leadId:params.has('missing')?'missing':l.id,leadName:l.name,company:l.company,at:`2026-09-${String(18-i).padStart(2,'0')}T13:00:00Z`,sentimento:!safe&&i<3?'em risco':i%3===0?'neutro':'satisfeito',resumo:i<3?'Aguardando acesso às contas para concluir a configuração.':'Contas vinculadas e primeira campanha configurada.',...(i===0?{recordingUrl:'https://example.invalid/integration-recording'}:{})}));
 return {count:rows.length,sentimento:Object.fromEntries(['satisfeito','neutro','em risco'].map(k=>[k,rows.filter(r=>r.sentimento===k).length])),pendencias:empty?[]:[{item:'Liberar acesso às contas',total:6,cliente:6,equipe:0},{item:'Revisar a primeira campanha',total:4,cliente:0,equipe:4},{item:'Ajustar catálogo e imagens dos anúncios',total:3,cliente:2,equipe:1}],configurado:empty?[]:[{item:'Vínculo das contas',total:8},{item:'Primeira campanha',total:5},{item:'Sincronização de estoque',total:4}],recent:rows,atrasos:empty||safe?{cliente:0,nosso:0,itens:[]}:{cliente:2,nosso:1,itens:rows.slice(0,3).map((r,i)=>({leadId:r.leadId,leadName:r.leadName,dias:9-i,de:i?'cliente':'nosso'}))}};
}};
