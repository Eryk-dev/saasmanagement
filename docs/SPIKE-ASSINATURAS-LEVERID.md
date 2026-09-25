# Spike: gerenciamento de assinaturas no LeverId

> **Status (25/09/2026): spike concluído, nada implementado.** Pergunta: vale levar o gerenciamento de assinaturas para o LeverId, a identidade central (`docs/PLANO-AUTH.md`)? E, se sim, persistido em qual banco? Levantamento feito no código dos três produtos (Cockpit `main`, LeverAds `feat/auth` sobre `develop`, LeverPrice), só leitura.
>
> **Recomendação curta:** **não** mover a cobrança (assinaturas, faturas, dinheiro) para o LeverId. Mover para o LeverId só o **direito de acesso** de cada org a cada produto, como **concessões por origem** com precedência explícita, guardadas no banco do LeverId (pequeno volume, é autorização). A cobrança continua no Cockpit (banco `levercopy`, schema `cockpit`) e no Mercado Pago. O desenho deixa a porta aberta para um serviço de cobrança próprio no futuro sem refazer a integração (seção 4.3).

---

## 1. Os bancos envolvidos

| Banco | Onde roda | O que guarda hoje | Perfil |
|---|---|---|---|
| **LeverId** | VPS2, serviço do Coolify; Postgres com teto de 2 vCPU / 2 GB, dividindo a máquina com o `lp-worker-go` de produção | `auth.*` (contas, sessões, fatores de MFA, gerido pelo GoTrue) e `core.*` (orgs, perfis, membros, staff, `org_products`) | Pequeno e isolado **de propósito**: se cair, ninguém faz login em produto nenhum. Separado do LeverAds em 18/09 para um pico de worker ou uma migration não derrubar o login |
| **levercopy** | Supabase Cloud hoje; vai para uma VPS nova junto com as apps (Fase 2 da plataforma) | `public` do LeverAds (inclusive as colunas de cobrança self-service em `orgs`) e `cockpit` do Cockpit (clientes, leads, **assinaturas, faturas**, espelhos do Mercado Pago, financeiro, remuneração) | O banco grande e mais carregado; é onde a cobrança do Cockpit já mora |
| **LeverPrice** | VPS1 | `public` do LeverPrice (colunas de cobrança herdadas, sem uso) | Sem cobrança própria |

## 2. Como é hoje

### 2.1 Quem cobra e quem libera

| | Cockpit | LeverAds | LeverPrice |
|---|---|---|---|
| Cobra? | **Sim**: vendas assistidas. `subscriptions` (active/past_due/paused/canceled, 4 ciclos), `invoices` (renewal/prorata/upsell/manual/installment), espelhos `mp_payments`/`mp_preapprovals`; motor de hora em hora (renovação, dunning com carência, `past_due`, mudança agendada) | **Sim**: self-service. Checkout de assinatura recorrente no Mercado Pago, troca de plano com pró-rata, seats, cancelamento; Stripe legado | **Não**. Colunas herdadas do Levercopy, sem código que cobre, sem webhook, sem compra no iOS |
| Onde persiste | `levercopy.cockpit` (tabelas `(id, json)`); dinheiro no Mercado Pago | `levercopy.public.orgs` (sem tabela de assinatura, fatura ou pagamento) | `leverprice.public.orgs` |
| Gate de acesso | — | `require_active_org`: `active` e CNPJ bloqueiam; libera por cortesia (`access_until`), pagamento (`payment_active` com contrato vigente) ou trial; 402 | igual + `leverprice_enabled` (404) |
| Quem libera | escreve só `payment_active` do LeverAds (a cada 10 min) | webhook MP, webhook Stripe, super admin, Cockpit, cadastro, exclusão | super admin, botão "Liberar", cadastro (5 dias), exclusão |

A recorrência pelo Mercado Pago deixou de ser vendida pelo Cockpit em 10/09/2026. O Mercado Pago é a verdade do dinheiro; o Cockpit se declara dono de assinatura, fatura e dunning.

### 2.2 O que dói
1. **`payment_active` do LeverAds tem quatro escritores e ganha o último** (webhook do checkout, Stripe, super admin, Cockpit). Uma org paga pelo checkout e `past_due` no Cockpit pisca entre liberada e bloqueada, em silêncio. Os webhooks também não limpam o cache da org (até 15 s de atraso).
2. **O LeverPrice é liberado à mão**, sem ligação com o que o Cockpit cobra.
3. **Um cliente com dois produtos vira dois `customers`** no Cockpit, e o vínculo com a org só existe para o LeverAds (`leveradsOrgId`).
4. **"Plano" não manda em nada automaticamente**: módulos pagos do LeverAds são flags ligadas à mão; no Cockpit as assinaturas nascem com `plan:""`.

O problema que machuca é de **acesso** (quem manda no liga/desliga), não de **cobrança** (como se cobra).

## 3. Onde a gestão de assinaturas poderia morar

### Opção 1 — Cobrança inteira no LeverId, no banco dele
Schema `billing` no Postgres do LeverId (VPS2): planos, assinaturas, faturas, pagamentos, webhooks do Mercado Pago, motor de dunning. Os produtos e o Cockpit leem de lá.

- **A favor:** um lugar só para pessoa, org e assinatura; o token pode levar o plano direto.
- **Contra:**
  - **raio de explosão:** webhooks, poller de reconciliação e motor de dunning rodando no serviço cujo tombo tira o login de todos; um bug de cobrança vira incidente de autenticação;
  - **superfície:** dados financeiros e integrações de pagamento no mesmo banco de senhas e sessões, com as mesmas credenciais de administração;
  - **capacidade:** o banco tem teto de 2 GB e divide a VPS2 com o `lp-worker-go`; faturas, espelhos de pagamento e histórico crescem sem parar;
  - **relatórios do Cockpit:** ARR/MRR, caixa, DRE, conciliação, remuneração, metas e marketing cruzam assinaturas e faturas com leads e clientes, que ficam no `levercopy`. Tudo isso passaria a cruzar bancos (ETL ou chamadas), ou a ser reescrito;
  - **modelo:** as coleções do Cockpit são JSON; o motor teria de ser reescrito em outro stack/banco.
- **Esforço:** muito alto (semanas), com risco no serviço mais crítico.

### Opção 2 — Serviço de cobrança próprio, com banco próprio ("LeverBilling")
Um serviço novo (API + Postgres dedicado) dono de planos, assinaturas, faturas e Mercado Pago, para todos os produtos; o LeverId recebe dele as concessões de acesso.

- **A favor:** isolamento de falha e de segurança; modelo relacional limpo; cliente multi-produto nativo; pode unificar o checkout self-service de todos os produtos.
- **Contra:**
  - **mais um serviço para operar:** deploy, backup com restore testado, monitoramento, plantão — para um time pequeno;
  - **relatórios do Cockpit** cruzam bancos igual à opção 1;
  - **migração de dados financeiros** (assinaturas, faturas, espelhos do MP) com conferência de valores;
  - só compensa se houver decisão de produto de unificar a cobrança dos produtos.
- **Esforço:** alto (semanas a meses).

### Opção 3 — Cobrança fica no Cockpit (`levercopy`); o LeverId guarda só o direito de acesso (**recomendada**)
Nada de cobrança sai do lugar. O LeverId ganha uma tabela de **concessões de acesso por origem** (seção 4), escrita por quem cobra ou libera e lida pelos produtos.

- **A favor:**
  - resolve o problema real (escritor múltiplo) com regra explícita e auditável;
  - **zero migração de dados financeiros**; relatórios do Cockpit intactos, no mesmo banco de leads e clientes;
  - o LeverId continua pequeno: guarda estado de acesso (uma linha por org × produto × origem, só muda quando o acesso muda), nunca valores;
  - o LeverPrice ganha liberação automática pelo mesmo caminho;
  - compatível com a opção 2 no futuro (o LeverBilling vira só mais um escritor de concessão).
- **Contra:**
  - a cobrança continua acoplada ao backoffice, em JSON;
  - dois motores de cobrança (Cockpit e checkout do LeverAds) seguem existindo até uma decisão de produto;
  - mais uma integração entre sistemas (RPC + espelho).
- **Esforço:** baixo a médio (dias por etapa).

### Opção 4 — Status quo com precedência só no LeverAds
Coluna de origem ao lado de `payment_active` e regra de quem vence dentro do LeverAds.

- **A favor:** o mais barato.
- **Contra:** não ajuda o LeverPrice nem o cliente multi-produto; a regra fica presa num produto.
- **Esforço:** baixo. Vale como remendo se a opção 3 atrasar.

### Comparação

| Critério | 1. LeverId (banco dele) | 2. Serviço próprio | 3. Cockpit + concessões no LeverId | 4. Status quo |
|---|---|---|---|---|
| Onde persiste a cobrança | LeverId (VPS2) | banco novo | `levercopy.cockpit` (como hoje) | como hoje |
| Onde persiste o acesso | LeverId | LeverId | **LeverId** (`core.product_grants`) | cada produto |
| Risco para o login | **alto** | baixo | baixo | nenhum |
| Relatórios do Cockpit | cruzam bancos / reescrita | cruzam bancos | **intactos** | intactos |
| Migração de dados financeiros | sim | sim | **não** | não |
| Resolve os 4 escritores do paywall | sim | sim | **sim** | só no LeverAds |
| LeverPrice liberado automaticamente | sim | sim | **sim** | não |
| Operação nova | pouca | **um serviço inteiro** | pouca | nenhuma |
| Esforço | muito alto | alto | **baixo a médio** | baixo |
| Caminho para o futuro | difícil de desfazer | é o futuro | **evolui para a 2** | remendo |

## 4. Desenho da opção 3

### 4.1 Concessões por origem, não um booleano
Cada origem é dona da **sua** linha, no banco do LeverId:

| Tabela | Conteúdo |
|---|---|
| `core.org_products` | já existe: `(org_id, product)`, `status`. Passa a ser o **acesso efetivo**, calculado, para leitura rápida e claim |
| `core.product_grants` (nova) | `(org_id, product, source)` PK; `kind` (`paid`, `trial`, `courtesy`, `block`); `active`; `until`; `reason`; `ref` (id da assinatura/contrato na origem, **sem valor**); `updated_by`, `updated_at` |
| `core.product_grant_events` (nova) | histórico append-only de cada mudança ("por que essa org perdeu acesso") |

Origens: `cockpit` (cobrança comercial), `leverads_checkout` (self-service), `trial` (cadastro), `staff` (liberação ou bloqueio manual).

**Regra do acesso efetivo** (função SQL, testada em pgTAP):
1. existe `block` ativo → **sem acesso** (o kill switch do staff vence tudo);
2. senão, existe qualquer concessão `paid`/`courtesy`/`trial` ativa e dentro do `until` → **com acesso**;
3. senão → sem acesso.

O Cockpit marcar `past_due` desliga só a concessão **dele**; se a org também paga pelo checkout, continua liberada, e o motivo fica visível.

### 4.2 Escrita e leitura
- **Escrita** por RPC (`identity_api.set_product_grant`, `SECURITY DEFINER`), com permissão por origem: `svc_cockpit` escreve `cockpit` e `staff`; `svc_leverads` escreve `leverads_checkout` e `trial`. Mesmo padrão das RPCs do `core`.
- **Leitura pelos produtos:**
  1. transição: o LeverId calcula o efetivo e um espelho grava a cópia local que o produto já lê (`payment_active`/`access_until` no LeverAds; o equivalente no LeverPrice). O gate `require_active_org` não muda;
  2. depois: claim `products` no token (previsto no plano da plataforma) e `core_replica` para o RLS.
- **Continua no produto:** seats, cotas, limites, flags de módulo, contrato (`contract_ends_at`). Mapear "plano → módulos" é decisão de produto, posterior.

### 4.3 Arquitetura alvo

```
                 Mercado Pago (dinheiro)
            webhooks │                 │ webhooks
                     ▼                 ▼
 ┌─ levercopy ─────────────────┐   ┌─ levercopy.public ───────────┐
 │ Cockpit: assinaturas,       │   │ LeverAds: checkout           │
 │ faturas, dunning,           │   │ self-service (planos, seats, │
 │ financeiro (schema cockpit) │   │ pró-rata)                    │
 └──────────┬──────────────────┘   └──────────┬───────────────────┘
            │ concessão "cockpit"             │ concessão "leverads_checkout"
            │ (e "staff", pela tela)          │ (e "trial", no cadastro)
            ▼                                 ▼
 ┌─ LeverId (banco próprio, VPS2) ─────────────────────────────────┐
 │ core.product_grants ──regra──▶ core.org_products (efetivo)      │
 │ core.product_grant_events (auditoria)   · sem valores, sem faturas │
 └──────────┬──────────────────────────────┬───────────────────────┘
            │ espelho (depois: claim/réplica) │
            ▼                                 ▼
   LeverAds: payment_active local     LeverPrice: acesso local
   → require_active_org (402)         → require_active_org (402)
```

Se a opção 2 vier um dia, o "LeverBilling" substitui as duas caixas de cobrança como escritor de concessões; o LeverId e os produtos não mudam.

### 4.4 Plano de migração (sem downtime, reversível por flag)

| Etapa | O que | Depende de |
|---|---|---|
| 0 | Levantamento em produção: quantas orgs têm assinatura self-service autorizada, quantas pagam pelos dois caminhos, quantas estão em cortesia, quantas orgs do LeverPrice pagam | leitura de produção |
| 1 | Tabelas, regra e RPCs no LeverId, com pgTAP; nenhum leitor | — (dá para fazer já, local) |
| 2 | Carga das concessões a partir do estado atual (`payment_active` → `paid` com origem inferida; `access_until` → `courtesy`; trial → `trial`) e **modo sombra**: calcula o efetivo e compara com o `payment_active` de hoje, sem aplicar | Fase 1 do `PLANO-AUTH` em produção |
| 3 | Escritores em paralelo: Cockpit e webhook do LeverAds gravam a concessão **além** do campo de hoje | 2 |
| 4 | LeverAds deriva `payment_active`/`access_until` do efetivo (flag por org, depois geral) | 3 sem divergência por 2 semanas |
| 5 | LeverPrice no mesmo espelho; Cockpit com vínculo por produto (`customer.orgId`) | 4; de-para das orgs do LeverPrice |

**Rollback:** desligar a flag; o campo local volta a ser escrito como hoje. **Esforço:** etapa 1 ~2–3 dias; 2–3 ~1 semana nos dois repos; 4 ~3–4 dias com a janela de sombra; 5 ~1 semana. Não inclui a Fase 1 do `PLANO-AUTH`.

## 5. Riscos da opção 3
- **LeverId fora do ar:** o produto usa a última cópia local do acesso (que já existe), então ninguém perde acesso por falha de infraestrutura; só as mudanças atrasam.
- **Divergência na virada:** modo sombra (etapa 2) e flag por org (etapa 4).
- **Regra de precedência:** "qualquer concessão paga libera" precisa de validação comercial (um cliente `past_due` no Cockpit que paga pelo checkout continua liberado).

## 6. Decisões para o time
1. Aprovar a opção 3 (cobrança no Cockpit, acesso no LeverId) e descartar, por ora, as opções 1 e 2.
2. A regra de precedência da seção 4.1.
3. O checkout self-service do LeverAds continua existindo? (a etapa 0 mostra quantas orgs dependem dele)
4. Trial e cortesia viram concessões no LeverId (recomendado) ou ficam no produto.
5. Fazer a etapa 1 já (local, sem risco) ou esperar a Fase 1 do `PLANO-AUTH` em produção.

## 7. Achados paralelos (independem da decisão)
- LeverAds: os webhooks de cobrança não limpam o cache da org (até 15 s de atraso no paywall).
- LeverAds: colunas sem uso (`use_prorata_change_plan`, `mp_customer_id`, `mp_card_id`) e ramo de downgrade agendado inalcançável em `billing.py`.
- LeverPrice: comentários citam webhook de pagamento e Stripe que não existem mais.
- Cockpit: `plans` não se liga às assinaturas (`plan:""`), então "plano" hoje é só rótulo.
