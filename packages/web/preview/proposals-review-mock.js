const params=new URLSearchParams(location.search);
export const proposalsReview=params.get('review')==='proposals';
let templates=[],proposals=[];
export function setupProposalsReview(seed) {
 localStorage.setItem('cockpit_proposals_filtro','todas');
 // As telas da apresentação em slides vêm da API (CONFIG.proposals.slidesDeck,
 // lido do renderer do deck). Aqui vai uma amostra com as duas naturezas: tela
 // fixa e tela que só entra conforme o plano montado na tela zero.
 seed.CONFIG={...seed.CONFIG,proposals:{...seed.CONFIG?.proposals,slidesDeck:[
  {label:'Capa'},{label:'01 Quem somos'},{label:'02 Método'},{label:'02a OEM',cond:'oem'},{label:'02b Lever Ads',cond:'ads'},
  {label:'03 Demonstração'},{label:'06 Resultados',cond:'resultados'},{label:'07 Entregáveis'},{label:'08 Investimento'},
  {label:'09 Tangibilidade',cond:'pratica'},{label:'10 Garantia'},{label:'11 Encerramento'},
 ]}};
 templates=[
  // A apresentação oficial: layout de slides (as telas moram no renderer) e a
  // tabela de preço no documento — é o que o editor dela deixa mexer.
  {id:'t1',name:'Diagnóstico LeverAds · Escala',layout:'slides',status:'published',officialSince:'2026-09-18',slides:[],calc:{catalog:{catalogV:2,products:{
   ads_essencial:{line:'ads',tier:'essencial',name:'Lever Ads · Essencial',contas:3,anu:{per:497,total:5964},sem:{per:597,total:3582},inclui:{motor:['Sincronização das suas contas'],plataforma:['3 contas incluídas']}},
   ads_escala:{line:'ads',tier:'escala',name:'Lever Ads · Escala',contas:7,anu:{per:999,total:11988},sem:{per:1197,total:7182},inclui:{motor:['Equalização das suas contas'],plataforma:['7 contas incluídas · conta extra R$ 100/mês']}},
  },addons:{contaExtra:{label:'Conta extra no Escala',per:100}},oemPacks:[{qty:1000,price:2000},{qty:2000,price:3500}]}}},
  {id:'t2',name:'Lever OEM · Essencial',status:'published',slides:Array.from({length:7},(_,i)=>({type:'cards',title:`Slide ${i+1}`}))},
  {id:'t3',name:'Lever Price · Enterprise',status:'published',slides:Array.from({length:9},(_,i)=>({type:'cards',title:`Slide ${i+1}`}))},
  {id:'t4',name:'Mentoria · Assistido',status:'draft',slides:Array.from({length:5},(_,i)=>({type:'cards',title:`Slide ${i+1}`}))},
  // Deck aposentado: fica recolhido em "arquivados" (carimbo no nome + rascunho).
  {id:'t5',name:'[ARQUIVO 2026-09-18] Proposta · LeverAds',status:'draft',slides:Array.from({length:8},(_,i)=>({type:'cards',title:`Slide ${i+1}`}))},
 ].map(t=>({...t,saas:'leverads',theme:{},calc:t.calc||{}}));
 const rows=[['Marina Kern','Studio Kern','t1',2,4,true],['Diego Arbo','Clínica Arbo','t1',8,3,true],['Rogério Vante','Grupo Vante','t2',15,2,true],['Fernanda Luz','Luz Odontologia','t1',3,5,false],['Paulo Ferraz','Ferraz Advocacia','t1',4,2,false],['Tatiana Ponto','Mercado Ponto','t2',10,1,true],['Isabel Corrêa','Corrêa Pets','t2',5,3,false],['Sérgio Prado','Oficina Prado','t3',6,1,false],['Helena Vitta','Nutri Vitta','t1',7,2,false],['Caio Menezes','Menezes Auto','t3',9,0,false],['Lúcia Amaral','Amaral Studio','t2',12,0,false],['Bruno Sato','Sato Imports','t1',14,0,false],['Eduardo Galante','Galante Holding','t3',18,0,false],['Renata Dias','Clínica RD','t2',21,0,false],['Otávio Braga','Braga Fit','t1',24,0,false],['Nina Castro','Castro Pet','t2',27,0,false],['Marcos Aguiar','Grupo MA','t1',29,0,false],['Paula Bittencourt','Vitta Odonto','t3',30,0,false]];
 proposals=rows.map(([name,company,template,days,views,accepted],i)=>({id:`p${i}`,saas:'leverads',template,createdAt:new Date(Date.now()-days*86400000).toISOString(),views,accepted,data:{lead:{name,company,phone:'5541999990001'}}}));
 if(params.get('state')==='empty'){templates=[];proposals=[];}
 seed.PROPOSAL_TEMPLATES=templates;seed.PROPOSALS=proposals;window.__reviewMutations=[];
}
export const proposalsReviewMock={
 list:async(col)=>{if(col==='proposal_templates'&&params.has('holdTemplates'))await new Promise(resolve=>{window.__releaseTemplates=resolve;});return col==='proposal_templates'?templates:col==='proposals'?proposals:window.SEED[col.toUpperCase()]||[];},
 create:async(col,data)=>{const t={...data,id:`new-${templates.length}`};templates.push(t);window.__reviewMutations.push({method:'create',col,data});return t;},
 update:async(col,id,data)=>{const t=templates.find(t=>t.id===id);Object.assign(t,data);window.__reviewMutations.push({method:'update',col,id,data});return t;},
 remove:async(col,id)=>{templates=templates.filter(t=>t.id!==id);window.__reviewMutations.push({method:'remove',col,id});return {ok:true};},
 proposalPreview:async()=>({html:'<!doctype html><html lang="pt-BR"><body><h1>Prévia de revisão</h1></body></html>'}),
};
