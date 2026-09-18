# Plano: tickets abertos e conversados por bots, LLMs e WhatsApp

> **Status (15/09/2026): planejado, não iniciado.** Espera a reestruturação que unifica a autenticação de LeverAds, LeverPrice e cockpit num único Supabase (Auth/JWT). Antes de executar, revisar a Fase 1 (chaves de integração e hook de auth em `auth.js`) e a Fase 4 (autenticação do MCP) contra o modelo de identidade novo: a ideia de integração como identidade própria, sem usuário, com escopos, produtos e revogação continua valendo, mas o armazenamento e a verificação das chaves podem mudar para o Supabase. As demais fases (idempotência, mensagem de cliente sem mexer no SLA, webhooks de saída, WhatsApp ↔ ticket, MCP por perfil) independem do auth.

> **Atualização (17/09/2026):** o espelho de tickets com o **Linear** já foi entregue (`linear.js`, `ticket-linear.js`, `ticket-linear-runner.js`, `POST /api/webhooks/linear`). Ele estreou o gancho de saída único em `tickets-core.js` (`setTicketSink`) e a fila `linear_outbox` com backoff — a **Fase 2** (webhooks de saída genéricos) deve reaproveitar esse gancho em vez de criar um segundo, e `addMessage` já aceita `source` (dedupe por id externo), que a Fase 0 previa.

## Contexto

Hoje um bot só consegue abrir ticket usando a **chave mestre** (acesso total ao cockpit) ou o MCP, que também usa a chave mestre. Tudo que ele faz aparece como "API", sem identidade, sem idempotência (retry = ticket duplicado) e sem origem. Pior: mensagem de cliente repassada pelo bot via `/api/tickets/:id/messages` é gravada como **resposta de atendente**, marcando a 1ª resposta do SLA e disparando e-mail. O inbox de WhatsApp é só de vendas (leads/SDR) e não conversa com tickets; o webhook da Meta nem verifica assinatura.

Objetivo: uma porta segura para qualquer bot/LLM/sistema abrir tickets, repassar mensagens do cliente e receber as respostas da equipe (mão dupla), mais WhatsApp nativo ligado aos tickets e MCP usando a mesma identidade.

Decisões já tomadas com o usuário:
- Escopo: API + MCP genéricos **e** WhatsApp nativo. E-mail de entrada e triagem por IA ficam para depois.
- Mão dupla: bot repassa mensagens do cliente (autor cliente, sem mexer no SLA de 1ª resposta) e recebe as respostas públicas da equipe por webhook assinado.
- Uma **chave por integração** (produtos e permissões limitados, revogável, nome próprio no histórico, limite de requisições); o MCP passa a aceitar essa chave.
- **Visibilidade: a integração vê e alimenta todos os tickets dos produtos liberados na chave** (não só os que abriu). Notas internas, anexos internos, SLA e responsável nunca saem.
- WhatsApp com janela de 24h fechada: a tela **pergunta** (template aprovado / salvar e avisar por e-mail / salvar sem enviar).
- Conversa de WhatsApp com ticket aberto: **pausa todos os robôs de venda** (fluxo de ligação, fluxos, automações, SDR, cérebro de IA, lembrete de espera) até o ticket fechar.
- Resposta enviada pelo inbox em conversa vinculada: sai pelo WhatsApp e é **espelhada no ticket** como resposta da equipe.

Assumido (padrão, ajustável na revisão): canal novo `api` (meio real em `source.medium`); validação estrita para máquinas (prioridade/categoria inválidas → 400 com a lista permitida); bot não responde como equipe na v1; e-mail ao cliente desligado por padrão em tickets de integração; assinatura `*Ana:*` nas respostas por WhatsApp ligada por padrão.

---

## Fase 0 — Preparação sem mudança de comportamento

- **`packages/api/src/customer-match.js`** (novo): `matchCustomer(repo, { saas, email, phone, leadId })` → leadId do cliente, e-mail exato, telefone por `waMatchKey` (wa-store.js, trata o nono dígito). `routes.support-portal.js` L118-123 passa a usar.
- **`packages/api/src/wa-outbound.js`** (novo): extrair de `routes.whatsapp.js` `resolvePhoneId`, `sendAndRecord` (L57), catálogo de templates, envio de template (L524-577) e `outsideWindow`; `waWindowOpen(msgs, now)` no servidor (espelho de `web/src/components/wa-thread.jsx`).
- **`tickets-core.js`**:
  - `addMessage(..., { asCustomer, source })`: `isCustomer = by === ACTOR_PORTAL || asCustomer`; dedupe por `source.externalId`/`waMessageId` dentro do lock; `message.source` e `message.delivery`.
  - `createTicket(..., { source, sourceKey, sourceConversation, strict })`; campos `source`, `sourceKey`, `sourceConversation`, `sourceHash` no topo do doc e em `MANAGED` (não vêm do input).
  - `TICKET_CHANNELS += "api"`; `nameOf` para `int:<id>` (nome da integração) e `whatsapp`; notificação de mensagem de cliente usa o nome do solicitante.
- Testes: `customer-match.test.js`; casos novos em `routes.tickets.test.js`; `routes.whatsapp.test.js`, `wa-*.test.js` e `routes.support-portal.test.js` continuam verdes sem editar asserts.

## Fase 1 — Chaves de integração + API de entrada

**Modelo** (`packages/api/src/integrations.js`, coleções PRIVATE `integrations` e `integration_keys` em `seed-data.js`, `routes.js` PRIVATE, índices em `db.js`):
- `integrations`: `{ id: int_…, name, active, products[], scopes[], defaultChannel, rateLimitPerMin, emailCustomer, webhook{url, secret, events[], active} }`.
- `integration_keys`: `{ id (12 hex), integrationId, prefix, secretHash (sha256), lastUsedAt, revokedAt, expiresAt }`. Token `cki_<keyId>_<secret>` exibido uma única vez; várias chaves ativas permitem rotação com carência.
- Escopos: `tickets:create`, `tickets:read`, `tickets:message`, `tickets:attach`.

**Autenticação** (`auth.js` `makeAuthHook`, `index.js`):
- Token `cki_` é reconhecido antes do `if (!apiKey) return` → `req.authIntegration` (nunca `req.authUser`).
- **Nega por padrão**: integração só alcança `/api/ext/v1/*` (403 em `/api/tickets`, CRUD genérico, `/api/events`, `/api/auth`…). Rotas `/api/ext/v1` exigem integração.
- Chave mestre passa a comparar em tempo constante.

**Gestão** (`routes.support-integrations.js`, sob `/api/support/integrations` → guard da tela `support_settings`; não-admin só com produtos do próprio escopo): listar, criar (retorna token), editar, gerar chave/rotacionar com carência, revogar chave, desativar integração (não apaga: o histórico cita).

**Intake** (`routes.intake.js`, prefixo `/api/ext/v1`, `app.register` com bodyLimit 8MB, rate limit por integração com limitador por chave derivado de `forms.js` `makeRateLimiter`):
| Rota | Escopo | O que faz |
|---|---|---|
| `GET /me`, `GET /meta?saas=` | — / create | identidade; prioridades, categorias, status públicos |
| `POST /tickets` | create | cria com `externalId`/`conversationId`/`medium`/`url`/`meta`, `Idempotency-Key`, anexos base64 opcionais; casa o cliente; 201, ou 200 `Idempotent-Replayed` no replay; 409 `idempotency_conflict` se o payload divergir |
| `GET /tickets?saas=&externalId=&conversationId=&status=&open=` | read | tickets dos produtos liberados |
| `GET /tickets/:id` | read | visão pública (`publicTicket` de `support-page.js` + ids de origem) |
| `POST /tickets/:id/messages` | message | mensagem **do cliente** (`asCustomer`), dedupe por `externalId`; 409 se fechado |
| `POST /tickets/:id/attachments`, `GET …/attachments/:aid` | attach / read | multipart (`readTicketUpload`) ou base64; só anexo público sai |
- Idempotência: `withTaskLock("ticket-src:"+sourceKey)` + busca por `sourceKey` indexado (o mem-repo sobrescreve id repetido, então não confiar em PK).
- Produto fora da chave → 403 `saas_not_allowed`; ticket de produto fora → 404.
- `emailCustomerReply` (routes.tickets.js L88) respeita `integration.emailCustomer` quando o ticket veio de integração.

**UI**: aba **Integrações** em `web/src/screens/support-settings.jsx` com componente novo `screens/support-integrations.jsx` (lista, modal de criação, tela "guarde esta chave" com copiar, chaves com revogar/rotacionar). `lib/api.js`; `lib/tickets.js` rótulo do canal `api`; `tickets/detail.jsx` mostra "via <integração> · <meio>" e atores de integração na atividade. Seguir `.claude/skills/cockpit-ui-review/references/design-system.md`.

## Fase 2 — Webhooks de saída (mão dupla)

- Coleção PRIVATE `integration_deliveries` + `integration-outbox.js`; gancho direto em `tickets-core.js` (`writeTicket` e `createTicket`, após `notifyTicketEvents`), best-effort — cobre UI, MCP, bulk, runner de SLA e WhatsApp.
- Entrega para as integrações ativas com webhook assinado **cujos produtos incluem o ticket** (coerente com a visibilidade por produto), com filtro de eventos por integração e opção "só os tickets que esta integração abriu".
- Eventos: `ticket.message.created` (só resposta pública da equipe), `ticket.status_changed`, `ticket.created` (para tickets de outros canais, se assinado), `ping`. Nota interna e mensagem do próprio cliente nunca saem.
- Assinatura: `X-Cockpit-Signature: t=<unix>,v1=HMAC_SHA256(secret, "t.body")`, `X-Cockpit-Delivery` para dedupe do receptor.
- Runner `integration-webhooks-runner.js` (molde `ticket-sla-runner.js`, iniciado em `index.js`): retries com backoff até 8 tentativas → `dead` + notificação; 410 → `dead`; URL só https (privada só com `INTEGRATION_WEBHOOK_ALLOW_PRIVATE=1`).
- Gestão: gerar segredo (mostra uma vez), testar, log de entregas, reenviar.

## Fase 3 — WhatsApp nativo ↔ ticket

- **3a**: `X-Hub-Signature-256` no `POST /api/webhooks/whatsapp` (parser de corpo cru num `app.register`, `WHATSAPP_APP_SECRET`; vazio = aceita com aviso). Vínculo `wa_threads.ticket` e `ticket.source.type = "whatsapp"`; `POST /api/whatsapp/threads/:id/ticket` (um ticket aberto por conversa, cliente por `matchCustomer`, importa as mensagens recentes do cliente), `DELETE` desvincula. Webhook: com ticket aberto, a entrada vira mensagem de cliente (dedupe por wamid) e **pula** call-flow, fluxos, automações, SDR, cérebro e `wa-waiting-reminder.js`; ticket fechado limpa o vínculo e a conversa volta ao pipeline de vendas. UI do inbox (`screens/whatsapp.jsx`): chip "ticket #N ↗", botão "Abrir ticket" e aviso de robôs pausados.
- **3b**: resposta pública num ticket de WhatsApp sai pela Cloud API (`wa-outbound.js`, assinatura do atendente); janela fechada → 409 `wa_window_closed` e a tela oferece template (`GET/POST /api/tickets/:id/whatsapp[/template]`), salvar + e-mail ou salvar sem enviar. Status da Meta atualiza `message.delivery.whatsapp` e falha gera evento + notificação. Envio pelo inbox em conversa vinculada é espelhado no ticket. UI do ticket: selo de entrega por mensagem e faixa de janela fechada.
- **3c**: mídia (entrada e saída) e abertura automática opcional só para quem já é cliente do produto (`settings.whatsapp.autoOpenForCustomers`, desligado).

## Fase 4 — MCP (pode vir logo após a Fase 1)

- `packages/mcp/src/apiClient.js` vira `makeApiClient({ base, key })` com métodos `/api/ext/v1`.
- `packages/mcp/src/auth.js` (novo): chave mestre → perfil atual; `cki_…` → valida em `/api/ext/v1/me` (cache) e cria cliente com a chave **da própria sessão**; sessão MCP presa ao hash da chave.
- `tools.js` `registerTools(server, { api, profile })`: perfil integração expõe só `whoami`, `support_meta`, `open_ticket`, `find_tickets`, `get_ticket_public`, `add_customer_message`, `attach_file`; perfil mestre segue igual. `express.json` 8MB para anexo.
- Testes em `packages/mcp/test` (servidor e API falsos) + script `test` no package.json.

## Docs e configuração
- `openapi.js`: esquema `IntegrationKey` (bearer `cki_…`), rotas `/api/ext/v1`, cabeçalhos de idempotência, formato e verificação do webhook, canal `api`.
- `docs/CONTEXTO-COCKPIT.md` (seção Suporte): remove "ticket a partir de WhatsApp" de fora do escopo; invariantes (integração nunca é usuário e só alcança `/api/ext/v1`; nota interna nunca sai por intake/webhook/WhatsApp; conversa com ticket pausa robôs; janela 24h exige escolha); coleções novas.
- README (MCP) e `.env.example` (`WHATSAPP_APP_SECRET`, `INTEGRATION_WEBHOOK_ALLOW_PRIVATE`, `MCP_API_KEY` aceita `cki_…`).

## Riscos registrados
- Locks e rate limit em memória valem para o processo único atual; com réplicas, trocar por advisory lock/índice único no Postgres.
- Conversa de WhatsApp é por telefone e um número por produto: vendas e suporte dividem a conversa (por isso abertura automática só para clientes, desligada).
- Visibilidade por produto aumenta o impacto de uma chave vazada: mitigado por escopos, revogação imediata, `lastUsedAt` e rate limit.
- SSRF do webhook: bloqueio por esquema/IP literal; DNS rebinding não coberto (URL definida por admin). Segredo do webhook fica em claro numa coleção PRIVATE (necessário para assinar); a chave só como hash.

## Verificação
1. Por fase: `npm test -w packages/api` (novos: `auth.integration-keys`, `routes.intake`, `routes.support-integrations`, `integration-webhooks`, `whatsapp-tickets`), `node --test` em `packages/mcp`, `npm test -w packages/web` (smoke com aba Integrações, ticket `api` e ticket/inbox de WhatsApp).
2. Casos-chave: replay idempotente e corrida com `Promise.all` → 1 ticket; mensagem de cliente não marca `firstResponseAt` e reabre; integração → 403 fora de `/api/ext/v1`; visão/webhook nunca contêm nota interna; entrega assinada confere o HMAC; wamid repetido não duplica; automação não responde conversa com ticket aberto; janela fechada → 409.
3. Ponta a ponta local, **só com `COCKPIT_DB_URL` apontando para banco isolado**: criar integração, `curl` com `Authorization: Bearer cki_…` (criar, repetir com `Idempotency-Key`, mandar mensagem, tentar `/api/tickets` → 403); receptor local `node:http` recalculando o HMAC; payload de webhook da Meta assinado com `openssl dgst -hmac`; cliente MCP com a chave `cki_…` listando só as 7 ferramentas.
4. Fluxo de entrega: uma fase por commit, sem push até o usuário pedir.
