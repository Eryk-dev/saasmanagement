# Plano: migrar o Cockpit para a VPS do Levercopy

> **Status (19/10/2026): proposto, não iniciado.** Complementa o `PLANO-PLATAFORMA-SUPABASE.md` (rev. 5), que já colocava o Cockpit na VPS nova do Levercopy, mas partia de uma premissa que não vale mais: a de que o Cockpit não tem banco próprio. Tudo o que está em "Estado medido" foi lido em produção em 19/10/2026, só leitura.

## Decisão

**O Cockpit (app + banco) vai para a VPS nova do Levercopy (`187.127.50.132`, `srv2071456`), num database `cockpit` separado dentro do mesmo Postgres.** Não vai para a VPS2 do LeverId.

O que decide é o banco, não o app. O Cockpit conversa muito com o próprio banco: `repo.list()` lê a coleção inteira (cache de 60 s), o bootstrap do CRM faz ~18 desses, e 32 jobs em processo fazem polling o tempo todo. O app tem que ficar ao lado do banco dele. Já o LeverId quase não pesa: o JWT é validado localmente pelo JWKS (cache de 10 min) e a admin API tem cache de 60 s.

| | VPS nova do Levercopy | VPS2 do LeverId (`82.112.245.65`) |
|---|---|---|
| Folga | 8 vCPU / 31 GB; amostra de 19/10: ~2,2 cores e 11 GB em uso | soma dos tetos de CPU já passa de 8; sobram ~10–12 GB (`PLANO-DEV-INTERINO-VPS2.md`) |
| `leverads-results` (varre 180 dias de `platform_orders`) | leitura local | atravessa a internet |
| Raio de explosão | pico do Cockpit disputa CPU com o LeverAds; resolve com teto por container | pico do Cockpit atinge o login de todos os produtos |
| Planos | rev. 5 já previa | o spike de assinaturas desaconselha dados pesados ali; vai receber o dev interino |

**Database separado, não o schema `cockpit` do banco `levercopy`:** o Cockpit roda DDL no boot (`initDb`/`ensureSchema`) e expõe `rawQuery`. Num database próprio, com role própria sem acesso ao `public`, um erro dele não alcança as tabelas do LeverAds. O código já suporta isso desde `900276a6` (30/08): o Cockpit lê o Levercopy só por `LEVERCOPY_DB_URL`, num pool à parte. Não há FK, view nem join entre `cockpit` e `public`.

## Estado medido (19/10/2026)

**App** — Easypanel `82.25.70.107`, projeto `extrator_mp`, serviço `saasmngmnt`, `Dockerfile.allinone` (api :8787 + mcp :8788 + nginx :80). ~0,9 GB de RAM e CPU baixa na amostra (pico de ~200% registrado em 15/10). URL: `https://extrator-mp-saasmngmnt.gnnc3f.easypanel.host`.

**Banco do Cockpit** — Supabase Cloud **`zvlcyzqwetqueffossfs`**, pelo pooler `aws-0-sa-east-1.pooler.supabase.com:6543`, como `postgres` (não superusuário).
- PostgreSQL 17.6, igual ao da VPS (`supabase/postgres:17.6.1.136`); `wal_level=logical`.
- **716 MB**, sendo 703 MB no schema `cockpit` (125 tabelas). Maiores: `wa_media` 413 MB, `form_events` 81 MB, `proposals` 78 MB. Há 37 tabelas `_bak_*` (63 MB).
- Fora do `cockpit`, nada: `auth.users` = 0, `vault.secrets` = 0, `storage` vazio, sem sequences, sem triggers, sem `pg_cron`.
- Extensões: `pgcrypto`, `uuid-ossp`, `pg_stat_statements`, `supabase_vault` (sem uso).
- Ritmo: 9,9 M commits desde 25/08 (~2 transações/s em média).

**Outras conexões do Cockpit**
- `LEVERCOPY_DB_URL` = `cockpit_reader@187.127.50.132:5432` — **já aponta para a VPS nova**, pela internet (o IP do Easypanel está na allowlist `LEVERADS_PG` do iptables da VPS).
- `ELO_DB_URL` = projeto `fyxbhgrhdyiocyoztuuc` (Elo) — não muda.
- Identidade = `https://auth.leverads.com.br` (VPS2) — não muda.

**Bucket `proposal-assets`** — 21 objetos, 3 MB, público, no projeto Cloud **antigo do Levercopy** (`hsooljludhobvsznvnir`), último upload em 13/07. URL fixa em `packages/api/src/proposals/proposal-slides-page.js:527`. Quebra quando aquele projeto for desligado, independentemente de onde o Cockpit rodar.

**Cópia morta** — o schema `cockpit` dentro do banco `levercopy` parou em 30/08 18:26 (maior `updated_at` de `wa_messages` e `leads`), tanto no Cloud antigo quanto na VPS (346 MB, veio no restore de 17/10). Ninguém escreve ali.

**VPS nova** — Ubuntu 24.04, Coolify 4.4.6, Traefik. Postgres `leverads-db` (`max_connections` 200, `shared_buffers` 6 GB), PostgREST, GoTrue, Studio, meta, Envoy (`leverads-api-gw`). Apps: `copylever` (teto 4 GB, sem teto de CPU), `leveradswk` (3 GB, sem teto de CPU), `ci-runner-runner-1` + `ci-runner-dind-1` (4 GB cada). **Não há Storage, Kong nem Supavisor.** UFW libera só 22/80/443; 5432 só para `82.25.70.107` e `82.112.245.65`.

**Domínios** — o Cockpit é servido em **`levermoney.com.br`** (registro A → `82.25.70.107`, TTL 3600, DNS no Registro.br `*.sec.dns.br`). Nas últimas 24 h foram 7.903 requisições por ele e 48 pela URL do Easypanel. O Traefik do Easypanel também roteia `api.levermoney.com.br` para o Cockpit, mas esse nome não existe no DNS (NXDOMAIN). Os outros subdomínios (`copy.`, `conciliador.`, `dash.`) são de outros serviços e não mudam.

**Quem chama o Cockpit**
- por `levermoney.com.br`: formulários públicos, webhooks do WhatsApp, Meta e Shopify, clientes MCP, o time;
- pela URL do Easypanel (`extrator-mp-saasmngmnt.gnnc3f.easypanel.host`): só o webhook do **Linear** (42 em 24 h) e `/public/lp/events` (6);
- LeverAds: `COCKPIT_API_URL` no `copylever` (form `/diagnostico` cria lead).

## Arquitetura alvo

```
VPS 187.127.50.132 (Coolify)
├─ leverads-db (Postgres 17.6)
│   ├─ database postgres  ← levercopy (public)      ← copylever, leveradswk
│   │                     ← cockpit_reader (só leitura, rede local)
│   └─ database cockpit   ← dono: cockpit_app       ← Cockpit
├─ copylever, leveradswk
└─ cockpit (allinone: nginx :80, api :8787, mcp :8788)  teto 2 vCPU / 2 GB
                ▲
   levermoney.com.br (Traefik/TLS)       Easypanel: vira proxy → VPS enquanto o DNS propaga
```

- `COCKPIT_DB_URL` → `cockpit_app@leverads-db:5432/cockpit?sslmode=require` (rede `coolify`; nada pela internet).
- `LEVERCOPY_DB_URL` → `cockpit_reader@leverads-db:5432/postgres?sslmode=require`.
- `JOBS_ENABLED` só fica ligado em **uma** instância por vez (ver corte).

## Fases

### Fase 0 — decisões e preparação (sem impacto)

1. **Domínio:** o mesmo, `levermoney.com.br`; o corte é trocar o registro A para `187.127.50.132`. Um dia antes, baixar o TTL de 3600 para 300 no Registro.br. Recadastrar o webhook do Linear e a origem de `/public/lp/events` em `levermoney.com.br` já agora, porque a URL do Easypanel some.
2. **Fotos da proposta:** copiar os 21 objetos de `proposal-assets/leverads` para `packages/web/public/proposal-assets/leverads/` (servidos pelo nginx em `levermoney.com.br/proposal-assets/...`) e trocar a constante `ASSETS` (`proposal-slides-page.js:527`). São 3 MB estáticos: não justificam subir Storage na VPS. Ajustar `test/cases.test.js:269`.
   ⚠️ **A URL também está gravada nos dados:** em 19/10, **1.670 `proposals` e 2 `proposal_templates`** tinham `https://hsooljludhobvsznvnir.supabase.co/storage/v1/object/public/proposal-assets/` no JSON (9 arquivos: `operacao-interna-1/2.jpg`, `operacao-barracao-novo/antigo.jpg`, `ig-{netair,easy,uniquekids,uniquebox,bellator}-full.jpg`), além das `_bak_*`. Esses links de proposta já enviados quebram quando o projeto Cloud antigo for desligado. Reescrever o prefixo para `https://levermoney.com.br/proposal-assets/` numa migração idempotente de startup (`runStartupMigrations`), depois que as fotos estiverem servidas. Não depende da VPS; precisa estar feito antes de desligar `hsooljludhobvsznvnir`.
3. **Tetos de CPU:** pôr teto de CPU também em `copylever`, `leveradswk` e no runner de CI (hoje só há teto de memória). O CI é o vizinho mais barulhento; ver LEV-555.
4. **Webhooks:** listar onde cada URL está cadastrada (app da Meta/WhatsApp, Linear, Shopify UniqueKids, `back_url` do Mercado Pago, clientes MCP) e quem tem acesso a cada painel.

### Fase 1 — ensaio (sem impacto)

1. Na VPS, como `postgres`:
   ```sql
   create role cockpit_app login password '<gerada>';
   create database cockpit owner cockpit_app;
   \c cockpit
   create extension if not exists pgcrypto;
   create extension if not exists "uuid-ossp";
   ```
   Conferir o `cockpit_reader` no database `postgres`: hoje tem BYPASSRLS; reduzir para `SELECT` em `orgs`, `platform_orders`, `org_revenue_generated` e `EXECUTE` em `dashboard_portfolio(uuid[])`, que é tudo o que `leverads-results.js` usa.
2. `pg_dump` do Cloud pela porta **5432** (sessão; nunca pela 6543 de transação): `pg_dump -Fc -n cockpit --no-owner --no-acl`.
3. Restore num database de ensaio (`cockpit_ensaio`) com `pg_restore --role=cockpit_app --no-owner`. Medir o tempo do dump e do restore: é o que dimensiona a janela.
4. Conferir `count(*)` por tabela entre Cloud e ensaio (mesma ideia do `/opt/leverads/tools/corte.py contagem` do corte do LeverAds, apontado para o schema `cockpit`).
5. Subir o Cockpit no Coolify apontando para `cockpit_ensaio`, com **`JOBS_ENABLED=0`** e sem as credenciais de integração (WhatsApp, MP, Meta, Linear). Validar login pelo LeverId, CRM, propostas com fotos, resultados do Levercopy. Confirmar que o `initDb` roda sem superusuário.
6. Apagar `cockpit_ensaio` e o app de ensaio.

**Resultado do ensaio (19/10/2026):**
- `cockpit_app` (sem superusuário, `noinherit`, sem `CONNECT` no database `postgres`) e `cockpit_ensaio` criados pelo `supabase_admin`. O `postgres` da imagem do Supabase **não** consegue `create database ... owner` de outra role (`must be able to SET ROLE`).
- `pg_dump` pela **conexão direta** `db.zvlcyzqwetqueffossfs.supabase.co:5432` (a VPS alcança por IPv6). Nunca pelo pooler: o `pg_dump` faz `SET` de sessão, e um `SET` vazado pelo 6543 deixou o Cockpit 1h48 sem conseguir escrever em 19/10.
- Dump **26 s** (320 MB, `-Fc`); restore **12 s** (`-j 4`). Contagem: 125 tabelas, todas iguais.
- App da `origin/main` (`b94ac3e9`) num container solto na rede `coolify`, `APP_ENV=dev`, `JOBS_ENABLED=0`: `initDb` rodou sem superusuário, `/api/health` ok, proposta `/p/:id` e formulário `/f/:id` renderizaram (200), zero erro no log, 115 MB de RAM.
- **Conexão de app para o Postgres exige SSL**: a rede `coolify` é IPv6 (`fd72:…`) e o `pg_hba` só aceita IPv6 com `hostssl`. Usar `sslmode=require` (o `makePool` já desliga a verificação do certificado), nunca `sslmode=disable`.
- Arquivos na VPS: `/root/.cockpit-app-pw`, `/root/.cockpit-cloud-dsn` (600), `/opt/cockpit-migracao/` (dump e fonte). O database `cockpit_ensaio` fica até o corte e sai depois.

### Fase 2 — corte (janela de ~30 min, fora do horário comercial)

1. Avisar o time; Cockpit fora do ar durante a janela.
2. No Easypanel, **parar** o `saasmngmnt` (para o API e os 32 jobs: nada escreve mais no Cloud). Conferir no Cloud que não há conexão do Cockpit (`pg_stat_activity`).
3. `pg_dump` final pela 5432 → `pg_restore` no database `cockpit` → contagem por tabela Cloud × VPS igual.
4. Subir o Cockpit no Coolify com o env de produção completo, `COCKPIT_DB_URL`/`LEVERCOPY_DB_URL` locais, domínio `levermoney.com.br` e `JOBS_ENABLED` como hoje. **Só depois de o Easypanel estar parado:** duas instâncias com jobs ligados mandam WhatsApp e cobrança em dobro.
5. Trocar o registro A de `levermoney.com.br` para `187.127.50.132`. Enquanto o DNS propaga (TTL de 5 min), o Easypanel continua recebendo parte do tráfego: trocar o `saasmngmnt` por um proxy reverso (nginx) para `187.127.50.132` com `Host: levermoney.com.br`. Proxy, não redirect: webhook é `POST` e nem todo remetente segue 301/302. O Traefik da VPS emite o certificado assim que o DNS aponta para ela.
6. Prova: `/api/health.build` igual ao commit da `main`; login; um webhook do WhatsApp recebido; um job rodando (log); proposta com foto; resultados do Levercopy na tela do cliente.

### Fase 3 — pós-corte (dias 1 a 30)

1. Conferir o `COCKPIT_API_URL` do `copylever` (precisa apontar para `levermoney.com.br`).
2. Quando o Easypanel parar de receber tráfego do Cockpit (DNS propagado), remover o proxy e o serviço `saasmngmnt`.
3. Revisar a allowlist `LEVERADS_PG`: o `82.25.70.107` provavelmente entrou para o `LEVERCOPY_DB_URL` do Cockpit (confirmar); manter só se backups do Easypanel ainda precisarem.
4. Backup diário do database `cockpit` junto com o do `levercopy`.
5. Depois de 30 dias estável:
   - pausar o projeto `zvlcyzqwetqueffossfs` (guardar um dump final em arquivo antes);
   - apagar a cópia morta do schema `cockpit` no banco `levercopy` da VPS (346 MB), depois de confirmar que nada lê dali;
   - decidir sobre as 37 tabelas `_bak_*` (63 MB).

## Rollback

Até o fim da Fase 3, o projeto Cloud `zvlcyzqwetqueffossfs` fica intacto, só sem escrita.

- **Durante o corte (antes do passo 4):** religar o `saasmngmnt` no Easypanel; nada mudou no Cloud.
- **Depois do corte:** parar o Cockpit na VPS → `pg_dump -n cockpit` da VPS → restore no Cloud (substituindo o schema) → religar o Easypanel com o env antigo. Sem esse retorno, perde-se o que foi escrito na VPS.

## Riscos

| Risco | Mitigação |
|---|---|
| Jobs duplicados (WhatsApp, cobrança MP) | Easypanel parado antes de subir a VPS; `JOBS_ENABLED=0` em qualquer instância que não seja a de produção |
| Webhook perdido durante a janela | Janela fora do horário; proxy na URL antiga; conferir no painel de cada remetente se reenvia em falha |
| Cockpit disputando CPU com o LeverAds | Tetos por container (Fase 0.3), medir com `docker stats` na primeira semana |
| `initDb` precisar de privilégio que `cockpit_app` não tem | Testado no ensaio (Fase 1.5) |
| Fotos da proposta quebrarem com o desligamento do Cloud antigo | Fase 0.2, independente do resto |

## Fora do escopo

- RLS e troca de login do Cockpit (`PLANO-AUTH.md`).
- Migrar o Elo.
- Desligar o projeto Cloud antigo do Levercopy (`hsooljludhobvsznvnir`). Ele ainda guarda o bucket até a Fase 0.2 entrar.
