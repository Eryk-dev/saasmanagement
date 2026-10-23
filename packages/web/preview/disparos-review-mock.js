import {marketingCollections,marketingCrud,marketingMock} from './marketing-mock.js';
// Prévia da tela de Disparos (Broadcasts · Sequências · Fila · Modelos), com ?review=disparos.
// &nowa / &noemail desligam os canais; &empty zera tudo; &failOnce=<método> e
// &slow=<método> simulam falha e espera. Nenhuma mensagem real sai daqui.
const params=new URLSearchParams(location.search);
export const disparosReview=params.get('review')==='disparos';
const clone=v=>structuredClone(v);
const APPROVED=[{name:'retomada_diag',language:'pt_BR',category:'MARKETING',body:'Oi {{1}}, tudo certo com a {{2}}?',params:2,header:'',supported:true}];
let official=[{...APPROVED[0],id:'1',status:'APPROVED',quality:'GREEN',rejectedReason:'',footer:'LeverAds',buttons:[]},{id:'2',name:'promo_out',language:'pt_BR',category:'MARKETING',status:'REJECTED',quality:'',rejectedReason:'PROMOTIONAL',header:null,body:'Promo imperdível',params:0,footer:'',buttons:[]}];
export function setupDisparosReview(seed){
 seed.CONFIG.ai={configured:true};seed.CONFIG.google={gmail:false};
 seed.CONFIG.whatsapp={...(seed.CONFIG.whatsapp||{}),configured:!params.has('nowa')};
 seed.CONFIG.email={provider:'resend',ready:!params.has('noemail')};
 seed.LEADS=seed.LEADS.map((l,i)=>({...l,email:`lead${i}@example.com`,phone:`554199999${String(i).padStart(4,'0')}`}));
 if(params.has('empty')){seed.LEADS=[];for(const k of ['campaigns','sequences','sequence_enrollments','drip_templates'])marketingCollections[k]=[];official=[];return;}
 marketingCollections.sequences=[{id:'seq-preview',saas:'leverads',name:'Retomada por etapas',status:'draft',trigger:{stages:['Qualificação'],reasons:['sem_resposta']},exitOn:{won:true,booked:true,optOut:true,stageLeft:false},steps:[{channel:'whatsapp',delayDays:0,text:'Olá {{nome}}!'}]}];
 marketingCollections.sequence_enrollments=[{id:'en-preview',saas:'leverads',sequence:'seq-preview',lead:'l5',stepIndex:0,status:'waiting'}];
 marketingCollections.drip_templates=[{id:'tpl-preview',saas:'leverads',name:'Primeiro contato',channel:'email',subject:'Olá {{nome}}',body:'Vamos conversar sobre {{empresa}}?'}];
 // Broadcast que a Meta aceitou e depois recusou na entrega: só a Carla (l5)
 // foi escolhida; os outros da etapa ficam de fora. O progresso reconcilia.
 const stage=seed.LEADS.find(l=>l.id==='l5')?.stage||'Qualificação';
 marketingCollections.campaigns=[...marketingCollections.campaigns,{id:'camp-falhou',saas:'leverads',name:'Follow-up com falha',channel:'whatsapp',status:'done',stages:[stage],channels:{whatsapp:true,email:false},
  wa:{template:{...APPROVED[0],vars:[{source:'token',value:'nome'},{source:'text',value:'LeverAds'}]}},email:{subject:'',body:''},
  sent:{l5:{whatsapp:new Date().toISOString(),waStatus:'sent',waMessageId:'wamid.FALHOU'}},createdAt:new Date().toISOString(),createdBy:'leo'}];
 window.__disparosWrites=[];window.__opened=[];window.open=(url)=>{window.__opened.push(url);return null;};
}
const failures={};
async function gate(method,write=false){if(write)window.__disparosWrites.push(method);if(params.get('slow')===method)await new Promise(r=>setTimeout(r,2000));if(params.get('failOnce')===method&&!failures[method]){failures[method]=true;throw new Error('Falha simulada. Tente novamente.');}}
const camp=id=>marketingCollections.campaigns.find(c=>c.id===id);
const methods={
 list:async(col,q)=>{await gate(`list:${col}`);return marketingCollections[col]?marketingCrud.list(col,q):[];},
 create:async(col,data)=>{await gate(`create:${col}`,true);return marketingCrud.create(col,{sent:{},...data});},
 update:async(col,id,data)=>{await gate(`update:${col}`,true);window.__disparosWrites.push({col,id,data:clone(data)});return marketingCrud.update(col,id,data);},
 remove:async(col,id)=>{await gate(`remove:${col}`,true);return marketingCrud.remove(col,id);},
 campaignMetrics:async()=>{await gate('campaignMetrics');return params.has('empty')?{campaigns:[]}:marketingMock.campaignMetrics();},
 sequenceMetrics:async()=>{await gate('sequenceMetrics');return {sequences:[{id:'seq-preview',enrolled:20,advanced:8,booked:4,won:2,statusCounts:{waiting:1,active:8}}]};},
 campaignAiCopy:async()=>{await gate('campaignAiCopy',true);return marketingMock.campaignAiCopy();},
 campaignSendEmail:async(id,ids)=>{await gate('campaignSendEmail',true);const c=camp(id);c.sent=c.sent||{};for(const lead of ids)c.sent[lead]={...c.sent[lead],emailStatus:'queued'};c.status='sending';return {ok:true,queued:ids.length,skipped:[],total:ids.length,status:'sending',sent:clone(c.sent)};},
 campaignSendWhatsapp:async(id,ids)=>{await gate('campaignSendWhatsapp',true);const c=camp(id);c.sent=c.sent||{};for(const lead of ids)c.sent[lead]={waStatus:'queued'};c.status='sending';return {ok:true,queued:ids.length,skipped:[],status:'sending'};},
 campaignProgress:async(id)=>{const c=camp(id);if(c?.sent?.l5?.waMessageId==='wamid.FALHOU'&&c.sent.l5.waStatus==='sent')c.sent.l5={...c.sent.l5,waStatus:'failed',waError:'a Meta segurou a entrega para preservar o engajamento (limite de marketing por pessoa)'};const out={queued:0,sent:0,delivered:0,read:0,failed:0,skipped:0,email:{queued:0,sent:0,failed:0,skipped:0}};for(const s of Object.values(c?.sent||{})){if(s?.waStatus)out[s.waStatus]=(out[s.waStatus]||0)+1;if(s?.emailStatus)out.email[s.emailStatus]=(out.email[s.emailStatus]||0)+1;}return {id,status:c?.status||'draft',pauseReason:c?.pauseReason||'',...out,byLead:clone(c?.sent||{})};},
 campaignPause:async(id)=>{await gate('campaignPause',true);const c=camp(id);c.status='paused';c.pauseReason='pausado pelo time';return clone(c);},
 campaignResume:async(id)=>{await gate('campaignResume',true);const c=camp(id);c.status='sending';c.pauseReason='';return clone(c);},
 sequenceEnroll:async(id,ids)=>{await gate('sequenceEnroll',true);return {enrolled:ids.length};},
 sequenceWaSent:async(id)=>{await gate('sequenceWaSent',true);marketingCollections.sequence_enrollments=marketingCollections.sequence_enrollments.filter(e=>e.id!==id);return {ok:true};},
 waMetaTemplates:async()=>{await gate('waMetaTemplates');return {templates:clone(APPROVED),unsupported:0};},
 waTemplatesAll:async()=>{await gate('waTemplatesAll');return {templates:clone(official)};},
 waDeleteTemplate:async(name)=>{await gate('waDeleteTemplate',true);official=official.filter(t=>t.name!==name);return {ok:true};},
 waCreateTemplate:async(body)=>{await gate('waCreateTemplate',true);official.push({id:String(official.length+1),name:body.name,language:body.language||'pt_BR',category:body.category,status:'PENDING',quality:'',rejectedReason:'',header:body.headerText?{format:'TEXT',text:body.headerText}:null,body:body.body,params:0,footer:body.footer||'',buttons:body.buttons||[]});return {ok:true,status:'PENDING'};},
 waNumber:async()=>({tier:'TIER_1K'}),waInsights:async()=>marketingMock.waInsights(),
};
export const disparosReviewMock=methods;
