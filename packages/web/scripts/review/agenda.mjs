import assert from 'node:assert/strict';
import { reviewHarness } from './harness.mjs';
const h=await reviewHarness('agenda','Agenda',async p=>{
 await p.getByRole('button',{name:/^Comercial/}).click();
 await p.getByRole('button',{name:'Agenda',exact:true}).click();
});
const dialog=p=>p.getByRole('dialog',{name:'compromisso',exact:true});
const create=async p=>{await p.getByRole('button',{name:'Criar compromisso',exact:true}).click();await dialog(p).waitFor();};
const selectView=(p,name)=>p.locator('.agenda-toolbar').getByRole('button',{name,exact:true}).click();
const geometry=[];
async function measure(p,ref){return p.evaluate(ref=>{
 const title=[...document.querySelectorAll('h1')].find(x=>x.textContent==='Agenda'&&x.getClientRects().length),head=title.closest('header');
 const root=head.parentElement,notices=ref?root.querySelector('section'):document.querySelector('.agenda-notices-card');
 const toolbar=ref?root.querySelectorAll('section')[1]:document.querySelector('.agenda-toolbar');
 const calendar=ref?root.querySelectorAll('section')[2]:document.querySelector('.agenda-calendar');
 return Object.fromEntries(Object.entries({title,head,notices,toolbar,calendar}).map(([k,e])=>{const r=e.getBoundingClientRect();return[k,{x:r.x,y:r.y,width:r.width,height:r.height}];}));
},ref);}
try{
 for(const width of process.env.REVIEW_FLOWS?[]:[1440,1920]){
  const app=await h.open(width),ref=await h.open(width,'',true);
  for(const view of ['Dia','Semana','Mês','Equipe']){
   if(view!=='Dia'){await selectView(app,view);await ref.getByRole('button',{name:view,exact:true}).filter({visible:true}).click();}
   await h.capture(app,`app-${width}-${view}`);await h.capture(ref,`reference-${width}-${view}`);
   const pair={width,view,app:await measure(app,false),reference:await measure(ref,true)};
   geometry.push(pair);await h.write('geometry.json',geometry);
   for(const key of ['title','head','notices','toolbar','calendar'])for(const axis of ['x','y','width','height'])assert.ok(Math.abs(pair.app[key][axis]-pair.reference[key][axis])<=1,`${width} ${view} ${key}.${axis}: ${pair.app[key][axis]} vs ${pair.reference[key][axis]}`);
  }
  await create(app);await ref.getByRole('button',{name:'Criar compromisso',exact:true}).click();
  await h.capture(app,`drawer-${width}`);await h.capture(ref,`reference-drawer-${width}`);
  await app.close();await ref.close();
 }
 const page=await h.open(1440);await create(page);
 await dialog(page).getByRole('button',{name:'Criar',exact:true}).click();
 await dialog(page).getByRole('alert').filter({hasText:'título'}).waitFor();
 await dialog(page).getByLabel('Título',{exact:true}).fill('Reunião de revisão');
 await dialog(page).getByLabel('Começa às').selectOption('18');
 await dialog(page).getByRole('button',{name:'Criar',exact:true}).click();await dialog(page).waitFor({state:'hidden'});
 assert.equal(await page.evaluate(()=>window.__reviewMutations.filter(m=>m.method==='create').length),1);
 await page.getByRole('button',{name:/Reunião de revisão/}).click();
 await dialog(page).getByLabel('Título',{exact:true}).fill('Reunião editada');
 await dialog(page).getByRole('button',{name:'Salvar',exact:true}).click();await dialog(page).waitFor({state:'hidden'});
 await page.getByRole('button',{name:/Reunião editada/}).click();
 page.once('dialog',d=>d.dismiss());await dialog(page).getByRole('button',{name:'Excluir',exact:true}).click();assert.equal(await dialog(page).count(),1);
 page.once('dialog',d=>d.accept());await dialog(page).getByRole('button',{name:'Excluir',exact:true}).click();await dialog(page).waitFor({state:'hidden'});
 await create(page);await dialog(page).getByLabel('Título',{exact:true}).fill('Rascunho');
 await dialog(page).getByRole('button',{name:'Cancelar',exact:true}).focus();page.once('dialog',d=>d.dismiss());await page.keyboard.press('Escape');assert.equal(await dialog(page).count(),1);
 page.once('dialog',d=>d.accept());await page.keyboard.press('Escape');await dialog(page).waitFor({state:'hidden'});
 await selectView(page,'Mês');await page.locator('.agenda-month-day').nth(15).focus();await page.keyboard.press('Enter');assert.equal(await page.locator('.agenda-month').count(),0);
 await page.getByRole('button',{name:'Hoje',exact:true}).click();await selectView(page,'Equipe');await page.getByRole('button',{name:/\+ livre das/}).first().click();await dialog(page).waitFor();await dialog(page).getByRole('button',{name:'Cancelar',exact:true}).focus();await page.keyboard.press('Escape');
 await page.getByLabel('Tipo de evento',{exact:true}).selectOption('call');assert.equal(await page.locator('.agenda-block').count(),0);
 await page.locator('.agenda-hidden').click();await page.locator('.agenda-block').first().waitFor();
 await page.close();
 for(const method of ['create','update','remove']){
  const p=await h.open(1440,`&failOnce=${method}`);
  if(method==='create'){await create(p);await dialog(p).getByLabel('Título',{exact:true}).fill('Teste de falha');await dialog(p).getByLabel('Começa às').selectOption('18');}
  else await p.getByRole('button',{name:/MELI/}).click();
  const action=method==='remove'?'Excluir':method==='create'?'Criar':'Salvar';
  if(method==='remove')p.once('dialog',d=>d.accept());
  await dialog(p).getByRole('button',{name:action,exact:true}).click();await dialog(p).getByRole('alert').waitFor();
  if(method==='remove')p.once('dialog',d=>d.accept());
  await dialog(p).getByRole('button',{name:action,exact:true}).click();await dialog(p).waitFor({state:'hidden'});await p.close();
 }
 const partial=await h.open(1440,'&partial');await create(partial);await dialog(partial).getByLabel('Título',{exact:true}).fill('Recorrente parcial');await dialog(partial).getByRole('button',{name:'Seg a sex',exact:true}).click();await dialog(partial).getByRole('button',{name:'Criar',exact:true}).click();await dialog(partial).getByRole('alert').filter({hasText:'salvo(s)'}).waitFor();assert.equal(await dialog(partial).getByRole('button',{name:'Criar',exact:true}).isDisabled(),true);assert.equal(await partial.evaluate(()=>window.__reviewMutations.length),4);await dialog(partial).getByRole('button',{name:'Cancelar',exact:true}).click();await partial.close();
 const slow=await h.open(1440,'&hold=create');await create(slow);await dialog(slow).getByLabel('Título',{exact:true}).fill('Aguardando servidor');await dialog(slow).getByLabel('Começa às').selectOption('18');
 await dialog(slow).getByRole('button',{name:'Criar',exact:true}).click();assert.equal(await dialog(slow).getByRole('button',{name:'Salvando…'}).isDisabled(),true);
 await slow.keyboard.press('Escape');assert.equal(await dialog(slow).count(),1);await slow.evaluate(()=>window.__releaseAgenda());await dialog(slow).waitFor({state:'hidden'});await slow.close();
 for(const [width,q] of [[390,''],[1440,'&theme=dark'],[1440,'&empty']]){
  const p=await h.open(width,q);await h.capture(p,`state-${width}-${q||'mobile'}`);
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await create(p);await h.capture(p,`editor-${width}-${q||'mobile'}`);
  const box=await dialog(p).boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width);
  await dialog(p).getByRole('button',{name:'Criar',exact:true}).focus();await p.keyboard.press('Tab');assert.ok(await dialog(p).evaluate(el=>el.contains(document.activeElement)));await p.close();
 }
 assert.deepEqual(h.errors,[]);console.log('Agenda: quatro visões, gaveta, CRUD, falhas, bloqueio de envio, filtros, teclado, mobile e tema escuro OK.');
}finally{await h.close();}
