import {setupPipelineReview} from './pipeline-mock.js';
const params=new URLSearchParams(location.search);
export const analiseReview=params.get('review')==='analise';
export function setupAnaliseReview(seed){setupPipelineReview(seed);if(params.has('empty'))seed.LEADS=[];window.__paceProducts=[];}
export const analiseReviewMock={pipelinePace:async saas=>{
 window.__paceProducts.push(saas);
 const empty=params.has('empty')||saas==='elo',won=params.has('won'),superMeta=params.has('super'),blocked=params.has('blocked');
 const sold=empty?0:won?200000:112400,target=180000;
 const rate=(value,numerator,denominator)=>({value,source:'history',numerator,denominator});
 return {month:'2026-09',today:'2026-09-18',context:{averageEntry:empty?0:14050,averageEntrySource:'initial_payments',wonMonth:empty?0:8},
 conversions:{contactRate:rate(.841,841,1000),bookingRate:rate(.312,262,841),showRate:rate(.76,199,262),closeRate:rate(blocked?0:.17,34,199)},
 marketing:{cpl:empty?null:77,spend30:10180,leads30:132},
 sale:{target,sold,remainingBusinessDays:9,elapsedBusinessDays:13,totalBusinessDays:22,...(superMeta?{chaseTarget:240000,chaseGap:127600,chasePct:133}:{}),byDay:Array.from({length:18},(_,i)=>i===17?sold:0)},
 plan:{leads:{today:4},contacts:{today:12},calls:{today:3},wins:{today:1}}};
}};
