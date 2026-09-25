# Plano: ambiente de dev para Cockpit, LeverAds e LeverPrice

> **Status (18/09/2026): planejado, não iniciado.** Abrange Cockpit (este repo), LeverAds (`C:\dev\LeverAds`) e LeverPrice (`C:\dev\Leverprice`). Complementa o `PLANO-PLATAFORMA-SUPABASE.md`, que prevê `prod` e um ambiente não-prod para os três produtos e para a identidade, mas não dizia como esse ambiente nasce. **Ele se chama `dev`** (revisão 6 daquele plano; não haverá um staging separado).
>
> **Decisões do pedido:**
> - o ambiente novo é o **dev**, que hoje não existe em nenhum dos três;
> - os dados são **só sintéticos**: nenhum dado de cliente nem token de marketplace sai de produção.
>
> **Topologia de produção considerada (revisão de 18/09):**
> - **Cockpit e LeverAds compartilham o banco `levercopy`** (Supabase auto-hospedado). O Cockpit é o backoffice: guarda os dados dele no schema `cockpit` e tem acesso a **tudo** no banco do Levercopy, não só ao `public`. Não existe banco nem VPS separados para o Cockpit.
> - **A VPS nova do Supabase auto-hospedado recebe todo o Levercopy** migrado do Cloud: o banco e também as apps `copylever` (API LeverAds), `leveradswk` (worker LeverAds) e o Cockpit (api + web + mcp).
> - **A VPS do Easypanel** fica livre para backups e apps auxiliares.
> - Registrado também no `PLANO-PLATAFORMA-SUPABASE.md` (revisão 5).

## Contexto: como é hoje

Os três só têm **produção**. O desenvolvimento local existe, em níveis diferentes de isolamento:

| | Cockpit | LeverAds | LeverPrice |
|---|---|---|---|
| Local | `infra/local/docker-compose.yml` (Postgres + Studio); API/web/MCP na máquina | sem compose de app; só `docker-compose.test.yml` (bancada de testes) | `scripts/lp-dev.py` + `dev/docker-compose.yml` (Postgres, PostgREST, Redis, **fakeml**, API, worker) |
| `.env` local aponta para prod? | banco local, mas `LINEAR_API_KEY` real e URLs de LeverAds de produção | **sim**: `SUPABASE_URL`/`DB_ASYNC_DSN` do projeto `hsoolj…` e chaves reais de ML, Shopee, MP, Stripe, Telegram | não (sem `.env`); o `.mcp.json` dá SQL irrestrito ao banco da VPS1 |
| Dev | nenhum | `docs/STAGING-SETUP.md` marcado **NÃO OPERACIONAL** (schema `levercopy_staging` nunca existiu); decisão #199: projeto/instância separada | nenhum; `develop` é só branch |
| Deploy | push em `main` → EasyPanel (`Dockerfile.allinone`), sem CI | CI verde em `main` → `scripts/publica.py` → Easypanel | manual (`lp-worker-go-deploy.sh`, receita em `docs/ops/producao.md` §5) |
| Migrations | `ensureSchema` + ~60 `runStartupMigrations` no boot | SQL manual, sem ledger (LEV-439), 89 espelhos `staging_NNN` defasados | `lp-migrate` com ledger `schema_migrations`, como `supabase_admin` |
| Seed | `seedAll()` + `DEFAULT_ADMINS` | nenhum | `lp-dev.py seed` (`e2e@leverprice.test`) |

**O que torna um ambiente de dev perigoso hoje** (tudo precisa ser resolvido antes de subir apps):
- **Cockpit:** todos os jobs sobem no boot e disparam se houver credencial ou dado no banco: WhatsApp (SDR, cadência, NPS), Gmail (drip, relatórios), Meta (`startAdDelivery` pausa anúncios reais), Mercado Pago (billing/dunning), Linear, Shopify, blog. O refresh token do Gmail fica **no banco** (`app_config/google_oauth`).
- **LeverAds:** o worker **ignora** `DISABLE_BACKGROUND_WORKERS`, e a maioria dos loops (fila de cópia, pollers de regras, auto-answer, espelho de estoque, auto-pause, ad-recycle, alertas) não tem chave. Um worker ligado com as chaves erradas é um segundo worker de produção.
- **LeverPrice:** o worker já usa fakeml e freios (`brakes.go`), mas a **API** chama `api.mercadolibre.com` fixo (`app/services/ml/api.py:26,43`), e o app iOS tem a URL de produção fixa (`ios/project.yml:31`).

---

## Princípios

1. **Dev é um produto isolado, não um schema de produção.** Banco, chaves JWT, `TOKEN_ENCRYPTION_KEY`, service keys, webhooks e contas de terceiros são **próprios**. Nenhum segredo de prod existe no dev, e vice-versa.
2. **Mesma topologia de prod.** O dev espelha a produção: um Supabase auto-hospedado `levercopy` compartilhado por LeverAds e Cockpit, um do LeverPrice e, depois, a identidade. Cada fase da plataforma roda primeiro aqui.
3. **Dados sintéticos e recriáveis.** Um comando zera e recria o dev. Sem backup de dados; o que se preserva é o código do seed.
4. **Integrações externas em sandbox ou fake**, nunca em conta real de cliente.
5. **Defesa em camadas:** checagem no boot (a app se recusa a subir com host de prod), firewall de saída na VPS e checagem no CI.
6. **Mesma imagem sobe para dev e depois para prod.** O que muda é só o env.

---

## Arquitetura do dev

```
 Produção                                         Dev
 ┌─ VPS nova Levercopy ─────────────────┐        ┌─ VPS Dev (Coolify) ─────────────────────┐
 │ Supabase levercopy                   │        │ identity-dev  GoTrue+Postgres+Kong (F3) │
 │   schemas public (LeverAds) + cockpit│        │ levercopy-dev Supabase: public + cockpit│
 │ copylever · leveradswk · Cockpit     │   ✕    │   copylever · leveradswk · Cockpit      │
 ├─ VPS1 ───────────────────────────────┤ ◀───── │ leverprice-dev Supabase                 │
 │ Supabase LeverPrice · lp-api · worker│firewall│   lp-api · worker Go · Redis            │
 ├─ VPS2 ───────────────────────────────┤        │ fakeml · Mailpit                        │
 │ identidade · lp-worker-go · Evolution│        └─────────────────────────────────────────┘
 ├─ Easypanel ──────────────────────────┤
 │ backups + apps auxiliares            │
 └──────────────────────────────────────┘
```

- **Onde:** uma **VPS dedicada ao dev**, gerida pelo Coolify, com três stacks de banco: `identity-dev`, `levercopy-dev` e `leverprice-dev`. Não usar VPS1, VPS2 nem a VPS nova do Levercopy: esta última agora roda o banco **e** as apps de prod de LeverAds e Cockpit, então um teste de carga ou uma migration quebrada no dev ali atingiria clientes.
  - Dimensionamento inicial pequeno (ordem de 8 vCPU / 16–32 GB); os limites por container seguem o padrão da identidade na VPS2.
  - O plano da plataforma previa "prod e staging isolados" na VPS do LeverAds. Isso foi substituído por uma VPS só de dev.
- **`levercopy-dev` espelha o compartilhamento de prod:** um só Supabase com os schemas `public` (LeverAds) e `cockpit`. O Cockpit dev tem acesso a todo o banco, como em prod, e por isso o seed e o `reset-dev` de LeverAds e Cockpit rodam juntos.
- **Rede:** a VPS entra na mesma rede privada (Tailscale/WireGuard) só para administração, **sem** rota para os bancos de prod. Postgres, Studio e pg-meta ficam na rede privada.
- **Domínios: regra `dev.` + host de prod.**

  | Prod | Dev |
  |---|---|
  | `auth.leverads.com.br` (identidade, Fase 3) | `dev.auth.leverads.com.br` |
  | `leverads.com.br` | `dev.leverads.com.br` |
  | `leverprice.com.br` | `dev.leverprice.com.br` |
  | host do Cockpit | `dev.<host do Cockpit>` |

  O Coolify emite um certificado por host, sem wildcard.
- **Identidade separada da de prod** (decidido em 18/09): o dev tem GoTrue + `core` próprios em `dev.auth.leverads.com.br`, com chaves JWT, de serviço e de impersonação próprias. O auth de prod foi descartado para o dev porque:
  - traria dados reais de clientes para o dev pela replicação de `core`;
  - faria um token de prod valer nas APIs do dev;
  - tiraria do dev o teste de hook, schema `core`, upgrade do GoTrue e rotação de chaves;
  - criaria usuários de teste no cadastro real e poria carga de teste na VPS2.
- **Cookies de prod presos ao host:** como o dev fica sob os domínios de prod, nenhum cookie de prod pode usar `Domain=.leverads.com.br` ou `Domain=.leverprice.com.br`. Senão o navegador envia a sessão de prod para `dev.*`, que roda código ainda não revisado.
- **Acesso:** os frontends ficam atrás de Cloudflare Access (ou basic auth) e com `noindex`. Webhooks de sandbox ficam públicos, protegidos pelos segredos próprios do dev.
- **Faixa visual "DEV"** fixa nos três frontends, para ninguém confundir as abas.

### `APP_ENV` e trava no boot
Cada app passa a ler `APP_ENV` (`local` | `dev` | `production`). Com `APP_ENV != production`, a app **se recusa a subir** se o env contiver um destino de produção:
- hosts de banco de prod (`hsooljludhobvsznvnir`, IPs da VPS1, da VPS2 e da VPS nova do Levercopy);
- `BASE_URL`/`PROD_URL` de produção;
- `api.mercadolibre.com` como base de escrita, salvo com `ML_ALLOW_REAL_API=1` explícito.

O LeverAds já tem o padrão (validador de `<PLACEHOLDER>` em `app/config.py:781-790`); a trava entra ao lado dele. O LeverPrice já exige localhost nos testes. O Cockpit ganha a checagem em `index.js`, antes do `initDb()`.

### Firewall de saída
Na VPS de dev, `nftables`/UFW com **deny** para os IPs e hosts de produção (VPS1, VPS2, VPS nova do Levercopy, VPS do Easypanel, pooler e host do Supabase Cloud). A trava do boot evita o erro comum; o firewall garante que um env errado não alcance prod mesmo assim.

---

## Integrações externas em dev

| Integração | Produto | Em dev |
|---|---|---|
| Mercado Livre | LeverAds, LeverPrice | **fakeml** (extraído de `Leverprice/bench/fakeml` para um serviço compartilhado). Para testes manuais de OAuth, um app ML próprio de dev com **usuários de teste** do ML. Exige base URL configurável na API do LeverPrice e no LeverAds. |
| Shopee | LeverAds | `SHOPEE_SANDBOX=1`, partner de sandbox, push apontando para `dev.leverads.com.br` |
| TikTok | LeverAds | `TIKTOK_ENABLED=0` |
| Mercado Pago | Cockpit, LeverAds, LeverPrice | credenciais de teste (`MERCADOPAGO_SANDBOX=1`) e webhook de dev |
| Stripe (legado) | LeverAds | chave `sk_test_` ou vazio |
| WhatsApp (Meta Cloud API) | Cockpit | número de teste do app Meta de dev, com lista fechada de destinatários |
| Meta Ads / CAPI | Cockpit, LeverAds | `startAdDelivery` e `startMarketingAutoSync` **desligados**; CAPI só com `META_TEST_EVENT_CODE` |
| E-mail | todos | **Mailpit** no dev. O Cockpit ganha transporte SMTP além do Gmail API; em dev, só SMTP → Mailpit |
| Linear | Cockpit | time ou workspace de dev no Linear, com chave própria; nunca o `LEV` |
| Shopify | Cockpit | desligado (sem loja de teste) |
| LLM (OpenRouter, Anthropic, OpenAI) | todos | chaves próprias de dev, com teto de gasto baixo |
| Telegram / Discord / Loki | todos | canais e endpoints de dev |
| Cockpit ↔ LeverAds | Cockpit, LeverAds | acesso direto a todo o banco `levercopy-dev`; as chamadas HTTP (`LEVERADS_API_URL`, `COCKPIT_API_URL`, `COCKPIT_INGEST_KEY`) só entre instâncias de dev |
| Cockpit ↔ LeverPrice | Cockpit, LeverPrice | HTTP só para `dev.leverprice.com.br` |

---

## Dados sintéticos

Um **seed compartilhado** entre os três produtos, com ids fixos, para que as integrações entre produtos funcionem sem mapeamento:
- **Orgs:** org A e org B (clientes comuns), org C (inadimplente/paywall), org D (MFA obrigatório). UUIDs fixos, iguais nos três bancos. As orgs do LeverAds continuam canônicas, como no plano da plataforma.
- **Usuários:** um owner, um admin e um membro por org; staff do Cockpit com papéis diferentes (suporte, comercial, admin). E-mails `@lever.test`, senhas do dev no cofre, **nunca** no README.
- **Marketplace:** sellers fictícios cujos ids o fakeml reconhece, com anúncios, pedidos e notificações gerados. Tokens cifrados com a `TOKEN_ENCRYPTION_KEY` do dev.
- **Cockpit:** no schema `cockpit` do `levercopy-dev`: clientes ligados às orgs A–D do `public`, tickets, conversas de WhatsApp, propostas e faturas fictícias, e nenhum `app_config/google_oauth`.
- **Volume:** um modo `--volume` que gera ordem de grandeza parecida com prod (anúncios, jobs, notificações) para teste de carga e benchmark do worker Go, sem dado real.

**Onde fica:** o seed de cada produto no próprio repo (o LeverPrice já tem `scripts/_contas_unificadas_seed.py`), mais um arquivo de ids fixos compartilhado. Na Fase 3 as orgs e os usuários passam a vir do seed do `lever-identity`, e cada produto semeia só os próprios dados.

**Reset:** `reset-dev <produto>` derruba o banco, aplica as migrations do zero e roda o seed. Rodar as migrations do zero toda semana também prova que o histórico aplica limpo.

### Dev não é ambiente de ensaio
O plano da plataforma pede **ensaio com dump de produção** (Fase 2, e "Ensaio e execução de cada virada"). Isso **não** acontece no dev:
- o ensaio usa uma **instância efêmera**, criada para a virada e destruída ao fim;
- acesso restrito a quem executa a virada, com registro;
- o dump fica cifrado e é apagado junto com a instância;
- o dev permanente continua só com dados sintéticos.

---

## Deploy e migrations

| | Cockpit | LeverAds | LeverPrice |
|---|---|---|---|
| Dev recebe | merge em `main` (automático) | merge em `develop` (automático) | merge em `develop` (automático) |
| Prod recebe | promoção manual do **mesmo SHA** validado em dev | merge `develop` → `main` (fluxo atual) | deploy manual do SHA validado |
| Ferramenta | Coolify (prod na VPS nova do Levercopy, dev na VPS Dev) | `publica.py` passa a mirar o Coolify em vez do Easypanel, com `--ambiente dev` (hoje `PROD_URL` é o default) | `lp-worker-go-deploy.sh` e receita da API parametrizados por ambiente |

- **Migrations sempre passam primeiro pelo dev.** O LeverPrice ganha `lp-migrate --env dev`. O LeverAds precisa do ledger (LEV-439) antes, e os 89 espelhos `staging_NNN_*.sql` são apagados: com instância separada, o dev aplica os mesmos arquivos de prod. O Cockpit continua com `ensureSchema`/`runStartupMigrations` até a Fase 4, e o dev é onde elas rodam primeiro. Como os dois dividem o banco, uma migration do LeverAds que mexe em tabela lida pelo Cockpit passa pelo dev com os dois apps no ar.
- **CI:** o Cockpit ganha o primeiro workflow (testes + build + deploy de dev). O LeverAds e o LeverPrice acrescentam o job de deploy de dev ao CI que já existe.
- **Checagem no CI:** falha se o env de dev (no Coolify, lido por API) contiver host, chave ou URL de produção.

---

## Fases

### S0 — Pré-requisitos no código (sem VPS)
- **Todos:** `APP_ENV` e a trava no boot; seed sintético com ids fixos; `.env` local de cada desenvolvedor apontando para o stack local, e service_role de prod **retirada** das máquinas (relaciona com `docs/seguranca/acessos-producao.md` do LeverAds).
- **Cockpit:**
  - chave-mestra `JOBS_ENABLED` + lista `JOBS=` em `index.js:109-206`, com tudo desligado por padrão fora de produção;
  - transporte SMTP no `mailer.js` para usar Mailpit;
  - os scripts de `packages/api/scripts` exigem `--env` explícito em vez de ler o `.env` da raiz (hoje dizem "escreve no DB compartilhado (= prod)");
  - retirar `DEFAULT_ADMINS` (já está na Fase 0 da plataforma).
- **LeverAds:**
  - o worker passa a respeitar `DISABLE_BACKGROUND_WORKERS` e ganha `WORKER_LOOPS=` (allowlist de loops) em `copy_worker.py:455-512`;
  - base URL do ML e da Shopee configurável, para apontar ao fakeml;
  - ledger de migrations (LEV-439).
- **LeverPrice:**
  - `ML_API_BASE_URL` também na API (`app/services/ml/api.py`);
  - configuração de build `Dev` no iOS (xcconfig com `LeverPriceAPIURL` de dev);
  - `lp-migrate` e scripts de deploy com alvo por ambiente.
- **fakeml** vira serviço compartilhado (imagem própria), com os endpoints que o LeverAds usa além dos do LeverPrice.

### S1 — Infraestrutura
- Provisionar a VPS de dev, Coolify, rede privada e firewall de saída.
- Subir os bancos: Supabase auto-hospedado `levercopy-dev` (schemas `public` e `cockpit`) e `leverprice-dev`, com a mesma imagem da VPS1 (`supabase/postgres:17.6.x`).
- Aplicar as migrations do zero e o seed. Isso já valida que o histórico do LeverAds aplica numa instância nova, o que interessa à Fase 2 da plataforma.
- Segredos de dev no cofre, separados dos de prod, com as chaves JWT e `TOKEN_ENCRYPTION_KEY` próprias.

### S2 — Apps e deploy automático
- Subir API, worker e frontends dos três, com domínios, faixa "DEV" e Cloudflare Access.
- Ligar os deploys automáticos da tabela acima.
- Smoke automático pós-deploy: `/api/health`/`/api/version`, login com um usuário do seed, uma leitura por org.

### S3 — Integrações
- fakeml, Mailpit e canais de alerta de dev.
- Apps de sandbox: ML (usuários de teste), Shopee, Mercado Pago, Meta (WhatsApp de teste + `META_TEST_EVENT_CODE`), Linear de dev.
- Integrações entre produtos apontando só para dev.
- Teste de ponta a ponta: org do seed conecta seller fake → LeverAds copia anúncio → LeverPrice ajusta preço no fakeml → Cockpit vê o resultado.

### S4 — Dev serve à plataforma
A partir daqui, cada fase do `PLANO-PLATAFORMA-SUPABASE.md` roda primeiro no dev:
- **Fase 3:** `identity-dev` (GoTrue + `core`), JWKS, replicação de `core` para `core_replica` dos três bancos de dev, suíte pgTAP.
- **Fases 4 a 6:** PostgREST com JWKS, RLS, papéis `svc_*`, flags por módulo e `tests/isolation/` do LeverAds rodando contra o dev.
- **Benchmark** do worker Go e da fila do LeverAds via RPC com o seed `--volume`.
- **Ensaio de failover** da identidade e do LeverAds numa standby de dev.

**Ordem:** S0 começa já, em paralelo com as Fases 0 e 1 da plataforma. S1 e S2 precisam estar prontas **antes** da Fase 3, porque a identidade não deve ir a prod sem passar pelo dev.

---

## Decisões em aberto
1. **VPS única de dev** (recomendado aqui) ou dev junto da VPS nova do Levercopy. Como ela agora roda também as apps de prod, dividir a máquina com o dev fica ainda menos recomendável.
2. **Fluxo do Cockpit:** hoje push em `main` vai direto a prod. Proposta: `main` → dev automático, prod por promoção manual do mesmo SHA.
3. **Proteção dos frontends de dev:** Cloudflare Access ou basic auth.
4. **Mercado Livre:** só fakeml, ou também um app ML de dev com usuários de teste para validar OAuth de verdade.

## Verificação
- Com `APP_ENV=dev` e `DB_ASYNC_DSN` de prod, a app **não sobe**.
- Da VPS de dev, conexão para VPS1, VPS2 e Supabase Cloud falha no firewall.
- Nenhuma variável do dev é igual à de prod (checagem do CI).
- Worker do LeverAds com `WORKER_LOOPS` vazio não inicia nenhum loop; Cockpit com `JOBS_ENABLED=0` não inicia nenhum job.
- `reset-dev` recria os três bancos do zero, e o smoke passa em seguida.
- Um token de marketplace de prod **não** decifra no dev.
- Um JWT de `auth.leverads.com.br` recebe 401 nas APIs do dev, e um de `dev.auth.leverads.com.br` recebe 401 em prod.
- Nenhum `Set-Cookie` de prod tem atributo `Domain` (conferido nos três produtos).
- Todo e-mail do dev aparece no Mailpit e nenhum sai para a internet.

## Próximo passo
- Fechar as quatro decisões em aberto.
- Começar a S0 pelo que protege hoje, mesmo antes de o dev existir: trava de `APP_ENV`, `WORKER_LOOPS` no LeverAds, `JOBS_ENABLED` no Cockpit e tirar os `.env` locais de produção.
