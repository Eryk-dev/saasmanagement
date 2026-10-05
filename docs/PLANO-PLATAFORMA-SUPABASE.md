# Plano: Plataforma Lever — auth unificado no Supabase, bancos separados por produto e RLS

> **Status (18/09/2026): planejado, não iniciado.** Abrange Cockpit (este repo), LeverAds (`C:\dev\LeverAds`) e LeverPrice (`C:\dev\Leverprice`). Desbloqueia o portal do cliente e o `PLANO-TICKETS-BOTS-WHATSAPP.md`. O ambiente de dev, onde cada fase roda antes de prod, está em `PLANO-AMBIENTE-DEV.md`.
>
> **Revisões (18/09/2026):**
> 1. **Banco único descartado.** Os bancos tinham sido separados em 30/08 por carga, então cada produto continua com o seu banco e só a identidade é unificada.
> 2. ~~A identidade fica na VPS do LeverAds.~~ Substituída pela revisão 4.
> 3. **Substitui o plano anterior do projeto Linear** "Plataforma Lever" (banco único `db-01` com um schema por produto e sem RLS por usuário).
>    - Os itens de contenção daquele plano continuam na Fase 0.
>    - ~~A VPS nova roda **só banco + Supabase**: a API e o worker do LeverAds continuam fora dela.~~ Substituída pela revisão 5.
>    - O **billing central** (schema `billing` como único dono de planos, assinaturas e faturas) **saiu do escopo por ora**.
>
> 4. **A identidade ganha VPS própria, separada do banco do LeverAds.** O LeverAds é o produto pesado; com o Auth no mesmo Postgres, um pico de worker ou uma migration do LeverAds afetaria o login de todos. Agora:
>    - a **VPS de identidade** roda GoTrue + um Postgres pequeno (`auth` e `core`);
>    - o **banco do LeverAds** sai do Cloud para uma VPS nova só dele;
>    - os **três produtos** (inclusive o LeverAds) validam o JWT pelo JWKS e recebem `core` por replicação.
>
> 5. **Todo o Levercopy vai para a VPS nova, e o Cockpit continua dentro dele.**
>    - O Cockpit **não tem banco próprio**: usa o mesmo banco do LeverAds (`levercopy`), com os dados dele no schema `cockpit`. Como backoffice, tem acesso a **todo** o banco, não só ao `public`.
>    - A VPS nova do Supabase auto-hospedado recebe o banco `levercopy` **e** as apps `copylever` (API LeverAds), `leveradswk` (worker LeverAds) e o Cockpit (api + web + mcp).
>    - A VPS do Easypanel fica livre para backups e apps auxiliares.
>    - Com isso, o plano passa a ter **dois bancos de produto** (`levercopy` e LeverPrice) mais a identidade.
>
> 6. **O ambiente não-prod se chama `dev`**, não `staging`. Ele fica numa VPS isolada, só com dados sintéticos (ver `PLANO-AMBIENTE-DEV.md`). Os ensaios com dump de produção rodam numa instância temporária, nunca no dev.
>
> 7. **(25/09) Identidade segue o `PLANO-AUTH.md`** (revisão 2, seção 7.1). Onde este plano diverge, vale aquele:
>    - senha do staff do Cockpit por migração no login, não por convite;
>    - TOTP do LeverAds importado, não recadastrado;
>    - telas e `supportSaas` ficam em `cockpit.users`, não em `core.staff`;
>    - `X-Super-Admin-Org` continua, autorizado por `staff_roles`; `x-act-org` e impersonação ficam para depois do RLS;
>    - carga com dual-write e reconciliação, sem pausar cadastro nem troca de senha;
>    - no Cockpit, `customer.leveradsOrgId` vira `customer.orgId` (mesmo id), sem `core_org_id`;
>    - claims `products` e `aud` por produto ficam para o LeverPrice/RLS.
>
>    O mecanismo do RLS antes da Fase 2 (`SET LOCAL` pelo backend × PostgREST com JWKS) está em aberto no `PLANO-AUTH.md` (decisão 9).
>
> **Contexto de escala** (LEV-355, 05/09):
> - o banco do LeverAds tem 18,7 GB, dos quais ~10 GB são logs e notificações já processadas;
> - o gargalo no Cloud é memória;
> - a base de contas dobra a cada ~6 semanas.

## Contexto

Hoje são três produtos em dois bancos: o Cockpit mora dentro do banco do LeverAds. Cada produto tem login próprio e acesso privilegiado:

| | Cockpit (saasmanagement) | LeverAds | LeverPrice (canônico p/ pricing) |
|---|---|---|---|
| Onde roda | schema `cockpit` no banco do LeverAds (`COCKPIT_DB_URL`), com acesso a todo o banco; app no Easypanel | Supabase **Cloud** `hsooljludhobvsznvnir`; API e worker no Easypanel | Supabase auto-hospedado na VPS1 (Coolify) |
| Stack | Fastify + React, `pg` | FastAPI + React | FastAPI + worker Go + React + iOS |
| Login | scrypt + `cockpit.sessions` + master key `COCKPIT_API_KEY` | bcrypt + `user_sessions` (token em texto puro), TOTP, magic link | bcrypt + `user_sessions`, magic link, `admin-promote` por senha mestra |
| Acesso ao banco | `pg` como superusuário (`db.js`) | service_role (~450 call sites) + asyncpg como `postgres` (63 arquivos) | service_role (~350 `.table`) + asyncpg/pgx como `postgres` |
| RLS | nenhuma | ligada, **0 policies** | ligada em quase tudo, **0 policies**, 10 tabelas sem RLS |
| Tenancy | 1 tenant, `saas` dentro do JSON | `orgs.id` | `orgs.id` (herdado do Levercopy) |
| Schema | ~77 tabelas `(id, json)`, DDL no boot | ~110 tabelas em `public`, SQL manual sem ledger | ~65 tabelas, ledger `schema_migrations` |

O isolamento entre tenants existe só no código (`.eq("org_id")`). Um bug ou uma credencial vazada expõe tudo. Cada produto tem seu próprio cadastro de usuários e orgs, então a mesma pessoa tem uma conta em cada um.

**Decisões tomadas:**
- **LeverPrice canônico:** o repositório Leverprice é o dono do pricing. As tabelas e rotas `leverprice_*` do LeverAds são legado.
- **Identidade:** uma conta e uma org para vários produtos. O Cockpit é o backoffice, e staff é um papel global.
- **Bancos separados:** LeverPrice e Levercopy em bancos e VPS diferentes, por causa da carga. O Cockpit fica no banco `levercopy`, no schema `cockpit`, e tem acesso a todo esse banco por ser o backoffice.
- **Auth central numa VPS de identidade própria:** GoTrue (`auth.*`) e `core.*` (orgs, vínculos de usuário, produtos liberados, staff) ficam numa VPS pequena, dedicada, sem dados de produto. Nenhum produto roda GoTrue; todos validam os JWTs emitidos ali.
- **Levercopy numa VPS nova:** o banco `levercopy` sai do Supabase Cloud para uma VPS auto-hospedada, que também roda `copylever`, `leveradswk` e o Cockpit. O Easypanel fica para backups e apps auxiliares.
- **Backends como BFF:** os backends (FastAPI/Fastify) continuam entre o frontend e o banco e repassam o JWT do usuário ao PostgREST do produto, então o RLS vale sempre. Workers usam papéis próprios de menor privilégio.
- **Sem acesso privilegiado nas apps:** nada de service_role, DSN do banco ou usuário `postgres` no código ou no env das aplicações.

---

## Arquitetura alvo

```
                 ┌───────────────────────────────────┐
                 │  VPS Identidade (nova, pequena)    │
  login/refresh  │  GoTrue + Postgres + Kong          │── /auth/v1 (login de todos os produtos)
  ─────────────▶ │  auth.*  core.* (orgs, memberships,│── JWKS (só chaves públicas)
                 │  org_products, staff, profiles,    │
                 │  revoked_sessions)                 │── replicação lógica de core.* ──┐
                 └───────────────────────────────────┘                                  │
                  ┌──────────────────────────────────────────────────┬─────────────┘
                  ▼                                                  ▼
 ┌─────────────────────────────────────────────┐   ┌──────────────────────┐
 │ VPS Levercopy (nova)                        │   │ VPS1 LeverPrice      │
 │ Postgres + PostgREST + Kong + Supavisor     │   │ Postgres + PostgREST │
 │ + Storage                                   │   │ + Kong               │
 │ schemas public (LeverAds) + cockpit         │   │ core_replica.* (RO)  │
 │ core_replica.* (RO)                         │   │ lp-api + worker Go   │
 │ apps: copylever · leveradswk · Cockpit      │   └──────────────────────┘
 └─────────────────────────────────────────────┘
   todos validam o JWT localmente pelo JWKS — nenhuma chamada à identidade por requisição
   Easypanel: backups e apps auxiliares
```

### VPS de identidade (dedicada, pequena)
- **Stack:** GoTrue, Postgres, Kong e o endpoint de impersonação. **Sem dados de produto**: a carga é só login, refresh e cadastro. Studio e pg-meta ficam só na rede privada.
- **Schemas:**
  - `auth`: gerido pelo GoTrue.
  - `core`: identidade compartilhada. Contém:
    - `orgs` e `profiles` (1:1 com `auth.users`);
    - `memberships(org_id, user_id, role)`;
    - `org_products(org_id, product, status, plan, access_until, payment_active)`;
    - `staff(user_id, roles[], screens[], support_products[])`;
    - `revoked_sessions`, `audit_events`.
  - `private`: hook e funções `SECURITY DEFINER`. Não é exposto.
- **Os ids do LeverAds viram os ids canônicos:** `users.id` do LeverAds vira `auth.users.id`, e `orgs.id` do LeverAds vira `core.orgs.id`. A carga é um script idempotente que preserva os ids, então nenhum dado do LeverAds é reescrito. O `public.orgs` do LeverAds mantém as colunas específicas do produto (billing do LeverAds, flags de feature) e passa a ter FK para `core_replica.orgs`.
- **Chaves JWT assimétricas** (ES256/RS256): o GoTrue assina com a chave privada, e os três produtos recebem **só a pública** via JWKS. Nenhum segredo compartilhado sai da VPS.
- **Custom Access Token Hook** (`private.custom_access_token_hook`) coloca no JWT:
  - `org_id` e `org_role`: a org ativa. Trocar de org grava a escolha e força refresh.
  - `products`: os produtos liberados para a org ativa.
  - `is_staff` e `staff_roles`.
  - `aud`: a lista de produtos.
- **O GoTrue substitui o código próprio de login:** e-mail/senha, magic link, recuperação de senha, TOTP MFA, captcha Turnstile e rate limit.
- **Ponto único de falha, mas isolado:**
  - Se a VPS de identidade cair, ninguém faz login nem refresh. Sessões já emitidas continuam valendo até expirar, porque a validação é local.
  - A carga dos produtos não chega nela, mas ela ainda é crítica. Por isso tem **réplica standby física** com failover ensaiado, além do PITR.

### Bancos de produto (`levercopy` e LeverPrice)
- **Stack:** Postgres, PostgREST e Kong, mais Supavisor e Storage no `levercopy`. **Nenhum roda GoTrue.**
- **`levercopy` (LeverAds + Cockpit):**
  - VPS nova, com o banco e as apps `copylever`, `leveradswk` e Cockpit na mesma máquina.
  - Schemas: `public` do LeverAds e `cockpit` do Cockpit. O Cockpit, como backoffice, lê e opera **todo** o banco.
  - Dimensionada pela carga medida no Cloud **somada** à das apps que saem do Easypanel, com standby e alarme de saturação.
  - Banco e apps dividem CPU e memória, então valem limites por container e por papel (item 4 de "Acesso a dados"), para um pico do `leveradswk` não derrubar a API nem o Cockpit.
  - Como não guarda mais o login, um pico de worker ou uma migration do LeverAds não afeta o login nem o LeverPrice.
- **PostgREST:** configurado com o JWKS do GoTrue mais uma chave de serviço **própria do produto**. Exige `aud` contendo o produto, então um token emitido para outro produto é recusado.
- **Réplica local de `core`:** `core_replica.*` é somente leitura e chega por **replicação lógica** nativa (publication na identidade, uma subscription por banco: `levercopy`, usada por LeverAds e Cockpit, e LeverPrice), por rede privada (WireGuard/Tailscale). Isso permite:
  - policies com `JOIN` em memberships e `org_products` sem chamada de rede;
  - chaves estrangeiras para `core_replica.orgs` e `core_replica.profiles`;
  - continuar funcionando com a identidade fora do ar, com os dados da última sincronização.
- **Permissões específicas continuam no banco de cada produto**, ligadas a `auth.uid()`: acesso por seller no LeverAds, aprovadores do LeverPrice e telas do Cockpit.
- **`auth.uid()` / `auth.jwt()`:** vêm na imagem do Supabase e leem `request.jwt.claims`. Não dependem de `auth.users` local.

### Autorização (RLS)
- **Helpers em `private`:**
  - `private.is_member(org uuid, min_role text)`, `private.has_product(org uuid)`, `private.is_staff(role text default null)`, `private.can_access_seller(slug text)`;
  - o caminho rápido usa os claims do JWT;
  - a confirmação usa `core_replica`;
  - todos são `STABLE SECURITY DEFINER` com `search_path=''`, chamados como `(select private.is_member(org_id))` para o resultado ser cacheado.
- **Toda tabela:**
  - `ENABLE` e `FORCE ROW LEVEL SECURITY`;
  - policies separadas por operação e por papel;
  - grants explícitos por tabela e coluna, sem grant para `authenticated` em colunas sensíveis (tokens, hashes);
  - default privileges com `REVOKE ALL` para `anon`, `authenticated` e `public`.
- **Views e funções:** views com `security_invoker = true`; `SECURITY DEFINER` só em `private`.
- **MFA obrigatório por org:** policy `RESTRICTIVE` com `auth.jwt()->>'aal' = 'aal2'`.
- **Backoffice no `levercopy`:** toda tabela de `public` e de `cockpit` tem policy para `private.is_staff()`, com o papel de staff decidindo leitura e escrita. É assim que o Cockpit mantém acesso ao banco inteiro sem service_role. Usuários de org **não** alcançam o schema `cockpit`.

### Acesso a dados
1. **Requisição de usuário:** o backend valida o JWT pelo JWKS (em cache) e cria um cliente por requisição com a anon key do produto e `Authorization: Bearer <jwt do usuário>`. O RLS se aplica, e as guards do FastAPI/Fastify continuam como defesa em profundidade.
2. **Workers, crons e webhooks:** um papel de banco por serviço, `NOLOGIN`, concedido ao `authenticator` e **sem `BYPASSRLS`**:
   - `svc_leverads_worker`
   - `svc_leverprice_worker`
   - `svc_cockpit_jobs`
   - `svc_webhook_ingest`

   Cada produto tem sua própria chave de serviço no JWKS. Os tokens levam `role: svc_x`, `jti`, `aud` do produto e validade de 90 dias. O `db-pre-request` (`private.check_request()`) confere o `jti` contra uma lista de revogados.
3. **Filas:** `SKIP LOCKED`, `ON CONFLICT` e advisory locks passam para RPCs: `claim_jobs(worker_id, n)`, `complete_job`, `fail_job` e `upsert_*` em lote via `jsonb`. Locks de sessão viram lease (`locked_until`/`locked_by`) ou `pg_try_advisory_xact_lock` dentro da RPC.
4. **Limites contra vizinho barulhento:** `statement_timeout` e limite de conexões por papel `svc_*`, para um job não travar a API do próprio produto. No `levercopy` isso também separa `svc_leverads_worker` de `svc_cockpit_jobs`, que dividem banco e máquina.
5. **Tokens de marketplace:**
   - A chave de criptografia passa a ser **própria**, via Vault ou `TOKEN_ENCRYPTION_KEY` explícita. Hoje ela é derivada da service_role, que **muda** na instância nova.
   - O token em claro só sai pela RPC `get_access_token(slug)`, concedida aos papéis `svc_*`.
6. **Chamadas entre produtos:**
   - **Cockpit → LeverAds:** mesmo banco. O Cockpit acessa o `public` pelo PostgREST do `levercopy` com o JWT do staff (ou `svc_cockpit_jobs` quando é um job), coberto pelas policies de staff. Ações com regra de negócio (paywall, liberação de acesso) viram RPCs.
   - **Cockpit → LeverPrice e `core.org_products`:** via HTTP, com o JWT do staff ou `svc_cockpit_jobs`, sempre em RPCs específicas.
   - Com isso acabam `LEVERCOPY_DB_URL`, `cockpit_reader`, `COCKPIT_INGEST_KEY` e o login de admin em `leverads-access.js`.
7. **Exceção documentada:** se um hot path do worker Go não aguentar o PostgREST (medido no dev), ele pode usar um papel `LOGIN` restrito via Supavisor, com os mesmos grants do `svc_leverprice_worker` e sem `BYPASSRLS`. Só vale com o benchmark registrado.

### Impersonação e revogação
- **Ver como cliente:**
  - um endpoint só para staff, junto da identidade, emite um JWT de 15 a 30 minutos, sem refresh;
  - no token, `sub` é o usuário do cliente e `act: {sub: <staff>}` identifica o staff (padrão da RFC 8693);
  - ele é assinado com uma **chave de impersonação** publicada no JWKS;
  - o RLS se aplica como se fosse o cliente;
  - uma policy `RESTRICTIVE` bloqueia escrita quando há `act` (pode ser liberada por papel de staff);
  - toda requisição com `act` é auditada no `db-pre-request`.
- **Operar como suporte:** substitui o `X-Super-Admin-Org`. O staff mantém a própria identidade e envia `x-act-org`. As policies aceitam o header via `request.headers` só com `private.is_staff('support')`.
- **Revogação:**
  - o access token vale de 5 a 10 minutos;
  - um trigger grava logout e bloqueio forçado em `core.revoked_sessions`;
  - essa tabela é replicada para os outros produtos;
  - o `db-pre-request` confere o `session_id` do JWT contra ela.
- **Removidos:** master key do Cockpit, `admin-promote` por senha mestra e tokens de sessão em texto puro.

### Páginas públicas e blobs
- **Links públicos por token** (portal `/s/:token`, NPS, proposta `?k=`, forms, links de pagamento): viram RPCs `SECURITY DEFINER` concedidas a `anon`, que recebem o token e devolvem só os campos necessários.
- **Blobs:** o base64 do Cockpit (`*_assets`, `wa_media`) e o bucket `proposal-assets` vão para o Storage do `levercopy`, com policies em `storage.objects`.

### Migrations: cada repo é dono do seu banco
- **Identidade (`core`, `private`, hook, publication):** fica num repositório próprio (LeverId), com ledger próprio, aplicado no banco da VPS de identidade.
  - Os helpers de RLS e o schema `core_replica` são publicados como pacote SQL versionado, que os três produtos instalam.
- **Cada produto:**
  - migra só os próprios schemas, junto com o código;
  - usa um ledger único (Supabase CLI ou dbmate);
  - roda as migrations com o papel `<produto>_owner`, que não é superusuário e é dono só dos próprios schemas. Uma migration errada **não consegue** alterar `core_replica`.
- **`levercopy` tem dois donos:** `leverads_owner` (schema `public`) e `cockpit_owner` (schema `cockpit`), cada um com seu ledger. O acesso amplo do Cockpit vem de grants e policies de staff, não de ser dono do `public`, então uma migration do Cockpit não altera tabelas do LeverAds. Mudanças no `public` que o Cockpit lê seguem expand/contract e passam pelo dev com os dois apps no ar.
- **Contrato:**
  - os produtos dependem só de `core_replica` (colunas estáveis) e dos claims do JWT;
  - mudanças em `core` seguem expand/contract;
  - colunas novas precisam existir no assinante **antes** de serem publicadas.
- **CI de cada produto:**
  - sobe um Postgres descartável, aplica o pacote `core` na versão fixada e depois as migrations do produto;
  - roda pgTAP e os advisors;
  - falha se houver tabela sem RLS, `SECURITY DEFINER` exposta, service_role ou DSN.
- **Fim do DDL nas apps:** saem o `ensureSchema` do Cockpit, o SQL manual do LeverAds e o `lp-migrate` como `supabase_admin`.

### Infraestrutura
- **Exposição pública:** só o Kong de cada VPS (`/auth/v1` só na identidade; `/rest/v1` nos bancos de produto; `/storage/v1` no `levercopy`) e os domínios das apps. Postgres, Studio e pg-meta ficam em rede privada ou atrás de VPN.
- **Rede privada** (WireGuard/Tailscale) entre as VPS, para replicação e administração.
- **Ambientes:** `prod` e `dev` para a identidade e para os três produtos. O dev fica numa VPS isolada, com dados sintéticos e domínios `dev.` + host de prod (ver `PLANO-AMBIENTE-DEV.md`). Hoje nenhum dos três tem ambiente não-prod.
- **Localização:**
  - identidade: **exceção decidida em 18/09**, roda na **VPS2 (`82.112.245.65`)** e não numa VPS dedicada. É o serviço `lever-identity` do Coolify (vira LeverId) (projeto "Supabase Lever"), ao lado do `lp-worker-go`, da `lp-api` de reserva e do Evolution API.
    - Mitigação: teto de CPU e memória por container (db 2 vCPU/2 GB; auth, rest e kong 0,5 vCPU cada).
    - Standby e backup ainda pendentes (LEV-499).
    - Migrar para VPS dedicada se a latência do login ou o uso da máquina justificarem;
  - todo o Levercopy numa **VPS nova com Supabase auto-hospedado**, com standby: banco `levercopy` (schemas `public` e `cockpit`) e as apps `copylever`, `leveradswk` e Cockpit;
  - LeverPrice na VPS1 atual;
  - VPS do Easypanel: backups e apps auxiliares.

---

## Fases

### Fase 0 — Contenção (produção atual, sem depender da VPS nova)
- **Cockpit:**
  - remover a senha padrão (`DEFAULT_ADMINS` com `1234`);
  - restringir a criação e o reset de usuários a admins;
  - não desligar a auth quando `COCKPIT_API_KEY` estiver ausente;
  - restringir CORS.
- **Chave dos tokens, obrigatória antes da Fase 2:**
  - LeverAds e LeverPrice passam a usar `TOKEN_ENCRYPTION_KEY` explícita e recifram os tokens de marketplace;
  - a instância nova terá outra service_role, então sem esse passo **todos os tokens do LeverAds seriam perdidos na mudança**.
- **LeverPrice:**
  - backup fora da VPS1, com restore testado;
  - remover os containers Python antigos, que podem voltar a escrever preços após um reboot.
- **LeverAds:** religar a retenção e limpar ~10 GB (`ml_notifications_inbox`, `copy_jobs`, `api_debug_logs`). Alivia a memória no Cloud e diminui a mudança.
- **Supabase Cloud:**
  - confirmar o project ref de produção (`hsooljludhobvsznvnir` × `wrbrbhuhsaaupqsimkqz`);
  - fazer um dump final do projeto antigo que ainda cobra e desligá-lo.

### Fase 1 — Fundação
- **VPS nova do Levercopy:**
  - banco + PostgREST/Kong/Supavisor/Storage e as apps `copylever`, `leveradswk` e Cockpit, com Kong fechado e rede privada;
  - PITR externo, standby física e monitoramento.
- **Dimensionamento:** medir a carga real no Cloud (`pg_stat_statements`, memória, CPU, IO, conexões) **e** a das apps no Easypanel, dimensionar a VPS com folga para o crescimento e definir o alarme de saturação.
- **Base operacional do Levercopy:**
  - ledger de migrations (LEV-439), com um ledger para `public` e outro para `cockpit`;
  - backup completo com restore testado (LEV-431);
  - ambiente de dev isolado (relacionado à LEV-194; ver `PLANO-AMBIENTE-DEV.md`).
- **Deploy:** `publica.py` e o deploy do Cockpit passam a mirar o Coolify da VPS nova em vez do Easypanel.
- **Segredos do Vault do Cloud:** exportar pela view `vault.decrypted_secrets` e recriar na instância nova, porque a chave raiz do Cloud não sai de lá.
- **Legado de pricing no LeverAds:** congelar as rotas `leverprice*`, comparar com o banco do LeverPrice, migrar o que faltar e remover routers, loops e tabelas do LeverAds.
- **Mapa de identidades:**
  - orgs do LeverPrice e `customers` do Cockpit casados com as orgs do LeverAds, que são as canônicas (o Cockpit já vincula isso em `packages/api/scripts/2026-09-12-vincular-org-leverads.mjs`);
  - usuários casados por e-mail, com lista de conflitos para revisão manual (sem fusão automática).

### Fase 2 — Mudança do Levercopy: Cloud + Easypanel → VPS (só infraestrutura; LEV-355)
- **Ensaio antes:** replicação lógica do Cloud para uma **instância de ensaio temporária** (não o dev, que só tem dados sintéticos), para medir o tempo de sincronização e validar extensões, `supabase_vault` e sequences.
- **Mesmas apps e mesmo login de hoje:** mudam só onde o banco está (os schemas `public` e `cockpit` vão juntos) e onde `copylever`, `leveradswk` e Cockpit rodam, via replicação lógica e janela curta em somente leitura (ver "Virada").
- **Troca de env:** `SUPABASE_URL`, chaves, `DB_ASYNC_DSN` e `COCKPIT_DB_URL` passam a apontar para a VPS.
- **Rollback:** a replicação reversa fica ativa por alguns dias, e as apps antigas ficam paradas no Easypanel, prontas para voltar.
- **Desligamentos:** `leverads_runtime` e `cockpit_reader` do Cloud não são levados, ou são desligados aqui. Depois da retenção, o Easypanel fica só com backups e apps auxiliares.

### Fase 3 — Identidade na VPS dedicada
- **VPS de identidade:** GoTrue + Postgres + Kong (prod na VPS2; dev como `identity-dev` na VPS de dev), com rede privada, PITR, standby e monitoramento. Pode ser provisionada em paralelo às Fases 1 e 2.
- **Repositório LeverId:** `core`, hook, helpers, pacote `core_replica`, chaves (GoTrue, serviço, impersonação), endpoint de impersonação e publication de `core`.
- **Carga inicial do Auth:** script idempotente, pelo mapa da Fase 1:
  - usuários do LeverAds, preservando ids e hash bcrypt;
  - usuários do LeverPrice e staff do Cockpit.
- **GoTrue público** em `/auth/v1`, ainda sem nenhuma app usando.
- **Testes:** suíte pgTAP base (org A × org B, staff, anon, `svc_*`, aal1/aal2, `act`) e teste de ponta a ponta com uma subscription num banco de dev vazio.

### Fase 4 — Cockpit (piloto: interno, poucos usuários, um único ponto de acesso ao banco)
- **Staff:** `cockpit.users` vira `auth.users` + `core.staff`. As telas ficam em `staff.screens`. O staff redefine a senha por convite, porque o scrypt não é compatível. Saem `DEFAULT_ADMINS` e a master key.
- **Banco:**
  - o `levercopy` ganha a subscription de `core_replica`, que o LeverAds reaproveita na Fase 6;
  - o schema `cockpit` passa a ser servido pelo PostgREST do `levercopy`;
  - as policies de staff cobrem `public` e `cockpit`, para o Cockpit manter acesso ao banco inteiro;
  - mantém o formato `(id, json)`, com colunas geradas (`saas`, `org_id`, `assignee`) para RLS e índices.
- **Código:**
  - `packages/api/src/platform/db.js`: `repo.*` passa a usar postgrest-js com o JWT da requisição;
  - `rawQuery` vira RPC;
  - `auth.js`, `makeAuthHook` e `screens.js` validam o JWT pelo JWKS;
  - `support-scope.js` continua, e o RLS repete a regra;
  - os jobs usam `svc_cockpit_jobs`, e os webhooks `svc_webhook_ingest`.
- **Integrações:**
  - `leverads-results.js` lê o `public` pelo PostgREST do mesmo banco, com o JWT do staff;
  - `leverads-access.js` troca o login de admin por RPCs no `levercopy`;
  - `org_products` é escrito em `core`.
- **Fora de escopo:** o Elo continua externo, com `cockpit_reader`.

### Fase 5 — LeverPrice
1. **Banco:** a VPS1 ganha a subscription de `core_replica` e o JWKS no PostgREST. `orgs` local recebe `core_org_id`.
2. **Login:** web e iOS passam a entrar pelo `/auth/v1` da identidade. `require_user` e os guards leem o JWT.
3. **Acesso a dados:** `get_db()` vira uma dependência por requisição. As RPCs passam a tirar a org de `auth.jwt()`/`core_replica`.
4. **Worker Go:** RPCs via HTTP com `svc_leverprice_worker`, com benchmark no dev. O webhook do ML usa `svc_webhook_ingest`.
5. **Limpeza:** o MCP com `postgres` irrestrito vira read-only, e o `admin-promote` é removido.

### Fase 6 — LeverAds (a maior)
1. **Banco:** o `levercopy` já tem a subscription de `core_replica` e o JWKS no PostgREST desde a Fase 4. `public.orgs` passa a ter FK para `core_replica.orgs`.
2. **Login pelo GoTrue da identidade.** O TOTP precisa de novo cadastro no MFA do GoTrue.
3. **Acesso a dados:** `get_db()` vira uma dependência por requisição, módulo a módulo (~90 arquivos), em PRs pequenos guiados pela `docs/seguranca/matriz-autorizacao.yaml`. `tests/isolation/` roda contra o dev com RLS.
4. **Workers e webhooks:**
   - os ~30 loops e os 63 arquivos com asyncpg passam a usar RPCs com `svc_leverads_worker`;
   - os webhooks usam `svc_webhook_ingest`.
5. **Integração com o Cockpit:** o `X-Cockpit-Key` (`COCKPIT_INGEST_KEY`) é substituído por chamada autenticada.

### Fase 7 — Consolidação
- **Segurança:** revogar papéis transitórios, rotacionar chaves e ligar o CI de "sem service_role/DSN" nos três repos.
- **Portal do cliente:** login real, com memberships dando acesso aos tickets da org.
- **Chaves de integração:** as do `PLANO-TICKETS-BOTS-WHATSAPP.md` viram `svc_*` com escopos.
- **Cockpit:** normalização relacional das coleções restantes.
- **Encerramento:** desligar o projeto Cloud depois da retenção.

---

## Virada, downtime, migração de dados e backup

### Princípio: nada de big bang
As tabelas de produto ficam nos schemas atuais e não mudam de nome. A virada é uma sequência de passos pequenos, cada um reversível por flag ou env:

| Passo | Por que não derruba nada | Rollback |
|---|---|---|
| Levercopy Cloud + Easypanel → VPS (Fase 2) | Replicação contínua; só a troca final exige janela curta. | Replicação reversa + env antigo + apps antigas no Easypanel |
| Criar papéis, helpers e policies | As apps ainda usam service_role/`postgres`, que ignoram RLS. As policies ficam "dormentes". | Não precisa |
| Replicação de `core` para `core_replica` | Schema novo, só leitura, nada existente é alterado. | Remover a subscription |
| Backend aceita **os dois logins** (sessão antiga ou JWT) | Ninguém é deslogado, e a sessão antiga expira sozinha em 7 dias. | Front volta ao login antigo |
| Módulo a módulo: JWT do usuário no lugar da service_role | Feature flag por módulo, com shadow compare nas leituras (padrão que o LeverPrice já usa em `LP_LISTING_SHADOW_COMPARE`). | Desligar a flag |
| Loop a loop: worker via RPC + `svc_*` | Flag por loop, e o caminho antigo fica mantido até estabilizar. | Desligar a flag |
| Revogar service_role/DSN das apps | Só depois de semanas sem uso nos logs. | Devolver o env |

**Downtime esperado:**
- **Única janela real:** a troca final do Levercopy Cloud → VPS, de **5 a 15 minutos em somente leitura**, num horário de baixo tráfego. Vale para LeverAds **e** Cockpit, que dividem o banco. O tempo exato sai do ensaio da Fase 2.
- **Todo o resto é zero:** deploys com restart normal.

### O que efetivamente migra de dados
1. **Levercopy Cloud → VPS:**
   - `pg_dump --schema-only` (schemas `public` e `cockpit`) e ajuste de extensões na VPS;
   - replicação lógica do Cloud (publication com o papel `postgres` do projeto) até alcançar o primário;
   - `copylever`, `leveradswk` e Cockpit sobem na VPS nova ainda parados, apontando para o banco novo;
   - janela em somente leitura: parar os workers e os jobs do Cockpit, esperar lag zero, conferir contagens e checksums, ajustar as **sequences** (a replicação lógica não as copia), recriar os segredos do Vault, trocar o env e subir;
   - replicação reversa VPS → Cloud por alguns dias, para voltar sem perder escrita.
2. **Usuários para o Auth:**
   - LeverAds: script idempotente que copia para a identidade preservando ids e hash bcrypt.
   - LeverPrice: script idempotente com mapa `legacy_user_map(produto, id_antigo, auth_user_id)` e lista de conflitos de e-mail.
   - Carga cheia e depois **delta** (`updated_at` > última execução) logo antes de ligar o login novo. Nesses minutos, cadastro e troca de senha ficam pausados.
   - Staff do Cockpit (scrypt): recebe convite para definir senha.
   - TOTP do LeverAds: é refeito no primeiro login, com prazo antes de ficar obrigatório.
3. **Orgs:**
   - as do LeverAds viram `core.orgs` com o mesmo id, e `public.orgs` do LeverAds ganha FK para `core_replica.orgs`;
   - no LeverPrice e no Cockpit o id **não é reescrito**: a tabela local ganha `core_org_id`, e os helpers resolvem por ela;
   - assim não há UPDATE em cascata.
4. **Tokens de marketplace (Fase 1):**
   - leitura dupla: decifra com a chave nova e, se falhar, com a derivada da service_role;
   - recifragem em lotes;
   - remoção do fallback só quando não restar nenhum token na chave antiga;
   - tem que terminar **antes** da Fase 2.
5. **Cockpit `(id, json)`:**
   - tabelas pequenas ganham coluna `GENERATED STORED`;
   - nas grandes (`wa_messages`, `wa_media`, `*_events`), coluna comum com trigger e backfill em lotes, para evitar reescrita com lock.
6. **Blobs base64 → Storage:** cópia em lotes, leitura dupla (usa o Storage quando há caminho, o base64 quando não há) e remoção do base64 só no fim, depois de backup.
7. **Legado `leverprice_*` do LeverAds → LeverPrice:** script idempotente com conferência de contagens, com as rotas antigas congeladas antes.

### Backup
- **As duas VPS mais críticas:**
  - **identidade:** guarda as senhas e o login de todos;
  - **Levercopy:** o maior banco, que cresce mais rápido, com os dados do LeverAds e do Cockpit.

  Ambas têm:
  - **PITR contínuo** (WAL-G ou pgBackRest) em armazenamento de **outro provedor** (R2/S3/B2), com retenção de 30 dias;
  - **standby física** com failover documentado e ensaiado.
- **LeverPrice:** PITR no mesmo padrão.
- **VPS do Easypanel:** guarda uma cópia dos backups, além do armazenamento externo. Não substitui o outro provedor, porque é mais uma máquina do mesmo parque.
- **Réplicas não são backup:** `core_replica` e a standby copiam também um `DELETE` errado.
- **Restore testado de verdade:**
  - automático toda semana, numa VPS descartável, com conferência de contagens;
  - antes de cada virada, dump lógico e restore conferido na instância de ensaio.
- **O antigo fica intacto:** o projeto Cloud e as tabelas legadas (sessões, `users` antigos, blobs base64) ficam **só de leitura por 30 dias** após cada virada.
- **Segredos fora dos servidores**, num cofre (1Password/Bitwarden), com responsável e procedimento de rotação:
  - chaves privadas JWT (GoTrue, serviço, impersonação);
  - `TOKEN_ENCRYPTION_KEY`, **a mais crítica**: perdê-la é perder todos os tokens de marketplace;
  - credenciais de backup.

### Ensaio e execução de cada virada
1. **Ensaio numa instância temporária** com dump recente de produção: runbook inteiro, cronometrado. Só há go se passar limpo. A instância tem acesso restrito e é destruída depois; o dev nunca recebe dado real.
2. **Runbook escrito:**
   - checklist, horário de baixo tráfego e responsável;
   - critério de go/no-go;
   - **gatilhos de rollback definidos antes**, por exemplo taxa de 401/403 acima de X% ou job parado há mais de N minutos.
3. **Conferência pós-virada:**
   - contagens e checksums por tabela;
   - login de uma amostra de usuários reais de cada produto;
   - `tests/isolation/` contra produção em modo leitura;
   - painéis de 401/403 e da fila de jobs.
4. **Comunicação:**
   - clientes só são avisados quando algo muda para eles: o MFA precisa ser recadastrado, a senha continua a mesma, e a janela da Fase 2 é informada com antecedência;
   - o staff recebe o convite antes da virada.

---

## Arquivos-chave por repo
- **Cockpit:**
  - banco e autenticação: `packages/api/src/platform/db.js`, `auth.js`, `screens.js`, `support-scope.js`;
  - rotas e integrações: `routes.js`, `index.js`, `leverads-results.js`, `leverads-access.js`;
  - web: `packages/web/src/lib/api.js`.
- **LeverAds:**
  - banco e configuração: `app/db/supabase.py`, `app/db/asyncpg_pool.py`, `app/config.py`;
  - autenticação e rotas: `app/routers/auth.py`, `app/routers/commercial.py`;
  - workers e migrations: `app/workers/*`, `app/db/migrations/`;
  - backup e deploy: `scripts/backup_supabase.py`, `scripts/publica.py`;
  - segurança e testes: `docs/seguranca/*`, `tests/isolation/`;
  - frontend: `frontend/src/hooks/useAuth.ts`.
- **LeverPrice:**
  - banco: `app/db/supabase.py`, `app/db/asyncpg_pool.py`, `app/services/leverprice/data/postgrest.py`;
  - autenticação e webhooks: `app/routers/auth.py`, `magic_link.py`, `auth_ml.py`, `ml_notifications.py`;
  - worker Go: `worker-go/queue/pool.go`, `worker-go/tokencrypto/`;
  - migrations e ferramentas: `app/db/migrations/`, `scripts/lp-migrate`, `.mcp.json`.

## Verificação
- **pgTAP em cada banco:**
  - org A não lê nem escreve org B;
  - `anon` só acessa RPCs públicas;
  - cada `svc_*` só alcança o que declara;
  - staff sem papel é negado;
  - aal1 é barrado em org com MFA obrigatório;
  - com `act`, só leitura;
  - `<produto>_owner` não consegue alterar `core_replica`;
  - no `levercopy`: staff lê todas as tabelas de `public` e `cockpit`, usuário de org não alcança `cockpit`, e `cockpit_owner` não altera `public`.
- **Tokens:**
  - um token com `aud` de outro produto recebe 401;
  - um `svc_*` revogado recebe 401 na próxima requisição;
  - uma sessão revogada recebe 401 na próxima requisição.
- **Resiliência:**
  - com a identidade fora, sessões ativas continuam nos três produtos, e o login falha como esperado;
  - o failover das standbys (identidade e Levercopy) é ensaiado.
- **Carga:** benchmark do worker Go e da fila do LeverAds via RPC contra o baseline, e a latência do `/auth/v1/token` monitorada.
- **Mudança de Cloud:** contagens, checksums, sequences e segredos do Vault conferidos. Tokens de marketplace decifram na VPS nova.
- **Replicação:** mudança em `memberships` chega aos produtos em segundos, com o atraso monitorado.
- **Login migrado:** a senha antiga funciona, e e-mails duplicados viram uma conta com vários produtos.
- **Advisors (splinter)** sem erros, e o CI de "sem service_role/DSN" verde.

## Próximo passo
Fase 0 e Fase 1 em paralelo:
- levantar a carga atual do banco no Cloud e das apps no Easypanel (`copylever`, `leveradswk`, Cockpit) para dimensionar a VPS nova do Levercopy;
- começar a separação da `TOKEN_ENCRYPTION_KEY` no LeverAds e no LeverPrice, que é pré-requisito da mudança.
