import assert from 'node:assert/strict';
import {reviewHarness} from './harness.mjs';
// Disparos (22/10/2026): Broadcasts por canal (WhatsApp pela API oficial, e-mail
// pelo provedor de Integrações), Sequências, Fila do WhatsApp e Modelos. A tela
// deixou de seguir TelaDisparos.dc.html, então não há comparação de geometria.
const h=await reviewHarness('disparos','Disparos',async()=>{});
const tab=(p,name)=>p.locator('.disparos-tabs').getByRole('button',{name,exact:true});
const writes=p=>p.evaluate(()=>window.__disparosWrites);
const noOverflow=p=>p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);
// Menus são o seletor do Cockpit (SelectPopover), nunca o <select> nativo (Yudi, 22/10/2026).
const noNativeSelects=p=>p.evaluate(()=>document.querySelectorAll('select').length===0);
const esc=t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const pick=async(p,label,option)=>{await p.getByRole('button',{name:new RegExp('^'+esc(label)+':')}).click();await p.getByRole('listbox',{name:label}).getByRole('option',{name:new RegExp('^'+esc(option))}).click();};
try{
 // Lista: o broadcast antigo (WhatsApp assistido) aparece como só consulta.
 const p=await h.open(1440);await tab(p,'Broadcasts').waitFor();await p.getByText('Retomada do diagnóstico',{exact:true}).waitFor();await p.getByText('WhatsApp (assistido, antigo)',{exact:true}).waitFor();await h.capture(p,'broadcasts-lista');
 await p.getByText('Retomada do diagnóstico',{exact:true}).click();await p.getByText(/Broadcast antigo de WhatsApp assistido/).waitFor();assert.equal(await p.getByRole('button',{name:/^Enviar /}).count(),0,'antigo não envia');await p.getByRole('button',{name:'← Broadcasts',exact:true}).click();

 // Novo broadcast de WhatsApp: canal → público → modelo aprovado com variáveis → prévia → enviar → pausar.
 await p.getByRole('button',{name:'+ Novo broadcast',exact:true}).first().click();
 assert.equal(await p.getByRole('checkbox',{name:/^WhatsApp/}).getAttribute('aria-checked'),'true');assert.equal(await p.getByRole('checkbox',{name:/^E-mail/}).getAttribute('aria-checked'),'false');
 await p.getByLabel('Nome do broadcast',{exact:true}).fill('Retomada outubro');
 await pick(p,'Modelo aprovado','retomada_diag (pt_BR)');
 await pick(p,'Valor da variável 2','texto fixo');
 await p.getByLabel('Texto fixo da variável 2',{exact:true}).fill('LeverAds');
 await p.getByText(/tudo certo com a LeverAds\?/).first().waitFor();
 assert.ok(await noNativeSelects(p),'nenhum <select> nativo');
 await p.getByText('limite do número por dia',{exact:true}).waitFor();await p.getByText('1.000',{exact:true}).waitFor();
 await h.capture(p,'broadcast-whatsapp');
 const sendBtn=p.getByRole('button',{name:/^Enviar \d+ mensage/});const label=await sendBtn.innerText();const n=Number(label.replace(/\D/g,''));assert.ok(n>0,label);
 p.once('dialog',d=>d.accept());await sendBtn.click();await p.getByText(/mensagem\(ns\) de WhatsApp na fila/).waitFor();
 assert.ok((await writes(p)).includes('campaignSendWhatsapp'));
 await p.getByRole('button',{name:'Pausar envio',exact:true}).click();await p.getByRole('button',{name:'Retomar envio',exact:true}).waitFor();await p.getByText('Pausado: pausado pelo time',{exact:true}).waitFor();
 await h.capture(p,'broadcast-whatsapp-pausado');
 await p.getByRole('button',{name:'← Broadcasts',exact:true}).click();await p.getByText('Retomada outubro',{exact:true}).waitFor();await p.getByText('pausado',{exact:true}).waitFor();

 // Broadcast de e-mail com modelo livre.
 await p.getByRole('button',{name:'+ Novo broadcast',exact:true}).first().click();await p.getByRole('checkbox',{name:/^E-mail/}).click();await p.getByRole('checkbox',{name:/^WhatsApp/}).click();assert.equal(await p.getByRole('checkbox',{name:/^WhatsApp/}).getAttribute('aria-checked'),'false');
 await pick(p,'Usar modelo livre','Primeiro contato');assert.equal(await p.getByLabel('Assunto do e-mail',{exact:true}).inputValue(),'Olá {{nome}}');
 await p.getByRole('button',{name:'Inserir primeiro nome',exact:true}).click();assert.match(await p.getByLabel('Mensagem',{exact:true}).inputValue(),/\{\{nome\}\}$/);
 const mailBtn=p.getByRole('button',{name:/^Enviar \d+ e-mail/});p.once('dialog',d=>d.accept());await mailBtn.click();await p.getByText(/e-mail\(s\) na fila, saem pelo Resend/).waitFor();await p.getByText('Pausar envio',{exact:true}).waitFor();
 assert.ok((await writes(p)).includes('campaignSendEmail'));await p.getByRole('button',{name:'← Broadcasts',exact:true}).click();

 // Os dois canais ao mesmo tempo: modelo no WhatsApp, texto no e-mail, um botão só.
 await p.getByRole('button',{name:'+ Novo broadcast',exact:true}).first().click();await p.getByRole('checkbox',{name:/^E-mail/}).click();
 assert.equal(await p.getByRole('checkbox',{name:/^WhatsApp/}).getAttribute('aria-checked'),'true');assert.equal(await p.getByRole('checkbox',{name:/^E-mail/}).getAttribute('aria-checked'),'true');
 await p.getByLabel('Nome do broadcast',{exact:true}).fill('Dois canais');
 await pick(p,'Modelo aprovado','retomada_diag (pt_BR)');await pick(p,'Valor da variável 2','texto fixo');await p.getByLabel('Texto fixo da variável 2',{exact:true}).fill('LeverAds');
 await pick(p,'Usar modelo livre','Primeiro contato');
 await p.getByText('WhatsApp e e-mail',{exact:true}).first().waitFor();await p.getByText('por WhatsApp',{exact:true}).waitFor();await p.getByText('por e-mail',{exact:true}).waitFor();
 await h.capture(p,'broadcast-dois-canais');
 const both=p.getByRole('button',{name:/^Enviar \d+ WhatsApp e \d+ e-mails?$/});p.once('dialog',d=>d.accept());await both.click();await p.getByText(/e-mail\(s\) na fila, saem pelo Resend · \d+ mensagem\(ns\) de WhatsApp na fila/).waitFor();await p.getByLabel('Progresso do envio').getByText('E-mail',{exact:true}).waitFor();await h.capture(p,'broadcast-dois-canais-enviado');
 const bw=await writes(p);assert.equal(bw.filter(w=>w==='campaignSendEmail').length,2);assert.equal(bw.filter(w=>w==='campaignSendWhatsapp').length,2);
 await p.getByRole('button',{name:'← Broadcasts',exact:true}).click();await p.getByText('WhatsApp + E-mail',{exact:true}).waitFor();await p.close();

 // Sequência: o gatilho guarda os motivos de perda ao salvar (bug 3); menus nativos.
 const seq=await h.open(1440);await tab(seq,'Sequências').click();await seq.getByRole('button',{name:'Retomada por etapas',exact:true}).click();
 await seq.getByLabel('Nome da sequência',{exact:true}).fill('Sequência editada');await pick(seq,'Estado da sequência','ativa');
 await seq.getByRole('button',{name:'salvar sequência',exact:true}).click();await seq.getByText('sequência salva',{exact:true}).waitFor();
 const sw=(await writes(seq)).filter(w=>w.col==='sequences');assert.deepEqual(sw.at(-1).data.trigger.reasons,['sem_resposta']);assert.ok(await noNativeSelects(seq));await h.capture(seq,'sequencias');
 // Passo de WhatsApp com modelo oficial: sem modelo não salva; com modelo e variáveis, grava o modelo no passo.
 await pick(seq,'Como sai o passo 1','modelo oficial');await seq.getByRole('button',{name:'salvar sequência',exact:true}).click();await seq.getByText(/Passo 1: escolha o modelo aprovado/).waitFor();
 await pick(seq,'Passo 1 · Modelo aprovado','retomada_diag (pt_BR)');await pick(seq,'Passo 1 · Valor da variável 2','texto fixo');await seq.getByLabel('Passo 1 · Texto fixo da variável 2',{exact:true}).fill('LeverAds');
 await seq.getByRole('button',{name:'salvar sequência',exact:true}).click();await seq.getByText('sequência salva',{exact:true}).waitFor();
 const sw2=(await writes(seq)).filter(w=>w.col==='sequences').at(-1).data;assert.equal(sw2.steps[0].template.name,'retomada_diag');assert.deepEqual(sw2.steps[0].template.vars[1],{source:'text',value:'LeverAds'});assert.deepEqual(sw2.trigger.reasons,['sem_resposta']);
 await h.capture(seq,'sequencia-modelo-oficial');
 // Inscrever leads à mão.
 await seq.getByRole('button',{name:'inscrever leads…',exact:true}).click();const en=seq.getByRole('dialog');await en.getByRole('checkbox').first().check();await en.getByRole('button',{name:'Inscrever 1',exact:true}).click();await seq.getByText(/^1 lead inscrito/).waitFor();assert.ok((await writes(seq)).includes('sequenceEnroll'));
 await seq.close();

 // Fila do WhatsApp: passo de sequência mandado à mão.
 const fila=await h.open(1440);await tab(fila,'Fila do WhatsApp').click();await fila.getByText('Fila do WhatsApp · 1 para mandar',{exact:true}).waitFor();await h.capture(fila,'fila');
 await fila.getByRole('link',{name:'abrir WhatsApp ↗'}).click();await fila.getByText('Fila do WhatsApp · 0 para mandar',{exact:true}).waitFor();assert.ok((await writes(fila)).includes('sequenceWaSent'));await fila.close();

 // Modelos: oficiais da Meta com status e motivo, criar e apagar; livres.
 const mod=await h.open(1440);await tab(mod,'Modelos').click();await mod.getByText('retomada_diag',{exact:true}).waitFor();await mod.getByText('aprovado',{exact:true}).waitFor();await mod.getByText('Motivo da Meta: PROMOTIONAL',{exact:true}).waitFor();await mod.getByText('Modelos livres',{exact:true}).waitFor();
 await h.capture(mod,'modelos');
 await mod.getByRole('button',{name:'+ novo modelo oficial',exact:true}).click();const dlg=mod.getByRole('dialog');await dlg.getByLabel('Nome (a-z, 0-9, _)').fill('oferta_out');await dlg.getByLabel('Corpo da mensagem').fill('Oi {{1}}, temos novidade para a {{2}}.');
 assert.ok(await dlg.getByRole('button',{name:'Enviar para aprovação',exact:true}).isDisabled(),'faltam os exemplos');
 await dlg.getByLabel('Exemplo para {{1}} (a Meta exige)').fill('Ana');await dlg.getByLabel('Exemplo para {{2}} (a Meta exige)').fill('Loja Exemplo');
 await dlg.getByRole('button',{name:'+ botão',exact:true}).click();await dlg.getByLabel('Texto do botão 1').fill('Quero saber');assert.ok(await noNativeSelects(mod),'modal sem <select> nativo');await h.capture(mod,'modelo-oficial-novo');
 await dlg.getByRole('button',{name:'Enviar para aprovação',exact:true}).click();await dlg.getByText(/Enviado para a Meta \(em análise\)/).waitFor();await dlg.getByRole('button',{name:'fechar',exact:true}).click();
 await mod.getByText('oferta_out',{exact:true}).waitFor();await mod.getByText('em análise',{exact:true}).waitFor();
 mod.once('dialog',d=>d.accept());await mod.getByRole('button',{name:'Apagar modelo promo_out',exact:true}).click();await mod.getByText('Modelo "promo_out" apagado.',{exact:true}).waitFor();await mod.close();

 // Falha de leitura com nova tentativa.
 const fail=await h.open(1440,'&failOnce=list:campaigns');await fail.getByRole('alert').filter({hasText:'Não foi possível atualizar os broadcasts'}).waitFor();await fail.getByRole('button',{name:'Tentar novamente',exact:true}).click();await fail.getByText('Retomada do diagnóstico',{exact:true}).waitFor();await fail.close();

 // Canal sem configuração fica bloqueado com o caminho para configurar.
 const nowa=await h.open(1440,'&nowa');await nowa.getByRole('button',{name:'+ Novo broadcast',exact:true}).first().click();assert.ok(await nowa.getByRole('checkbox',{name:/^WhatsApp/}).isDisabled());assert.equal(await nowa.getByRole('checkbox',{name:/^E-mail/}).getAttribute('aria-checked'),'true');await nowa.close();

 // Celular, tablet, escuro e vazio: sem rolagem lateral em nenhuma aba.
 for(const[width,q]of [[390,''],[1024,''],[1440,'&theme=dark'],[1440,'&empty']]){const page=await h.open(width,q);for(const name of ['Broadcasts','Sequências','Fila do WhatsApp','Modelos']){await tab(page,name).click();await page.waitForTimeout(150);assert.ok(await noOverflow(page),`${name} ${width}${q}`);await h.capture(page,`state-${name}-${width}-${q||'base'}`);}await page.close();}
 assert.deepEqual(h.errors,[]);console.log('Disparos: broadcasts por canal e nos dois canais (WhatsApp oficial e e-mail), sequência com gatilho preservado, fila, modelos oficiais e livres, menus no seletor do Cockpit, falha/retry, celular, escuro e vazio OK.');
}finally{await h.close();}
