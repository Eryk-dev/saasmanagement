import assert from 'node:assert/strict';
import { reviewHarness } from './harness.mjs';
const h=await reviewHarness('today','Minhas atividades',p=>p.getByRole('button',{name:/^Atividades/}).click());
const evidence=[];
async function geometry(page,reference){return page.evaluate(reference=>{
  const heading=[...document.querySelectorAll('h1')].find(e=>e.offsetWidth&&e.textContent==='Minhas atividades');
  const header=heading.closest('header');const grid=header.parentElement;
  const now=reference?grid.children[1].querySelector('section'):document.querySelector('.today-now');
  const queue=reference?grid.children[1].querySelectorAll('section')[1]:document.querySelector('.today-queue');
  const empty=reference?grid.children[2].querySelector('aside'):document.querySelector('.today-script-empty');
  const search=queue.querySelector('input').parentElement;
  const row=reference?[...queue.children].find(e=>getComputedStyle(e).display==='grid'):queue.querySelector('.today-queue-row');
  const parts={heading,header,now,nowButton:now.querySelector('button'),queue,empty,search,row};
  return Object.fromEntries(Object.entries(parts).map(([key,e])=>{const r=e.getBoundingClientRect();return[key,{x:r.x,y:r.y,width:r.width,height:r.height}]}));
},reference)}
try {
  for(const width of [1440,1920]){
    const reference=await h.open(width,'',true),page=await h.open(width);
    await page.locator('.today-queue-row').first().waitFor();
    const expected=await geometry(reference,true),actual=await geometry(page,false),comparisons=[];
    for(const key of Object.keys(expected)) for(const dimension of ['x','y','width','height']) {
      // Queue height varies with data; row Y follows the content-dependent header.
      if(key==='queue'&&dimension==='height')continue;
      if(key==='row'&&dimension==='y')continue;
      if(key==='search'&&(dimension==='x'||dimension==='y'))continue;
      const difference=Math.abs(actual[key][dimension]-expected[key][dimension]);
      comparisons.push({element:key,dimension,expected:expected[key][dimension],actual:actual[key][dimension],difference});
    }
    evidence.push({width,comparisons});
    await h.capture(reference,`reference-${width}`);await h.capture(page,`app-${width}`);
    assert.deepEqual(comparisons.filter(r=>r.difference>1),[],`Fixed geometry at ${width}`);
    const text=await page.locator('.today-screen').innerText();
    for(const removed of ['Sem data','O que vem','Placar','Tarefas do kanban','Social selling','Agenda, tarefas e placar'])assert.ok(!text.includes(removed),removed);
    const search=page.getByRole('textbox',{name:'Buscar na fila'});
    await search.fill('Carla');assert.equal(await page.locator('.today-queue > .today-queue-row').count(),1);
    await page.locator('.today-open-script').first().click();
    const panel=page.getByRole('region',{name:'Atividade do lead'});await panel.waitFor();
    assert.ok(await panel.evaluate(e=>e.contains(document.activeElement)));
    assert.equal(await page.locator('.today-step').count(),0);
    await panel.getByRole('heading',{name:'Perguntas e respostas do formulário',exact:true}).waitFor();
    await h.capture(page,`selected-${width}`);
    assert.equal(await panel.getByText('Como se comportar',{exact:true}).count(),0);
    await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
    assert.equal(await search.inputValue(),'Carla');assert.ok(await page.locator('.today-open-script').first().evaluate(e=>e===document.activeElement));
    await search.fill('zzzz');await page.getByRole('button',{name:'limpar busca',exact:true}).click();assert.equal(await search.inputValue(),'');
    await page.locator('.today-completed summary').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('.today-completed').evaluate(e=>e.open),true);
    await page.getByRole('button',{name:'Pessoa da fila',exact:true}).click();await page.getByRole('button',{name:/^Lucas/}).click();assert.equal(await page.evaluate(()=>localStorage.getItem('cockpit_today_person')),'lucas');
    await page.close();await reference.close();
  }
  const mobile=await h.open(390);await mobile.locator('.today-queue-row').first().waitFor();
  assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await h.capture(mobile,'app-390');
  const trigger=mobile.getByRole('button',{name:'Abrir a atividade →',exact:true});await trigger.click();
  const dialog=mobile.getByRole('dialog');await dialog.waitFor();const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=391);
  assert.ok(await dialog.evaluate(e=>e.contains(document.activeElement)));await mobile.keyboard.press('Shift+Tab');assert.ok(await dialog.evaluate(e=>e.contains(document.activeElement)));
  await h.capture(mobile,'selected-390');await mobile.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.ok(await trigger.evaluate(e=>e===document.activeElement));await mobile.close();
  const many=await h.open(1440,'&many');await many.getByRole('navigation',{name:'Páginas da fila'}).waitFor();assert.equal(await many.locator('.today-queue > .today-queue-row').count(),10);
  await many.getByRole('button',{name:'Próximas ›'}).click();await many.getByRole('button',{name:'‹ Anteriores'}).click();await many.close();
  const empty=await h.open(1440,'&state=empty');await empty.getByRole('heading',{name:'Nenhuma atividade pendente hoje'}).waitFor();assert.equal(await empty.getByRole('button',{name:'Fila limpa ✓'}).isDisabled(),true);await h.capture(empty,'empty');await empty.close();
  const failed=await h.open(1440,'&failOnce=list');await failed.getByRole('alert').waitFor();await h.capture(failed,'error');await failed.getByRole('button',{name:'recarregar',exact:true}).click();await failed.getByRole('alert').waitFor({state:'hidden'});await failed.close();
  const write=await h.open(1440);await write.getByRole('button',{name:'Abrir a atividade →',exact:true}).click();
  await write.getByRole('button',{name:'cliente confirmou',exact:true}).click();
  await write.waitForFunction(()=>window.__reviewMutations.some(m=>m.method==='logActivity'));
  const mutations=await write.evaluate(()=>window.__reviewMutations);
  assert.ok(mutations.some(m=>m.method==='update'&&m.patch.callConfirmed===true));assert.ok(mutations.some(m=>m.method==='logActivity'&&m.data.meta.event==='confirm'));
  await write.close();
  const slow=await h.open(1440,'&slow=list');await slow.locator('.today-queue-row').first().waitFor();await h.capture(slow,'loaded-after-delay');await slow.close();
  const dark=await h.open(1440,'&theme=dark');await dark.locator('.today-queue-row').first().waitFor();await h.capture(dark,'dark');await dark.close();
  assert.deepEqual(h.errors,[]);
  console.log('Atividades: geometria, 390px, busca, paginação, pessoa, roteiro, teclado, confirmação, vazio, carga e recuperação de erro aprovados.');
} finally {await h.write('geometry.json',evidence);await h.close();}
