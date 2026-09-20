import assert from 'node:assert/strict';
import {reviewHarness} from './harness.mjs';
const h=await reviewHarness('tickets','Tickets',async p=>{await p.getByRole('button',{name:/^Suporte/}).click();await p.getByRole('button',{name:/^Tickets/}).click();});
const geometry=[];
const detail=p=>p.getByRole('dialog',{name:/^Ticket #/});
const openFirst=async p=>{await p.locator('.support-card').first().click();await detail(p).getByLabel('Resposta ao cliente',{exact:true}).waitFor();};
async function measure(p,ref){return p.evaluate(ref=>{
 const title=[...document.querySelectorAll('h1')].find(e=>e.textContent==='Tickets'&&e.getClientRects().length),head=title.closest('header'),root=head.parentElement;
 const summary=ref?root.querySelector('section'):document.querySelector('.support-agent-summary'),filters=ref?root.querySelectorAll('section')[1]:document.querySelector('.support-bar');
 let board=ref?filters.nextElementSibling:document.querySelector('.kb-board');if(ref)while(board&&getComputedStyle(board).display!=='flex')board=board.nextElementSibling;
 const elements={title,head,summary,filters};if(board){elements.board=board;elements.column=board.querySelector('section');}
 return Object.fromEntries(Object.entries(elements).map(([k,e])=>{const r=e.getBoundingClientRect();return[k,{x:r.x,y:r.y,width:r.width,height:r.height}];}));
},ref);}
try{
 for(const width of process.env.REVIEW_FLOWS?[]:[1440,1920]){
  const app=await h.open(width),ref=await h.open(width,'',true);await app.locator('.support-card').first().waitFor();
  await h.capture(app,`app-${width}`);await h.capture(ref,`reference-${width}`);const pair={width,app:await measure(app,false),reference:await measure(ref,true)};geometry.push(pair);await h.write('geometry.json',geometry);
  for(const [k,box] of Object.entries(pair.reference))for(const [axis,v]of Object.entries(box))assert.ok(Math.abs(pair.app[k][axis]-v)<=1,`${width} ${k}.${axis}: ${pair.app[k][axis]} vs ${v}`);
  await app.getByRole('button',{name:'Lista',exact:true}).click();await ref.getByRole('button',{name:'Lista',exact:true}).filter({visible:true}).click();await h.capture(app,`list-${width}`);await h.capture(ref,`reference-list-${width}`);
  await app.locator('.support-row').first().click();await detail(app).getByLabel('Resposta ao cliente',{exact:true}).waitFor();await h.capture(app,`drawer-${width}`);
  await app.close();await ref.close();
 }
 const p=await h.open(1440);await p.getByRole('textbox',{name:'Buscar tickets'}).fill('planilha');assert.equal(await p.locator('.support-card').count(),1);await p.getByRole('textbox',{name:'Buscar tickets'}).fill('');
 await p.getByRole('button',{name:/^SLA em risco/}).click();assert.ok(await p.locator('.support-card').count()>0);await p.getByRole('button',{name:/^Abertos/}).click();
 await openFirst(p);await detail(p).getByRole('button',{name:'Dados',exact:true}).click();await detail(p).getByRole('complementary',{name:'Dados do atendimento'}).waitFor();
 await detail(p).getByRole('button',{name:'Atividade',exact:true}).click();await detail(p).getByRole('button',{name:/^Conversa/}).click();
 await detail(p).getByLabel('Resposta ao cliente',{exact:true}).fill('Resposta fictícia da revisão');await detail(p).getByRole('button',{name:'Enviar resposta',exact:true}).click();await detail(p).locator('.support-msg').filter({hasText:'Resposta fictícia da revisão'}).waitFor();
 await detail(p).getByLabel('Resposta ao cliente',{exact:true}).fill('Rascunho');p.once('dialog',d=>d.dismiss());await detail(p).getByRole('button',{name:'Fechar',exact:true}).click();assert.equal(await detail(p).count(),1);p.once('dialog',d=>d.accept());await detail(p).getByRole('button',{name:'Fechar',exact:true}).click();await detail(p).waitFor({state:'hidden'});
 await p.getByRole('button',{name:'Abrir ticket',exact:true}).click();const newTicket=p.getByRole('dialog',{name:'Novo ticket'});await newTicket.getByLabel('Assunto',{exact:true}).fill('Ticket fictício da revisão');await newTicket.getByRole('button',{name:'Abrir ticket',exact:true}).click();await detail(p).getByLabel('Resposta ao cliente',{exact:true}).waitFor();await detail(p).getByRole('button',{name:'Dados',exact:true}).click();p.once('dialog',d=>d.dismiss());await detail(p).getByRole('button',{name:'Apagar ticket'}).click();assert.equal(await detail(p).count(),1);p.once('dialog',d=>d.accept());await detail(p).getByRole('button',{name:'Apagar ticket'}).click();await detail(p).waitFor({state:'hidden'});await p.close();
 const failure=await h.open(1440,'&failOnce=tickets');await failure.getByText(/Não deu pra carregar a fila/).waitFor();await failure.getByRole('button',{name:'recarregar',exact:true}).click();await failure.locator('.support-card').first().waitFor();await failure.close();
 const failedDetail=await h.open(1440,'&failOnce=ticket');await failedDetail.locator('.support-card').first().click();await detail(failedDetail).getByRole('alert').waitFor();await detail(failedDetail).getByRole('button',{name:'Tentar novamente'}).click();await detail(failedDetail).getByLabel('Resposta ao cliente',{exact:true}).waitFor();await failedDetail.close();
 const failedCreate=await h.open(1440,'&failOnce=ticketCreate');await failedCreate.getByRole('button',{name:'Abrir ticket',exact:true}).click();const create=failedCreate.getByRole('dialog',{name:'Novo ticket'});await create.getByLabel('Assunto',{exact:true}).fill('Preservar cadastro');await create.getByRole('button',{name:'Abrir ticket',exact:true}).click();await create.getByRole('alert').waitFor();assert.equal(await create.getByLabel('Assunto',{exact:true}).inputValue(),'Preservar cadastro');await create.getByRole('button',{name:'Abrir ticket',exact:true}).click();await detail(failedCreate).waitFor();await failedCreate.close();
 const failedReply=await h.open(1440,'&failOnce=ticketMessage');await openFirst(failedReply);await detail(failedReply).getByLabel('Resposta ao cliente',{exact:true}).fill('Manter resposta após falha');await detail(failedReply).getByRole('button',{name:'Enviar resposta',exact:true}).click();await failedReply.getByText(/Não deu pra enviar/).waitFor();assert.equal(await detail(failedReply).getByLabel('Resposta ao cliente',{exact:true}).inputValue(),'Manter resposta após falha');await detail(failedReply).getByRole('button',{name:'Enviar resposta',exact:true}).click();await detail(failedReply).locator('.support-msg').filter({hasText:'Manter resposta após falha'}).waitFor();await failedReply.close();
 for(const method of ['ticketCreate','ticketMessage','ticketDelete']){
  const slow=await h.open(1440,`&slow=${method}`);await slow.clock.pauseAt(new Date('2026-09-18T18:05:00Z'));
  if(method==='ticketCreate'){
   await slow.getByRole('button',{name:'Abrir ticket',exact:true}).click();const dialog=slow.getByRole('dialog',{name:'Novo ticket'});await dialog.getByLabel('Assunto',{exact:true}).fill('Criação demorada');await dialog.getByRole('button',{name:'Abrir ticket',exact:true}).click();assert.ok(await dialog.getByRole('button',{name:'Abrindo…'}).isDisabled());assert.ok(await dialog.getByRole('button',{name:'Cancelar'}).isDisabled());await slow.keyboard.press('Escape');assert.equal(await dialog.count(),1);await slow.clock.fastForward(2100);await detail(slow).waitFor();
  }else{
   await openFirst(slow);
   if(method==='ticketMessage'){await detail(slow).getByLabel('Resposta ao cliente',{exact:true}).fill('Resposta demorada');await detail(slow).getByRole('button',{name:'Enviar resposta',exact:true}).click();assert.ok(await detail(slow).getByRole('button',{name:'Enviando…'}).isDisabled());}
   else{await detail(slow).getByRole('button',{name:'Dados',exact:true}).click();slow.once('dialog',d=>d.accept());await detail(slow).getByRole('button',{name:'Apagar ticket'}).click();assert.ok(await detail(slow).getByRole('button',{name:'Apagar ticket'}).isDisabled());}
   assert.ok(await detail(slow).getByRole('button',{name:'Fechar',exact:true}).isDisabled());await slow.keyboard.press('Escape');assert.equal(await detail(slow).count(),1);await slow.clock.fastForward(2100);
   if(method==='ticketMessage')await detail(slow).locator('.support-msg').filter({hasText:'Resposta demorada'}).waitFor();else await detail(slow).waitFor({state:'hidden'});
  }await slow.close();
 }
 const keyboard=await h.open(1440);await keyboard.locator('.support-card').first().focus();await keyboard.keyboard.press('Space');await detail(keyboard).waitFor();await detail(keyboard).getByRole('button',{name:'Fechar',exact:true}).click();await keyboard.getByRole('button',{name:'Lista',exact:true}).click();await keyboard.locator('.support-row').first().focus();await keyboard.keyboard.press('Enter');await detail(keyboard).waitFor();await keyboard.close();
 for(const [width,q]of [[390,''],[1440,'&theme=dark'],[1440,'&empty']]){
  const page=await h.open(width,q);await h.capture(page,`state-${width}-${q||'mobile'}`);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));if(!q.includes('empty')){await openFirst(page);await h.capture(page,`detail-${width}-${q||'mobile'}`);const box=await detail(page).boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width);await detail(page).getByRole('button',{name:'Dados',exact:true}).click();await h.capture(page,`data-${width}-${q||'mobile'}`);}await page.close();
 }
 assert.deepEqual(h.errors,[]);console.log('Tickets: Kanban/Lista, filtros, gaveta, abas, criação, resposta mock, descarte, exclusão, falhas/retry, mobile e tema escuro OK.');
}finally{await h.close();}
