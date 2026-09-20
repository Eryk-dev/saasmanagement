import {marketingMock} from './marketing-mock.js';
const params=new URLSearchParams(location.search),clone=v=>structuredClone(v);
export const blogReview=params.get('review')==='blog';
export function setupBlogReview(seed){if(params.has('viewer')){seed.ME.roles=['sdr'];seed.USERS.find(u=>u.id==='leo').roles=['sdr'];}window.__blogWrites=[];window.__blogReads=[];}
const deleted=new Set();
export const blogReviewMock={
 trainingQueue:async()=>({decks:[],queue:{}}),
 blog:async(saas)=>{const d=marketingMock.blog(saas);d.posts=d.posts.filter(p=>!deleted.has(p.id));d.counts=Object.fromEntries(['pauta','rascunho','agendado','publicado','arquivado'].map(status=>[status,d.posts.filter(p=>p.status===status).length]));if(params.has('empty')){d.posts=[];d.counts={};}if(params.has('noAi'))d.aiConfigured=false;return d;},
 blogPost:async(...a)=>{window.__blogReads.push('blogPost');if(deleted.has(a[1]))throw new Error('Post excluído');return marketingMock.blogPost(...a);},
 blogUpdate:async(...a)=>{window.__blogWrites.push({method:'blogUpdate',patch:clone(a[2])});return marketingMock.blogUpdate(...a);},
 blogSaveRules:async(...a)=>{window.__blogWrites.push({method:'blogSaveRules',patch:clone(a[1])});return marketingMock.blogSaveRules(...a);},
 blogNewPauta:async(...a)=>{window.__blogWrites.push({method:'blogNewPauta'});return marketingMock.blogNewPauta(...a);},
 blogMine:async(...a)=>{window.__blogWrites.push({method:'blogMine'});return marketingMock.blogMine(...a);},
 blogTick:async(...a)=>{window.__blogWrites.push({method:'blogTick'});return marketingMock.blogTick(...a);},
 blogDigest:async(...a)=>marketingMock.blogDigest(...a),
 blogPreviewUrl:async()=>{window.__blogReads.push('blogPreviewUrl');return {url:new URL('blog-post.html',location.href).href,expiresAt:new Date(Date.now()+30*60_000).toISOString()};},
 blogAction:async(saas,id,action,opts)=>{window.__blogWrites.push({method:'blogAction',action,opts});const p=marketingMock.blogAction(saas,id,action);if(action==='approve')return marketingMock.blogUpdate(saas,id,{scheduledAt:opts?.scheduledAt||new Date(Date.now()+86400000).toISOString()});if(action==='publish')return marketingMock.blogUpdate(saas,id,{slugLocked:true,publishedAt:new Date().toISOString()});return p;},
 blogDraft:async(saas,id)=>{window.__blogWrites.push({method:'blogDraft'});return marketingMock.blogUpdate(saas,id,{status:'rascunho',body:'## Texto fictício\n\nRascunho gerado na revisão.',lint:[],wordCount:8});},
 blogRevise:async(saas,id,instruction)=>{window.__blogWrites.push({method:'blogRevise',instruction});return marketingMock.blogUpdate(saas,id,{body:'## Texto revisado\n\nRevisado com uma instrução fictícia.',lint:[]});},
 blogDelete:async(saas,id)=>{window.__blogWrites.push({method:'blogDelete'});deleted.add(id);return {ok:true};},
};
