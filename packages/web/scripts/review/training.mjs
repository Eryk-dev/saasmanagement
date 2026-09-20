import assert from 'node:assert/strict';
import { reviewHarness } from './harness.mjs';
const h=await reviewHarness('training','Treinamentos',p=>p.getByRole('button',{name:/^Treinamentos/}).click());
const evidence=[];
async function geometry(page,reference){return page.evaluate(reference=>{
 const heading=[...document.querySelectorAll('h1')].find(e=>e.offsetWidth&&e.textContent==='Treinamentos'),header=heading.closest('header'),grid=reference?header.parentElement:document.querySelector('.training-study-layout');
 const offset=reference?1:0;
 const hero=grid.children[offset],consistency=grid.children[offset+1],main=grid.children[offset+2],aside=grid.children[offset+3];
 const parts={header,heading,hero,consistency,decks:main.children[0],references:main.children[1],mastery:aside.children[0],exam:aside.children[1]};
 return Object.fromEntries(Object.entries(parts).map(([key,e])=>{const r=e.getBoundingClientRect();return[key,{x:r.x,y:r.y,width:r.width,height:r.height}]}));
},reference)}
try{
 for(const width of [1440,1920]){
  const reference=await h.open(width,'',true),page=await h.open(width);await page.locator('.training-consistency').waitFor();
  const expected=await geometry(reference,true),actual=await geometry(page,false),comparisons=[];
  for(const key of Object.keys(expected))for(const dimension of ['x','y','width','height']){
   // Real deck count controls the second row's height and following cards.
   if(['decks','mastery'].includes(key)&&dimension==='height')continue;
   if(['references','exam'].includes(key)&&dimension==='y')continue;
   const difference=Math.abs(actual[key][dimension]-expected[key][dimension]);comparisons.push({element:key,dimension,expected:expected[key][dimension],actual:actual[key][dimension],difference});
  }
  evidence.push({width,comparisons});await h.capture(reference,`reference-${width}`);await h.capture(page,`app-${width}`);
  assert.deepEqual(comparisons.filter(r=>r.difference>1),[],`Fixed geometry at ${width}`);
  await page.getByRole('button',{name:'Estudar →',exact:true}).click();const session=page.getByRole('region',{name:'Sessão de estudo'});await session.waitFor();assert.equal(await page.getByRole('dialog').count(),0);
  await h.capture(page,`session-${width}`);await reference.getByRole('button',{name:'Estudar →',exact:true}).click();await h.capture(reference,`reference-session-${width}`);
  const sessionGeometry = (p,ref)=>p.evaluate(ref=>{const button=[...document.querySelectorAll('button')].find(e=>e.offsetWidth&&e.textContent.startsWith('Mostrar resposta'));const parts=ref?[button.parentElement,button.previousElementSibling,button]:[document.querySelector('.training-study-session'),document.querySelector('.training-flashcard'),button];return parts.map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})},ref);
  const referenceSession=await sessionGeometry(reference,true),actualSession=await sessionGeometry(page,false);
  for(let i=0;i<3;i++)for(const dimension of ['x','y','width','height']){const difference=Math.abs(actualSession[i][dimension]-referenceSession[i][dimension]);comparisons.push({element:`session-${i}`,dimension,expected:referenceSession[i][dimension],actual:actualSession[i][dimension],difference});assert.ok(difference<=1,`Session geometry ${i}/${dimension} at ${width}`);}

  await page.getByRole('button',{name:/Mostrar resposta/}).click();await page.keyboard.press('3');await page.getByRole('button',{name:/Mostrar resposta/}).waitFor();
  await page.keyboard.press('Escape');await session.waitFor({state:'hidden'});
  await page.getByRole('button',{name:/Abrir referência: ICP/}).click();assert.equal(await page.getByRole('button',{name:/Fechar referência: ICP/}).getAttribute('aria-expanded'),'true');await page.getByRole('button',{name:/Fechar referência: ICP/}).click();
  await page.getByRole('button',{name:'Equipe',exact:true}).click();await page.locator('.training-team-row').first().waitFor();await page.locator('.training-team-row').first().click();await page.locator('.training-team-memory').waitFor();await h.capture(page,`team-${width}`);await reference.getByRole('button',{name:'Equipe',exact:true}).click();await reference.getByText('Manuela Costa',{exact:true}).filter({visible:true}).click();await h.capture(reference,`reference-team-${width}`);
  assert.equal(await page.getByText('Ritmo',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Editar',exact:true}).click();await page.getByRole('textbox',{name:'Frente do card',exact:true}).first().waitFor();
  await page.getByRole('button',{name:'Prévia',exact:true}).first().click();await page.locator('.training-inline-preview').waitFor();await h.capture(page,`edit-${width}`);await reference.getByRole('button',{name:'Editar',exact:true}).click();await reference.getByRole('button',{name:/^prévia$/i}).first().click();await h.capture(reference,`reference-edit-${width}`);
  await page.getByRole('textbox',{name:'Frente do card',exact:true}).first().fill('Pergunta revisada');await page.getByRole('button',{name:'Salvar 1 mudança',exact:true}).click();await page.getByRole('status').waitFor();
  await page.getByRole('button',{name:'Avançado',exact:true}).first().click();await page.getByRole('dialog',{name:'Editar card'}).waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.getByRole('combobox',{name:'Baralho',exact:true}).selectOption('sdr');await page.getByRole('button',{name:'Adicionar card',exact:true}).click();
  await page.getByRole('textbox',{name:'Frente do card',exact:true}).first().fill('Novo card');await page.getByRole('textbox',{name:'Verso do card',exact:true}).first().fill('Nova resposta');await page.getByRole('button',{name:'Salvar 1 mudança',exact:true}).click();await page.getByRole('status').waitFor();
  await page.getByRole('button',{name:'Estudar',exact:true}).first().click();await page.getByRole('button',{name:'Editar',exact:true}).click();await page.getByRole('combobox',{name:'Baralho',exact:true}).selectOption('sdr');assert.equal(await page.getByRole('textbox',{name:'Frente do card',exact:true}).first().inputValue(),'Novo card');
  await page.close();await reference.close();
 }
 const mobile=await h.open(390);await mobile.locator('.training-consistency').waitFor();assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await h.capture(mobile,'app-390');
 await mobile.getByRole('button',{name:'Estudar →',exact:true}).click();await mobile.getByRole('button',{name:/Mostrar resposta/}).click();await h.capture(mobile,'session-390');await mobile.keyboard.press('Escape');
 await mobile.getByRole('button',{name:'Equipe',exact:true}).click();await mobile.locator('.training-team-row').first().waitFor();assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await h.capture(mobile,'team-390');
 await mobile.getByRole('button',{name:'Editar',exact:true}).click();await mobile.locator('.training-inline-card').first().waitFor();assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await h.capture(mobile,'edit-390');await mobile.close();
 const failed=await h.open(1440,'&failOnce=trainingQueue');await failed.getByRole('alert').waitFor();await h.capture(failed,'error');await failed.getByRole('button',{name:'Tentar novamente',exact:true}).click();await failed.locator('.training-start').waitFor();await failed.close();
 const failedStats=await h.open(1440,'&failOnce=trainingStats');await failedStats.getByRole('alert').waitFor();assert.ok(await failedStats.getByRole('button',{name:'Estudar →',exact:true}).isEnabled());await failedStats.getByRole('button',{name:'Tentar novamente',exact:true}).click();await failedStats.locator('.training-consistency').waitFor();await failedStats.close();
 const empty=await h.open(1440,'&state=empty');await empty.getByText('Nenhum baralho pra você',{exact:true}).waitFor();await h.capture(empty,'empty');await empty.close();
 const saveFail=await h.open(1440,'&failOnce=saveFlashcards');await saveFail.getByRole('button',{name:'Editar',exact:true}).click();await saveFail.getByRole('textbox',{name:'Frente do card',exact:true}).first().fill('Rascunho preservado');await saveFail.getByRole('button',{name:'Salvar 1 mudança',exact:true}).click();await saveFail.getByRole('alert').waitFor();assert.equal(await saveFail.getByRole('textbox',{name:'Frente do card',exact:true}).first().inputValue(),'Rascunho preservado');await saveFail.getByRole('button',{name:'Salvar 1 mudança',exact:true}).click();await saveFail.getByRole('status').waitFor();await saveFail.close();
 const retryWrite=await h.open(1440,'&failOnce=trainingReview');await retryWrite.getByRole('button',{name:'Estudar →',exact:true}).click();await retryWrite.getByRole('button',{name:/Mostrar resposta/}).click();const question=await retryWrite.locator('.training-flashcard').innerText();await retryWrite.keyboard.press('3');await retryWrite.getByRole('alert').waitFor();assert.equal(await retryWrite.locator('.training-flashcard').innerText(),question);await retryWrite.keyboard.press('3');await retryWrite.getByRole('button',{name:/Mostrar resposta/}).waitFor();await retryWrite.close();
 const focus=await h.open(1440);await focus.getByRole('button',{name:'◐ Foco',exact:true}).click();await focus.locator('.training-focus').waitFor();await h.capture(focus,'focus');await focus.getByRole('button',{name:'sair (esc)',exact:true}).click();await focus.locator('.training-focus').waitFor({state:'hidden'});await focus.getByRole('region',{name:'Sessão de estudo'}).waitFor();assert.ok(await focus.getByRole('region',{name:'Sessão de estudo'}).evaluate(e=>e===document.activeElement));await focus.close();
 const exam=await h.open(1440,'&exam');await exam.getByRole('button',{name:'Fazer prova →',exact:true}).click();const dialog=exam.getByRole('dialog',{name:'Prova de checkpoint'});await dialog.waitFor();for(let i=0;i<5;i++){await dialog.locator('button').filter({hasText:/Centralizar|Conferir|Acompanhar|Uma pendência|Manter o estoque/}).first().click();await dialog.getByRole('button',{name:i===4?'entregar prova':'próxima →',exact:true}).click();}await dialog.getByText('aprovado',{exact:true}).waitFor();await h.capture(exam,'exam-result');await exam.close();
 const dark=await h.open(1440,'&theme=dark');await dark.locator('.training-consistency').waitFor();await h.capture(dark,'dark');await dark.close();
 assert.deepEqual(h.errors,[]);console.log('Treinamentos: geometria, estudo inline, teclado, revisão, referências, equipe, edição/salvamento, 390px e recuperação de falhas aprovados.');
}finally{await h.write('geometry.json',evidence);await h.close();}
