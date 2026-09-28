import assert from 'node:assert/strict';
import {reviewHarness} from './harness.mjs';
const h=await reviewHarness('proposals','Propostas',async p=>{await p.getByRole('button',{name:/^Comercial/}).click();await p.getByRole('button',{name:'Propostas',exact:true}).click();});
const measurements=[];
// ── O que ainda se compara com a prancha ─────────────────────────────────────
// Em 28/09/2026 a tela ganhou, entre o funil e as tabelas, o cartão da
// apresentação OFICIAL (pedido do Leo: a página fala da apresentação que
// usamos hoje, e os decks aposentados saem da frente, recolhidos). É uma
// divergência DELIBERADA do protótipo de 33 telas: daqui pra baixo a página
// inteira desce, e comparar o y/altura dos blocos com a prancha só produziria
// ruído. Seguem valendo a moldura de cima (título, cabeçalho, funil), a
// largura e a posição horizontal das duas tabelas e a geometria INTERNA delas
// — as colunas, medidas dentro do próprio bloco, continuam as da prancha.
async function measure(page,reference) {return page.evaluate(reference=>{
 const h1=[...document.querySelectorAll('h1')].find(e=>e.textContent==='Propostas'&&e.getClientRects().length),root=reference?h1.parentElement.parentElement.parentElement:document.querySelector('.proposals-page');
 const header=root.children[0],funnel=root.children[1];
 const templates=reference?root.children[2]:root.querySelector('.proposals-templates'),generated=reference?root.children[3]:root.querySelector('.proposals-generated');
 const templateHead=reference?templates.children[1].children[0].children[0]:templates.querySelector('.proposals-table-head'),templateRow=reference?templateHead.nextElementSibling:templates.querySelector('.proposals-template-row');
 const generatedHead=reference?generated.children[1].children[0].children[0]:generated.querySelector('.proposals-table-head'),generatedRow=reference?generatedHead.nextElementSibling:generated.querySelector('.proposals-generated-row');
 const box=(e,base)=>{const r=e.getBoundingClientRect(),b=base&&base.getBoundingClientRect();return {x:b?r.x-b.x:r.x,y:b?r.y-b.y:r.y,width:r.width,height:r.height};};
 const faixa=e=>{const r=e.getBoundingClientRect();return {x:r.x,width:r.width};};
 const cells=(row,prefix)=>Object.fromEntries([...row.children].map((e,i)=>[`${prefix}${i}`,box(e,row)]));
 return {
  title:box(h1),header:box(header),funnel:box(funnel),
  templatesFaixa:faixa(templates),generatedFaixa:faixa(generated),
  templateHead:box(templateHead,templates),templateRow:box(templateRow,templates),
  generatedHead:box(generatedHead,generated),generatedRow:box(generatedRow,generated),
  ...cells(templateRow,'templateCell'),...cells(generatedRow,'generatedCell'),
 };
},reference);}
try{
 for(const width of process.env.REVIEW_FLOWS?[]:[1440,1920]) {
  const app=await h.open(width),ref=await h.open(width,'',true);await ref.evaluate(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});await app.locator('.proposals-template-row').first().waitFor();
  await h.capture(app,`app-${width}`);await h.capture(ref,`reference-${width}`);
  const pair={width,app:await measure(app,false),reference:await measure(ref,true)};measurements.push(pair);
  for(const [name,box] of Object.entries(pair.reference))for(const [k,v] of Object.entries(box))assert.ok(Math.abs(v-pair.app[name][k])<=1,`${width} ${name}.${k}: ${pair.app[name][k]} vs ${v}`);
  await app.close();await ref.close();
 }
 const p=await h.open(1440);await p.locator('.proposals-generated-row').first().waitFor();
 // O cartão da apresentação de hoje: o deck publicado saiu da tabela e virou
 // o topo da tela, com as telas que o cliente vê e as duas ações que existem.
 const atual=p.locator('.proposals-current');await atual.waitFor();
 assert.ok((await atual.getByRole('link',{name:'Abrir prévia ↗',exact:true}).getAttribute('href')).includes('/p/t/'));
 assert.ok(await atual.locator('.proposals-screens li').count()>0);
 const arquivo=p.locator('.proposals-archive');await arquivo.waitFor();
 assert.equal(await arquivo.locator('.proposals-template-row').first().isVisible(),false,'arquivado nasce recolhido');
 await arquivo.locator('summary').click();await arquivo.locator('.proposals-template-row').first().waitFor();
 await h.capture(p,'apresentacao-atual');await arquivo.locator('summary').click();
 const filters=p.locator('.proposals-filters');
 await p.getByRole('button',{name:'Ver quais',exact:true}).click();assert.equal(await p.locator('.proposals-generated-row').count(),9);
 await filters.getByRole('button',{name:/^Fecharam/}).click();assert.equal(await p.locator('.proposals-generated-row').count(),4);
 await filters.getByRole('button',{name:/^Abertas/}).click();assert.equal(await p.locator('.proposals-generated-row').count(),5);
 await filters.getByRole('button',{name:/^Todas/}).click();assert.equal(await p.locator('.proposals-generated-row').count(),18);
 const row=p.locator('.proposals-generated-row').first();assert.ok((await row.getByRole('link',{name:'abrir ↗',exact:true}).getAttribute('href')).includes('from=cockpit'));
 await row.getByRole('button',{name:'Copiar',exact:true}).click();await row.getByRole('button',{name:'Copiado ✓',exact:true}).waitFor();assert.ok((await p.evaluate(()=>navigator.clipboard.readText())).endsWith('/p/p0'));
 const wa=p.getByRole('link',{name:'Cobrar',exact:true}).first();assert.ok((await wa.getAttribute('href')).startsWith('https://wa.me/'));assert.equal((await wa.getAttribute('href')).includes('from%3Dcockpit'),false);
 const name=p.getByRole('button',{name:/^Editar template:/}).first();const label=await name.getAttribute('aria-label');await name.click();await p.getByRole('textbox',{name:'Nome do template',exact:true}).waitFor();await p.getByRole('button',{name:'Cancelar',exact:true}).click();assert.equal(await p.getByRole('button',{name:label,exact:true}).evaluate(e=>e===document.activeElement),true);
 const duplicate=p.locator('.proposals-template-row').first().getByRole('button',{name:'Duplicar',exact:true});await duplicate.click();const editName=p.getByRole('textbox',{name:'Nome do template',exact:true});assert.ok((await editName.inputValue()).includes('cópia'));
 await editName.fill('Cópia revisada');await p.getByRole('button',{name:'Salvar',exact:true}).click();await p.locator('.proposals-template-row').filter({hasText:'Cópia revisada'}).waitFor();assert.ok(await p.evaluate(()=>window.__reviewMutations.some(m=>m.method==='create'&&m.data.name==='Cópia revisada')));
 const remove=p.locator('.proposals-template-row').filter({hasText:'Cópia revisada'}).getByRole('button',{name:'Excluir',exact:true});p.once('dialog',d=>d.dismiss());await remove.click();assert.equal(await remove.isVisible(),true);p.once('dialog',d=>d.accept());await remove.click();await remove.waitFor({state:'hidden'});
 const create=p.getByRole('button',{name:'Criar template',exact:true});await create.click();await p.getByRole('button',{name:'Salvar',exact:true}).click();await p.getByRole('alert').filter({hasText:'Dê um nome'}).waitFor();await editName.fill('Template de revisão');await p.getByRole('button',{name:'+ adicionar slide',exact:true}).click();await h.capture(p,'editor-desktop');p.once('dialog',d=>d.dismiss());await p.getByRole('button',{name:'Cancelar',exact:true}).click();assert.equal(await editName.inputValue(),'Template de revisão');
 await p.getByRole('button',{name:'Salvar',exact:true}).click();await p.waitForFunction(()=>window.__reviewMutations.some(m=>m.method==='create'&&m.data.name==='Template de revisão'&&m.data.slides.length===3));await p.locator('.proposals-template-row').first().waitFor();await p.close();
 const fail=await h.open(1440,'&failOnce=list');await fail.getByRole('alert').waitFor();assert.equal(await fail.locator('.proposals-funnel').count(),0);await fail.getByRole('button',{name:'Tentar novamente',exact:true}).click();await fail.locator('.proposals-generated-row').first().waitFor();await h.capture(fail,'read-retry');await fail.close();
 const slow=await h.open(1440,'&failOnce=list&holdTemplates');await slow.getByRole('alert').waitFor();await slow.getByRole('button',{name:'Tentar novamente',exact:true}).click();await slow.getByText('Carregando propostas…',{exact:true}).waitFor();await slow.getByRole('button',{name:'Criar template',exact:true}).click();await slow.getByRole('textbox',{name:'Nome do template',exact:true}).waitFor();await slow.close();
 const saveFail=await h.open(1440,'&failOnce=create');await saveFail.getByRole('button',{name:'Criar template',exact:true}).click();await saveFail.getByRole('textbox',{name:'Nome do template',exact:true}).fill('Rascunho preservado');await saveFail.getByRole('button',{name:'Salvar',exact:true}).click();await saveFail.getByRole('alert').filter({hasText:'Falha simulada'}).waitFor();assert.equal(await saveFail.getByRole('textbox',{name:'Nome do template',exact:true}).inputValue(),'Rascunho preservado');await saveFail.getByRole('button',{name:'Salvar',exact:true}).click();await saveFail.locator('.proposals-template-row').filter({hasText:'Rascunho preservado'}).waitFor();await saveFail.close();
 const removeFail=await h.open(1440,'&failOnce=remove');removeFail.once('dialog',d=>d.accept());await removeFail.getByRole('button',{name:'Excluir',exact:true}).first().click();await removeFail.getByRole('alert').waitFor();assert.equal(await removeFail.locator('.proposals-template-row').count(),4);assert.equal(await removeFail.getByRole('button',{name:'Excluir',exact:true}).first().isEnabled(),true);await removeFail.close();
 const previewFail=await h.open(1440,'&failOnce=proposalPreview');await previewFail.getByRole('button',{name:'Criar template',exact:true}).click();await previewFail.getByRole('alert').waitFor();await previewFail.getByRole('button',{name:'Tentar novamente',exact:true}).click();await previewFail.frameLocator('iframe').getByRole('heading',{name:'Prévia de revisão'}).waitFor();await previewFail.keyboard.press('Escape');await previewFail.keyboard.press('Escape');await previewFail.getByRole('heading',{name:'Propostas',exact:true}).waitFor();await previewFail.close();
 const empty=await h.open(1440,'&state=empty');await empty.getByText('Nenhum template neste SaaS',{exact:true}).waitFor();await empty.getByText('Nenhuma proposta gerada ainda.',{exact:true}).waitFor();await h.capture(empty,'empty');await empty.close();
 const mobile=await h.open(390);await mobile.locator('.proposals-template-row').first().waitFor();assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await mobile.locator('.proposals-templates .tbl-x').evaluate(e=>e.scrollWidth>e.clientWidth));await h.capture(mobile,'mobile');await mobile.getByRole('button',{name:'Criar template',exact:true}).click();await mobile.getByRole('textbox',{name:'Nome do template',exact:true}).fill('Prévia mobile');assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await h.capture(mobile,'mobile-editor');for(const name of ['Salvar','Cancelar']){const r=await mobile.getByRole('button',{name,exact:true}).boundingBox();assert.ok(r.x>=0&&r.x+r.width<=390,`${name} fora da viewport`);}await mobile.getByRole('button',{name:'Salvar',exact:true}).click();await mobile.locator('.proposals-template-row').filter({hasText:'Prévia mobile'}).waitFor();await mobile.close();
 const dark=await h.open(1440,'&theme=dark');await dark.locator('.proposals-template-row').first().waitFor();await h.capture(dark,'dark');await dark.close();

 await h.write('geometry.json',measurements);assert.deepEqual(h.errors,[]);console.log('Propostas: geometria, ações, editor, falhas, mobile e temas conferidos.');
}finally{await h.close();}
