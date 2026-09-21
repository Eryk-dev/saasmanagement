const params = new URLSearchParams(location.search);
export const todayReview = params.get('review') === 'today';
let activities = [];
export function setupTodayReview(seed) {
  if (params.has('card')) {
    const futureDate=(days)=>{const d=new Date();d.setDate(d.getDate()+days);d.setHours(16,0,0,0);return d.toISOString();};
    const base=seed.LEADS.find(l=>l.name==='Carla Nunes');
    seed.LEADS.push(...Array.from({length:7},(_,i)=>({...base,id:`future-${i}`,name:`Futuro ${i+1}`,nextActionAt:futureDate(1)})));
    seed.LEADS.push({...base,id:'future-later',name:'Mais adiante',nextActionAt:futureDate(4)});
    Object.assign(seed.LEADS.find(l=>l.name==='Bruno Teixeira'), {niche:'auto',need:'Preciso organizar a gestão de estoque entre todas as contas e acompanhar os produtos com maior giro.\nTambém quero criar anúncios mais rápido.',proposta_id:'card-preview',proposalUrl:'/p/card-preview',proposal_edit_url:'/p/card-preview?k=review'});
    seed.SAAS[0].leadQuestions=[{key:'niche',label:'Qual é o principal nicho de produtos que você vende nos marketplaces?',options:[{value:'auto',label:'Autopeças e acessórios para veículos de diferentes marcas e modelos'}]},{key:'need',label:'O que fez você procurar uma solução agora?',options:[]},{key:'accounts',label:'Quantas contas?',options:[{value:'2',label:'2 contas'},{value:'3-5',label:'3 a 5 contas'}]}];
  }
  if (params.get('state') === 'empty') seed.LEADS = [];
  if (params.has('many')) seed.LEADS = [...seed.LEADS, ...Array.from({length:15},(_,i)=>({...seed.LEADS.find(l=>l.id==='l3'), id:`extra-${i}`, name:`Lead ${i + 1}`, company:`Empresa ${i + 1}`}))];
  window.__reviewMutations = [];
}
export const todayMock = {
  get: async (col,id) => window.SEED[col.toUpperCase()]?.find(row=>row.id===id),
  generateProposal: async (id,options) => {
    window.__reviewMutations.push({method:'generateProposal',id,options});
    if (params.has('proposalFail')) return {ok:false};
    const lead=window.SEED.LEADS.find(l=>l.id===id);
    Object.assign(lead,{proposta_id:'card-preview',proposalUrl:'/p/card-preview',proposal_edit_url:'/p/card-preview?k=review'});
    return {ok:true,lead};
  },
  shareProposal: async (id,offer) => {
    window.__reviewMutations.push({method:'shareProposal',id,offer});
    return {url:'https://client.example/proposal'};
  },
  list: async col => col === 'leads' ? window.SEED.LEADS : [],
  listActivities: async id => activities.filter(activity => activity.lead === id),
  update: async (col, id, patch) => {
    window.__reviewMutations.push({method:'update',col,id,patch});
    const row = window.SEED[col.toUpperCase()]?.find(row=>row.id===id);
    if (row) Object.assign(row,patch);
    return row;
  },
  logActivity: async data => {
    const row = {...data,id:`review-${activities.length}`,at:new Date().toISOString()};
    activities.push(row); window.__reviewMutations.push({method:'logActivity',data}); return row;
  },
};
