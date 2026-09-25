# Dev interino na VPS2 (Coolify, projeto novo)

## Contexto
O `docs/PLANO-AMBIENTE-DEV.md` prevê uma VPS dedicada ao dev, que ainda não está disponível. Por enquanto, o dev inteiro sobe como um **projeto novo no Coolify da VPS2** (82.112.245.65, a VPS da identidade, a que temos acesso). Quando a VPS dedicada chegar, o projeto migra para lá; por isso tudo é descrito como compose/env reaproveitável.

Decisões do usuário:
- rollout **por etapas**;
- **as travas no código vêm antes** de ligar workers e jobs;
- acesso disponível: **UI do Coolify e token da API do Coolify**. Não temos SSH nem DNS.

## Estado atual (levantamento)

**VPS2:** Hostinger KVM8, 8 vCPU / 31 GB, Coolify 4.3.14. Já roda produção:

| Container | Limite | Observação |
|---|---|---|
| `lp-worker-go` | 3,5 CPU / 8 GB | |
| `lp-api` reserva | 1,5 / 3 GB | |
| `lp-redis` | 0,5 / 1–2 GB | |
| `lp-tunnel` | — | ssh `-L` para o Postgres e o Kong de **prod** da VPS1 |
| Evolution API | sem limite | |
| `lever-identity` (projeto "Supabase Lever"; vira LeverId) | planejado: db 2/2 GB, auth/rest/kong 0,5 cada | se já está no ar precisa ser conferido |

- Todos os `lp-*` foram criados com `docker run` à mão, não pelo Coolify.
- **Folga estimada:** ~10–12 GB de RAM. CPU já passa de 8 somando os tetos.
- Não existe repo LeverId nem compose da identidade em `C:\dev`.
- O token `VPS2_COOLIFY_*` do `~/Documents/Leverprice/.env` está documentado como órfão.

**Código, nada da S0 foi feito:**

| | Cockpit | LeverAds | LeverPrice |
|---|---|---|---|
| `APP_ENV` / trava de host de prod | não | não; existe só `_sem_placeholder` (`app/config.py:781`) | não; existe o freio `PRICING_PLATFORM_WRITES_ENABLED=0` |
| Desligar jobs e loops | não. ~30 jobs em `index.js:115-219`; vários sem gate (billing, NPS, relatórios, SDR, cadência, `compMonthClose`) | não. O worker ignora `DISABLE_BACKGROUND_WORKERS` e sobe ~25 loops (`copy_worker.py:455-512`) | worker ok (`ML_API_BASE_URL`, fakeml) |
| Base URL do ML | — | fixa (`ml_api.py:22`, 118 usos) | API fixa (`app/services/ml/api.py:26`), worker configurável |
| Schema do zero | `ensureSchema` no boot | replay de 000..212 sem ledger, nunca testado em Supabase | `dev/db/migrate.sh` já aplica do zero em `supabase/postgres:17.6.1.136` |
| Seed | `seedAll()` + `DEFAULT_ADMINS` com senha `1234` | nenhum | `_contas_unificadas_seed.py` (defasado) |
| E-mail | só Gmail API | — | — |
| Faixa DEV / noindex | não | não | não |
| Imagens | `Dockerfile.allinone` | `Dockerfile` (API + web), `Dockerfile.worker` | `dev/docker-compose.yml` pronto |

## O que precisamos (fora do código)
1. **Token da API do Coolify da VPS2:** um token novo com permissão de escrita, gerado na UI (Keys & Tokens). Fica só no `.env` local, fora do git.
2. **Alguém com SSH na VPS2**, uma vez, para:
   - conferir em que rede e porta o `lp-tunnel` expõe o Postgres de prod;
   - conferir o disco livre;
   - aplicar um bloqueio de saída dos containers de dev para a VPS1, a VPS nova e o Supabase Cloud.

   Sem isso, o isolamento fica só na trava de boot.
3. **DNS:** quem administra o domínio cria `dev.leverads.com.br`, `dev.<host do Cockpit>` e depois `dev.leverprice.com.br` / `dev.auth.leverads.com.br` → 82.112.245.65.
   - Até lá, usar os domínios `*.sslip.io` que o Coolify gera.
4. **Cofre:** registro para os segredos do dev (JWT secret, anon/service keys, `TOKEN_ENCRYPTION_KEY`, basic auth), separados dos de prod.
5. **Orçamento de recursos do dev na VPS2** (tetos por container): na etapa 2, ≤ 2 vCPU / 6 GB no total; na etapa 4, ≤ 3 vCPU / 10 GB.

## Etapas

### Etapa 0 — Verificar pela API do Coolify (só leitura)
- `GET /api/v1/servers`, `/projects` e `/resources`:
  - confirmar o servidor VPS2 e o estado do projeto "Supabase Lever" / `lever-identity` (vira LeverId);
  - ver quais redes o Coolify usa.
- Ver o uso de CPU e RAM da VPS2 nas métricas da UI do Coolify para fechar o orçamento.

### Etapa 1 — Travas no código (PRs pequenos, locais até o usuário pedir push)
- **Cockpit**
  - Em `packages/api/src/index.js`, antes do `initDb()` (linha 85):
    - `APP_ENV` (`local|dev|production`);
    - fora de prod, recusar o boot se `COCKPIT_DB_URL`, `LEVERCOPY_DB_URL` ou `ELO_DB_URL` apontarem para host de prod (`hsooljludhobvsznvnir`, pooler do Supabase, IP da VPS1, `lp-tunnel`) ou se `COCKPIT_API_KEY` estiver vazia.
  - `JOBS_ENABLED` + `JOBS=` (allowlist) envolvendo cada `start*` em `index.js:115-219`, incluindo `regenerateOpenLeadsToSlides` e `refreshResults`. O padrão fora de produção é tudo desligado.
  - Fora de produção, `ensureDefaultAdmins` (`auth.js:30-46`) usa um admin de `DEV_ADMIN_EMAIL`/`DEV_ADMIN_PASSWORD` do env, não o `1234`.
  - Web: `VITE_APP_ENV=dev` mostra uma faixa "DEV" fixa e o nginx do `deploy/nginx.allinone.conf` envia `X-Robots-Tag: noindex`.
- **LeverAds**
  - `app_env` em `app/config.py`, com a mesma trava de host de prod ao lado de `_sem_placeholder`.
  - O worker respeita `DISABLE_BACKGROUND_WORKERS` e ganha `WORKER_LOOPS` (allowlist) em `copy_worker.py:455-512`. Vazio = nenhum loop.
  - Faixa "DEV" no frontend.
- **LeverPrice:** `APP_ENV` + trava no `app/config.py` e no `worker-go/config/config.go`. Pode esperar a etapa 5.

### Etapa 2 — Projeto "Lever DEV" no Coolify: `levercopy-dev` + Cockpit + LeverAds API
- **Projeto novo**, ambiente `dev`, separado do "Supabase Lever".
- **`levercopy-dev`:** serviço Supabase do template do Coolify, enxuto.
  - Sobem só db (`supabase/postgres:17.6.1.136`, a mesma imagem de prod), rest, kong e meta/studio.
  - Ficam desligados: realtime, storage, analytics/logflare, vector, functions, imgproxy e supavisor.
  - Tetos: db 1 vCPU / 2 GB, os demais 0,25.
  - Postgres sem porta pública; Studio atrás de basic auth.
  - Segredos novos: JWT, anon/service e `TOKEN_ENCRYPTION_KEY`.
- **Schema:** replay de `LeverAds/app/db/migrations/[0-9][0-9][0-9]_*.sql`, como em `scripts/test_db.sh:57-84`.
  - Corrigir o que quebrar no Supabase e registrar as falhas; isso também serve à Fase 2 da plataforma.
  - O schema `cockpit` nasce pelo `ensureSchema` no boot do Cockpit.
- **Seed mínimo novo:** orgs A–D e usuários `@lever.test` no `public`, com ids fixos, num script do LeverAds. O `seedAll()` do Cockpit cuida do schema `cockpit`.
- **Apps:**
  - Cockpit: `Dockerfile.allinone`, auto-deploy de `main`.
  - LeverAds API: `Dockerfile`, auto-deploy de `develop`.
  - Ambas com `APP_ENV=dev`, `JOBS_ENABLED=0` / `DISABLE_BACKGROUND_WORKERS=1` e **nenhuma credencial de terceiro**.
  - Tetos de 0,5 vCPU / 1 GB cada. Basic auth via middleware do Traefik no Coolify.
- **Integração Cockpit ↔ LeverAds:** `LEVERADS_API_URL` e `LEVERCOPY_DB_URL` apontam só para o dev.

### Etapa 3 — Workers e jobs, com allowlist
- Adicionar `leveradswk` (`Dockerfile.worker`) com `WORKER_LOOPS` limitado a loops que **não** chamam ML nem Shopee, porque as URLs são fixas.
- No Cockpit, ligar só jobs internos (ex.: `startTicketSla`, `startTaskReminder`).
- Sem Gmail, WhatsApp, Meta e MP até existirem SMTP/Mailpit e credenciais de sandbox (S3 do plano original).

### Etapa 4 — `leverprice-dev`
- Levar o `Leverprice/dev/docker-compose.yml` como serviço Docker Compose no Coolify: db, postgrest, gateway, redis, fakeml, api e worker.
- Configuração: `PRICING_PLATFORM_WRITES_ENABLED=0` e worker em `ML_API_BASE_URL=http://fakeml:8080`.
- Antes de subir, medir a folga da VPS2 com o lp-worker-go de prod em pico.

### Etapa 5 — `identity-dev`
- Sobe quando a Fase 3 da plataforma começar (o repo LeverId ainda não existe): GoTrue + Postgres + Kong, com chaves próprias, em `dev.auth.leverads.com.br`.

## Documentação
- `docs/PLANO-AMBIENTE-DEV.md`: nova seção "Fase interina: dev na VPS2" com o que mudou:
  - o dev convive com prod do LeverPrice e com a identidade;
  - os tetos de recursos;
  - o isolamento sem firewall de host;
  - o plano de migração para a VPS dedicada.
- Atualizar também a decisão em aberto 1.
- `docs/PLANO-PLATAFORMA-SUPABASE.md`: revisão 7 com uma linha apontando para essa seção.

## Riscos
- **Vizinho barulhento:** o dev divide CPU com o `lp-worker-go` de prod. Os tetos por container são obrigatórios, e o seed `--volume` e benchmarks ficam proibidos na VPS2.
- **Rota para prod:** o `lp-tunnel` na mesma máquina dá rota para o banco de prod da VPS1. Mitigações:
  - trava de boot;
  - não conectar os recursos do dev a redes externas ao projeto;
  - checagem por SSH (item 2).
- **Migrations do LeverAds** nunca rodaram do zero num Supabase; a etapa 2 pode revelar drift.

## Verificação
- Com `APP_ENV=dev` e DSN de prod, Cockpit e LeverAds **não sobem** (teste local antes do deploy).
- Com `JOBS_ENABLED=0` / `WORKER_LOOPS` vazio, os logs de boot não mostram nenhum job ou loop iniciado.
- No Coolify: health de todos os recursos. `/api/version` do LeverAds e o health do Cockpit respondem nos domínios de dev. Login com usuário do seed. Faixa "DEV" visível. Header `noindex` presente.
- Tetos de recursos aplicados (`docker stats` pela UI do Coolify), e o uso do `lp-worker-go` de prod sem regressão.
- De dentro de um container de dev, conexão ao host do banco de prod falha (depende do item 2).
