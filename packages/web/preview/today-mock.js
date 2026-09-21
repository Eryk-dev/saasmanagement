const params = new URLSearchParams(location.search);
export const todayReview = params.get('review') === 'today';
let activities = [];
export function setupTodayReview(seed) {
  if (params.has('card')) {
    Object.assign(seed.LEADS.find(l=>l.name==='Bruno Teixeira'), {proposalUrl:'/p/card-preview',proposal_edit_url:'/p/card-preview?k=review'});
    seed.SAAS[0].leadQuestions=[{key:'accounts',label:'Quantas contas?',options:[{value:'2',label:'2 contas'},{value:'3-5',label:'3 a 5 contas'}]}];
  }
  if (params.get('state') === 'empty') seed.LEADS = [];
  if (params.has('many')) seed.LEADS = [...seed.LEADS, ...Array.from({length:15},(_,i)=>({...seed.LEADS.find(l=>l.id==='l3'), id:`extra-${i}`, name:`Lead ${i + 1}`, company:`Empresa ${i + 1}`}))];
  window.__reviewMutations = [];
}
export const todayMock = {
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
