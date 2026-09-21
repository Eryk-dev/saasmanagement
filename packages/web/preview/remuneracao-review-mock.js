const q=new URLSearchParams(location.search),clone=v=>structuredClone(v);
export const remuneracaoReview=q.get('review')==='remuneracao';
let docs=[];
export function setupRemuneracaoReview(seed){window.__compWrites=[];window.__compReads=[];docs=[];if(q.has('readonly')||q.has('denied')){seed.ME={...seed.ME,roles:['sdr'],screens:q.has('readonly')?['remuneracao']:[]};seed.USERS=seed.USERS.map(u=>u.id===seed.ME.id?{...u,roles:seed.ME.roles,screens:seed.ME.screens}:u);} seed.USERS=seed.USERS.map(u=>({...u,compLevel:1}));}
export const remuneracaoReviewMock={
 list:async c=>{window.__compReads.push(c);return clone(c==='comp_plans'?docs:[]);},
 create:async(c,body)=>{window.__compWrites.push({method:'create',body:clone(body)});const d={id:body.role,...clone(body)};docs.push(d);return clone(d);},
 update:async(c,id,body)=>{window.__compWrites.push({method:'update',body:clone(body)});const d=docs.find(d=>d.id===id);Object.assign(d,body);return clone(d);},
 scoreboard:async()=>{if(q.has('scoreFail')&&!window.__scoreRetried){window.__scoreRetried=1;throw Error('Condições sem conexão');}return {team:{teamBonus:{applies:true,cash:{ok:true,sold:180000,target:180000},churn:{ok:true,pct:6,max:15},ok:true}},referrals:{people:q.has('empty')?[]:[{user:'leo',name:'Leonardo',collected:5,meetings:2,closed:1,value:700}],rates:{meeting:100,closed:500}}};},
 compMonths:async()=>({months:q.has('empty')?[]:[{month:'2026-08',total:12000,teamBonus:{ok:true,applies:true,cash:{ok:true},churn:{pct:5}}}]}),
 compMonthClose:async(saas,month)=>{window.__compWrites.push({method:'close',saas,month});return {ok:true};},
 trainingQueue:async()=>({cards:[],decks:[],exams:[]}),
};
