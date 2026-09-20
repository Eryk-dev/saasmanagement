import {marketingMock} from './marketing-mock.js';
const params=new URLSearchParams(location.search);
export const socialReview=params.get('review')==='social';
export function setupSocialReview(seed){if(!socialReview)return;seed.USERS.push({id:'social-demo',name:'Manuela',roles:['social'],saas:'leverads'});seed.CONFIG.ai.configured=true;}
const ago=d=>new Date(Date.now()-d*86400000).toISOString();
const posts=[['Como clonar anúncios em várias contas','reel',18400,2],['Erros que atrapalham sua operação','carousel',12600,4],['Antes e depois da organização','reel',9800,6],['O que a IA muda no anúncio','feed',6400,1],['Preço fixo por operação','carousel',5200,11],['Como reduzir o retrabalho','reel',4800,13]].map(([caption,format,reach,d],i)=>({id:`social-post-${i}`,caption,format,reach,at:ago(d),views:reach+1200,likes:800-i*70,comments:40-i*3,saved:90-i*5,shares:30-i,totalInteractions:960-i*80,profileVisits:80-i*4,follows:20-i,permalink:`https://example.com/post/${i}`}));
let creatives=3;
let comments=[['Marcos','Quanto custa para três contas?',26],['Nina','Funciona para Shopee também?',5],['Otávio','Como conectar a conta?',9]].map(([author,text,waitingHours],i)=>({id:`social-comment-${i}`,network:'instagram',author,text,waitingHours,at:ago(waitingHours/24),postTitle:posts[i].caption,permalink:posts[i].permalink,pending:true,answered:false,done:false,hidden:false}));
const checked=(name,fn)=>(...args)=>{if(window.__socialFailures?.[name]>0){window.__socialFailures[name]--;throw new Error('Falha simulada na prévia');}return fn(...args);};
export const socialReviewMock={
 socialSummary:checked('socialSummary',(saas,days)=>params.has('disconnected')?{configured:false}:{...marketingMock.socialSummary(saas),aiConfigured:true,pains:[],media:params.has('empty')?[]:posts,followerSeries:Array.from({length:days},(_,i)=>({date:ago(days-i).slice(0,10),value:5+i%9}))}),
 socialPosts:checked('socialPosts',()=>params.has('empty')?[]:posts),
 socialAudience:checked('socialAudience',()=>marketingMock.socialAudience()),
 socialStories:checked('socialStories',()=>({stories:params.has('empty')?[]:[{id:'story-demo',caption:'Bastidores da operação',at:ago(1),type:'IMAGE',reach:1200,views:1600,replies:12,shares:7,profileVisits:30,follows:4,navForward:450,navBack:80,navExit:23,navNext:44}]})),
 socialDiscovery:checked('socialDiscovery',()=>({competitors:[],mentions:[],hashtags:[]})),
 socialComments:checked('socialComments',(_saas,status)=>{const all=params.has('empty')?[]:comments;return {configured:true,comments:all.filter(c=>status==='pending'?c.pending:status==='answered'?c.answered:true),insights:{pending:all.filter(c=>c.pending).length,oldestPendingHours:26,answeredRate:85,medianReplyMinutes:18,hidden:all.filter(c=>c.hidden).length}};}),
 socialCommentReply:checked('socialCommentReply',(id,text)=>{(window.__socialReplies ||= []).push({id,text});comments=comments.map(c=>c.id===id?{...c,pending:false,answered:true,reply:{text,at:ago(0)}}:c);return{ok:true};}),
 socialCommentDone:checked('socialCommentDone',(id,done)=>{comments=comments.map(c=>c.id===id?{...c,done,pending:!done}:c);return{ok:true};}),
 socialCommentHide:checked('socialCommentHide',(id,hidden)=>{comments=comments.map(c=>c.id===id?{...c,hidden}:c);return{ok:true};}),
 desempenho:checked('desempenho',()=>({logs:{'social-demo':{creatives}}})),
 desempenhoLog:checked('desempenhoLog',(_saas,{inc})=>({creatives:creatives=Math.max(0,creatives+inc.creatives)})),
 socialUpload:checked('socialUpload',()=>({id:'asset-demo'})),
 socialPublish:checked('socialPublish',body=>{(window.__socialPublishes ||= []).push(body);return params.has('partial')?{ok:false,results:{instagram:{ok:true,permalink:'https://example.com/post/mock'},facebook:{ok:false,error:'Falha fictícia no Facebook'}}}:{ok:true,results:Object.fromEntries(body.networks.map(net=>[net,{ok:true,permalink:'https://example.com/post/mock'}]))};}),
 socialAiCopy:checked('socialAiCopy',()=>({fields:{},caption:'Legenda fictícia da revisão'})),
};
