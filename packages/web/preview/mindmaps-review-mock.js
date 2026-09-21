const params=new URLSearchParams(location.search),clone=v=>structuredClone(v);
export const mindmapsReview=params.get('review')==='mindmaps';
let maps=[],conflicted=false;
export function setupMindmapsReview(){
 window.__mapWrites=[];
 const nodes=[['r',null,'Funil LeverAds'],['a','r','Entrada'],['a1','a','Anúncio no Meta'],['a2','a','Indicação da base'],['b','r','Qualificação'],['b1','b','2+ contas'],['c','r','Fechamento']].map(([id,parent,text],order)=>({id,parent,text,order}));
 maps=params.has('empty')?[]:[{id:'m1',name:'Funil LeverAds',nodes},{id:'m2',name:'Plano do trimestre',nodes:[{id:'root2',parent:null,text:'Plano do trimestre'}]},{id:'m3',name:'Ideias da equipe',nodes:[]},{id:'foreign',name:'Mapa de Elo',saas:'elo',nodes:[]}].map(m=>({saas:'leverads',links:[],layout:'tree',version:1,createdAt:'2026-09-16T12:00:00Z',updatedAt:'2026-09-18T12:00:00Z',...m}));
 window.__mapDocs=maps;
}
export const mindmapsReviewMock={
 list:async col=>clone(col==='mindmaps'?maps:[]),
 get:async(col,id)=>clone(maps.find(m=>m.id===id)),
 update:async(col,id,body)=>{const m=maps.find(m=>m.id===id);if(params.has('conflict')&&!conflicted&&body.nodes){conflicted=true;m.version++;m.nodes[0].text='Atualizado por outra pessoa';}
 if(body.baseVersion!=null&&body.baseVersion!==m.version){const err=new Error('Versão desatualizada');err.status=409;throw err;}
 window.__mapWrites.push({method:'update',id,body:clone(body)});const {baseVersion,...patch}=body;Object.assign(m,patch,{version:m.version+1});return clone(m);},
 create:async(col,body)=>{window.__mapWrites.push({method:'create',body:clone(body)});const m={...clone(body),id:`m${maps.length+1}`,version:1};maps.push(m);return clone(m);},
 remove:async(col,id)=>{window.__mapWrites.push({method:'remove',id});maps.splice(maps.findIndex(m=>m.id===id),1);return {ok:true};},
};
