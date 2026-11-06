# Etapas do SDR (LeverAds): quando cada uma entra e sai — levantamento de 06/11/2026

> **Decisão de 06/11/2026 (implementada no código, ainda não publicada):** o lead fica em
> Novo lead, segue Dia 2 … Dia 7 e só vai pra Qualificando quando a cadência termina.
> Mensagem do lead não move mais o card; o corte do robô vai pra Nutrição. O retrato abaixo
> é do comportamento ANTES dessa mudança.

Levantamento do código atual (`main` em `f75a547e`) cruzado com o banco de produção
(leitura, 06/11/2026). Números de "30 dias" vêm das activities `type: stage` do LeverAds.

## Configuração vigente em produção

- Funil: **Novo lead** (`novo`) → **Dia 2…Dia 7** (`contato`) → **Qualificando** (`qualificacao`)
  → **Call agendada** (`call`) → **Follow-up** → **Ganho** → **Integração** → **Acompanhamento**.
  Laterais: **Desqualificado**, **Nutrição** (`contato`), **No show** (`contato`), **Mentoria** (`outro`).
- `app_config/cadencia_dias.enabled = true` desde 11/09/2026 (colunas de dia + relógio ligados).
- Robô SDR (`products.leverads.sdrBot`): 1º toque (1 min após o cadastro, janela de 24h),
  2º toque, escada de retomada, corte pra Nutrição, conversa com IA e resgate de backlog ligados.
- Hoje: Qualificando 619 · Nutrição 1072 · Novo lead 5 · Dia 2–7 juntos 30.
  **323 dos 619 cards em Qualificando nunca tiveram um toque humano registrado.**

## Movimentos automáticos nos últimos 30 dias

| De → Para | Quem | Qtde | Gatilho |
|---|---|---:|---|
| Novo lead → Qualificando | system | **703** | mensagem recebida do lead (`promoverPorResposta`) |
| Qualificando → **Dia 2** | sdr-bot | **529** | corte da escada do robô (bug: devia ser Nutrição) |
| Dia 2 → Nutrição | system | 523 | relógio da cadência corrigindo o card acima |
| Qualificando → Call agendada | sdr-bot | 251 | robô marcou a call |
| Novo lead → Dia 2 | system | 134 | relógio (virou o dia desde o cadastro) |
| Dia 2→3→4→5→6→7 | system | ~110 cada | relógio |
| Dia 7 → Nutrição | system | 108 | relógio (8º dia) |
| Nutrição → Qualificando | sdr-bot | 51 | robô respondeu um lead da Nutrição |
| Call agendada → Qualificando | sdr-bot | 35 | robô desmarcou a call |
| Novo lead → Desqualificado | system | 18 | número sem WhatsApp |

Dos 703 "Novo lead → Qualificando": **590 aconteceram menos de 2 minutos depois do cadastro**
e 602 tinham como mensagem recebida o texto pronto do formulário. É exatamente o caso
"terminou o formulário, mandou a mensagem no WhatsApp e caiu em Qualificando".

---

## Etapa por etapa

### 1. Novo lead (`novo`)

**Entra quando**
- Formulário enviado e aprovado: nasce na 1ª etapa do funil (`forms/routes.forms.js:172`).
  Reprovado vai direto pra Desqualificado; saída lateral (ex.: Mentoria) vai pra etapa da saída.
- Conversa no WhatsApp sem cadastro (walk-in): o robô cria o card em Novo lead
  (`sdr/sdr-brain.js:423`, `adoptWalkIn`).
- Lead parado (desqualificado ou fora das etapas do robô) que manda o texto do formulário de novo:
  card reaberto em Novo lead (`sdr/sdr-brain.js:615`, R-090). Esse movimento usa `repo.update`
  direto, **sem `applyStageMove`**: não gera histórico de etapa.
- Criação manual ou pela API.
- Reenvio de formulário por quem já tem card **não** mexe na etapa (dedup preserva o funil).

**Sai automaticamente quando**
- **Qualquer mensagem recebida do lead → Qualificando** (`whatsapp/wa-store.js:184` e `:192`).
  Conta inclusive a mensagem pronta do formulário. ⚠️ Problema 1.
- **Vira o dia desde o cadastro → Dia 2** (`crm/cadencia-runner.js`, de hora em hora;
  `crm/cadencia-stages.js:56`, relógio = `cadenciaDesde || createdAt`). Não espera o SDR humano;
  `cadenciaDesde` nunca é gravado por nenhum código. ⚠️ Problema 2.
- Cadastro com mais de 7 dias ainda em Novo lead → Nutrição direto (mesmo relógio).
- Número sem WhatsApp (falha 131026/131021/131000) e lead nunca respondeu → Desqualificado
  (`wa-store.js`, `disqualifyInvalidNumber`).
- Robô marca a call → Call agendada (`sdr-brain.js:302`, `bookCall`).
- Escada do robô terminada + 48h sem resposta → "Dia 2" (bug) → Nutrição (ver Qualificando).

**O que NÃO move** (com as colunas de dia): o 1º toque do robô, mensagem enviada pelo inbox,
ligação ou "Retomar" registrado no Meu dia (`crm/lead-flow.js:402`, `:443`;
`web/src/screens/today.jsx:2120`). Ou seja, **hoje nenhuma ação do SDR humano inicia a
cadência**; ela começa sozinha no cadastro.

**Humano pode:** Retomar (registra tentativa, fica na etapa), Agendar call, Desqualificar.

### 2. Dia 2 … Dia 7 (`contato`, cadência de 7 dias)

**Entra quando:** só pelo relógio, contado do cadastro (ver Problema 2). Os dias são de
calendário (fim de semana conta).

**Sai quando**
- Relógio: vai pro dia seguinte; no 8º dia → Nutrição. Se o funil não tem Nutrição, o card para.
- Mensagem recebida do lead → Qualificando (mesmo `promoverPorResposta`; também conta a mensagem
  pronta do form se ela chegar nessa fase).
- Humano: Qualificando ("ele respondeu", p.ex. por ligação), Agendar call, Nutrição, Desqualificar.
- Robô marca call → Call agendada.

**Observações**
- O robô **não** faz 2º toque, escada nem cobrança de oferta pra quem está em Dia N: esses
  passos só olham `novo` e `qualificacao` (`sdr/sdr-flow.js:802`, `:892`, `:1081`). A cadência
  de 7 dias aqui é só humana; o robô só responde se o lead falar.
- Mensagem enviada nessas colunas (robô ou inbox) não move o card (`lead-flow.js:443`).

### 3. Qualificando (`qualificacao`)

**Entra quando**
- Lead manda qualquer mensagem estando em Novo lead ou Dia N (automático; 703 em 30 dias).
- Robô ou inbox manda mensagem pra lead em **Nutrição** (kind `contato` que não é coluna de dia)
  → `onOutboundMessage` promove (`lead-flow.js:429`). 51 em 30 dias.
- Robô desmarca a call (`sdr-brain.js:341`, `cancelCall`). 35 em 30 dias.
- Humano move.
- Em funil **sem** colunas de dia (hoje: UniqueKids), o 1º toque de qualquer um (robô, inbox,
  ligação registrada) já leva Novo lead → Qualificando (`lead-flow.js:402`).

**Sai quando**
- Robô marca call → Call agendada (251 em 30 dias).
- Escada do robô (R-102) terminou e 48h sem resposta → deveria ir pra Nutrição, mas vai pra
  **Dia 2** (`sdr/sdr-flow.js:987`: `stageByKind(product, "contato")` pega a 1ª etapa
  `contato` do funil, que virou o Dia 2 em 11/09). Na hora seguinte o relógio vê o card em
  Dia 2 com cadastro antigo e manda pra Nutrição. ⚠️ Problema 3.
- Humano: Agendar call, Nutrição, Desqualificar.

**Régua de toques aqui:** escada do robô (frio: 1º toque, +24h, +5d encerramento; morno: +3d,
+8d, +13d encerramento), mais a cadência do funil (`retryDays 1, maxAttempts 2`) que só
reagenda o GPS do humano.

### 4. Nutrição (`contato`)

**Entra quando:** relógio após o Dia 7 (108); corte da escada via o desvio pelo Dia 2 (523);
humano a partir do Follow-up (75), Qualificando ou Dia N.

**Sai quando**
- Lead responde e o robô responde de volta → Qualificando (pela mensagem **nossa**, não pela
  dele: `promoverPorResposta` não age em Nutrição).
- Resgate de backlog manda template sem mover o card (R-103).
- Humano: Call, Qualificando, Desqualificar.

**Divergência:** R-090 diz que lead parado em **nutrição** que manda o texto do form de novo
"reabre em Novo lead". O código não reabre Nutrição, porque Nutrição é `contato` e está nas
etapas atendidas pelo robô (`BRAIN_KINDS`); o card vai pra Qualificando quando o robô responde.

### 5. Call agendada (`call`)

**Entra quando:** robô marca (de Novo lead, Dia N, Qualificando ou Nutrição); humano agenda;
PATCH com `callAt` futuro num card em No show (`crm/routes.crud.js:860`).

**Sai quando:** humano marca No show, Follow-up, Integração/Ganho ou Desqualificado; robô
desmarca a call → Qualificando.

### 6. Laterais

- **No show:** só humano coloca; volta pra Call agendada ao remarcar. Mensagens nossas não movem.
- **Desqualificado:** formulário reprovado, número inválido (automático) ou humano.
- **Mentoria:** saída lateral do formulário.

---

## Problemas encontrados

1. **Mensagem do lead tira o card do Novo lead** (o caso relatado). `promoverPorResposta`
   considera o Novo lead parte da cadência e não separa a mensagem pronta do form
   (`isFormMessage`, em `sdr/sdr-signals.js:13`, já existe e não é usada ali).
2. **A cadência de 7 dias começa no cadastro, não na marcação do SDR humano.** O relógio usa
   `createdAt`; nada grava `cadenciaDesde`. Mesmo corrigindo o item 1, o card iria sozinho pro
   Dia 2 no dia seguinte.
3. **Corte da escada manda pro Dia 2 em vez da Nutrição** (`sdr-flow.js:987`), gerando 529
   movimentos falsos em 30 dias e um salto extra no histórico. O front já contorna a mesma
   colisão resolvendo a Nutrição pelo nome (`nurtureStage`, `today.jsx:2139`); o servidor não.
4. **Duas réguas paralelas.** O robô faz a escada em Novo lead e Qualificando; a cadência de
   dias é outra régua, que o robô ignora. Com o item 2 corrigido, um lead parado em Novo lead
   esperando o humano receberia a escada inteira do robô e poderia ser cortado pra Nutrição
   sem nenhum humano ter agido.
5. **Nutrição → Qualificando pela mensagem nossa**, e não pela resposta do lead; e R-090 promete
   reabrir Nutrição em Novo lead, o que o código não faz. A reabertura que existe (desqualificado)
   não passa por `applyStageMove`.
6. **Funis sem colunas de dia** (UniqueKids) seguem a regra antiga: 1º toque promove pra
   Qualificando.
7. **Sem rede de proteção pro Novo lead parado.** O alerta de "sem 1º contato" só vale até 7
   dias depois do prazo (`customers/crm-alerts.js:126`). Se o card passar a esperar o humano,
   precisa de um SLA visível.

## Proposta de regra (para validar)

| Etapa | Entra | Sai |
|---|---|---|
| Novo lead | form, walk-in, reabertura pelo form | **só** quando o SDR humano registra o 1º contato (inicia a cadência), marca call ou desqualifica; robô marcando call também tira |
| Dia 2–7 | relógio contado da marcação do SDR humano (`cadenciaDesde`) | dia seguinte; Nutrição no 8º dia; resposta **real** do lead → Qualificando; humano |
| Qualificando | resposta real do lead durante a cadência; humano; call desmarcada | call marcada; humano; corte → **Nutrição** |
| Nutrição | 8º dia da cadência; corte da escada; humano | resposta real do lead → Qualificando (pela mensagem dele); humano |

Decisões em aberto:

1. O que conta como "SDR humano marcou": registrar a tentativa no Meu dia ("Retomar"),
   ligação registrada, qualquer mensagem humana no inbox, ou um botão explícito
   "Iniciar cadência"?
2. Enquanto o lead está em Novo lead esperando o humano, o robô continua mandando 1º toque,
   2º toque e escada? E pode cortar pra Nutrição sem o humano ter agido?
3. Resposta real do lead **em Novo lead** (não a mensagem do form): fica em Novo lead até o
   humano marcar, ou vai pra Qualificando?
4. Vale a mesma regra pro funil da UniqueKids?
5. Os 619 cards de Qualificando (323 sem toque humano): migrar parte deles de volta, ou só
   corrigir daqui pra frente?
