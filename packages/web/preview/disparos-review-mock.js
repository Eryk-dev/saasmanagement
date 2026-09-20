import {marketingCollections,marketingCrud,marketingMock} from './marketing-mock.js';
const params=new URLSearchParams(location.search);
export const disparosReview=params.get('review')==='disparos';
const clone=v=>structuredClone(v);
export function setupDisparosReview(seed){
 seed.CONFIG.ai={configured:true};seed.CONFIG.google={gmail:!params.has('assisted')};
 seed.LEADS=seed.LEADS.map((l,i)=>({...l,email:`lead${i}@example.com`,phone:`554199999${String(i).padStart(4,'0')}`}));
 if(params.has('empty')){seed.LEADS=[];for(const k of ['campaigns','sequences','sequence_enrollments','drip_templates'])marketingCollections[k]=[];return;}
 marketingCollections.sequences=[{id:'seq-preview',saas:'leverads',name:'Retomada por etapas',status:'draft',trigger:{stages:['Qualificação']},exitOn:{won:true,booked:true,optOut:true,stageLeft:false},steps:[{channel:'whatsapp',delayDays:0,text:'Olá {{nome}}!'}]}];
 marketingCollections.sequence_enrollments=[{id:'en-preview',saas:'leverads',sequence:'seq-preview',lead:'l5',stepIndex:0,status:'waiting'}];
 marketingCollections.drip_templates=[{id:'tpl-preview',saas:'leverads',name:'Primeiro contato',channel:'email',subject:'Olá {{nome}}',body:'Vamos conversar sobre {{empresa}}?'}];
 window.__disparosWrites=[];window.__opened=[];window.open=(url)=>{window.__opened.push(url);return null;};
}
const failures={};
async function gate(method,write=false){if(write)window.__disparosWrites.push(method);if(method.includes(':')&&params.get('slow')===method)await new Promise(r=>setTimeout(r,2000));if((method.includes(':')&&params.get('failOnce')===method)&&!failures[method]){failures[method]=true;throw new Error('Falha simulada. Tente novamente.');}}
const methods={
 list:async(col,q)=>{await gate(`list:${col}`);return marketingCollections[col]?marketingCrud.list(col,q):[];},
 create:async(col,data)=>{await gate(`create:${col}`,true);return marketingCrud.create(col,data);},
 update:async(col,id,data)=>{await gate(`update:${col}`,true);return marketingCrud.update(col,id,data);},
 remove:async(col,id)=>{await gate(`remove:${col}`,true);return marketingCrud.remove(col,id);},
 campaignMetrics:async()=>{await gate('campaignMetrics');return params.has('empty')?{campaigns:[]}:marketingMock.campaignMetrics();},
 sequenceMetrics:async()=>{await gate('sequenceMetrics');return {sequences:[{id:'seq-preview',enrolled:20,advanced:8,booked:4,won:2,statusCounts:{waiting:1,active:8}}]};},
 campaignAiCopy:async()=>{await gate('campaignAiCopy',true);return marketingMock.campaignAiCopy();},
 campaignMark:async(id,{leadId,channel})=>{await gate('campaignMark',true);const c=marketingCollections.campaigns.find(c=>c.id===id);c.sent[leadId]={...c.sent[leadId],[channel]:new Date().toISOString()};return clone(c);},
 campaignSendEmail:async(id,ids)=>{await gate('campaignSendEmail',true);const c=marketingCollections.campaigns.find(c=>c.id===id);for(const lead of ids)c.sent[lead]={...c.sent[lead],email:new Date().toISOString()};return {ok:ids.length,results:ids.map(id=>({id,ok:true})),sent:clone(c.sent)};},
 sequenceWaSent:async(id)=>{await gate('sequenceWaSent',true);marketingCollections.sequence_enrollments=marketingCollections.sequence_enrollments.filter(e=>e.id!==id);return {ok:true};},
 waNumber:async()=>marketingMock.waNumber(),waInsights:async()=>marketingMock.waInsights(),
};
export const disparosReviewMock=methods;
