const params = new URLSearchParams(location.search);
export const pipelineReview = params.get('review') === 'pipeline';
export function setupPipelineReview(seed) {
  seed.SAAS[0].funnel = [
    {stage:'Novo lead',kind:'novo',conv:1}, {stage:'Em contato',kind:'contato',conv:.7},
    {stage:'Qualificando',kind:'qualificacao',conv:.6}, {stage:'Call agendada',kind:'call',conv:.5},
    {stage:'Proposta enviada',kind:'proposta',conv:.7}, {stage:'Follow-up',kind:'followup',conv:.7},
    {stage:'Ganho',kind:'ganho',conv:.4}, {stage:'Descartado',kind:'desqualificado'}, {stage:'Perdido',kind:'perdido'},
  ];
  seed.USERS.forEach((u,i)=>{u.name=['Rafael Moura','Bruno Alencar','Manuela Costa'][i];});
  seed.LEADS.forEach(l=>{ l.stage=({'Qualificação':'Qualificando','Call marcada':'Call agendada','Proposta':'Proposta enviada'})[l.stage]||l.stage; });
  seed.LEADS.push({...seed.LEADS[5],id:'contact',name:'Lúcia Costa',stage:'Em contato',nextActionAt:'2026-09-17T12:00:00Z'});
  seed.LEADS.push({...seed.LEADS[6],id:'follow',name:'Carlos Souza',stage:'Follow-up'});
  seed.LEADS.push({...seed.LEADS[5],id:'discard',name:'Lead descartado',stage:'Descartado'});
  if(params.get('state')==='empty') seed.LEADS=[];
  if(params.has('many')) seed.LEADS.push(...Array.from({length:20},(_,i)=>({...seed.LEADS[5],id:`many-${i}`,name:`Contato ${i+1}`,stage:'Novo lead'})));
  window.__reviewMutations=[];
}
export const pipelineMock = {
  generateProposal: async (id,options)=>{window.__reviewMutations.push({method:'generateProposal',id,options});const row=window.SEED.LEADS.find(l=>l.id===id);Object.assign(row,{proposta_id:'proposal-review',proposalUrl:'about:blank',proposal_edit_url:'about:blank'});return row;},
  shareProposal: async id=>{window.__reviewMutations.push({method:'shareProposal',id});return {url:'about:blank'};},
  mpLeadLink: async (id,data)=>{window.__reviewMutations.push({method:'mpLeadLink',id,data});return {url:'https://example.invalid/review-payment'};},
  list: async col=>window.SEED[col.toUpperCase()] || [],
  update: async (col,id,patch)=>{window.__reviewMutations.push({method:'update',col,id,patch});const row=window.SEED[col.toUpperCase()]?.find(r=>r.id===id);if(row)Object.assign(row,patch);return row;},
  create: async (col,data)=>{const row={...data,id:`review-${window.__reviewMutations.length}`};(window.SEED[col.toUpperCase()]||=[]).push(row);window.__reviewMutations.push({method:'create',col,data});return row;},
  get: async (col,id)=>window.SEED[col.toUpperCase()]?.find(r=>r.id===id),
  logActivity: async data=>{window.__reviewMutations.push({method:'logActivity',data});return {...data,id:'activity-review'};},
};
