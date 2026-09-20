import {marketingMock} from './marketing-mock.js';
const params=new URLSearchParams(location.search);
export const metricsReview=params.get('review')==='metrics';
export function setupMetricsReview(seed){if(!metricsReview)return;seed.CONFIG.meta.configured=!params.has('disconnected');if(!params.has('disconnected'))seed.SAAS[0].metaAdAccount='act_4471';}
const clone=o=>structuredClone(o);
let objects={campaigns:[{id:'cp1',name:'[B] Operação organizada',status:'ACTIVE',effectiveStatus:'ACTIVE',dailyBudget:50},{id:'cp2',name:'[C] Expansão de catálogo',status:'PAUSED',effectiveStatus:'PAUSED',dailyBudget:30}],adsets:[{id:'as1',campaignId:'cp1',name:'01 [B] Público operação',status:'ACTIVE',effectiveStatus:'ACTIVE',dailyBudget:25}],ads:[{id:'ad1',campaignId:'cp1',adsetId:'as1',name:'01 [B] Vídeo operação',status:'ACTIVE',effectiveStatus:'ACTIVE'},{id:'ad2',campaignId:'cp1',adsetId:'as1',name:'02 [B] Sem conversão',status:'ACTIVE',effectiveStatus:'ACTIVE'}]};
let rules={agendaFull:{enabled:true,horizon:'pair',callsPerCloser:4},weekendOff:{enabled:true,days:[5,6]},shortFriday:{enabled:false,lastCallHour:16},budget:{enabled:false,maxStepPct:20,windowDays:14}};
const delivery=()=>({rules:clone(rules),state:{pausedCampaigns:[]},log:[],metaConfigured:true,preview:{window:['2026-09-21','2026-09-22'],booked:6,target:16,capacity:20,days:[],cost:{calls:46,leads:168,spend:8400,costPerCall:182.61}}});
const checked=(name,fn)=>(...args)=>{if(window.__adsFailures?.[name]>0){window.__adsFailures[name]--;throw new Error('Falha simulada na prévia');}return fn(...args);};
const stats=(o,i)=>({...o,spend:i?300:4500,leads:i?0:90,cpl:i?null:50,impressions:24000,linkClicks:800,clicks:950,calls:26,shown:20,won:4,revenue:13200,roas:2.93,ctr:3.3,cpc:5.62,abc:{A:30,B:40,C:20}});
export const metricsReviewMock={
 metrics:checked('metrics',()=>marketingMock.metrics()),
 marketingMetrics:checked('marketingMetrics',()=>({...marketingMock.marketingMetrics(),syncedAt:new Date().toISOString(),campaigns:params.has('empty')?[]:objects.campaigns.map(stats),adsets:params.has('empty')?[]:objects.adsets.map(stats),ads:params.has('empty')?[]:objects.ads.map(stats)})),
 adObjects:checked('adObjects',()=>params.has('empty')?{campaigns:[],adsets:[],ads:[]}:clone(objects)),
 marketingPlacements:()=>({rows:[]}),
 deliveryRules:checked('deliveryRules',delivery),
 saveDeliveryRules:checked('saveDeliveryRules',(_saas,next)=>{rules=clone(next);(window.__adsRules ||= []).push(clone(next));return delivery();}),
 runDeliveryRules:checked('runDeliveryRules',()=>({ok:true})),
 metaObjectStatus:checked('metaObjectStatus',(id,status)=>{(window.__adsToggles ||= []).push({id,status});for(const rows of Object.values(objects))for(const row of rows)if(row.id===id)Object.assign(row,{status,effectiveStatus:status});return{ok:true};}),
 metaObjectBudget:checked('metaObjectBudget',(id,dailyBudget)=>{(window.__adsBudgets ||= []).push({id,dailyBudget});for(const rows of Object.values(objects))for(const row of rows)if(row.id===id)row.dailyBudget=dailyBudget;return{ok:true};}),
 create:checked('create',(col,data)=>{(window.__adsCreated ||= []).push({col,data});return{id:'manual-demo',...data};}),
 marketingSync:checked('marketingSync',()=>({ok:true})),
 creativeDefaults:()=>({painMap:{B:'Organização da operação',C:'Expansão'},link:'https://example.com/diagnostico',pageId:'page-demo'}),
 metaAdsets:id=>({adsets:clone(objects.adsets.filter(o=>o.campaignId===id))}),
 adCreative:checked('adCreative',()=>({type:'none'})),
 adFromVideo:checked('adFromVideo',()=>{(window.__adsUploads ||= []).push('clone');return{jobId:'job-demo'};}),
 uploadCreative:checked('uploadCreative',()=>{(window.__adsUploads ||= []).push('creative');return{jobId:'job-demo'};}),
 adVideoJob:()=>params.has('jobfail')?{status:'error',error:'Falha fictícia no processamento'}:({status:'done',result:{adsetName:'99 [B]',name:'99 [B]',status:'PAUSED'}}),
};
