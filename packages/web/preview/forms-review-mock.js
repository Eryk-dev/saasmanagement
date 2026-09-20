import {marketingCollections,marketingCrud,marketingMock} from './marketing-mock.js';
const params=new URLSearchParams(location.search);
export const formsReview=params.get('review')==='forms';
export function setupFormsReview(seed){if(!formsReview)return;seed.LEADS.push({id:'form-lead-1',saas:'leverads',name:'Ana',accounts:'7-10',listings:'10000+'},{id:'form-lead-2',saas:'leverads',name:'Bruno',accounts:'1',listings:'500-1000'});}
const clone=v=>structuredClone(v),ago=hours=>new Date(Date.now()-hours*3600_000).toISOString();
const forms=()=>params.has('empty')?[]:marketingCollections.forms;
let submissions=[{id:'submission-1',saas:'leverads',form:'diagnostico-preview',lead:'form-lead-1',createdAt:ago(2),variant:'A',answers:{name:'Ana Lima',email:'ana@example.com',company:'Loja Exemplo',accounts:'7-10'},utm:{source:'instagram'}},{id:'submission-2',saas:'leverads',form:'diagnostico-preview',lead:'form-lead-2',createdAt:ago(100),variant:'B',answers:{name:'Bruno Souza',email:'bruno@example.com',company:'Catálogo Exemplo',accounts:'1'},utm:{source:'google'}}];
const stats=()=>({...marketingMock.formFunnel(),variants:marketingMock.formFunnel().variants.map((v,i)=>({...v,starts:i?360:420,firstAt:ago(24*14)}))});
const checked=(name,fn)=>(...args)=>{if(window.__formsFailures?.[name]>0){window.__formsFailures[name]--;throw new Error('Falha simulada na prévia');}return fn(...args);};
export const formsReviewMock={
 formsOverview:checked('formsOverview',saas=>({forms:clone(forms().filter(f=>f.saas===saas)),counts:{'diagnostico-preview':2},recent:params.has('empty')?[]:clone(submissions)})),
 formFunnels:checked('formFunnels',()=>Object.fromEntries(forms().map(f=>[f.id,stats()]))),
 formFunnel:checked('formFunnel',stats),
 formPreview:checked('formPreview',draft=>({html:`<!doctype html><html lang="pt-BR"><body style="font:16px system-ui;padding:32px;background:${draft.theme.bg};color:${draft.theme.fg}"><h1>${String(draft.welcome?.title || 'Seu formulário').replace(/[<>&"]/g,'')}</h1><p>Prévia fictícia · ${draft.questions.length} perguntas</p><button style="background:${draft.theme.accent};color:${draft.theme.accentFg};padding:12px 24px;border:0;border-radius:999px">${draft.welcome?.button || 'Começar'}</button></body></html>`})),
 list:checked('list',(col,q)=>col==='form_submissions'?clone(submissions.filter(s=>s.form===q.form)):marketingCrud.list(col,q)),
 update:checked('update',(col,id,patch)=>{(window.__formsWrites ||= []).push({col,id,patch:clone(patch)});return marketingCrud.update(col,id,patch);}),
 create:checked('create',(col,body)=>{(window.__formsWrites ||= []).push({col,body:clone(body)});return marketingCrud.create(col,body);}),
};
