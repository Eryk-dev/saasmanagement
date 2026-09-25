# Plano: identidade unificada no `lever-identity` (Cockpit + LeverAds)

> **Status (25/09/2026): diagnóstico feito e levantamento para concluir registrado (revisão 2, seção 7); execução não iniciada.** Branch `feat/auth`.
>
> **Escopo:** levar para o `lever-identity` (GoTrue + Postgres no Coolify da VPS2):
> - o **login** do Cockpit e do LeverAds;
> - o **vínculo de cada usuário a uma org (tenant)**, com o papel dele nela.
>
> A identidade passa a responder "quem é" e "de qual org, com qual papel". Tudo isso sai **no JWT** (`org_id`, `org_role`, `is_staff`), e os produtos confiam nesses claims.
>
> **Metas:** **downtime zero planejado** e **nenhum usuário perdido**. O LeverPrice entra depois, no mesmo molde (Fase 7).
>
> **Revisão 1 (21/09):** o tenant entrou no escopo. Antes, o GoTrue só autenticava e a org ficava em cada produto.
>
> **Revisão 2 (25/09):** levantamento do que falta para concluir a mudança **com RLS** (seção 7):
> - onde este plano e o `PLANO-PLATAFORMA-SUPABASE.md` divergiam, **vale este plano** (seção 7.1), e as decisões em aberto 1 e 2 ficam fechadas;
> - a revogação de sessão foi corrigida: o `logout` da admin API não derruba o access token já emitido, então a conferência claim × banco passa a ser permanente (seção 2.1 e decisão 7);
> - estado do código conferido, pré-requisitos externos, checklist por frente e duas decisões novas (identidade passa pelo dev antes de prod; mecanismo do RLS).
>
> **Relação com `PLANO-PLATAFORMA-SUPABASE.md`:** este plano é o recorte de identidade daquele (Fases 3, 4 e 6: GoTrue, `core.orgs`, `core.memberships`, `core.staff` e o hook de claims). Ele fica **desacoplado** do resto:
> - não depende da mudança do Levercopy para a VPS nova, do RLS por usuário, do `core_replica` nem do fim da service_role;
> - as permissões específicas de cada produto (seller no LeverAds, telas no Cockpit) e o paywall continuam no produto;
> - o resto da plataforma pode vir por cima sem refazer nada.

---

## 1. Diagnóstico

### 1.1 Serviço de identidade na VPS2 (conferido pela API do Coolify, só leitura, em 21/09)

| Item | Estado |
|---|---|
| Coolify | 4.3.23, projeto **"Lever Id"** (não "Supabase Lever", como diziam os outros planos), ambiente `production` |
| Serviço | `lever-identity`, **running:healthy**, criado em 18/09 |
| Containers | `supabase/gotrue:v2.186.0` (0,5 CPU/256 MB) · `kong:3.9.1` (0,5/512 MB) · `postgrest:v14.6` (0,5/256 MB) · `supabase/postgres:15.8.1.085` (2 CPU/2 GB, sem porta pública, `wal_level=logical`) |
| Domínio | `auth.leverads.com.br` configurado no Kong, mas **não existe no DNS** (NXDOMAIN) → sem certificado válido |
| JWT | **HS256 com segredo compartilhado** (mesmo segredo em GoTrue, PostgREST e Kong). JWKS publicado vazio (`{"keys":[]}`). Access token de 600 s, refresh com rotação |
| Cadastro | `DISABLE_SIGNUP=true`, `MAILER_AUTOCONFIRM=false`, só e-mail/senha, sem OAuth externo |
| MFA | TOTP (enroll + verify) **habilitado** |
| SMTP | **não configurado**: recuperação de senha, convite e magic link não saem |
| Redirects | `ADDITIONAL_REDIRECT_URLS` vazio |
| Hook / `core` | nenhum: sem custom access token hook, sem schema `core`; PostgREST só expõe `public` |
| Backup | nenhum configurado (LEV-499 pendente) |
| Usuários | não consultado; com cadastro fechado e sem SMTP, deve estar vazio |
| Código | não existe repo `lever-identity`; o compose só vive no Coolify |

**Leitura:** o GoTrue está de pé, mas é o template cru. Falta tudo o que faz dele um serviço de produção: domínio, TLS, SMTP, chaves assimétricas e backup. A vantagem é que **ainda está vazio**, então mudar a chave JWT ou o Postgres agora não custa nada.

### 1.2 Cockpit (este repo)

- **Usuários:** `cockpit.users` `(id, json)`. O `id` é um slug (`"eryk"`), **não tem e-mail** e não tem 2FA.
- **Hash:** `scrypt:<salt>:<hash>` do Node, **incompatível com o GoTrue** (`packages/api/src/auth.js:14-26`). O GoTrue importa bcrypt, argon2 e firebase-scrypt; o scrypt cru do Node não entra.
- **Sessão:** token hex de 64 caracteres em `cockpit.sessions`, TTL de 7 dias sem refresh (`auth.js:12,156`).
  - O SPA guarda o token em `localStorage.cockpit_key` e o envia como `x-api-key` (`packages/web/src/lib/api.js:11-35`); no SSE, vai como `?key=`.
  - Um 401 no meio da sessão não é tratado: o login só aparece no bootstrap (`main.jsx:48`).
- **Hook** (`auth.js:125-143`):
  1. **Sem `COCKPIT_API_KEY`, tudo fica aberto.**
  2. Quem envia a master key passa por tudo, inclusive pelas telas e pelo escopo de tickets.
  3. Sem master key, vale a sessão.
- **Master key com outros usos:** a `COCKPIT_API_KEY` também é salt do HMAC de descadastro e da prévia do blog (`disparos-util.js:8`, `routes.blog-public.js:49`). Rotacioná-la quebra links `/u/` já enviados.
- **Autorização:** fica toda no produto e continua lá:
  - `screens.js`: telas; `screens` vazio libera tudo;
  - `support-scope.js`: `supportSaas`;
  - a tag `admin` em `roles[]`.

  O `req.authUser` (91 usos em 21 arquivos) sai de um único `publicUser()` (`auth.js:62-84`). Por isso o adaptador de JWT é um ponto só.
- **Usuários padrão:** `DEFAULT_ADMINS` com senha `1234` são recriados se `users` estiver vazio (`auth.js:30-46`).
- **Cockpit → LeverAds:** `leverads-access.js:28-67` faz **login de super admin por senha** (`LEVERADS_ADMIN_EMAIL/PASSWORD`, `X-Auth-Token`) para `GET /api/super/orgs` e `PUT /api/super/orgs/:id`.
  - Não trata o desafio de MFA.
  - **Quebra na virada do LeverAds**, porque o `/api/auth/login` antigo deixa de existir.
- **MCP:** usa a master key (`packages/mcp/src/apiClient.js:13-18`). Fica fora deste plano.
- **Testes:** `test/auth.test.js`, `screens.test.js` e `leverads-access.test.js` (em memória, com `mem-repo.js`).

### 1.3 LeverAds (`C:\dev\LeverAds`, `origin/develop` 22626c0d)

- **Usuários:** `public.users`.
  - `id uuid` e `org_id` NOT NULL: **uma org por usuário, sem memberships**.
  - Papéis `admin|operator`, mais `is_super_admin`, flags por ferramenta e `user_permissions` por seller.
  - `active` e `deleted_at` (lápide com e-mail anonimizado).
- **E-mail:**
  - único por índice parcial, **sensível a maiúsculas**, e **pode ser nulo**;
  - o cadastro grava em minúsculas;
  - **o login não normaliza** (`app/routers/auth.py:912`, `.eq("email", req.email)`).
- **Hash:** bcrypt `$2b$12$` (`auth.py:31-35`), **importável direto** no GoTrue, que valida bcrypt pela lib do Go. **Ninguém precisa redefinir a senha.**
- **Não usa Supabase Auth em lugar nenhum.** O backend fala com o banco pela service_role.
- **Sessão:**
  - token `token_urlsafe(32)` **em texto puro** em `user_sessions`, TTL de 7 dias sem refresh;
  - o token vai no header `X-Auth-Token`;
  - o frontend o guarda em `localStorage['copy-auth-token']`, lido em 5 lugares (`useAuth.ts`, `lib/http.ts:20`, `ConnectChooser.tsx`, `MagicLinkLanding.tsx`, `ProdutosScreen.tsx:1057`);
  - cada processo guarda um cache de sessão de 30 s.
- **Fluxos próprios** (todos precisam de equivalente):
  - cadastro com Turnstile, throttle, trial e criação de org (`auth.py:1073`);
  - esqueci/redefinir senha por SMTP próprio (`auth.py:1304,1338`);
  - magic link, inclusive o super admin gerando para qualquer usuário (`magic_link.py`);
  - usuário criado por admin com senha provisória e `must_change_password`;
  - reset de senha em massa pelo super admin;
  - `PATCH /me` com troca de e-mail;
  - lápide.
- **TOTP:**
  - o segredo fica cifrado com Fernet em `users.totp_secret` (chave `TOKEN_ENCRYPTION_KEY` ou derivada da service_role);
  - recovery codes em SHA-256, anti-replay por `totp_last_counter`;
  - MFA **obrigatório** para super admin (env) e para admins de org com `orgs.mfa_required`.
- **Gate central:** `require_user` (`auth.py:297-384`). Todos os ~355 endpoints protegidos passam por ele.
  - Ele resolve sessão → usuário → `active` → permissões → `X-Super-Admin-Org` → gate de MFA.
  - O paywall (`require_active_org`) e os módulos vêm depois dele.
- **O que quebra com token de outro formato:**
  - `_TOKEN_PLAUSIVEL` em `app/services/entry_rate_limit.py:96`: um JWT tem pontos e mais de 128 caracteres, então cairia silenciosamente no rate limit só por IP;
  - o header fixo `X-Auth-Token`;
  - `Vary: X-Auth-Token` (`billing.py:1349`);
  - a redação de logs (`log_redaction.py:27`);
  - `session_token` na resposta do magic link;
  - o `{token}` que o Cockpit espera no login.
- **Webhooks e OAuth de marketplace** (ML, Shopee, MP, Stripe, TikTok) não usam sessão. **Não são afetados.**
- **Integrações com o Cockpit:**
  - Cockpit → LeverAds: `X-Cockpit-Key` só em `/api/proposta/generate`;
  - LeverAds → Cockpit: `x-api-key` com a master key do Cockpit em `/api/leads`.

  Nenhuma das duas depende do login.

### 1.4 Tenancy hoje

| | LeverAds | Cockpit | LeverPrice |
|---|---|---|---|
| Tenant | `public.orgs.id` (uuid) | não há tenant de login: é 1 tenant interno, e os clientes são `customers` separados por `saas` | `orgs.id` próprio, **ids diferentes** dos do LeverAds |
| Usuário ↔ org | coluna `users.org_id` NOT NULL: **1 org por usuário**, sem tabela de vínculo | não há (todo mundo é staff) | igual ao LeverAds, em outro banco |
| Papel na org | `users.role` `admin`/`operator`; o "dono" é implícito (`users.email = orgs.email`, `require_org_owner`, `auth.py:618`) | `roles[]` e `screens` (papéis de staff, não de tenant) | `admin`/`operator` |
| Staff global | `users.is_super_admin`, que mesmo assim fica preso a uma org via `org_id`; atua em outras orgs pelo `X-Super-Admin-Org` | todos os usuários | `admin-promote` por senha mestra |
| Vínculo entre produtos | — | `customer.leveradsOrgId`, casado por e-mail (`scripts/2026-09-12-vincular-org-leverads.mjs`) | nenhum |

**O que isso significa:**
- As identidades estão **separadas**: um staff do Cockpit que também usa o LeverAds tem duas contas e duas senhas.
- O único vínculo entre produtos é `customer.leveradsOrgId` (org, não usuário).
- O `id` do usuário LeverAds vira o `id` canônico em `auth.users`, e o `orgs.id` do LeverAds vira `core.orgs.id`, como já decidido no plano da plataforma. **Nenhuma FK do LeverAds é reescrita.**
- O modelo "1 org por usuário" é uma **limitação** do LeverAds, não uma regra de negócio. O `core` já nasce N:N (`memberships`), e cada produto continua enxergando 1 org ativa por vez.

---

## 2. Decisões de desenho

1. **A identidade responde "quem é" e "de qual org, com qual papel".**
   - O JWT leva:
     - quem é: `sub`, `email`, `aal`, `session_id`;
     - a org: `org_id` e `org_role`;
     - o staff: `is_staff` e `staff_roles`.
   - Isso vem de `core.orgs`, `core.memberships` e `core.staff`, pelo custom access token hook (seção 2.1).
   - **Continuam no produto:**
     - as permissões específicas: seller (`user_permissions`), flags de ferramenta, telas e `supportSaas` do Cockpit;
     - o paywall (`payment_active`, trial) e os dados de produto da org.
2. **Mesmos UUIDs:**
   - `auth.users.id = public.users.id` e `core.orgs.id = public.orgs.id` do LeverAds.
   - No Cockpit, `cockpit.users` ganha `authUserId`, e o `id` slug não muda (ele é autor e dono em todo o JSON).
   - `customer.leveradsOrgId` passa a se chamar `customer.orgId`. Como o id é o mesmo, a mudança é só de nome.
3. **O frontend fala direto com o GoTrue** (`@supabase/auth-js`: login, refresh, MFA, recuperação), e os backends só **validam** o JWT.
   - Se o login passasse pelo backend (BFF), todas as tentativas chegariam ao GoTrue com o IP do servidor, e o rate limit e o captcha do GoTrue deixariam de funcionar por usuário.
   - **Exceção:** o cadastro do LeverAds continua no backend, que cria o usuário no GoTrue pela admin API. Isso mantém Turnstile, throttle, trial, criação de org e o `DISABLE_SIGNUP=true` público.
4. **JWT assimétrico antes do primeiro consumidor.**
   - O GoTrue passa a assinar com ES256 (`GOTRUE_JWT_KEYS`), e os produtos validam pelo JWKS em cache, sem segredo compartilhado.
   - O HS256 atual fica no keyset só para validar as chaves `anon`/`service` do Kong.
   - É mais barato fazer isso agora, com zero usuários.
5. **Backend em modo dual durante a transição**, controlado por env (`AUTH_MODE=legacy|dual|gotrue`):
   - aceita a sessão antiga **ou** `Authorization: Bearer <jwt>`;
   - ninguém é deslogado, e as sessões antigas morrem sozinhas em até 7 dias.
6. **Fonte da verdade** das credenciais **e dos vínculos** (usuário, org, papel, staff):
   - antes da virada, o **legado**, com espelho contínuo para o GoTrue/`core`;
   - depois da virada, a **identidade**, com espelho reverso para o legado enquanto o rollback estiver aberto.

   Assim nenhuma troca de senha, de papel ou de org se perde em nenhum sentido.
7. **Os produtos conferem o claim contra o próprio banco, sempre** (revisão 2: antes valia só durante a transição).
   - Um `org_id` ou `org_role` do JWT diferente de `public.users`, ou um usuário `active=false`, é **negado e logado**.
   - Na transição, isso detecta divergência do espelho antes de ela virar acesso indevido.
   - Depois da virada, `public.users.org_id` e `role` continuam existindo (são FK e são usados em todo lugar), mas passam a ser **cópia** do `core`, gravada logo após a RPC `identity_api.*` (Fase 4). A conferência fica, porque é ela que fecha a janela do access token (seção 2.1, "Validade dos claims").
   - Custo zero: o `require_user` do LeverAds e o `publicUser()` do Cockpit já leem essa linha a cada requisição.

### 2.1 Modelo de tenancy na identidade

**Schema `core` no Postgres do `lever-identity`:**

| Tabela | Conteúdo | Origem na carga |
|---|---|---|
| `core.orgs` | `id`, `name`, `status` (`active`/`suspended`/`deleted`), `created_at` | `public.orgs` do LeverAds, mesmo id. Os campos de produto (billing, flags, `mfa_required`, trial) **ficam no LeverAds** |
| `core.memberships` | `(org_id, user_id)` PK, `role` (`owner`/`admin`/`member`), `created_at` | `users.org_id` + `users.role`: `admin` → `admin`, `operator` → `member`; o usuário cujo e-mail é `orgs.email` → `owner` |
| `core.profiles` | `user_id` (1:1 com `auth.users`), `name`, `active_org_id` | `users.username`/nome; `active_org_id` = a única org de hoje |
| `core.staff` | `user_id`, `roles[]` (`admin`, `support`, `leverads_super_admin`…) | `users.is_super_admin` do LeverAds + staff do Cockpit (a tag `admin` vira `roles`) |
| `core.org_products` | `(org_id, product)`, `status` | LeverAds para toda org importada. **Opcional nesta etapa** (decisão em aberto 5) |

**Org interna "Lever"** (UUID fixo): todo o staff tem membership nela. Isso dá ao staff um `org_id` válido sem prendê-lo a uma org de cliente, como o `is_super_admin` faz hoje.

**Hook** `private.custom_access_token_hook`, ligado por `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_*`:
- lê `profiles.active_org_id` e confirma que existe membership, além de ler `staff`;
- grava `org_id`, `org_role`, `is_staff` e `staff_roles` no token;
- **sem membership válida, o token sai sem `org_id`**, e os produtos negam, exceto nas rotas de onboarding.

**Troca de org ativa:**
- a RPC `identity_api.set_active_org(org_id)` exige membership;
- o frontend chama `refreshSession()` em seguida.

Hoje ninguém tem duas orgs, mas o modelo já aceita.

**Staff atuando em org de cliente:**
- o `X-Super-Admin-Org` continua, agora autorizado por `staff_roles` do JWT em vez de `is_super_admin`;
- o token não é trocado: o staff mantém a própria identidade, e a org alvo vem no header, auditada.

**Escrita pelos produtos** (cadastro cria org + owner, admin convida ou remove usuário, muda papel, super admin suspende org):
- o PostgREST da identidade expõe **só** o schema `identity_api`, com RPCs `SECURITY DEFINER`:
  - `create_org_with_owner`, `add_member`, `set_member_role`, `remove_member`, `set_org_status`, `set_staff`;
- as RPCs são concedidas à chave de serviço de cada produto;
- nada de acesso direto às tabelas `core`.

**Validade dos claims:**
- mudanças de papel e de org chegam ao token no próximo refresh (≤ 600 s);
- remover um membro ou suspender uma org também revoga as sessões do usuário no GoTrue (admin API `logout`). **Isso só invalida o refresh token**: o access token já emitido continua válido até expirar (≤ 600 s), porque os backends validam localmente pelo JWKS;
- o efeito imediato vem da conferência contra o banco do produto (decisão 7), que é **permanente**, não só da transição. A cópia local (`public.users`, `cockpit.users`) é atualizada na mesma operação que chama a RPC da identidade;
- uma lista de sessões revogadas (`core.revoked_sessions` replicada, do `PLANO-PLATAFORMA-SUPABASE.md`) só entra junto com o `core_replica` e o RLS.

---

## 3. Fases

### Fase 0: identidade pronta para produção (sem nenhum consumidor)
- **Repo `lever-identity`:**
  - compose exportado do Coolify (sem segredos);
  - scripts de carga e sincronização;
  - `docker-compose.local.yml` com o **mesmo** `gotrue:v2.186.0` + Postgres, para testar tudo localmente (não há `identity-dev` ainda).
- **DNS e TLS:** `auth.leverads.com.br` → 82.112.245.65, certificado Let's Encrypt pelo Coolify.
- **Chaves:** gerar o par ES256, configurar `GOTRUE_JWT_KEYS`, conferir que `/.well-known/jwks.json` publica a chave pública. A privada vai para o cofre.
- **SMTP:** o mesmo provedor que o LeverAds usa hoje (remetente e domínio já aquecidos).
  - Templates em PT-BR para recuperação, magic link, convite e troca de e-mail.
  - `GOTRUE_SITE_URL` e `ADDITIONAL_REDIRECT_URLS` com os hosts de LeverAds e Cockpit (e os `dev.` depois).
- **Proteções:**
  - captcha Turnstile no GoTrue (`GOTRUE_SECURITY_CAPTCHA_*`), com a mesma conta do LeverAds;
  - limites de e-mail, token e verify;
  - `GOTRUE_RATE_LIMIT_HEADER` com o IP real vindo do Traefik/Kong. Conferir que não é o IP do Kong.
- **Sessão:** `GOTRUE_SESSIONS_TIMEBOX`/`INACTIVITY_TIMEOUT` perto dos 7 dias atuais, para o comportamento visível não mudar. O access token continua com 600 s.
- **Backup (obrigatório antes de carregar usuário real):**
  - dump diário e WAL em storage de **outro provedor**;
  - restore testado;
  - segredos (chave JWT, senha do Postgres, service key) no cofre.
- **Postgres:** decidir agora se sobe de 15.8 para a 17 usada nos outros bancos. Com o banco vazio, isso é recriar o volume.
- **Tenancy** (migrations versionadas no repo `lever-identity`, com ledger próprio):
  - os schemas `core`, `private` e `identity_api` da seção 2.1;
  - o hook `private.custom_access_token_hook`, com grant só para `supabase_auth_admin`;
  - `PGRST_DB_SCHEMAS=identity_api`;
  - uma chave de serviço por produto, com grant só nas RPCs de que cada um precisa;
  - a org interna "Lever".
- **Testes do `core` (pgTAP no compose local):**
  - o hook emite `org_id` e `org_role` corretos;
  - um usuário sem membership sai sem `org_id`;
  - `set_active_org` recusa uma org da qual o usuário não é membro;
  - uma chave de produto não chama RPC de outro;
  - `anon` não alcança nada.
- **Levantamento em produção** (consultas só de leitura, rodadas por quem tem acesso; nenhum dado sai do banco):
  - LeverAds:
    - total de usuários por `active` e por `deleted_at`;
    - `email IS NULL`;
    - colisões de `lower(email)`;
    - prefixos de `password_hash` (esperado: 100% `$2b$`);
    - usuários com `totp_enabled`;
    - super admins;
    - orgs por status, com e sem usuário;
    - usuários apontando para org inexistente ou apagada;
    - orgs sem `orgs.email` casando com algum usuário (ficam sem `owner`);
    - orgs com mais de um candidato a owner;
    - duplicatas óbvias de org (mesmo e-mail ou CNPJ em mais de uma org).
  - Cockpit:
    - lista de `cockpit.users` e o e-mail de cada staff;
    - quais já têm conta no LeverAds com o mesmo e-mail;
    - `customers` com e sem `leveradsOrgId`, e ids que não existem mais em `public.orgs`.
- **Pronto quando:** `https://auth.leverads.com.br/auth/v1/health` (com apikey) responde com TLS válido; o JWKS tem a chave ES256; um e-mail de recuperação chega; o restore do backup foi testado.

### Fase 1: carga e espelho contínuo LeverAds → identidade (ninguém usa o GoTrue ainda)
- **Ordem da carga:** orgs → usuários → profiles → memberships → staff.
  - Com essa ordem, nenhuma FK do `core` fica pendurada.
  - Cada etapa é um upsert idempotente por id.
- **Orgs:**
  - `public.orgs` → `core.orgs` com o mesmo `id`;
  - status `active`, ou `suspended` se `orgs.active=false`;
  - orgs sem nenhum usuário entram assim mesmo, porque podem ter cobrança ou dados.
- **Memberships:**
  - uma por usuário, a partir de `users.org_id` + `users.role`;
  - o owner é quem tem `email = orgs.email`;
  - as orgs sem owner (lista da Fase 0) ficam com o admin mais antigo como owner, **com revisão manual antes da carga**.
- **Staff:**
  - `is_super_admin` → `core.staff` com `leverads_super_admin`, mais membership na org "Lever";
  - a membership original na org do cliente é **mantida**, para preservar o comportamento de hoje.
- **Script idempotente de usuários** (`lever-identity/scripts/sync-leverads-users`):
  - lê `public.users` e faz upsert em `auth.users` pela admin API com `id`, `email` em minúsculas, `password_hash` (`$2b$…`) e `email_confirm: true`, porque o LeverAds nunca exigiu confirmação;
  - guarda `app_metadata.source = 'leverads'`;
  - se a admin API não aceitar `id` ou `password_hash` na atualização, escreve direto em `auth.users` pela rede interna do Coolify (validar no compose local).
- **Regras da carga:**
  - `deleted_at` preenchido: **não importa**, ou remove se já existir;
  - `active=false`: importa mesmo assim, porque quem bloqueia é o `require_user` do produto;
  - sem e-mail: fica numa lista de pendências, porque essa conta já não consegue logar hoje;
  - colisão de `lower(email)`: lista para decisão manual, sem fusão automática.
- **Espelho:**
  - **dual-write** nos pontos que mudam credencial **ou vínculo** no LeverAds:
    - cadastro (org + owner);
    - redefinir e trocar senha;
    - criação e edição de usuário por admin (papel);
    - reset em massa;
    - `PATCH /me` (e-mail);
    - lápide;
    - `PUT /api/super/orgs/:id` (ativar/suspender);
    - liga/desliga `is_super_admin`.
  - **reconciliação a cada 5 min** como rede de segurança, comparando usuários (`id`, `email`, hash, lápide), orgs (`id`, status) e memberships (`org_id`, `role`).
  - Resultado: a identidade fica sempre igual ao legado, **sem congelar cadastro, troca de senha ou mudança de papel na virada**.
- **TOTP:** o script decifra `totp_secret` com a `TOKEN_ENCRYPTION_KEY` e cria o fator verificado em `auth.mfa_factors`. Assim **ninguém recadastra o autenticador**.
  - Validar no compose local que o GoTrue v2.186 aceita o fator importado (SHA1, 6 dígitos, 30 s, como o `pyotp`).
  - Se não aceitar, o fallback é recadastro guiado, com prazo antes de ficar obrigatório.
  - Os recovery codes não têm equivalente no GoTrue: o reset de MFA passa a ser feito pelo super admin via admin API (apaga o fator).
- **Correção prévia no LeverAds:** o login passa a usar `lower(email)`, o que já vale mesmo sem GoTrue.
- **Pronto quando:**
  - as contagens batem (usuários, orgs, memberships por papel, staff);
  - uma amostra de contas internas faz login pelo `/auth/v1/token` com a senha de sempre e recebe no JWT o `org_id` e o `org_role` iguais aos de `public.users`;
  - a reconciliação roda sem diferença por 48 h.

### Fase 2: backends aceitam JWT (dormente em produção)
- **LeverAds:**
  - `require_user` passa a aceitar `Authorization: Bearer`, validado pelo JWKS em cache (`iss`, `exp`, `aud`), com `sub` → `public.users.id`.
  - A **org vem do claim `org_id`**, e o papel de `org_role` (`owner`/`admin` → `admin`; `member` → `operator`).
    - Os dois são conferidos contra `public.users` (em qualquer modo, não só no dual); divergência é negada e logada (decisão 7).
    - `require_org_owner` passa a usar `org_role = owner` em vez da comparação de e-mail.
  - O `X-Super-Admin-Org` passa a ser autorizado por `staff_roles` contendo `leverads_super_admin`.
  - `active`, `user_permissions`, módulos e paywall ficam **iguais**, lidos do banco do LeverAds.
  - O gate de MFA lê `aal` do JWT: se a política exige MFA e o token é `aal1`, a API devolve o mesmo 403 com `X-Mfa-Enrollment-Required` ou um desafio.
  - Ajustes de formato:
    - `_TOKEN_PLAUSIVEL` e a chave do rate limit passam a usar o `session_id` do JWT;
    - `Vary` e a redação de logs incluem `Authorization`;
    - o cache de sessão é chaveado por `session_id`.
- **Cockpit:**
  - `makeAuthHook` aceita o Bearer JWT, resolvido pelo `authUserId` → `publicUser()` de sempre;
  - exige `is_staff` e `org_id` da org "Lever". Um cliente com JWT válido **não entra** no Cockpit (até existir o portal);
  - o `?key=` do SSE passa a aceitar o JWT;
  - a master key continua como está (é do MCP e das integrações, não do login).
- **Cockpit → LeverAds sem senha:** o `leverads-access.js` troca o login de super admin por uma **chave de serviço** própria, aceita só em `GET /api/super/orgs` e `PUT /api/super/orgs/:id`, com `compare_digest` e auditoria. Ele precisa estar resolvido **antes** da Fase 4.
- **Deploy:** com `AUTH_MODE=dual` em produção, nada muda para ninguém, porque nenhum frontend emite JWT ainda.
- **Testes:**
  - JWT válido, expirado, de outra chave e sem `sub` conhecido;
  - `aal1` em conta com MFA obrigatório;
  - `X-Super-Admin-Org` com JWT;
  - no Cockpit, o in-memory de `auth.test.js`/`screens.test.js` com um JWKS de teste.

### Fase 3: piloto no Cockpit (interno, poucos usuários)
- **Vínculo:** cada staff recebe um e-mail.
  - Se o e-mail já existe no GoTrue (conta LeverAds), o `authUserId` aponta para ela: **uma pessoa, uma conta**, com a senha do LeverAds.
  - Se não existe, o staff é criado no GoTrue.
- **Senha sem reset, por migração no login** (o scrypt não é importável):
  - durante o modo dual, o login antigo do Cockpit, ao validar o scrypt, define essa mesma senha no GoTrue pela admin API. Isso vale **só** para contas criadas pelo Cockpit, nunca sobrescrevendo senha de conta LeverAds;
  - quem não logar na janela recebe o e-mail de definir senha.
- **SPA:**
  - login e refresh via `auth-js`;
  - o token vai em `Authorization: Bearer`;
  - tratamento global de 401 (tenta refresh, senão volta ao login);
  - a UI de MFA fica opcional para staff.
- **Tenancy no Cockpit:**
  - todo staff vira `core.staff` + membership na org "Lever" (papel `admin` para a tag `admin`, `member` para os demais);
  - `screens` e `supportSaas` continuam em `cockpit.users`;
  - `customer.leveradsOrgId` → `customer.orgId`, validado contra `core.orgs`. Os ids órfãos da Fase 0 são corrigidos antes;
  - clientes sem org (outros SaaS ou leads) ficam sem `orgId` até precisarem de login (portal);
  - a partir daqui, o Cockpit escreve o status da org em `identity_api.set_org_status`, além da chamada de serviço ao LeverAds.
- **Remover** `DEFAULT_ADMINS`/`1234` e o `POST /api/auth/password` com mínimo de 4 caracteres.
- **Pronto quando:** todo o staff entra pelo GoTrue e nenhuma sessão antiga é usada há 7 dias. Aí o Cockpit vai para `AUTH_MODE=gotrue` e o login antigo sai.

### Fase 4: virada do LeverAds
- **Frontend** atrás de flag (`VITE_AUTH_PROVIDER=gotrue`):
  - login, refresh, MFA (`challenge`/`verify`), esqueci/redefinir senha e magic link pelo `auth-js`;
  - leitura do token centralizada (acabam os 5 acessos diretos ao `localStorage`);
  - o cadastro chama o backend, que cria no GoTrue e devolve a sessão.
- **Backend:**
  - criação por admin, reset em massa e "gerar magic link" do super admin passam a usar a admin API (`generate_link`);
  - `must_change_password` continua no `public.users`;
  - o cadastro chama `identity_api.create_org_with_owner` e depois cria `public.orgs`/`public.users` com os mesmos ids;
  - gestão de usuários da org (adicionar, mudar papel, remover) e suspender org passam pelas RPCs `identity_api.*` primeiro e só então gravam no banco local.
- **Ensaio em produção antes da virada:** a flag por query/allowlist liga o login novo só para contas internas, com usuários reais do legado e senha de sempre.
- **Virada:**
  1. deploy do frontend com a flag ligada, **sem janela**;
  2. usuários logados continuam com a sessão antiga;
  3. novos logins saem do GoTrue;
  4. a direção do espelho inverte: identidade → LeverAds (hash bcrypt, e-mail, fatores, `org_id`, papel, status da org, super admin), mantendo o legado pronto para rollback.
- **Rollback:** desligar a flag. O legado tem os mesmos usuários e senhas, graças ao espelho reverso, e só as sessões GoTrue são perdidas (novo login). Gatilhos definidos antes:
  - taxa de 401/403 acima do normal;
  - falhas no `/auth/v1/token`;
  - reclamação de MFA.
- **Comunicação:** nada muda para o cliente (mesma senha e mesmo autenticador). Aviso só se o TOTP precisar de recadastro.

### Fase 5: desligamento do legado (depois de pelo menos 7 dias sem uso de sessão antiga)
- **Sai do código:** `AUTH_MODE=gotrue` nos dois. No LeverAds saem `/api/auth/login`, `/api/mfa/*`, `/api/magic-link/*` e as rotas antigas de senha; no Cockpit sai o login por scrypt.
- **Somente leitura por 30 dias, depois removidas:**
  - no LeverAds: `user_sessions`, `magic_links`, `password_reset_tokens`, `mfa_challenges`, as colunas `totp_*`, `password_hash`;
  - no Cockpit: `sessions` e `passwordHash`.
- **Credenciais aposentadas:** `LEVERADS_ADMIN_EMAIL`/`PASSWORD` do Cockpit e o espelho reverso.
- **Documentação:** `docs/CONTEXTO-COCKPIT.md`, `AUTH-SECURITY.md` e `mfa-politica.md` do LeverAds, e a matriz de autorização.

### Fase 6: standby e observabilidade da identidade
- Réplica standby com failover ensaiado (LEV-499).
- Alarme de saúde e de latência do `/auth/v1/token`.
- Cenário de falha documentado: sessões ativas continuam, porque os backends validam localmente pelo JWKS; login e refresh param.

### Fase 7 (fora deste plano, na ordem)
1. **LeverPrice no mesmo molde:**
   - usuários casados por e-mail (`legacy_user_map`);
   - as orgs dele têm **ids próprios**: a `orgs` local ganha `core_org_id`, e não se reescreve id;
   - `org_products` passa a dizer quais orgs têm LeverPrice;
   - app iOS.
2. **Réplica de `core` nos bancos de produto** (`core_replica`) e RLS/BFF do `PLANO-PLATAFORMA-SUPABASE.md`.
3. **Portal do cliente:** as memberships já dão ao cliente acesso aos tickets da própria org. Chaves de integração vêm junto.
4. **Mais de uma org por usuário na UI do LeverAds:** seletor de org + `set_active_org`. O modelo já suporta.

---

## 4. Downtime e perda de usuários

| Risco | Como é evitado |
|---|---|
| Janela de indisponibilidade | Nenhuma prevista: cada passo é deploy com restart normal, e o modo dual aceita os dois tokens |
| Deslogar todo mundo | Sessões antigas valem até expirar (≤ 7 dias) |
| Usuário LeverAds sem acesso | Mesmo UUID + mesmo hash bcrypt + e-mail confirmado; reconciliação a cada 5 min |
| Troca de senha perdida na virada | Dual-write antes, espelho reverso depois; não há congelamento |
| Staff do Cockpit sem senha | Migração no login + e-mail de definir senha para o resto |
| MFA perdido | Importação dos fatores TOTP (fallback: recadastro com prazo) |
| E-mails com maiúsculas ou nulos | Levantados na Fase 0 e corrigidos antes da carga |
| Usuário cair na org errada ou perder o papel | Mesmo `org_id`; carga validada por contagem de memberships por papel; conferência claim × banco permanente (decisão 7) |
| Org sem dono | Lista da Fase 0 revisada à mão antes da carga |
| Papel ou org desatualizado no token | Revogar sessões ao remover membro ou suspender org; o refresh (≤ 600 s) cobre o resto |
| Cockpit perder a liberação de acesso no LeverAds | Chave de serviço antes da Fase 4 |
| Identidade fora do ar | Sessões continuam valendo; backup e standby nas Fases 0 e 6 |

**Reset de senha só em dois casos:** o staff do Cockpit que não logar durante a janela, e a conta sem e-mail.

## 5. Decisões em aberto
1. ~~**Staff do Cockpit:** migração no login ou convite de redefinição.~~ **Fechada (revisão 2):** migração no login, com convite só para quem não logar na janela.
2. ~~**TOTP:** importar os fatores ou pedir recadastro.~~ **Fechada (revisão 2):** importar os fatores; recadastro com prazo só se o teste local com o GoTrue v2.186 falhar.
3. **Postgres da identidade:** ~~subir para a 17 ou manter a 15.8.~~ **Adotada a 17 no repo local** (25/09), a mesma imagem da VPS1 e do dev; o serviço do Coolify (15.8, vazio) é recriado na substituição.
4. **Onde roda a reconciliação:** job no Coolify da VPS2 (perto do banco da identidade) ou no worker do LeverAds.
5. **`core.org_products` agora ou só com o LeverPrice:** tabela criada na primeira migration (25/09), sem claim no JWT; `create_org_with_owner` aceita o produto.
6. **Papéis de org:** `owner`/`admin`/`member` no `core`, com `operator` = `member` no LeverAds. Alternativa: manter os nomes do LeverAds no `core`.
7. **Super admin do LeverAds:** manter a membership na org do cliente de origem (recomendado, é o comportamento de hoje) ou deixá-lo só na org "Lever".
8. **(nova, revisão 2) A identidade passa pelo dev antes de prod?** O `PLANO-AMBIENTE-DEV.md` exige S1/S2 prontas antes da identidade ir a prod; este plano testa só no compose local. Opções: `identity-dev` na VPS2 (etapa 5 do `PLANO-DEV-INTERINO-VPS2.md`) antes da Fase 1, ou compose local + ensaio com contas internas em prod (Fase 4) como está.
9. **(nova, revisão 2) Mecanismo do RLS** (seção 7.5): esperar a mudança do Levercopy para a VPS (PostgREST com JWKS) ou começar já com o backend aplicando `SET LOCAL role` + `request.jwt.claims` na conexão `pg`/asyncpg.

## 6. Correções nos outros planos
- `PLANO-PLATAFORMA-SUPABASE.md` e `PLANO-DEV-INTERINO-VPS2.md`:
  - o projeto no Coolify se chama **"Lever Id"**;
  - o Coolify está na 4.3.23;
  - o `lever-identity` está no ar, mas com HS256, sem DNS, sem SMTP e sem backup.
- `PLANO-PLATAFORMA-SUPABASE.md` (revisão 7): nos pontos da seção 7.1, vale este plano.

---

## 7. Revisão 2: o que falta para concluir, com RLS (25/09)

Este plano entrega a identidade (login, org, papel, staff). O **RLS** está nas Fases 4 a 6 do `PLANO-PLATAFORMA-SUPABASE.md`. Concluir a mudança exige três frentes em sequência:
1. **Identidade:** Fases 0 a 5 deste plano.
2. **Dev:** `PLANO-AMBIENTE-DEV.md` S0–S2 ou a versão interina na VPS2 (decisão 8).
3. **RLS:** Cockpit primeiro, depois LeverAds módulo a módulo (seção 7.5, decisão 9).

### 7.1 Divergências com o plano da plataforma: vale este plano

| Tema | Vale (este plano) | Substitui (plataforma) |
|---|---|---|
| Senha do staff do Cockpit | migração no login (Fase 3) | convite de redefinição para todos |
| TOTP do LeverAds | importar o fator (Fase 1) | recadastro no primeiro login |
| Telas e `supportSaas` | ficam em `cockpit.users` | `core.staff.screens[]`/`support_products[]` |
| Staff em org de cliente | `X-Super-Admin-Org` autorizado por `staff_roles` | `x-act-org` + impersonação com `act` (fica para depois do RLS) |
| Carga de usuários | dual-write + reconciliação, sem congelar | delta com cadastro e troca de senha pausados |
| Org no Cockpit | `customer.leveradsOrgId` → `customer.orgId` (mesmo id) | coluna `core_org_id` |
| Claims no JWT | `org_id`, `org_role`, `is_staff`, `staff_roles` | também `products` e `aud` por produto (ficam para o LeverPrice/RLS) |

### 7.2 Estado conferido no código (25/09)

| Item | Estado |
|---|---|
| Cockpit: `DEFAULT_ADMINS` com `1234` | **existe** (`auth.js:30`) |
| Cockpit: sem `COCKPIT_API_KEY` a API fica aberta | **vale** (`auth.js:127`) |
| Cockpit: CORS | **aberto** (`origin: true`, `index.js:95`) |
| Cockpit: `APP_ENV`, `JOBS_ENABLED` | não existem |
| Cockpit: validação de JWT, `authUserId` | nada |
| Cockpit: `leverads-access.js` | login de super admin por senha (`X-Auth-Token`) |
| Cockpit: acesso ao banco | `pg` direto como superusuário, mais `LEVERCOPY_DB_URL`/`ELO_DB_URL` (`db.js`, `leverads-results.js`, `elo.js`) |
| SPA | `cockpit_key` via `x-api-key`, sem tratamento global de 401 |
| LeverAds: login com `lower(email)` | **não** (`auth.py`, `.eq("email", req.email)`) |
| LeverAds: `TOKEN_ENCRYPTION_KEY` | **parcial**: o envelope v2 (LEV-196) exige a chave explícita; o v1 (sellers ML/Shopee) ainda cai na chave derivada da service_role |
| LeverAds: ledger de migrations / policies | sem ledger (LEV-439), 89 espelhos `staging_*`, **0 policies** |

A cópia local do LeverAds conferida estava em v2.31.0, atrás da `origin/develop` (v2.34.1): reconferir os itens do LeverAds contra a `origin` antes de começar.

### 7.3 Pré-requisitos fora do código (bloqueiam a Fase 0)
- **DNS** de `auth.leverads.com.br` (e `dev.auth.leverads.com.br` se a decisão 8 for pelo dev).
- **SMTP** da identidade: credenciais do provedor que o LeverAds já usa.
- **Backup externo** do `lever-identity` com restore testado (LEV-499). Sem ele, nenhum usuário real é carregado.
- **Cofre** para a chave ES256, a senha do Postgres, as chaves de serviço por produto e a `TOKEN_ENCRYPTION_KEY`.
- **Token de escrita da API do Coolify** da VPS2; SSH uma vez, se o dev interino for usado.
- **Consultas do levantamento** da Fase 0 rodadas em produção por quem tem acesso.
- **Repo `lever-identity`** criado.

### 7.4 Checklist por frente

**A. Identidade (`lever-identity`)**
- [x] Repo local `C:\dev\lever-identity` (25/09, sem remoto ainda): compose local com `gotrue:v2.186.0`, Postgres 17 (`supabase/postgres:17.6.1.136`), PostgREST v14.6 só com `identity_api`, Mailpit e dbmate.
- [x] Par ES256 em `GOTRUE_JWT_KEYS`; o JWKS publica só a chave pública, e as chaves HS256 de papel seguem aceitas no GoTrue e no PostgREST.
- [x] Migration `core`, `private`, `identity_api`, hook, org "Lever" (id fixo `00000000-0000-4000-8000-00000000000a`), papéis `svc_leverads`/`svc_cockpit` com grants por RPC.
- [x] pgTAP (29 testes) e smoke de ponta a ponta verdes.
- [ ] Teste local do fator TOTP importado (fecha a decisão 2).
- [x] Admin API aceita `id` escolhido e importa hash bcrypt `$2b$`; o usuário loga com a senha antiga (smoke). Falta testar a **atualização** (upsert) de hash e e-mail, que a reconciliação usa.
- [ ] Compose de produção com Kong e substituição do serviço manual do Coolify.
- [ ] Scripts de carga e reconciliação (decisão 4).
- [ ] Produção: DNS, TLS, SMTP, templates PT-BR, captcha, rate limit por IP real, backup.

**B. Cockpit (este repo)**
- [x] Contenção (25/09, branch `feat/auth`): `DEFAULT_ADMINS`/`1234` substituído por `BOOTSTRAP_ADMIN_USER`/`PASSWORD`; API fechada sem `COCKPIT_API_KEY`; CORS restrito fora das rotas abertas (`cors-policy.js`); `APP_ENV` com trava de destino de prod (`app-env.js`); `JOBS_ENABLED`/`JOBS=`; senha nova com 8+ caracteres em criar, resetar e trocar.
- [x] Gestão do time só com a etiqueta `admin` (25/09): escrita em `/api/auth/users` (criar, editar papel/telas/nível, resetar senha, remover) barrada no `screens.js`; a key mestre continua passando; Ajustes → Equipe fica só leitura para os demais.
- [x] `AUTH_MODE=legacy|dual|gotrue` no `makeAuthHook` (25/09, `auth-jwt.js`): JWT ES256 pelo JWKS em cache (rotação de `kid` com anti-enxurrada), só staff da org Lever com `authUserId` ligado em `cockpit.users`; SSE aceita o JWT; troca de senha de conta da identidade recusada no cockpit. Validado de ponta a ponta com o `lever-identity` local e o banco local do Docker (login novo e antigo lado a lado; cliente barrado).
- [x] Testes com JWKS de teste (`test/auth-jwt.test.js`, 9 casos).
- [ ] Chave de serviço Cockpit → LeverAds no `leverads-access.js` (**antes da Fase 4**).
- [x] SPA (25/09): `@supabase/auth-js` com `VITE_AUTH_URL` (`lib/identity.js`); login por e-mail da conta Lever com opção do login antigo; `Authorization: Bearer`; renovação automática e antes da requisição se o token venceu; 401 global (renova uma vez, senão volta ao login); SSE reabre com o token atual; troca de senha e sair pelo GoTrue. Validado no navegador (Playwright) contra o `lever-identity` e o banco local.
- [x] Vínculo e migração de senha (26/09): Ajustes → Equipe → "Lever" liga pelo e-mail (`POST /api/auth/users/:id/identity`; reusa a conta existente, senão cria com `app_metadata.password_pending`); o login antigo leva a mesma senha à conta Lever só se ela ainda não tem senha própria (gatilho no `lever-identity` apaga a marca na primeira troca); etiquetas → staff `team`/`admin`/`support`; remover ou desligar tira o staff. Validado de ponta a ponta com o GoTrue local.
- [x] E-mail de definir senha (26/09): admin dispara em Ajustes → Equipe → Lever (`POST /api/auth/users/:id/identity/password-email`, recovery do GoTrue com volta ao cockpit); "esqueci minha senha" no login da conta Lever; tela de definir senha a partir do link (token sai da barra na hora; link usado/expirado avisa). A senha escolhida pela pessoa não é sobrescrita pela migração. Validado no navegador com o e-mail real pelo Mailpit.
- [ ] `leveradsOrgId` → `orgId` (órfãos corrigidos antes).
- [ ] Atualizar `docs/CONTEXTO-COCKPIT.md` a cada mudança de auth.

**C. LeverAds**
- [ ] Login com `lower(email)` (independe do resto).
- [ ] `TOKEN_ENCRYPTION_KEY` também no envelope v1, com recifragem em lotes.
- [ ] Dual-write nos 8 pontos da Fase 1.
- [ ] `require_user` com Bearer JWT e os ajustes de formato (`_TOKEN_PLAUSIVEL`, `Vary`, redação de logs, cache por `session_id`).
- [ ] Endpoint de serviço para o Cockpit (`GET/PUT /api/super/orgs`).
- [ ] Frontend atrás de `VITE_AUTH_PROVIDER`, leitura do token centralizada.
- [ ] Espelho reverso após a virada.
- [ ] Ledger de migrations (LEV-439), pré-requisito do RLS.

**D. RLS** (seção 7.5)
- [ ] Helpers `private.is_member`, `private.is_staff`, `private.can_access_seller`.
- [ ] `ENABLE` + `FORCE ROW LEVEL SECURITY`, grants explícitos, default privileges revogados.
- [ ] Papel de app sem `BYPASSRLS` no lugar do superusuário; papéis `svc_*` para workers e jobs.
- [ ] Cockpit: colunas geradas (`saas`, `org_id`, `assignee`) nas tabelas `(id, json)`; policies de staff em `public` e `cockpit`; usuário de org não alcança `cockpit`.
- [ ] LeverAds: módulo a módulo guiado pela `docs/seguranca/matriz-autorizacao.yaml`; `tests/isolation/` com RLS.
- [ ] pgTAP de isolamento (org A × org B, staff, `anon`, `svc_*`, aal1/aal2).

### 7.5 Mecanismo do RLS (decisão 9)
O plano da plataforma valida o JWT no banco pelo PostgREST com o JWKS da identidade e usa `core_replica` por replicação lógica. Isso depende do `levercopy` fora do Supabase Cloud (Fase 2 da plataforma), porque:
- **a confirmar:** o Cloud aceita JWT de terceiros só de provedores listados, não um JWKS arbitrário;
- **a confirmar:** criar uma subscription no Cloud apontando para o Postgres da identidade.

**Alternativa que destrava antes da mudança:** o backend valida o JWT (já faz, Fase 2 deste plano) e, em cada transação, aplica `SET LOCAL role <papel_da_app>` + `set_config('request.jwt.claims', <claims>, true)`. As policies leem `auth.jwt()`/`current_setting`, então funcionam igual no Cloud e na VPS, e migram para o PostgREST depois sem reescrever policy. Para o Cockpit, que usa `pg` direto, isso evita reescrever o `repo.*` para postgrest-js. Sem `core_replica`, os helpers usam o caminho rápido pelos claims mais a cópia local (`public.users`), como na decisão 7.

### 7.6 Ordem proposta
1. **Já, sem dependência externa:** contenção do Cockpit (B, primeiro item); `lower(email)` e `TOKEN_ENCRYPTION_KEY` v1 no LeverAds; repo `lever-identity` com compose local, `core`, hook e pgTAP.
2. **Em paralelo, infra:** pré-requisitos da seção 7.3.
3. Fases 1 a 3 deste plano: carga, backends em modo dual (dormente), piloto no Cockpit.
4. Fase 4 (virada do LeverAds) e Fase 5 (desligamento do legado).
5. RLS: Cockpit, depois LeverAds, pelo mecanismo da decisão 9.
