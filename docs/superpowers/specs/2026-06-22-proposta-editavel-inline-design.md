# Design — Contas no lead (bug) + Proposta editável inline

> Spec de 2026-06-22. Dois problemas relacionados num funil só (form → lead →
> proposta). Contexto base: `docs/PLANO-REWORK.md` (fases 1 e 2).
> Decisões do dono fechadas em 2026-06-22 (ver §Decisões).

## Decisões do dono (2026-06-22)
1. Editáveis inline: os **5** valores (contas, volume, ciclo, preço, validade).
2. **Auto-salva** a cada alteração (sem botão "congelar").
3. Painel flutuante **sai 100%** — edição é só clicando no texto.
4. **Backfill** dos 8 leads/propostas já capturados.
5. Contas é **faixa** (mantém "3-5 contas"), não número preciso.
6. Preço = **fórmula atual** (`base + extra/conta além das incluídas`) usando o
   **topo da faixa** como nº de contas (3-5→5, 6-10→10).
7. Faixa aberta **"10+" → 10** contas na fórmula.

## Problema 1 — nº de contas não chega no lead/proposta

### Sintoma
Leads do form `fo_diagnostico_leverads` não carregam a quantidade de contas que o
lead preencheu. A proposta mostra sempre **2 contas** (default) e o texto
`{{answers.accounts}}` sai vazio.

### Causa raiz (verificada no banco de prod)
- A pergunta de contas no form tem a chave
  `quantas_contas_de_marketplace_voce_opera`.
- O template `pt_leverads` espera a chave de contrato `accounts`
  (`calc.seatsKey = "accounts"`; 2 slides usam `{{answers.accounts}}`).
- Mismatch → `lead.accounts` nunca é preenchido → `initialState()` cai em
  `seatsMap[undefined] || included || 2` = **2 assentos**; `{{answers.accounts}}`
  interpola vazio.
- Confirmado: 8 leads do form, **todos** com `accounts = undefined` e o valor real
  preso em `quantas_contas_de_marketplace_voce_opera` ("1", "2", "3-5"…).

### Causa do drift (por que a chave mudou)
`web/src/screens/forms.jsx:383` — ao editar o **rótulo** de uma pergunta, a chave é
re-derivada via `slug(label)` sempre que `!_keyTouched`. `_keyTouched` só existe na
sessão (não persiste); numa carga de form salvo é `undefined`, então **qualquer**
edição de rótulo reescreve a chave. O dono editou o texto da pergunta de contas → a
chave de contrato `accounts` virou o slug do rótulo. Mesmo risco vale para
`staff`/`volume`/`niche`/`marketplaces`/`plan_expand`.

### Correção (3 partes)

**1.1 — Builder não reescreve chave de pergunta existente** (`forms.jsx`)
Auto-derivar a chave do rótulo **só enquanto a chave veio em branco** (pergunta nova
sendo digitada). Pergunta carregada (já tem chave) → editar o rótulo nunca toca na
chave.
- Sentinela `_keyAuto`: a pergunta nova nasce com `_keyAuto: true` (preserva o
  auto-preenchimento ao digitar). Pergunta carregada não tem a flag e já tem chave →
  travada.
- Condição nova (l.383): derivar quando `!q._keyTouched && (q._keyAuto || !chave)`.
- Edição manual da chave continua setando `_keyTouched` (l.390) e trava o auto.
- `_keyAuto`/`_keyTouched` não persistem (o `save()` reconstrói a pergunta de campos
  explícitos, l.197-218). Sem mudança no payload salvo.

**1.2 — Renomear a chave no form de produção** (migração de dados)
Em `fo_diagnostico_leverads`: `quantas_contas_de_marketplace_voce_opera` →
`accounts`. Opções/branching ficam nas próprias opções (`to`), independem da chave →
seguro. Mapping (name/email/phone/company) não referencia contas. Novos envios
passam a gravar `lead.accounts`.

**1.3 — Backfill dos 8 leads + propostas** (migração de dados, uma vez)
- Cada lead do form com a chave antiga: `accounts = <valor antigo>`; remove a chave
  antiga (senão vira "resposta" lixo em `splitLeadData`).
- Cada proposta desses leads, **se não estiver `frozen`**: `data.answers.accounts =
  <valor>` (remove a chave antiga de `data.answers`), `state.accounts = <valor>` e
  `state.seats = seatsMap[valor]` (novos topos, ver §2). Proposta `frozen` (closer já
  ajustou) não é tocada.
- Script roda no banco compartilhado (dev = prod) → reflete em prod na hora.

> Deploy: 1.2 e 1.3 são dados (refletem em prod imediatamente). 1.1 e o renderer do
> Problema 2 são código (precisam de `git push` → auto-deploy).

## Problema 2 — proposta editável inline (sai o painel flutuante)

### Objetivo
O closer valida os números reais com o lead e ajusta clicando **direto no texto da
proposta** — sem painel separado, sem botão "gerar de novo", sem cara de modo de
edição para o lead.

### O que já existe (reaproveitar)
- Valores de `state.*`/`calc.*` viram `<span data-fill>`; `fillDynamic()` recalcula
  tudo ao vivo (`compute()` deriva preço/ROI/fatura de `state`).
- `state` = `{ seats, volume, cycle, customPriceCents, validUntil, frozen }`.
- `PATCH /public/proposals/:id` aceita os campos de estado + `frozen`, autenticado
  pelo `editKey` (`?k=`).
- Lead sem `?k` → página não-editável, renderiza o `state` salvo. O que o closer
  salva é exatamente o que o lead vê depois.

### Modelo de contas = faixa + preço por topo da faixa
- **`state.accounts`** (novo) = a faixa escolhida (string: "1","2","3-5","6-10",
  "10+"). É o valor editável inline (dropdown das faixas do form).
- **`state.seats`** continua sendo o inteiro que alimenta a fórmula e o custo/ROI,
  mas agora **derivado da faixa** = `seatsMap[state.accounts]` (topo da faixa).
- **`calc.seatsMap`** de `pt_leverads` muda para os topos:
  `{"1":1, "2":2, "3-5":5, "6-10":10, "10+":10}`. (Mesma chave `seatsMap`, semântica
  agora "faixa → nº de contas usado na fórmula".)
- Preço/mês = fórmula atual inalterada: `base + max(0, seats−included) × extra` por
  ciclo. Resultado (semestral, base 300 + 59,90, incl. 2): 1→300, 2→300, 3-5→479,70,
  6-10→779,20, 10+→779,20. Custo oculto/ROI usam o mesmo `seats` (topo).
- **Exibição**: a faixa aparece como texto ("3-5 contas") onde hoje há
  `{{answers.accounts}}` (hero, card) e onde há `{{state.seats}} contas` (sub do
  pricing — migra para `{{state.accounts}}`). `{{calc.contasDestino}}` (= seats−1)
  segue numérico (faz parte da narrativa de custo, não é o "perfil de contas").

### Abordagem da edição inline
Clique-no-texto sobre os spans `data-fill` ligados aos campos de estado (reusa
`fillDynamic`). Alternativas descartadas: `contentEditable` na página inteira
(quebra o vínculo com a calculadora); manter painel + inline (dono removeu o painel).

Mapa de edição (span → campo → controle):
| Campo | Controle inline | Spans clicáveis |
|---|---|---|
| accounts (contas) | dropdown das faixas (`seatsMap` keys) | answer-span de `seatsKey` (hero/card), `state.accounts` (pricing sub) |
| volume | select (chaves de `volumeMid`) | answer-span de `volumeKey`, `state.volume`, `calc.volume` |
| cycle (ciclo) | select (planos disponíveis) | `calc.plano`, `calc.ciclo` + grade de planos já clicável |
| price (preço) | input número "R$ /mês", vazio = auto | `calc.preco` |
| validUntil (validade) | input date | `state.validUntil` |

Derivados (`contasDestino`, `precoCiclos`, `totalCiclo`, `parcelado`, fatura, ROI)
ficam **não-editáveis** — atualizam sozinhos quando a fonte muda.

Vínculo answers→estado (atende "clica no nº de contas em qualquer lugar"): na
interpolação, `{{answers.K}}` com `K === calc.seatsKey` vira o span editável de
**accounts** (mostra a faixa, `state.accounts`); com `K === calc.volumeKey`, o de
**volume**. Demais respostas (`staff`, `niche`…) seguem texto estático.

### UX da edição
- **Afford**: só no modo closer (`?k`). Span editável ganha sublinhado pontilhado +
  cursor + lápis discreto no hover. Lead (sem `?k`) → texto normal, zero affordance.
- **Clique** → popover ancorado no span com o controle do campo. Escolheu/digitou →
  atualiza `state` → `fillDynamic()` → **auto-salva** (PATCH, debounce ~600ms) →
  "salvo ✓" discreto perto da nav.
- Sem botão "congelar". `state.frozen` passa a `true` na 1ª edição (registro de
  "closer mexeu"); o lead vê sempre o último estado salvo.
- Banner fino só-closer: "Modo closer · clique nos números p/ ajustar · salva
  sozinho".
- Grade de planos (cards de ciclo) no modo closer também auto-salva ao clicar.

### Escopo de arquivos
- `api/src/proposal-page.js` — troca `mountEditor()` (painel) por
  `mountInlineEdit()`; CSS do painel sai, entra CSS de affordance + popover; ajuste
  na interpolação (`fmt()` + builder `custom`) p/ o vínculo answers→accounts/volume;
  controle de accounts = dropdown de faixas; `state.accounts`→`state.seats` derivado.
- `api/src/proposal.js` — `initialState()` grava `state.accounts` (faixa) e deriva
  `seats = seatsMap[faixa]`.
- `api/src/routes.proposals.js` — PATCH aceita `body.accounts` (string ∈
  `p.calc.seatsMap`) e recalcula `state.seats = seatsMap[accounts]` no servidor
  (autoritativo). Mantém aceitar `seats`/`volume`/`cycle`/`customPriceCents`/
  `validUntil`/`frozen` (não quebra os testes existentes).
- `web/src/screens/forms.jsx` — fix 1.1 do builder.
- Dados (`pt_leverads`): `calc.seatsMap` → topos; slide pricing `sub` usa
  `{{state.accounts}}` no lugar de `{{state.seats}}`.

## Verificação (metas)
1. `cd packages/api && npm test` — suíte continua verde (PATCH retrocompatível;
   nenhum teste depende do painel). Adicionar teste do PATCH p/ `accounts` →
   `seats = topo`.
2. Builder: editar rótulo de pergunta com chave existente **não** muda a chave;
   pergunta nova ainda auto-preenche ao digitar (e2e manual no SPA).
3. Dado novo: enviar o form com "3-5" → `lead.accounts === "3-5"` → proposta com
   `state.accounts === "3-5"`, `state.seats === 5`, preço semestral R$ 479,70.
4. Backfill: 8 leads ganham `accounts`; propostas não-`frozen` recalculam faixa/seats.
5. Inline e2e (browser, `?k=`): clicar contas (faixa)/volume/ciclo/preço/validade
   ajusta ao vivo e auto-salva; reabrir sem `?k` mostra o salvo; sem affordance pro
   lead.

## Fora de escopo
- Editar copy livre (texto corrido) — só os 5 valores estruturados.
- PDF server-side, WhatsApp por proposta (pendências da fase 2).
- Guard automatizado contra drift de chave (lógica de slug é inline no JSX, sem infra
  de teste de front; a correção 1.1 é a barreira).
