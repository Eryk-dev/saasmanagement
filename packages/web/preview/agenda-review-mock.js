const params = new URLSearchParams(location.search);
export const agendaReview = params.get('review') === 'agenda';
const at = (day, hour) => { const d = new Date(); d.setDate(d.getDate() + day); d.setHours(Math.floor(hour), Math.round(hour % 1 * 60), 0, 0); return d.toISOString(); };
let blocks = [], calls = 0, attempts = 0;
export function setupAgendaReview(seed) {
  seed.USERS = [
    {id:'rm',name:'Rafael Moura',roles:['closer'],saas:'leverads'},
    {id:'ba',name:'Bruno Alencar',roles:['closer'],saas:'leverads'},
    {id:'vn',name:'Vitor Nunes',roles:['integrator'],saas:'leverads'},
    {...seed.ME, saas:''},
  ];
  seed.SAAS[0].funnel.push({stage:'No show',kind:'noshow'}, {stage:'Follow-up',kind:'followup'}, {stage:'Integração',kind:'integracao'});
  const examples = [
    ['Helena Vitta','Nutri Vitta','rm',9,'call','Ganho'],
    ['Marina Kern','Studio Kern','vn',10.5,'integration','Integração'],
    ['Camila Reis','Nutri Vitta','rm',14.67,'call','Call marcada'],
    ['Caio Menezes','Menezes Auto','ba',16.17,'call','Call marcada'],
    ['Marina Kern','Studio Kern','rm',16.5,'call','Call marcada'],
    ['Tatiana Ponto','Mercado Ponto','vn',17,'integration','Integração'],
    ['Eduardo Galante','Galante Holding','rm',8,'call','No show'],
    ['Tiago Nogueira','Nogueira Imports','rm',15,'call','No show',-1],
  ];
  seed.LEADS = params.has('empty') ? [] : examples.map(([name,company,who,h,kind,stage,day=0],i)=>({
    id:`agenda-lead-${i}`, saas:'leverads', name,company,stage,amount:9600,owner:'leo',
    ...(kind==='call'?{closer:who,callAt:at(day,h)}:{integrator:who,integrationAt:at(day,h)}),
    callConfirmed:name==='Camila Reis',nextActionAt:name==='Camila Reis'?null:at(3,9),createdAt:at(-5,9),
  }));
  blocks = params.has('empty') ? [] : [{id:'lunch',saas:'leverads',kind:'block',user:'vn',users:['vn'],date:at(0,12).slice(0,10),recur:'once',fromHour:12,toHour:13,reason:'almoço'},
    {id:'meli',saas:'leverads',kind:'event',user:'rm',users:['rm'],weekday:5,recur:'weekly',fromHour:13,toHour:14,title:'MELI · reunião semanal'}];
  seed.AGENDA_BLOCKS = blocks;
  window.__reviewMutations = [];
  localStorage.setItem('cockpit_agenda_view','day');
  localStorage.setItem('cockpit_agenda_person','');
  localStorage.setItem('cockpit_agenda_kind','all');
}
async function hold(method) {
  if(params.get('hold')===method) await new Promise(resolve=>window.__releaseAgenda=resolve);
}
export const agendaReviewMock = {
  list:async (col)=>col==='consultations'?[]:window.SEED[col.toUpperCase()]||[],
  create:async(col,data)=>{
    await hold('create');
    if(params.has('partial') && ++attempts===2) throw new Error('Falha em um dia');
    const row={...data,id:`saved-${Date.now()}-${calls++}`}; blocks.push(row);
    window.__reviewMutations.push({method:'create',col,data});return row;
  },
  update:async(col,id,data)=>{await hold('update');const row=blocks.find(b=>b.id===id);Object.assign(row,data);window.__reviewMutations.push({method:'update',col,id,data});return row;},
  remove:async(col,id)=>{await hold('remove');blocks=blocks.filter(b=>b.id!==id);window.__reviewMutations.push({method:'remove',col,id});return {ok:true};},
};
