import assert from 'node:assert/strict';
import { reviewHarness } from './harness.mjs';
const h=await reviewHarness('pipeline','Pipeline',async p=>{await p.getByRole('button',{name:/^Comercial/}).click();await p.getByRole('button',{name:/^Pipeline/}).click();});
const measurements=[];
async function geometry(page,reference,view='kanban') {
 return page.evaluate(({reference,view})=>{
  const h1=[...document.querySelectorAll('h1')].find(el=>el.textContent==='Pipeline'&&el.getClientRects().length);
  const root=h1.parentElement.parentElement.parentElement;
  const q=selector=>reference?root.querySelector(selector):document.querySelector(selector);
  const tpl=id=>`[data-dc-tpl="${id}"]`;
  const pairs={title:h1,header:root.children[0],filters:root.children[1],search:q(reference?tpl(18):'.pipeline-search'),viewTabs:q(reference?tpl(12):'.pipeline-views'),create:q(reference?tpl(16):'.pipeline-create')};
  if(view==='kanban') Object.assign(pairs,{board:q(reference?tpl(41):'.kb-board'),column:q(reference?tpl(43):'.kb-col'),columnHead:q(reference?tpl(44):'.kb-col-head'),card:q(reference?tpl(52):'.lead-board-card'),won:q(reference?tpl(65):'.pipeline-won')});
  if(view==='list') {
   const list=q(reference?tpl(82):'.pipeline-list'), head=reference?list.children[0]:list.querySelector('.pipeline-list-head'), row=reference?list.children[1].children[0]:list.querySelector('.pipeline-list-row');
   Object.assign(pairs,{list,listHead:head,listRow:row});for(let i=0;i<6;i++)pairs[`listCell${i}`]=row.children[i];
  }
  if(view==='analysis') {
   const section=root.children[2], head=section.children[0], tableHead=reference?section.children[1]:section.querySelector('.pipeline-analysis-head'), row=reference?section.children[2].children[0]:section.querySelector('.pipeline-analysis-row');
   Object.assign(pairs,{analysis:section,analysisHeader:head,analysisHead:tableHead,analysisRow:row});
  }
  const result={};for(const [name,el] of Object.entries(pairs)){if(!el)continue;const r=el.getBoundingClientRect();result[name]={x:r.x,y:r.y,width:r.width,height:r.height};}return result;
 },{reference,view});
}
try {
 for(const width of [1440,1920]) {
  const app=await h.open(width),ref=await h.open(width,'',true);
  const a=await geometry(app,false),r=await geometry(ref,true);
  measurements.push({width,app:a,reference:r});
  await h.capture(app,`app-${width}`);await h.capture(ref,`reference-${width}`);
  await app.getByRole('button',{name:'Lista',exact:true}).click();await ref.getByRole('button',{name:'Lista',exact:true}).click();
  await h.capture(app,`list-${width}`);await h.capture(ref,`list-reference-${width}`);
  measurements.push({width,view:'list',app:await geometry(app,false,'list'),reference:await geometry(ref,true,'list')});
  await app.getByRole('button',{name:'Análise',exact:true}).click();await ref.getByRole('button',{name:'Análise',exact:true}).click();await app.locator('.pipeline-analysis-row').first().waitFor();
  measurements.push({width,view:'analysis',app:await geometry(app,false,'analysis'),reference:await geometry(ref,true,'analysis')});
  await h.capture(app,`analysis-${width}`);await h.capture(ref,`analysis-reference-${width}`);
  await app.getByRole('button',{name:'Kanban',exact:true}).click();
  await app.getByRole('button',{name:'Abrir lead: Marcos Lima',exact:true}).click();await ref.getByRole('button',{name:'Kanban',exact:true}).click();await ref.getByText('Bruno Sato',{exact:true}).filter({visible:true}).click();
  await h.capture(app,`drawer-${width}`);await h.capture(ref,`drawer-reference-${width}`);
  measurements.push({width,view:'drawer',app:{drawer:await app.getByRole('dialog').boundingBox()},reference:{drawer:await ref.locator('aside').filter({visible:true}).last().boundingBox()}});
  await app.close();await ref.close();
 }
 await h.write('geometry.json',measurements);
 for(const m of measurements) for(const [name,r] of Object.entries(m.reference)) for(const [key,value] of Object.entries(r)) assert.ok(Math.abs(m.app[name][key]-value)<=1,`${m.width} ${m.view||'kanban'} ${name}.${key}: ${m.app[name][key]} vs ${value}`);
 const p=await h.open(1440);
 const search=p.getByRole('textbox',{name:'Buscar lead ou empresa'});
 await search.fill('Marcos'); assert.equal(await p.locator('.lead-board-card').count(),1);
 await p.getByRole('button',{name:'Lista',exact:true}).click(); assert.equal(await p.locator('.pipeline-list-row').count(),1);
 await p.getByRole('button',{name:'Análise',exact:true}).click(); await p.locator('.pipeline-analysis-row').first().waitFor();assert.equal(await search.inputValue(),'Marcos');
 await p.getByRole('button',{name:'Limpar filtros',exact:true}).click();
 await p.getByRole('button',{name:'Kanban',exact:true}).click();
 await p.locator('.pipeline-segment').first().getByRole('button',{name:/^SDR/}).click();assert.equal(await p.locator('.kb-col').count(),3);
 await p.getByRole('button',{name:'Limpar filtros',exact:true}).click();
 await p.getByRole('button',{name:'Manuela Costa',exact:true}).click();assert.equal(await p.locator('.lead-board-card').count(),0);
 await p.getByRole('button',{name:'Limpar filtros',exact:true}).click();
 await p.getByRole('combobox',{name:'Ordenar leads'}).selectOption('qualidade');
 await p.getByRole('checkbox',{name:'Selecionar Marcos Lima',exact:true}).click();await p.getByText('1 lead selecionado',{exact:true}).waitFor();
 await p.getByRole('button',{name:'registrar toque',exact:true}).click();
 assert.ok(await p.evaluate(()=>window.__reviewMutations.some(m=>m.method==='logActivity'&&m.data.lead==='l4')));
 await p.getByRole('button',{name:/Mostrar descartados/}).click();await p.getByRole('button',{name:/Lead descartado.*voltar/}).click();
 assert.ok(await p.evaluate(()=>window.__reviewMutations.some(m=>m.id==='discard'&&m.patch?.stage==='Novo lead')));
 const card=p.getByRole('button',{name:'Abrir lead: Marcos Lima',exact:true});await card.focus();await p.keyboard.press('Enter');
 const drawer=p.getByRole('dialog',{name:'Lead · Marcos Lima',exact:true});await drawer.waitFor();
 assert.equal(await drawer.locator('.lead-panel-facts').count(),0);
 await drawer.getByText('Anotações',{exact:true}).click();await drawer.getByRole('textbox',{name:'Anotações',exact:true}).fill('Conferir a proposta amanhã');
 await drawer.getByRole('textbox',{name:'Nota do próximo toque'}).click();assert.ok(await p.evaluate(()=>window.__reviewMutations.some(m=>m.patch?.recapNote==='Conferir a proposta amanhã')));
 await drawer.getByRole('button',{name:'Adiar 1d',exact:true}).click();assert.ok(await p.evaluate(()=>window.__reviewMutations.some(m=>m.id==='l4'&&m.patch?.nextActionAt)));
 await drawer.getByRole('button',{name:'Agendamento',exact:true}).click();await p.getByRole('dialog',{name:'Agendamento do lead'}).waitFor();await p.keyboard.press('Escape');assert.equal(await p.getByRole('dialog').count(),1);
 await drawer.getByRole('button',{name:'Descartar lead',exact:true}).click();const gate=p.getByRole('dialog',{name:'mover lead',exact:true});await gate.waitFor();assert.equal(await gate.getByRole('button',{name:'confirmar movimento'}).isEnabled(),false);await p.keyboard.press('Escape');await p.keyboard.press('Escape');await gate.waitFor({state:'hidden'});
 await drawer.getByRole('button',{name:'Gerar apresentação',exact:true}).click();await p.waitForFunction(()=>window.__reviewMutations.some(m=>m.method==='generateProposal'));
 await drawer.getByRole('button',{name:'Link de pagamento',exact:true}).click();await p.getByRole('dialog',{name:'Link de pagamento',exact:true}).waitFor();await p.keyboard.press('Escape');await p.keyboard.press('Escape');await p.getByRole('dialog',{name:'Link de pagamento',exact:true}).waitFor({state:'hidden'});
 await p.keyboard.press('Escape');await drawer.waitFor({state:'hidden'});assert.equal(await card.evaluate(el=>el===document.activeElement),true);
 await card.dragTo(p.getByRole('region',{name:'Em contato',exact:true}));
 await p.waitForFunction(()=>window.__reviewMutations.some(m=>m.id==='l4'&&m.patch?.stage==='Em contato'));
 await p.getByRole('button',{name:'Cadastrar lead',exact:true}).click();await p.getByRole('dialog').waitFor();const create=p.getByRole('dialog');await create.getByRole('textbox',{name:/^Nome/}).fill('Lead de revisão');await h.capture(p,'create-lead');await create.getByRole('button',{name:'Criar',exact:true}).click();await p.waitForFunction(()=>window.__reviewMutations.some(m=>m.method==='create'&&m.data.name==='Lead de revisão'));await create.waitFor({state:'hidden'});await p.close();
 const empty=await h.open(1440,'&state=empty');assert.equal(await empty.locator('.lead-board-card').count(),0);await h.capture(empty,'empty');await empty.close();
 const fail=await h.open(1440,'&failOnce=pipelinePace');await fail.getByRole('button',{name:'Análise',exact:true}).click();await fail.getByRole('alert').waitFor();await fail.getByRole('button',{name:'Tentar novamente',exact:true}).click();await fail.locator('.pipeline-analysis-row').first().waitFor();await fail.close();
 const slow=await h.open(1440,'&slow=pipelinePace');await slow.getByRole('button',{name:'Análise',exact:true}).click();await slow.getByText('Calculando análise…',{exact:true}).waitFor();await slow.getByRole('button',{name:'Lista',exact:true}).click();await slow.locator('.pipeline-list-row').first().waitFor();await slow.close();
 const many=await h.open(1440,'&many');assert.ok(await many.locator('.kb-col-list').first().evaluate(el=>el.scrollHeight>el.clientHeight));await many.locator('.kb-col-list').first().evaluate(el=>{el.scrollTop=el.scrollHeight;});await h.capture(many,'many');await many.close();
 const mobile=await h.open(390);assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 for(const view of ['Kanban','Lista','Análise']) {await mobile.getByRole('button',{name:view,exact:true}).click();await h.capture(mobile,`mobile-${view}`);assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await mobile.getByRole('button',{name:'Kanban',exact:true}).click();await mobile.getByRole('button',{name:'Abrir lead: Marcos Lima',exact:true}).click();const md=mobile.getByRole('dialog');await md.waitFor();const mb=await md.boundingBox();assert.ok(mb.x>=0&&mb.x+mb.width<=390&&mb.y+mb.height<=844);await md.getByRole('button',{name:'Descartar lead'}).click();await mobile.getByRole('dialog',{name:'mover lead'}).waitFor();await mobile.keyboard.press('Escape');await mobile.keyboard.press('Escape');await h.capture(mobile,'mobile-drawer');await mobile.keyboard.press('Escape');await mobile.close();
 const dark=await h.open(1440);await dark.evaluate(()=>document.body.dataset.theme='dark');await h.capture(dark,'dark');await dark.close();
 console.log(`Pipeline: ${measurements.reduce((n,m)=>n+Object.keys(m.reference).length*4,0)} medidas aprovadas; filtros, seleção, drag, ficha, proposta, gates, estados e mobile verificados.`);
 assert.deepEqual(h.errors,[]);
} finally {await h.close();}
