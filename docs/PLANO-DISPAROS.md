# Plano: Disparos por canal (E-mail pelo Resend e WhatsApp pela API oficial)

> **Status (23/10/2026): fases 0 a 5 implementadas localmente (sem commit); deploy só depois da validação do Yudi.** Decisões do Yudi em 22/10/2026:
> (1) a tela abre na lista de campanhas e "+ Nova campanha" começa escolhendo o
> canal; abas Campanhas · Sequências · Fila do WhatsApp · Modelos; (2) WhatsApp
> sai pela **API oficial** com modelos aprovados da Meta; (3) corrigir os bugs
> achados junto, cada um com teste; (4) modelos **livres** e gestão dos
> **oficiais da Meta**; (5) e-mail pelo **Resend**, configurado em
> Configurações → Integrações; (6) na tela, **"Campanhas" passa a se chamar
> "Broadcasts"** e os menus suspensos deixam o `<select>` nativo do navegador e
> passam ao **seletor do Cockpit** (`SelectPopover`) em todas as abas.

## Estado atual (conferido no código em 22/10/2026)

**Tela** (`web/src/screens/disparos.jsx`, 725 linhas, abas Disparos · Sequências · Templates):
- O canal é escolhido no passo 2 ("A mensagem"), mas muda o passo 1 (status por linha) e o passo 3 (contagem, custo, botão).
- Campanhas salvas ficam num `<select>` no pé do cartão da mensagem; os resultados ficam numa tabela à parte, de onde não se abre a campanha.
- WhatsApp é **assistido** (`wa.me`, um lead por vez; marca "enviado" ao abrir a aba). A fila das sequências é outra lista, em outra aba.
- `drip_templates` só serve às sequências. Os modelos da Meta ficam no Inbox (Automações) e não aparecem aqui.

**E-mail:** `integrations/mailer.js` embrulha o Gmail da conta Google do sistema (`google.sendGmail`, texto puro, um por vez, sem limite de ritmo). Chamadores: Disparos (`/send-email`), drip, NPS, relatório mensal e resposta de ticket. Não há Resend nem SMTP.

**WhatsApp:**
- O cliente (`whatsapp/whatsapp.js`) já envia modelos (`sendTemplate`) e cria modelos só com corpo e imagem no cabeçalho (`createTemplate`).
- Lista só os aprovados, sem o campo de status, e não apaga modelos.
- A WABA é global; o número é por produto (`product.waPhoneId`).
- Fila e limite de ritmo existem só no SDR (`sdr-flow.js`: teto por ciclo, lotes, pausa por saúde e disjuntor por taxa de falha); são o modelo para o disparo.

**Bugs achados (entram corrigidos, com teste):**
1. Limite diário: `Number("TIER_1K".replace(/\D/g, ""))` dá 1 (`disparos.jsx:292`).
2. Custo estimado usa todos os escolhidos, não os pendentes (`disparos.jsx:372`).
3. Salvar sequência pela tela apaga `trigger.reasons` (`disparos.jsx:442, 465`), que o drip usa (`drip-runner.js:80`).
4. Prévia (`scriptTokens`, rótulos) ≠ envio (`leadTokens`, valores crus) em nicho/contas/anúncios.
5. Campanha nunca chega a "concluída" (`draft → sending` só).
6. O pill de status dos modelos no Inbox sempre mostra "?" (a API não devolve `status`); o criador manda um só exemplo de variável, e modelo com 2+ variáveis falha.

**Segurança (achado, fora do pedido original, pré-requisito do Resend):** `app_config` não está nas coleções privadas nem tem trava de tela. Qualquer sessão logada lê e grava pelo CRUD genérico, inclusive `app_config/google_oauth`, que guarda o `refreshToken` do Google em texto aberto. Nenhum teste cobre isso.

## Fases

### Fase 0 — Segredos fora do alcance do CRUD
- Lista de chaves sensíveis de `app_config` (`google_oauth` e a futura config de e-mail): o CRUD genérico não devolve campos secretos (lê sem `refreshToken`/`apiKey`) e recusa escrita nelas; quem grava são as rotas dedicadas.
- Segredo novo mora em coleção **privada** (`integration_secrets`), lida só no servidor; a tela recebe `{ configured, last4 }`.
- Testes em `screens.test.js`/novo teste: sessão comum não lê o token nem grava as chaves.
- **Feito em 22/10/2026:** `SECRET_CONFIG` em `crm/routes.crud.js` — `app_config/google_oauth` sai do CRUD sem `refreshToken`/`accessToken`/`token` e POST/PATCH/DELETE nele dão 403 (o fluxo OAuth grava direto no repo). Coleção privada `integration_secrets` criada. Teste: `secret-config.test.js`. O SSE só manda nome de coleção, não documento. As outras chaves de `app_config` seguem abertas à escrita de qualquer sessão (não guardam credencial; anotado para tarefa própria).

### Fase 1 — E-mail pelo Resend
- `mailer.js` vira multiprovedor: **Resend** quando configurado (`POST https://api.resend.com/emails`, `Authorization: Bearer`, `from`, `to`, `subject`, `text`/`html`, `headers`), senão Gmail como hoje. Mesmo contrato `send()`/`ready()`; `provider` diz qual está ativo.
- Ritmo: o envio em massa respeita o limite do Resend (padrão 2 req/s), com espera e nova tentativa em 429; resultado por lead como hoje.
- **Configurações → Integrações → E-mail (Resend)**: chave (só escrita; mostra `•••• 1234`), remetente (nome + e-mail), domínio com o estado de verificação lido do Resend, botão "enviar e-mail de teste" e "remover". Rotas `GET/PUT/DELETE /api/integrations/email` e `POST /api/integrations/email/test`, só para quem tem Ajustes (escrita: etiqueta admin).
- `SEED.CONFIG.email = { provider, ready, from }` substitui o uso de `CONFIG.google.gmail` na tela.
- Depois (fase 5): webhook do Resend (entregue, devolvido, reclamação) marcando e-mail inválido/descadastro.
- **Feito em 22/10/2026:** domínio novo `email` (logo depois do `google` em `domains.js`): `email/resend.js` (envio e domínios, 429 com espera), `email/email-config.js` (doc `integration_secrets/email`; `publicEmailConfig` sem a chave), `email/mailer.js` (Resend → Gmail → nenhum; `provider()`, respiro de 550 ms entre envios) e `email/routes.email.js` (`GET/PUT/DELETE /api/email/config`, `POST /api/email/test`; ler com a tela Configurações, gravar/testar só admin; erros externos em 424). O `integrations/mailer.js` saiu. `SEED.CONFIG.email = { provider, ready }`; a tela de Disparos já usa. Tela: cartão "E-mail (Resend)" em `screens/settings-email.jsx`. Testes: `email-resend.test.js`; revisão no bloco de e-mail de `scripts/review/settings.mjs`.

### Fase 2 — Modelos (livres e oficiais da Meta)
- Aba **Modelos** com duas seções:
  - **Livres** (`drip_templates`): e-mail (assunto + corpo) e WhatsApp texto (para a fila assistida e a janela de 24h). Passam a servir também às campanhas.
  - **Oficiais da Meta**: lista com status (aprovado, em análise, rejeitado com motivo, pausado), categoria, idioma e qualidade; criar com cabeçalho (nenhum/texto/imagem), corpo com N variáveis e um exemplo por variável, rodapé e botões (resposta rápida e link); apagar.
- API: `listTemplates` com todos os status e paginação; `deleteTemplate`; `createTemplate` com rodapé, botões e cabeçalho de texto; rotas sob o domínio `whatsapp`.
- Variáveis com a mesma sintaxe e o mesmo preenchimento em prévia e envio (um `leadTokens` em `shared/`).
- **Feito em 22/10/2026:** cliente com `listAllTemplates` (todos os status, motivo, qualidade, componentes, paginação), `deleteTemplate` e `createTemplate` com cabeçalho de texto, rodapé e botões; rotas `GET /api/whatsapp/templates/all` e `DELETE /api/whatsapp/templates/:name`; o `POST` valida limites da Meta e pede um exemplo por número de variável (antes contava ocorrência); `/api/whatsapp/templates*` liberado também para a tela Disparos. Variáveis em `shared/campaign-tokens.js` (rótulo da resposta na prévia e no envio — bug 4). Gerenciador `components/wa-template-manager.jsx` (lista com status/motivo/qualidade, criar com exemplos por variável e botões, apagar com confirmação) já no Inbox → Automações (corrige o status "?" e o exemplo único — bug 6); entra em Disparos → Modelos na fase 4. Testes: `wa-templates-manage.test.js`.

### Fase 3 — WhatsApp pela API oficial nos disparos
- Campanha de WhatsApp escolhe um **modelo aprovado** e mapeia cada variável para um campo do lead (nome, empresa…) ou texto fixo; cabeçalho de imagem usa a foto padrão do modelo.
- Envio no servidor: a campanha vira fila (`campaign.sent` por lead com `queued/sent/delivered/read/failed`), um runner gated por `jobOn("campaignSends")` manda em lotes com teto por minuto e **teto diário pela faixa do número** (`TIER_250/1K/10K/100K/UNLIMITED` lidas certo), pausa por saúde do número e disjuntor por taxa de falha (padrão do resgate do SDR).
- Pula `whatsappOptOut`/`whatsappInvalid`; grava em `wa_messages` (autor `disparo`) para a conversa aparecer no Inbox; o webhook de status atualiza a campanha.
- Custo estimado pela categoria do modelo e pelos pendentes; status `rascunho → enviando → concluída` (e `pausada`).
- **Feito em 22/10/2026:** `marketing/broadcast-wa.js` — campanha com `channel: "whatsapp"` e `wa.template = { name, language, body, params, header, vars: [{ source: "token"|"text", value }] }`; `enqueueWaBroadcast` (pula sem telefone, opt-out, número inválido, já recebido e variável vazia; modelo com imagem exige a foto padrão), `runWaBroadcastTick` (teto diário = 80% da faixa via `shared/wa-tier.js`, faixa desconhecida = 250; pausa com saúde "danger"; disjuntor >20% de falha em ≥20 tentativas; grava `wa_messages` autor `disparo` e a activity; `sent[lead] = { waStatus: queued|sent|failed|skipped, waMessageId, waError }`; fecha em `done`), `waBroadcastProgress` (entregue/lida/falha pelo status do webhook). Rotas `POST /api/campaigns/:id/send-whatsapp` (confere o modelo aprovado na hora), `/pause`, `/resume`, `GET /:id/progress`. Runner a cada 30 s em `jobOn("waBroadcasts")`. Testes: `broadcast-wa.test.js`.

### Fase 4 — Tela nova de Disparos
- Abas **Broadcasts** (lista com canal, status, progresso e resultados; filtro Todos/WhatsApp/E-mail; "+ Novo broadcast") · **Sequências** · **Fila do WhatsApp** (envios assistidos de campanhas e sequências num lugar só) · **Modelos**.
- Novo broadcast em 4 passos: **1 Canal** (WhatsApp oficial · E-mail) → **2 Público** (etapas, busca, seleção; status por linha do canal escolhido) → **3 Mensagem** (modelo, IA para e-mail, variáveis) → **4 Conferir e enviar** (prévia real, quantos, custo e limite, um botão primário).
- Menus suspensos com o `SelectPopover` do design system em todas as abas, inclusive no modal de modelo oficial (pedido do Yudi, 22/10/2026: nenhum `<select>` nativo na página). Na API e no banco a coleção segue `campaigns`; só o texto da tela muda.
- Bugs 1–5 corrigidos aqui (o 3 no editor de sequência). Revisão com `.claude/skills/cockpit-ui-review`; o roteiro `scripts/review/disparos.mjs` deixa de comparar geometria com `TelaDisparos.dc.html` (a prancha antiga deixa de valer).
- **Feito em 22/10/2026:** `screens/disparos.jsx` reescrita — abas Broadcasts · Sequências · Fila do WhatsApp · Modelos (a aba lembrada migra de `disparos`/`templates`). Broadcasts: lista com canal, status, enviados/falhas e resultados (filtro Todos/WhatsApp/E-mail); editor em 4 passos; WhatsApp escolhe o **modelo aprovado** e liga cada variável a um campo do lead ou texto fixo, envia pela fila do servidor e mostra o progresso (na fila, enviadas, entregues, lidas, falharam) com pausar/retomar; e-mail usa modelo livre, variáveis e IA e sai pelo provedor ativo. Broadcasts antigos de WhatsApp assistido ficam só para consulta. Sequências mantêm o editor (gatilho inteiro preservado — bug 3); a fila de WhatsApp das sequências virou a aba própria; Modelos junta o gerenciador oficial e os livres. Bug 1 (`shared/wa-tier.js`), 2 (custo pelos que recebem) e 4 (`shared/campaign-tokens.js`) também na tela; 5 no servidor. Menus em `SelectPopover` (nenhum `<select>` nativo; o roteiro de revisão confere) e CSS da tela reescrito sem os seletores da estrutura antiga. Revisão: `npm run test:review:disparos -w packages/web` (novo roteiro, sem geometria do protótipo).

### Fase 5 — Sequências e retorno do e-mail
- Passo de WhatsApp da sequência pode usar modelo oficial (sai sozinho) ou texto livre (vai para a fila assistida).
- Webhook do Resend; inscrição manual de leads na sequência (a rota existe, a tela não usa).
- **Feito em 23/10/2026:**
  - passo de WhatsApp com `template` (mesmo formato do broadcast) sai sozinho no `drip-runner` via `sendTemplateToLead` (`broadcast-wa.js`): pula opt-out, número inválido, sem telefone e variável vazia; espera o próximo ciclo sem WhatsApp configurado ou com o número sinalizado; grava no Inbox (autor `sequencia`) e na timeline. Passo sem modelo continua indo para a Fila do WhatsApp;
  - webhook `POST /api/webhooks/resend` (assinatura Svix com o segredo `whsec_…` salvo em Integrações): `email.bounced` permanente marca `emailInvalid` (temporário não muda nada), `email.complained` marca `emailOptOut`; nota na timeline (autor `resend`). Broadcast de e-mail e sequência pulam `emailInvalid`;
  - tela: escolha "texto livre" ou "modelo oficial" no passo de WhatsApp (o mesmo `WaTemplateFields` do broadcast; não salva passo de modelo sem modelo/variáveis), "inscrever leads…" com busca e filtro de etapa, e o cartão de e-mail com a URL do webhook e o segredo;
  - testes: `disparos-fase5.test.js`; revisão no roteiro de Disparos e no bloco de e-mail de Configurações.
- **E-mail em fila no servidor (23/10/2026):** a rota `send-email` deixou de enviar dentro da requisição (com centenas de leads o proxy derrubava a conexão no meio) e só enfileira (`sent[lead].emailStatus = queued`, `enqueueEmailBroadcast`). O runner `marketing/broadcast-email.js` (`jobOn("emailBroadcasts")`, 30 s, até 40 por ciclo) manda pelo mailer, pula sem e-mail/descadastrado/devolvido, grava a activity e pausa com o motivo quando mais da metade de ≥10 tentativas falha; `/resume` devolve os e-mails que falharam à fila. "Concluído" só quando as duas filas esvaziam (`hasQueued`). Progresso mostra os dois canais; pausar/retomar vale para qualquer canal. Testes em `routes.disparos.test.js`, `broadcast-wa.test.js` e `disparos-fase5.test.js`.
- **Os dois canais no mesmo broadcast (23/10/2026, pedido do Yudi):** `channel: "both"` (`channels: { whatsapp: true, email: true }`). Na tela, os cartões de canal viram caixas de marcar (ao menos uma); o público mostra por onde cada lead recebe ("WhatsApp e e-mail", "só WhatsApp · e-mail: …"); a mensagem tem os dois blocos (modelo aprovado e e-mail); "Enviar N WhatsApp e M e-mails" manda o e-mail na hora (`send-email`) e enfileira o WhatsApp (`send-whatsapp`). No servidor, `hasWhatsappChannel` aceita `whatsapp` e `both` no enfileiramento e no runner. Teste em `broadcast-wa.test.js`; fluxo no roteiro de revisão.

## Fora do escopo
- Assinatura `X-Hub-Signature-256` do webhook da Meta (não existe hoje; tarefa própria).
- Inbox, SDR e automações continuam como estão (só passam a ver as mensagens do disparo).

## Riscos
| Risco | Mitigação |
|---|---|
| Disparo em massa derruba a qualidade do número | Teto diário pela faixa, lotes, pausa por saúde, disjuntor por falha; prévia mostra quantos e o custo |
| Mensagem duplicada (dois processos) | Runner único gated por `jobOn`; estado por lead na campanha antes do envio |
| Chave do Resend vazar | Coleção privada, só escrita pela tela, `last4` na leitura; fase 0 antes |
| Resend sem domínio verificado | Tela mostra o estado do domínio; envio recusa até verificar |
