import assert from 'node:assert/strict';
import { reviewHarness } from './harness.mjs';
const h=await reviewHarness('whatsapp','Inbox',async p=>{await p.getByRole('button',{name:/^Comercial/}).click();await p.getByRole('button',{name:/^Inbox/}).click();});
const open=(w,q='')=>h.open(w,`&inbox${q}`);
const geometry=[];
async function measure(p,reference){return p.evaluate(reference=>{
 const title=[...document.querySelectorAll('h1')].find(e=>e.textContent==='Inbox'&&e.getClientRects().length),header=title.closest('header');
 const root=header.parentElement,summary=reference?root.querySelector('section'):document.querySelector('.inbox-stats'),board=reference?root.querySelector('.inbox-3'):document.querySelector('.inbox-board');
 const elements={title,header,summary,board,list:board.children[0],chat:board.children[1],side:board.children[2]};
 return Object.fromEntries(Object.entries(elements).map(([k,e])=>{const r=e.getBoundingClientRect();return[k,{x:r.x,y:r.y,width:r.width,height:r.height}];}));
},reference);}
try{
 for(const width of process.env.REVIEW_FLOWS?[]:[1440,1920]){
  const p=await open(width),ref=await h.open(width,'',true);
  await p.locator('.inbox-compose textarea').waitFor();await h.capture(p,`app-${width}`);await h.capture(ref,`reference-${width}`);
  const pair={width,app:await measure(p,false),reference:await measure(ref,true)};geometry.push(pair);await h.write('geometry.json',geometry);
  for(const [key,box]of Object.entries(pair.reference))for(const [axis,v]of Object.entries(box))assert.ok(Math.abs(pair.app[key][axis]-v)<=1,`${width} ${key}.${axis}: ${pair.app[key][axis]} vs ${v}`);
  await p.close();await ref.close();
 }
 const p=await open(1440);await p.locator('.inbox-compose textarea').waitFor();
 await p.getByRole('button',{name:'Detalhes do número',exact:true}).click();await p.getByRole('dialog',{name:'Detalhes do número'}).waitFor();await p.getByRole('button',{name:'Fechar',exact:true}).click();
 await p.locator('.inbox-search-row input').fill('Carla');assert.equal(await p.locator('.inbox-conversation').count(),1);
 await p.locator('.inbox-search-row input').fill('nenhuma-correspondencia');await p.getByText('Nenhuma conversa',{exact:true}).waitFor();
 await p.locator('.inbox-search-row input').fill('');await p.locator('.inbox-compose textarea').fill('Mensagem fictícia de revisão');await p.locator('.inbox-send').click();await p.locator('.inbox-bubble').filter({hasText:'Mensagem fictícia de revisão'}).waitFor();assert.equal(await p.locator('.inbox-compose textarea').inputValue(),'');
 await p.getByRole('button',{name:'Responder agora →',exact:true}).click();await p.locator('.inbox-chat-head').filter({hasText:'Pedro Rocha'}).waitFor();assert.equal(await p.locator('.inbox-compose textarea').count(),0);await p.locator('.inbox-compose').getByText(/janela/i).first().waitFor();
 await p.getByRole('button',{name:'Mais ações da conversa'}).click();await p.getByRole('button',{name:'Encerrar a conversa',exact:true}).click();
 await p.getByRole('button',{name:'mais ▾',exact:true}).click();await p.getByRole('button',{name:/Encerradas/}).click();await p.locator('.inbox-conversation').filter({hasText:'Pedro Rocha'}).waitFor();
 await p.getByRole('button',{name:'Instagram',exact:true}).click();await p.getByText(/Este canal não está conectado/).waitFor();
 await p.getByRole('button',{name:'Messenger',exact:true}).click();await p.getByText(/Este canal não está conectado/).waitFor();
 await p.getByRole('button',{name:'Automações',exact:true}).click();await h.capture(p,'automacoes');await p.close();
 for(const [method,selector]of [['waThreads','.inbox-list'],['waThread','.inbox-chat-history']]){
  const e=await open(1440,`&failOnce=${method}`);const err=e.locator(selector).getByRole('alert');await err.waitFor();await err.getByRole('button',{name:'Tentar novamente'}).click();await e.locator('.inbox-compose textarea').waitFor();await err.waitFor({state:'hidden'});await e.close();
 }
 const failed=await open(1440,'&failOnce=waThreadSend');await failed.locator('.inbox-compose textarea').fill('Preservar rascunho');await failed.locator('.inbox-send').click();await failed.getByText('Falha simulada na prévia',{exact:true}).waitFor();assert.equal(await failed.locator('.inbox-compose textarea').inputValue(),'Preservar rascunho');await failed.locator('.inbox-send').click();await failed.locator('.inbox-bubble').filter({hasText:'Preservar rascunho'}).waitFor();await failed.close();
 const stats=await open(1440,'&failOnce=waInsights');await stats.getByText('Indicadores indisponíveis',{exact:true}).waitFor();await stats.getByRole('button',{name:'Atualizar indicadores'}).click();await stats.getByRole('button',{name:'Responder agora →',exact:true}).waitFor();await stats.close();
 const history=await open(1440);await history.locator('.inbox-compose textarea').fill('Já enviada');await history.evaluate(()=>window.__failInboxRead=true);await history.locator('.inbox-send').click();await history.locator('.inbox-chat-history').getByRole('alert').waitFor();await history.waitForFunction(()=>document.querySelector('.inbox-compose textarea')?.value==='');assert.equal(await history.evaluate(()=>window.__inboxSent.length),1);await history.evaluate(()=>window.__failInboxRead=false);await history.locator('.inbox-chat-history').getByRole('button',{name:'Tentar novamente'}).click();await history.locator('.inbox-bubble').filter({hasText:'Já enviada'}).waitFor();await history.close();
 const slow=await open(1440,'&holdSend');await slow.locator('.inbox-compose textarea').fill('Envio lento');await slow.locator('.inbox-send').click();assert.equal(await slow.locator('.inbox-send').isDisabled(),true);await slow.evaluate(()=>window.__releaseInboxSend());await slow.locator('.inbox-bubble').filter({hasText:'Envio lento'}).waitFor();assert.equal(await slow.evaluate(()=>window.__inboxSent.length),1);await slow.close();
 const audio=await open(1440);await audio.locator('.inbox-conversation').filter({hasText:'Carla Nunes'}).click();
 const voice=audio.locator('.inbox-bubble').filter({has:audio.locator('audio')});await voice.waitFor();
 const speed=voice.getByRole('button',{name:/^velocidade/});assert.equal(await speed.textContent(),'1×');
 await speed.click();assert.equal(await speed.textContent(),'1,5×');assert.equal(await voice.locator('audio').evaluate(a=>a.playbackRate),1.5);
 await speed.click();assert.equal(await speed.textContent(),'2×');
 await voice.getByRole('button',{name:'tocar áudio'}).click();await voice.getByRole('button',{name:'pausar áudio'}).waitFor();assert.equal(await voice.locator('audio').evaluate(a=>a.playbackRate),2);
 await voice.getByRole('button',{name:'pausar áudio'}).click();
 await voice.getByRole('button',{name:'Transcrever',exact:true}).click();await voice.getByText(/estou dirigindo/).waitFor();await h.capture(audio,'audio');await audio.close();
 const robo=await open(1440);await robo.getByRole('button',{name:'Robô',exact:true}).click();await robo.getByText('IA do robô',{exact:true}).waitFor();
 await robo.getByText('openai/gpt-5.6-luna',{exact:true}).first().waitFor();await robo.getByText('Respostas da IA',{exact:true}).waitFor();await robo.getByText(/Nunca fala preço/).waitFor();
 await robo.getByRole('button',{name:'Claude (Anthropic)',exact:true}).click();await robo.getByText(/ANTHROPIC_API_KEY não está no servidor/).waitFor();
 await robo.getByRole('button',{name:'OpenRouter',exact:true}).click();await robo.getByRole('button',{name:/padrão do provedor/}).click();await robo.getByRole('option',{name:/Gemini 2\.5 Flash/}).click();
 await robo.getByRole('button',{name:'Salvar IA',exact:true}).click();await robo.getByText(/Vale a partir da próxima mensagem/).waitFor();await robo.getByText('google/gemini-2.5-flash',{exact:true}).first().waitFor();
 await robo.getByRole('switch',{name:/Ignorar a pausa fora do horário comercial/}).click();await robo.getByText('Horário comercial, seg a sex, das',{exact:true}).waitFor();
 await robo.getByRole('button',{name:'Salvar ajustes',exact:true}).click();await robo.getByText('Ajustes salvos.',{exact:true}).waitFor();
 await h.capture(robo,'robo');await robo.close();
 const roboMobile=await open(390);await roboMobile.getByRole('button',{name:'Robô',exact:true}).click();await roboMobile.getByText('IA do robô',{exact:true}).waitFor();await h.capture(roboMobile,'robo-390');assert.ok(await roboMobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await roboMobile.close();
 const naoAdmin=await open(1440,'&naoadmin');await naoAdmin.getByRole('button',{name:'Automações',exact:true}).waitFor();assert.equal(await naoAdmin.getByRole('button',{name:'Robô',exact:true}).count(),0);await naoAdmin.close();
 for(const [width,q]of [[390,''],[1024,''],[1440,'&theme=dark'],[1440,'&empty']]){
  const page=await open(width,q);await h.capture(page,`state-${width}-${q||'default'}`);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  if(width===390){assert.equal(await page.locator('.inbox-chat').count(),0);await page.locator('.inbox-conversation').first().click();await page.locator('.inbox-compose textarea').waitFor();await h.capture(page,'mobile-chat');await page.getByRole('button',{name:'Voltar pra lista de conversas'}).click();await page.locator('.inbox-list').waitFor();}
  await page.close();
 }
 assert.deepEqual(h.errors,[]);console.log('Inbox: navegação, filtros, envio mock, áudio (velocidade e transcrição), aba Robô (só admin), falha/retry, janela fechada, encerramento, canais, mobile e tema escuro OK.');
}finally{await h.close();}
