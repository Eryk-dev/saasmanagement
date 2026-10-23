# Plano: régua de ICP configurável por produto

> **Status (22/10/2026): fases 1 a 4 implementadas localmente (sem commit); fase 5 com levantamento feito e régua da UniqueKids proposta, aguardando o time.** Decisões do Yudi em 22/10/2026:
> (1) regra nova vale para o passado; (2) uma régua só para métricas **e** operação;
> (3) precisa servir a todos os produtos, inclusive os futuros; (4) editar exige
> permissão atribuída em Ajustes → Equipe.

## Por quê

A nota S–E e o ICP estão em constantes espalhadas pelo código e só o LeverAds tem
régua por faturamento. Mudar um corte exige deploy, e a mudança de 21/09
(contas × anúncios → pedidos × ticket) deixou o "% de ICP" de agosto (30%) e de
outubro (13%) incomparáveis: setembro mistura as duas réguas (406 leads por
faturamento, 314 pela matriz antiga — medido em produção em 22/10/2026).

## Estado atual (conferido no código em 22/10/2026)

| Regra | Onde | Valor |
|---|---|---|
| Valor médio por faixa de pedidos e ticket | `api/src/shared/lead-grade.js` (`MID_ORDERS`, `MID_TICKET`) | 100/350/750/1.500/3.000 · R$ 50/110/225/450/800 |
| Cortes S–E | `shared/lead-grade.js` (`REVENUE_BANDS`) | R$ 1 mi · 500 mil · 200 mil · 100 mil · 50 mil |
| Matriz legada contas × anúncios | `shared/lead-grade.js` (`LEGACY_*`) e cópia em `crm/classificacao.js` (`GRID`, `IDX_*`) | 5×5 |
| Notas que são ICP | `metrics/metrics-core.js` (`ICP_GRADES`) | S/A/B |
| Ação, cadência e MQL (nota × intenção) | `crm/classificacao.js` (`ACOES`, `CADENCIA_DA_ACAO`, `mql`) | tabela fixa |
| Porte por linha (Ads/OEM/Price) e piso de GMV | `crm/classificacao.js` (`porte*`, `PISO_GMV_*`) | o piso só ajusta a matriz legada; no LeverAds não tem efeito, porque quem tem pedidos e ticket já usa faturamento |
| Texto do selo e do cartão | `product.icp` (`headline`, `pill`, `profile`, `redFlags`) | gravado pela migração `ensureRevenueClassification`, sem edição na tela |

`revenueGrade` devolve `null` fora do LeverAds; os outros produtos só têm nota se
o lead tiver contas/anúncios.

**Quem consome a nota** (64 usos em 20 arquivos):

- **Exibição:** `leadTier` (`web/src/lib/ui.js`) em Pipeline, Meu dia, WhatsApp, Clientes, Negócio, Formulários, Visão geral e blocos do lead.
- **Métricas:** "Com ICP" do Desempenho (`scoreboard.js`), contagem e custo por nota na Publicidade (`routes.marketing.js`), notas por variante (`routes.forms.js`).
- **Operação:** pool do closer sênior (`crm/agenda-slots.js`, `UPPER_GRADES = ICP_GRADES`), ordem do Meu dia, snapshot `lead.classificacao` (porte, ação, cadência, MQL, primário/cross-sell), cérebro e replay do SDR (`sdr-brain.js`, `sdr-replay.js`), proposta (`proposal-catalog.js`).

## Modelo

A régua mora no produto, em `product.icp.rules`. Um produto sem `rules` usa o
padrão embutido, idêntico ao comportamento de hoje — nada muda até alguém editar.

```js
icp: {
  headline, pill, profile: [], redFlags: [], contact,   // texto (já existe)
  rules: {
    version: 1, updatedAt, updatedBy, note,
    value: { label: "Faturamento mensal estimado", prefix: "R$", suffix: "/mês" },
    // Métodos em ordem: o PRIMEIRO cujas respostas o lead tem decide a nota.
    methods: [
      { id: "faturamento", type: "produto",
        axes: [
          { key: "orders", values: { "0-200": 100, "200-500": 350, "500-1000": 750, "1000-2000": 1500, "2000+": 3000 } },
          { key: "ticket", values: { "0-70": 50, "70-150": 110, "150-300": 225, "300-600": 450, "600+": 800 } },
        ],
        bands: [{ grade: "S", min: 1000000 }, { grade: "A", min: 500000 }, { grade: "B", min: 200000 },
                { grade: "C", min: 100000 }, { grade: "D", min: 50000 }, { grade: "E", min: 0 }] },
      { id: "legado", type: "matriz", legacy: true,
        rows: { key: "accounts", index: { "1": 0, "2-3": 1, "4-6": 2, "7-10": 3, "10+": 4, "2": 1, "3-5": 2, "6-10": 3 } },
        cols: { keys: ["listings", "volume"], index: { /* LEGACY_LISTINGS e LEGACY_VOLUME */ } },
        grid: [["E","D","C","C","C"], /* … LEGACY_GRID */] },
    ],
    icpGrades: ["S", "A", "B"],
  },
}
```

- **Tipos de método.** `produto` multiplica os valores dos eixos e aplica as faixas (pedidos × ticket; um eixo só vira faixa simples). `soma` soma pontos e aplica as faixas (pontuação). `matriz` cruza dois eixos numa grade de letras. Cobre o LeverAds de hoje e produtos futuros sem código novo.
- **Letras fixas S–E.** Um produto pode usar menos faixas; `GRADE_STYLE` e as cores não mudam.
- **Eixos vêm das perguntas do produto.** O editor oferece as chaves e opções de `product.leadQuestions` e dos formulários publicados do produto, para o valor médio nunca apontar para uma opção que não existe. Opção sem valor é aviso na tela, não erro silencioso.
- **`gradeInfo`** devolve `{ grade, method, legacy, value, version }`; o badge mostra o método ("pedidos × ticket médio", "Legado") pelo `method`, não por um texto fixo.

### Uma régua para tudo

- `shared/lead-grade.js` continua puro e ganha `rules` como parâmetro: `leadGradeInfo(lead, rules = defaultRules(lead.saas))`.
- **API:** quem tem o produto passa `product.icp?.rules`. `isIcpLead`, `UPPER_GRADES` e `classificar` deixam de ler constantes.
- **SPA:** um registro em `web/src/lib/` (`setGradeRules(saas, rules)`), alimentado pelo bootstrap e pelo SSE de produtos. Com isso, `leadTier(l)` acha a régua por `l.saas` sem mudar as ~25 chamadas das telas. O registro fica fora de `shared/`, que só importa de si mesmo.
- **`classificar`:** `porte` passa a ser a nota da régua do produto. Os portes por linha (`porteAds/Oem/Price`) ficam só para escolher o primário e o cross-sell quando não há `formProduct`, e deixam de ser nota. Isso elimina a divergência medida entre o snapshot gravado e a métrica (6 leads em 22/10). A matriz de ação, cadência e MQL usa os grupos da régua; ela fica fixa até a fase 4.

### Regra vale para o passado

- Métricas e badges já calculam a nota na hora, a partir das respostas do lead. Com a régua no produto, toda tela passa a usar a versão vigente para todo o histórico.
- O snapshot `lead.classificacao` é recalculado por um job ao salvar uma versão nova: em lotes, gravando `classificacao.version = rules.version`, sem mexer em etapa, responsável, agenda ou cadência em andamento (mesmo contrato do `ensureRevenueClassification`). O mesmo job roda no boot para pegar o que ficou para trás.
- Lead sem as respostas de nenhum método fica sem nota, como hoje.
- As métricas mostram a base: quantos leads foram avaliados por cada método (ex.: "412 por pedidos × ticket, 37 pelo legado, 20 sem nota").

### Permissão

- Nova tela `icp` em `SCREEN_IDS`, marcável em Ajustes → Equipe ("Editar ICP").
- **Ler** a régua fica aberto (todas as telas precisam dela).
- **Editar, pré-visualizar e restaurar** exigem a etiqueta `admin` **ou** a tela `icp` marcada explicitamente. A lista de telas vazia, que hoje significa "acesso total", não concede esta, no mesmo molde de `ADMIN_PREFIXES` da Remuneração.
- A trava fica na API (`auth/screens.js`), não só no menu. Testes em `screens.test.js`.

### Histórico e prévia

- **Coleção `icp_versions`** `{ saas, version, rules, text, by, at, note }`: uma linha por versão salva, para auditoria e para restaurar uma versão anterior (que vira uma versão nova).
- **`POST /api/products/:id/icp/preview`** recebe a régua proposta e compara com a vigente nos leads do produto (90 dias e total):
  - matriz de mudança de nota (de → para);
  - quantos entram e saem do ICP;
  - calls agendadas que trocariam de pool (sênior ↔ júnior);
  - "% de ICP por mês" antes e depois.
- **`PUT /api/products/:id/icp`** valida (faixas em ordem decrescente, letras únicas, `icpGrades` não vazio, eixos com chave existente), grava, registra a versão e dispara o recálculo.

## Fases

1. **Motor genérico com paridade.**
   - `lead-grade.js` com `rules` e os três tipos de método.
   - Regra padrão do LeverAds montada das constantes atuais e padrão "só matriz legada" para os outros produtos, igual a hoje.
   - Todos os consumidores da API e o registro na SPA passam pela régua.
   - Teste de paridade: mesma nota, ICP e pool para a grade completa de faixas novas e legadas e para produtos sem régua.
   - Sem tela; zero mudança de comportamento.
   - **Feito em 22/10/2026:** motor em `shared/lead-grade.js` (`leadGradeInfo(lead, rules)`, `gradeRulesOf`, `defaultRules`, `icpGradesOf`, `isIcpGrade`, `LEVERADS_RULES`, `MATRIX_RULES`); `leadGrade`/`isIcpLead` aceitam a régua; placar, Publicidade, Formulários, agenda (pool do sênior), cérebro e replay do SDR passam `gradeRulesOf(product)`; na SPA, `lib/grade-rules.js` é alimentado pelo `hydrateSeed` e o `leadTier` usa a régua do produto do lead. Paridade: `test/icp-rules.test.js` (grade completa contra a implementação antiga) e 0 divergência nos 2.899 leads de produção.
   - O `porte` do snapshot ficou para a fase 2 (feito, abaixo).
2. **API de edição:** permissão `icp`, `PUT` com validação, `preview`, `icp_versions`, recálculo do snapshot (job no domínio `crm`, gated por `jobOn`) e o boot genérico no lugar do `ensureRevenueClassification`.
   - **Feito em 22/10/2026:**
     - rotas em `crm/routes.icp.js`: `GET /api/products/:id/icp`, `GET …/icp/versions`, `POST …/icp/preview`, `PUT …/icp` (`{ text?, rules?, baseVersion?, note? }`; 409 se `baseVersion` não bate, 400 com `errors`);
     - lógica em `crm/icp.js` (`saveIcp`, `icpPreview`, `recalcClassifications`) e validação pura em `shared/icp-rules.js`;
     - permissão `icp` em `auth/screens.js` (`canEditIcp`, `ICP_EDIT_PATH`): admin ou marcada explicitamente; o CRUD genérico recusa `icp` no corpo de `products`; `icp_versions` é coleção privada;
     - `classificar` usa a régua do produto para o `porte`; `classificationPatch` (CRUD, reenvio de formulário) e `regradePatch` (régua nova, boot) só regravam quem mudou de nota e mantêm a intenção já medida;
     - o boot (`ensureRevenueClassification`) recalcula todos os produtos; texto editado marca a atualização única do texto como feita.
   - O recálculo roda dentro do `PUT` (síncrono, só grava quem mudou), não como job de fundo: a edição é rara e a tela recebe o total recalculado.
   - A permissão virou ETIQUETA (`icp`, "Editor de ICP" em Ajustes → Equipe), não tela: na Equipe, lista de telas vazia é acesso total, e marcar uma tela restringiria a pessoa a ela.
3. **Tela Ajustes → ICP:** texto do cartão e do selo, métodos (eixos, valores, faixas, matriz), notas de ICP, prévia de impacto antes de salvar, histórico com restauração. Revisar com `.claude/skills/cockpit-ui-review`.
   - **Feito em 22/10/2026:** Configurações → **ICP & nota** (`web/src/screens/settings-icp.jsx`): cartão (selo, título, contato, perfil e sinais vermelhos, salva sem prévia), notas de ICP, unidade do valor, métodos em ordem (subir/descer/remover/legado; produto e soma editáveis por pergunta de `product.leadQuestions`, com aviso de opção fora do formulário; matriz só leitura), faixas com o valor formatado, **prévia obrigatória** do rascunho atual antes de "salvar régua" (motivo vai pro histórico), conflito 409 explicado, histórico com "carregar no rascunho" e "voltar à régua padrão". Sem a etiqueta, a seção é só leitura. O `GradeCol` do cartão de ICP passou a ler a régua do produto.
   - Validação no navegador: o bloco ICP de `scripts/review/settings.mjs` (texto, prévia obrigatória, gravação v1, histórico, erro de validação, 390px sem rolagem, só leitura) passou isolado; o roteiro inteiro já falhava antes desta tarefa ao comparar com o protótipo (`design/crm-final/Cockpit - protótipo.dc.html` não resolve no Vite).
4. **Operação configurável e base nas métricas:** matriz de ação × intenção, cadência e corte de MQL por produto; base por método no Desempenho, Publicidade e Formulários; marcos de versão no "% de ICP por mês".
   - **Feito em 22/10/2026:**
     - a régua ganhou `actions` (nota × intenção alta/média/baixa → `ligar-15min`, `ligar-hoje`, `whats-depois-ligar`, `whats`, `nutrir`) e `mql` (`minGrade`, `minQualificacao`), com os padrões de antes (`DEFAULT_ACTIONS`, `DEFAULT_MQL` em `shared/lead-grade.js`); a cadência continua saindo da ação (`CADENCIA_DA_ACAO`);
     - `classificar` e `regradePatch` usam `actionFor`/`mqlFor`; o recálculo regrava também quando só a ação ou o MQL mudam (medido em produção em 22/10: as 1.145 classificações gravadas batem com a tabela padrão, então o deploy não regrava ninguém por isso);
     - "mudou?" compara pela chave estável `rulesKey` (padrões preenchidos, chaves em ordem): salvar a régua padrão sem mexer não cria versão;
     - prévia conta `actionChanged`; `GET /api/products/:id/icp/trend` (aberto) dá o % de ICP por mês pela régua vigente, sem nota, legado e os marcos de versão;
     - base nas métricas: `gradeBasis` (quantos leads cada método avaliou) em `sdr[].icpBasis` do placar, `totals.gradeBasis` da Publicidade e `variants[].gradeBasis` dos Formulários, mostrada no `title` de "Com ICP" (Desempenho), do cabeçalho "Clientes ABC" (Publicidade) e da coluna de notas das variantes (Formulários);
     - tela: "O que o SDR faz" (tabela nota × intenção e corte de MQL), "Mudam de ação do SDR" na prévia e "Evolução do ICP" com os marcos.
5. **Réguas dos outros produtos:** UniqueKids e Elo configurados pela tela, com a definição de negócio de cada um (a confirmar com o time).
   - **Levantamento em produção (22/10/2026, só leitura):**
     - **Elo:** nenhum lead no Cockpit e nenhuma pergunta de lead; não há o que avaliar. Fica sem régua (sem nota, como hoje) até existir funil de leads.
     - **UniqueKids:** 374 leads, todos vindos do Shopify ("comprou tarefas diárias"); só 12 têm resposta de qualificação e há 3 ganhos — pouco para calibrar cortes por dados. O formulário publicado `fo_diagnostico_uniquekids` pergunta `idade` (2-3, 4-6, 7-9, 10+, varios), `neuro` (diagnostico, suspeita, nao, nao-dizer), `desafio` (manhas, sono, telas, autonomia, estudos), `momento` (agora, mes, pesquisando) e `tentou` (quadro, cursos, profissional, nada). Hoje esses leads ficam sem nota.
   - **Ajuste feito:** `GET /api/products/:id/icp` devolve `questions` = perguntas com opções do cadastro **e dos formulários publicados** do produto (`icpQuestions`), porque o cadastro da UniqueKids não tem `momento` e guarda `desafio`/`tentou` como texto livre — sem isso esses eixos não apareciam no editor.
   - **Proposta de régua da UniqueKids (hipótese, NÃO aplicada; validar com o time antes de salvar pela tela):** um método "pontos" (`soma`):

     | Pergunta | Pontos |
     |---|---|
     | `momento` | agora 40 · mes 20 · pesquisando 5 |
     | `neuro` | diagnostico 30 · suspeita 25 · nao 10 · nao-dizer 10 |
     | `tentou` | profissional 25 · cursos 20 · quadro 10 · nada 5 |

     Faixas: A ≥ 80 · B ≥ 60 · C ≥ 40 · D ≥ 20 · E ≥ 0; ICP = A/B. Racional: urgência de começar e já ter investido em solução indicam compra; diagnóstico/suspeita de TDAH/TEA é o público em que o produto mais ajuda. `idade` e `desafio` ficam fora até haver dado mostrando que mudam a conversão. Antes de salvar, rodar a prévia: com 12 leads respondidos, ela mostra o efeito só nos poucos que vierem pelo formulário.

## Riscos

| Risco | Mitigação |
|---|---|
| Mudar a régua muda quem vai para o closer sênior e a cadência no mesmo minuto | Prévia mostra as calls que trocam de pool; o recálculo não mexe em agenda já marcada nem em etapa |
| SPA e API com réguas diferentes por cache | Mesma função pura dos dois lados; o registro da SPA atualiza pelo SSE de produtos; teste de paridade API × SPA |
| Régua mal configurada zera o ICP | Validação no `PUT`, prévia obrigatória e restauração pelo histórico |
| Recálculo pesado (≈3 mil leads no LeverAds) | Lotes, só leads com `version` diferente, sem regravar linha idêntica (cada escrita acorda o SSE) |
| Divergência entre opções do formulário e eixos da régua | Editor lê as opções das perguntas do produto e acusa opção sem valor |

## Validação prevista

- `node --test packages/api/test/revenue-grade.test.js packages/api/test/metrics-icp.test.js packages/api/test/desempenho.test.js packages/api/test/routes.marketing.test.js packages/api/test/agenda-slots.test.js packages/api/test/screens.test.js packages/api/test/fronteiras-dominio.test.js` mais os testes novos da régua.
- Suíte da API, smoke SSR e build da web; tela conferida no navegador com mocks.
