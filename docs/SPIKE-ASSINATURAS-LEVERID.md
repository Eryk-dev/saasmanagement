# Spike: gerenciamento de assinaturas no LeverId

> **Status (25/09/2026): spike concluído, nada implementado.** Pergunta: vale levar o gerenciamento de assinaturas para o LeverId, a identidade central (`docs/PLANO-AUTH.md`)? Levantamento feito no código dos três produtos (Cockpit `main`, LeverAds `feat/auth` sobre `develop`, LeverPrice), só leitura.
>
> **Recomendação curta:** **não** levar o billing (dinheiro, faturas, cobrança) para o LeverId. Levar só o **direito de acesso** de cada org a cada produto, como **concessões por origem** (`core.org_products` + uma tabela de concessões), com regra de precedência explícita. O billing continua onde está (Cockpit + Mercado Pago), e cada produto continua dono de seats, cotas e flags.

---

## 1. Como é hoje

### 1.1 Quem cobra e quem libera

| | Cockpit | LeverAds | LeverPrice |
|---|---|---|---|
| Cobra? | **Sim**: vendas assistidas. Coleções `subscriptions` (active/past_due/paused/canceled, 4 ciclos), `invoices` (renewal/prorata/upsell/manual/installment), espelhos `mp_payments`/`mp_preapprovals`; motor de hora em hora (renovação, dunning com carência, `past_due`, pendingChange) | **Sim**: self-service. Checkout de assinatura recorrente no Mercado Pago (`/api/billing/create-checkout`), troca de plano com pró-rata, seats, cancelamento; Stripe legado | **Não**. Colunas herdadas do Levercopy, sem código que cobre; sem webhook de pagamento; sem compra no iOS |
| Onde fica | `cockpit.*` (JSON), dinheiro no Mercado Pago | tudo em `public.orgs` (sem tabela de assinatura, fatura ou pagamento) | `public.orgs` (outro banco, ids próprios) |
| Gate de acesso | — | `require_active_org`: `active` e CNPJ bloqueiam; libera por **cortesia** (`access_until`), **pagamento** (`payment_active` com contrato vigente) ou **trial** (prazo + cópias); 402 | `require_active_org` parecido + `leverprice_enabled` (404) |
| Quem libera | escreve só `payment_active` do LeverAds (sync a cada 10 min, dry-run por padrão) | webhook MP, webhook Stripe, super admin, Cockpit, cadastro, exclusão de conta | super admin, botão "Liberar" da tela de Integração, cadastro (5 dias), exclusão |

A recorrência pelo Mercado Pago (preapproval) **deixou de ser vendida pelo Cockpit em 10/09/2026**; as existentes são espelhadas e vinculadas à mão. O Mercado Pago é a verdade do dinheiro, e o Cockpit se declara dono de assinatura, fatura e dunning.

### 1.2 Problemas que o levantamento mostrou

1. **`payment_active` do LeverAds tem quatro escritores e ganha o último.** O webhook do Mercado Pago reescreve o campo a cada evento da assinatura self-service; o Cockpit reescreve a cada 10 min pelo billing comercial; o super admin a qualquer hora. Uma org com assinatura self-service autorizada **e** cliente `past_due` no Cockpit pisca entre liberada e bloqueada. Os webhooks também não limpam o cache da org (o efeito leva até 15 s).
2. **O LeverPrice não tem cobrança nem sync**: todo acesso pago é liberado à mão pelo super admin, sem ligação com o que o Cockpit sabe.
3. **Um cliente comprando dois produtos vira dois `customers` no Cockpit** (`customer.saas` é um valor só), e o vínculo com a org é específico do LeverAds (`leveradsOrgId`).
4. **"Plano" não manda em nada automaticamente**: `plan_id` do LeverAds não liga módulo nenhum; os módulos pagos (`compat_enabled`, `creator_enabled`, `messages_enabled`…) são flags ligadas à mão pelo super admin. No Cockpit, `plans` existe mas as assinaturas nascem com `plan:""`.
5. Restos: colunas mortas no LeverAds (`use_prorata_change_plan`, `mp_customer_id`, `mp_card_id`); ramo de downgrade agendado inalcançável (`prorata.py` recusa antes); comentários do LeverPrice falando de webhook que não existe mais.

## 2. Opções avaliadas

### A. Billing inteiro no LeverId
Assinaturas, faturas, planos e integração com o Mercado Pago num schema `billing` do LeverId (o "billing central" que saiu do escopo em 18/09).

- **Contra:**
  - o LeverId foi desenhado pequeno, isolado e sem dado de produto, porque derrubar ele derruba o login de todos; colocar cobrança, webhook e dinheiro lá aumenta a superfície e a carga do serviço mais crítico;
  - ARR/MRR, caixa, DRE, conciliação, remuneração, metas e marketing do Cockpit leem `subscriptions`/`invoices` direto — seria reescrever o financeiro do Cockpit;
  - dois fluxos de cobrança diferentes (venda assistida com parcelas e fatura manual; self-service com pró-rata e seats) teriam de virar um modelo só antes de mudar de lugar.
- **A favor:** um lugar só para "quem pagou o quê".
- **Veredito:** não agora. Custo alto, risco no serviço mais crítico, e o problema real (item 1.2) não exige isso.

### B. Direito de acesso no LeverId, billing onde está (recomendada)
O LeverId passa a responder "a org X tem acesso ao produto Y, até quando e por quê". Quem cobra (Cockpit, checkout do LeverAds) e quem libera à mão (staff) **concedem** acesso; os produtos **leem** o resultado.

- **A favor:**
  - resolve o escritor múltiplo (cada origem tem a sua concessão; ver seção 3);
  - dá ao LeverPrice a liberação automática que falta, pelo mesmo caminho do LeverAds;
  - prepara cliente multi-produto (uma org, vários produtos) e o portal do cliente;
  - não mexe no financeiro do Cockpit nem no checkout do LeverAds;
  - o LeverId continua sem dinheiro: guarda estado de acesso, não valores.
- **Contra:** mais uma dependência entre sistemas; exige a carga da Fase 1 do `PLANO-AUTH` em produção (orgs no `core`).

### C. Status quo com precedência no LeverAds
Resolver só o item 1.2.1 dentro do LeverAds (coluna de origem para `payment_active`).

- **A favor:** barato.
- **Contra:** não ajuda o LeverPrice nem o multi-produto; a regra fica presa num produto.
- **Veredito:** vale como remendo se B demorar; não como destino.

## 3. Desenho da opção B

### 3.1 Concessões por origem, não um booleano
O erro de hoje é um campo só com vários donos. No LeverId, cada origem é dona da **sua** linha:

| Tabela | Conteúdo |
|---|---|
| `core.org_products` | já existe: `(org_id, product)`, `status`. Passa a ser o **resultado** calculado (acesso efetivo), para leitura rápida e claim |
| `core.product_grants` (nova) | `(org_id, product, source)` PK; `kind` (`paid`, `trial`, `courtesy`, `block`); `active`; `until`; `reason`; `ref` (id da assinatura/contrato na origem); `updated_by`, `updated_at` |
| `core.product_grant_events` (nova) | histórico append-only de cada mudança (auditoria de "por que essa org perdeu acesso") |

Origens (`source`): `cockpit` (billing comercial), `leverads_checkout` (self-service MP), `trial` (cadastro), `staff` (liberação/bloqueio manual).

**Regra do acesso efetivo** (uma função SQL, testada em pgTAP):
1. existe `block` ativo → **sem acesso** (kill switch do staff vence tudo);
2. senão, existe qualquer concessão `paid`/`courtesy`/`trial` ativa e dentro do `until` → **com acesso**;
3. senão → sem acesso.

Assim o Cockpit marcar `past_due` só desliga a concessão **dele**; se a org também paga pelo checkout, continua liberada — e o motivo fica visível. Hoje isso é um pisca-pisca silencioso.

### 3.2 Quem escreve e quem lê
- **Escrita** por RPC (`identity_api.set_product_grant`, `SECURITY DEFINER`), com grant por origem: `svc_cockpit` só escreve `source='cockpit'` e `staff` quando o ator é staff; `svc_leverads` só `leverads_checkout` e `trial`. Mesmo padrão das RPCs de `core`.
- **Leitura pelos produtos**, em duas etapas:
  1. **transição**: o LeverId recalcula e o produto recebe o efetivo como hoje (o LeverAds grava `payment_active`/`access_until` locais a partir do LeverId — espelho, igual ao de memberships). O gate `require_active_org` não muda.
  2. **depois**: claim `products` no JWT (já previsto no plano da plataforma) para decisão rápida, e `core_replica` no RLS.
- **Continua no produto**: seats, cotas, limites por plano, flags de módulo, contrato (`contract_ends_at`) enquanto não houver equivalente. Um mapeamento "plano → módulos" pode vir depois, mas é decisão de produto, não de identidade.

### 3.3 Onde o billing fica
- **Cockpit**: continua dono de assinatura, fatura, dunning e financeiro. O `leverads-access.js` vira um escritor de concessão (`source='cockpit'`) para **qualquer** produto, a partir de `customer.orgId` (renomeação já prevista no `PLANO-AUTH`).
- **Checkout self-service do LeverAds**: continua cobrando; o webhook passa a escrever a concessão `leverads_checkout` em vez de `payment_active` direto.
- **Mercado Pago**: continua a verdade do dinheiro.

## 4. Plano de migração (sem downtime, reversível por flag)

| Etapa | O que | Depende de |
|---|---|---|
| 0 | Levantamento em produção: quantas orgs têm assinatura self-service autorizada, quantas pagam pelos dois caminhos, quantas estão liberadas por cortesia, quantas orgs do LeverPrice pagam | acesso de leitura a produção |
| 1 | Tabelas, função de acesso efetivo e RPCs no LeverId, com pgTAP; nenhum leitor | — (dá para fazer já, local) |
| 2 | Carga inicial das concessões a partir do estado atual (`payment_active` → `paid` com origem inferida; `access_until` → `courtesy`; trial → `trial`) e **modo sombra**: calcula o efetivo e compara com o `payment_active` de hoje, sem aplicar | Fase 1 do `PLANO-AUTH` em produção |
| 3 | Escritores em paralelo: Cockpit e webhook do LeverAds gravam a concessão **além** do campo de hoje | 2 |
| 4 | LeverAds passa a derivar `payment_active`/`access_until` do efetivo do LeverId (flag por org, depois geral) | 3 sem divergência por 2 semanas |
| 5 | LeverPrice ganha o mesmo espelho (fim da liberação manual) e o Cockpit o vínculo por produto | 4; de-para das orgs do LeverPrice (`core_org_id`) |

**Rollback** em qualquer etapa: desligar a flag; o campo local volta a ser escrito como hoje.

**Esforço (ordem de grandeza):** etapa 1 ~2–3 dias; etapas 2–3 ~1 semana somando os dois repos; etapa 4 ~3–4 dias com a janela de sombra; etapa 5 ~1 semana. Não inclui a Fase 1 do `PLANO-AUTH`.

## 5. Riscos
- **LeverId fora do ar**: o produto usa a última cópia local do acesso (hoje ela já existe: `payment_active`), então ninguém perde acesso por falha de infraestrutura; só mudanças de acesso atrasam.
- **Divergência na virada**: mitigada pelo modo sombra (etapa 2) e pela flag por org (etapa 4).
- **Precedência mal entendida**: a regra "block vence, qualquer concessão libera" precisa de validação comercial (ex.: cliente `past_due` no Cockpit que pagou pelo checkout deve continuar liberado? pela regra, sim).

## 6. Decisões para o time
1. Aprovar a opção B (direito de acesso no LeverId, billing fora).
2. A regra de precedência da seção 3.1, em especial "qualquer concessão paga libera".
3. O checkout self-service do LeverAds continua existindo? (O Cockpit parou de vender recorrência em 10/09; a etapa 0 mostra quantas orgs ainda dependem dele.)
4. Trial e cortesia passam a ser concessões no LeverId (recomendado) ou ficam no produto.
5. Prioridade: fazer a etapa 1 já (local, sem risco) ou esperar a Fase 1 do `PLANO-AUTH` em produção.

## 7. Achados paralelos (independem da decisão)
- LeverAds: webhooks de billing não limpam o cache da org (até 15 s de atraso no paywall).
- LeverAds: colunas sem uso (`use_prorata_change_plan`, `mp_customer_id`, `mp_card_id`) e ramo de downgrade agendado inalcançável em `billing.py`.
- LeverPrice: comentários citam webhook de pagamento e Stripe que não existem mais.
- Cockpit: `plans` não se liga às assinaturas (`plan:""`), então "plano" hoje é só rótulo.
