import assert from 'node:assert/strict';
import { reviewHarness } from './harness.mjs';
const h=await reviewHarness('customers','Clientes',async p=>{await p.getByRole('button',{name:/^Comercial/}).click();await p.getByRole('button',{name:'Clientes',exact:true}).click();});
const measurements=[];
let assertions=0;
function compare(width,view,pair,dynamic=[]) {
 measurements.push({width,view,app:pair[0],reference:pair[1]});
 for(const [name,box] of Object.entries(pair[1]))for(const [key,value] of Object.entries(box)){
  if(key==='height'&&dynamic.includes(name))continue;
  assertions++;assert.ok(Math.abs(pair[0][name][key]-value)<=1,`${width} ${view} ${name}.${key}: ${pair[0][name][key]} vs ${value}`);
 }
}
try {
 for(const width of process.env.REVIEW_FLOWS ? [] : [1440,1920]) {
  const app=await h.open(width), ref=await h.open(width,'',true);await app.locator('.customers-table-row').first().waitFor();
  await h.capture(app,`app-${width}`);await h.capture(ref,`reference-${width}`);
  const measures=await Promise.all([app,ref].map((p,i)=>p.evaluate(reference=>{
    const h1=[...document.querySelectorAll('h1')].find(e=>e.textContent==='Clientes'&&e.getClientRects().length), root=reference?h1.parentElement.parentElement.parentElement:document.querySelector('.customers-page');
    const base=reference?root.children[1]:root.querySelector('.customers-base');
    const banner=reference?base.children[0]:base.querySelector('.customers-overdue'), kpis=reference?base.children[1]:base.querySelector('.customers-kpis'), columns=reference?base.children[2]:base.querySelector('.customers-columns');
    const table=reference?columns.children[0]:columns.querySelector('.customers-table-card'), filters=table.children[0], head=reference?table.children[1].children[0].children[0]:table.querySelector('.customers-table-head'), row=reference?table.children[1].children[0].children[1].children[0]:table.querySelector('.customers-table-row');
    const entries={title:h1,header:root.children[0],banner,kpis,columns,table,filters,head,row,rail:columns.children[1]};
    return Object.fromEntries(Object.entries(entries).map(([k,e])=>{const r=e.getBoundingClientRect();return[k,{x:r.x,y:r.y,width:r.width,height:r.height}];}));
  },!!i)));
  compare(width,'base',measures,['columns','table','rail']);
  await app.locator('.customers-table-row').first().click();
  await ref.getByText('Studio Kern',{exact:true}).filter({visible:true}).first().click();
  await h.capture(app,`drawer-${width}`);await h.capture(ref,`drawer-reference-${width}`);
  const drawers=await Promise.all([app,ref].map((p,i)=>p.evaluate(reference=>{
   const panel=reference?[...document.querySelectorAll('aside')].filter(e=>e.getClientRects().length).at(-1):document.querySelector('.customer-peek');
   const head=panel.children[0],body=panel.children[1],footer=panel.children[2];
   return Object.fromEntries(Object.entries({panel,head,body,footer,contract:body.children[0],milestones:body.children[1],money:body.children[2]}).map(([k,e])=>{const r=e.getBoundingClientRect();return[k,{x:r.x,y:r.y,width:r.width,height:r.height}];}));
  },!!i)));compare(width,'drawer',drawers);
  await app.getByRole('button',{name:'Fechar ficha',exact:true}).click();await ref.locator('aside').filter({visible:true}).last().getByRole('button',{name:'✕',exact:true}).click();
  await app.getByRole('button',{name:'Cobranças',exact:true}).click();await ref.getByRole('button',{name:'Cobranças',exact:true}).click();await app.locator('.customers-billing-row').first().waitFor();
  for(const view of ['invoices','subs']) {
   if(view==='subs'){await app.locator('.customers-billing-filters').getByRole('button',{name:/Assinaturas/}).click();await ref.getByRole('button',{name:/^Assinaturas/}).filter({visible:true}).click();}
   await h.capture(app,`${view}-${width}`);await h.capture(ref,`${view}-reference-${width}`);
   const billing=await Promise.all([app,ref].map((p,i)=>p.evaluate(reference=>{
    const h1=[...document.querySelectorAll('h1')].find(e=>e.textContent==='Clientes'&&e.getClientRects().length);
    const root=reference?h1.parentElement.parentElement.parentElement:document.querySelector('.customers-page');
    const head=reference?[...root.querySelectorAll('div')].find(e=>e.getClientRects().length&&e.style.textTransform==='uppercase'&&e.firstElementChild?.textContent.trim()==='Cliente'):root.querySelector('.customers-billing-head');
    const table=reference?head.closest('section'):root.querySelector('.customers-billing-table'),kpis=table.previousElementSibling,filters=table.children[0];
    const row=reference?head.nextElementSibling:table.querySelector('.customers-billing-row');
    return Object.fromEntries(Object.entries({kpis,table,filters,head,row}).map(([k,e])=>{const r=e.getBoundingClientRect();return[k,{x:r.x,y:r.y,width:r.width,height:r.height}];}));
   },!!i)));compare(width,view,billing,['table']);
  }
  await app.close();await ref.close();
 }
 const p=await h.open(1440);await p.locator('.customers-table-row').first().waitFor();
 const search=p.getByRole('textbox',{name:'Buscar cliente'}), filters=p.locator('.customers-filters');
 await search.fill('Braga');assert.equal(await p.locator('.customers-table-row').count(),1);
 const row=p.locator('.customers-table-row').first();await row.focus();await p.keyboard.press('Enter');
 const drawer=p.getByRole('dialog',{name:/^Cliente ·/});await drawer.waitFor();
 assert.equal(await drawer.locator('.customer-peek-body > section').count(),3);
 for(const text of ['Dados do cliente','Respostas do formulário','Último NPS','Resultados','Histórico'])assert.equal(await drawer.getByText(text,{exact:true}).count(),0);
 const check=drawer.locator('.customer-peek-checks button').filter({hasText:'Check-in de mês 1'});await check.click();assert.equal(await check.getAttribute('aria-pressed'),'true');
 assert.ok(await p.evaluate(()=>window.__reviewMutations.some(m=>m.patch?.milestonesDone?.checkin_m1)));
 await drawer.getByRole('button',{name:'Virar case',exact:true}).click();await drawer.getByRole('status').waitFor();
 assert.ok(await p.evaluate(()=>window.__reviewMutations.some(m=>m.method==='caseFromCustomer')));
 await drawer.getByRole('button',{name:'Cobrar próxima',exact:true}).click();const action=p.getByRole('dialog',{name:'Ação do cliente',exact:true});await action.waitFor();
 await action.getByRole('button',{name:'marcar paga',exact:true}).first().click();await p.waitForFunction(()=>window.__reviewMutations.some(m=>m.method==='payInvoice'));
 await p.keyboard.press('Escape');await action.waitFor({state:'hidden'});assert.equal(await drawer.isVisible(),true);
 await drawer.getByRole('button',{name:'⋯',exact:true}).click();await p.getByRole('button',{name:'Editar cliente',exact:true}).click();await action.waitFor();
 const name=action.getByRole('textbox',{name:/^Conta/});await name.fill('Braga Revisão');await action.getByRole('button',{name:'Salvar',exact:true}).click();await action.waitFor({state:'hidden'});
 await p.waitForFunction(()=>window.__reviewMutations.some(m=>m.patch?.name==='Braga Revisão'));
 for(const label of ['Registrar upsell','Registrar churn']) {
  await drawer.getByRole('button',{name:'⋯',exact:true}).click();await p.getByRole('button',{name:label,exact:true}).click();await action.waitFor();assert.equal(await action.getByRole('heading',{name:new RegExp(label)}).isVisible(),true);await action.getByRole('button',{name:'Fechar ação',exact:true}).click();await action.waitFor({state:'hidden'});
 }
 await p.keyboard.press('Escape');await drawer.waitFor({state:'hidden'});assert.equal(await search.inputValue(),'Braga');assert.equal(await row.evaluate(e=>e===document.activeElement),true);
 await search.fill('');await filters.getByRole('button',{name:/^Churn/}).click();assert.equal(await p.locator('.customers-table-row').count(),1);
 await filters.getByRole('button',{name:/^Sem dono/}).click();assert.equal(await p.locator('.customers-table-row').count(),1);
 await filters.getByRole('button',{name:/^Todos/}).click();assert.equal(await p.locator('.customers-table-row').count(),8);
 await p.locator('.customers-table-head').getByRole('button',{name:/^Cliente/}).click();
 const select=p.getByRole('combobox',{name:/Status de pagamento de/}).first();await select.selectOption('unpaid');assert.ok(await p.evaluate(()=>window.__reviewMutations.some(m=>m.patch?.paymentStatus==='unpaid')));
 await p.getByRole('button',{name:/Dar baixa na mais antiga/}).click();await p.getByRole('button',{name:'Cobranças',exact:true}).click();await p.locator('.customers-billing-row').first().waitFor();
 await p.locator('.customers-billing-filters').getByRole('button',{name:/Assinaturas/}).click();const activeSub=p.locator('.customers-billing-row').filter({hasText:'Braga Revisão'});await activeSub.getByRole('button',{name:'⋯',exact:true}).click();await p.getByRole('button',{name:'Pausar',exact:true}).click();await p.waitForFunction(()=>window.__reviewMutations.some(m=>m.col==='subscriptions'&&m.patch?.status==='paused'));
 await p.getByRole('button',{name:'Indicações',exact:true}).click();await p.getByRole('button',{name:/^Pra pedir/}).waitFor();await h.capture(p,'referrals');
 await p.getByRole('button',{name:'Cases',exact:true}).click();await p.getByText('rascunho',{exact:true}).waitFor();await h.capture(p,'cases');
 await p.locator('.customers-tabs').getByRole('button',{name:'Clientes',exact:true}).click();assert.equal(await filters.getByRole('button',{name:/^Todos/}).getAttribute('aria-pressed'),'true');
 await p.getByRole('button',{name:'Cadastrar cliente',exact:true}).click();const create=p.getByRole('dialog');await create.getByRole('textbox',{name:/^Conta/}).fill('Cliente de revisão');await create.getByRole('button',{name:'Criar',exact:true}).click();await p.waitForFunction(()=>window.__reviewMutations.some(m=>m.method==='create'&&m.data.name==='Cliente de revisão'));await create.waitFor({state:'hidden'});await p.close();
 const empty=await h.open(1440,'&state=empty');await empty.getByText('Nenhum cliente ainda',{exact:true}).waitFor();await h.capture(empty,'empty');await empty.getByRole('button',{name:'Cobranças',exact:true}).click();await empty.getByText('Nenhuma fatura neste produto',{exact:true}).waitFor();await empty.close();
 const fail=await h.open(1440,'&failOnce=billingReceived');await fail.getByRole('alert').waitFor();assert.equal(await fail.locator('.customers-kpis').count(),0);await h.capture(fail,'read-error');await fail.getByRole('button',{name:'Tentar novamente',exact:true}).click();await fail.locator('.customers-table-row').first().waitFor();await fail.close();
 const billFail=await h.open(1440,'&billingFail');await billFail.locator('.customers-table-row').first().waitFor();await billFail.getByRole('button',{name:'Cobranças',exact:true}).click();await billFail.getByRole('alert').waitFor();assert.equal(await billFail.locator('.customers-billing-kpis').count(),0);await billFail.getByRole('button',{name:'Tentar novamente',exact:true}).click();await billFail.locator('.customers-billing-row').first().waitFor();await billFail.close();
 const slow=await h.open(1440,'&failOnce=billingReceived&holdReceived');await slow.getByRole('alert').waitFor();await slow.getByRole('button',{name:'Tentar novamente',exact:true}).click();await slow.getByText('Carregando clientes…',{exact:true}).waitFor();await slow.getByRole('button',{name:'Cobranças',exact:true}).click();await slow.locator('.customers-billing-row').first().waitFor();await slow.close();
 const writeFail=await h.open(1440,'&failOnce=payInvoice');await writeFail.locator('.customers-table-row').first().waitFor();const pay=writeFail.getByRole('button',{name:/Dar baixa na mais antiga/});await pay.click();await writeFail.getByText('Falha simulada na prévia',{exact:true}).waitFor();assert.equal(await pay.isEnabled(),true);await pay.click();await writeFail.waitForFunction(()=>window.__reviewMutations.some(m=>m.method==='payInvoice'));await writeFail.close();
 const caseFail=await h.open(1440,'&failOnce=caseFromCustomer');await caseFail.locator('.customers-table-row').first().click();await caseFail.getByRole('button',{name:'Virar case',exact:true}).click();await caseFail.locator('.customer-peek-feedback[role=alert]').waitFor();await caseFail.getByRole('button',{name:'Virar case',exact:true}).click();await caseFail.locator('.customer-peek-feedback[role=status]').waitFor();await caseFail.close();
 const many=await h.open(1440,'&many');await many.locator('.customers-pagination').waitFor();assert.equal(await many.locator('.customers-table-row').count(),50);await many.locator('.customers-pagination button').click();assert.ok(await many.locator('.customers-table-row').count()>50);await h.capture(many,'many');await many.close();
 const mobile=await h.open(390);await mobile.locator('.customers-table-row').first().waitFor();assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await h.capture(mobile,'mobile-base');
 assert.ok(await mobile.locator('.customers-table-scroll').evaluate(e=>e.scrollWidth>e.clientWidth));await mobile.locator('.customers-table-row').first().click();const box=await mobile.getByRole('dialog').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390&&box.y+box.height<=844);await h.capture(mobile,'mobile-drawer');assert.ok(await mobile.getByRole('button',{name:'Virar case',exact:true}).evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
 await mobile.getByRole('button',{name:'Fechar ficha',exact:true}).click();await mobile.getByRole('button',{name:'Cobranças',exact:true}).click();await mobile.locator('.customers-billing-row').first().waitFor();assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await h.capture(mobile,'mobile-billing');await mobile.close();
 const dark=await h.open(1440);await dark.evaluate(()=>document.body.setAttribute('data-theme','dark'));await dark.locator('.customers-table-row').first().click();await h.capture(dark,'dark');await dark.close();

 await h.write('geometry.json',measurements);assert.deepEqual(h.errors,[]);console.log(`Clientes: ${assertions} medidas ≤1px; fluxos, teclado, vazio, falhas, lento, mobile e tema conferidos.`);
} finally {await h.close();}
