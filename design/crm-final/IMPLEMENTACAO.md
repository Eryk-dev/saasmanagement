# CRM final — implementação do Cockpit

Fonte aprovada: pasta local `CRM final `, recebida em 20/09/2026. O arquivo
`Cockpit - protótipo.dc.html` importa as 30 pranchas abaixo. As variantes de
proposta Cápsula não fazem parte desta referência.

Os HTMLs e `support.js` são referência de design. Não são importados no bundle
nem executados pela aplicação. A SPA continua em React, usando REST, workspace
por produto, permissões, formulários e atualizações SSE existentes.

## Aplicação

- Moldura: canvas cinza, rail navy de 244px, topo em cápsula, Outfit nos títulos
  e números, Plus Jakarta Sans no corpo, cards flutuantes e controles pill.
- Visão geral: meta navy junto do funil; vendas e carteira no trilho lateral.
- Atividades: roteiro no painel lateral; modal em janelas de até 1100px.
  Agenda, tarefas e placar continuam disponíveis na seção expansível.
- Clientes: cobrança e resumo antes da tabela; análise completa expansível.
- Painéis navy: treinamento, ganhos do Pipeline, cobrança, conversão de propostas,
  links de pagamento, formulários pedidos, Inbox, atendimento, criativos,
  publicidade, pitches, integração e pendência financeira.
- Mapas mentais: cabeçalho e lista no desktop junto do canvas; foco, recolhimento,
  teclado, edição e conflito de versão continuam disponíveis.
- Os componentes compartilhados propagam as superfícies e os controles para
  as telas com formulários, tabelas e gráficos, incluindo as rotas extras.

Funcionalidades reais que o protótipo deixa inertes foram mantidas: busca,
produto ativo, menu de conta, indicações, cases, filtros, abas e editores. O
conteúdo e a quantidade de linhas dependem da API; dados ilustrativos do HTML
não foram convertidos em dados do produto. Estado de dívida, perda ou atraso
continua usando cor semântica e texto.

## Mapa e verificação

As 30 rotas foram abertas na prévia isolada em **390, 1440 e 1920px**: título
presente, sem alerta de erro e sem extravasamento horizontal do documento.
Isso é uma checagem de renderização/layout, não uma comparação pixel a pixel
nem um teste de todas as mutações externas. Tabelas largas e quadros mantêm
rolagem interna. Abertura/fechamento do roteiro móvel e abertura do detalhe de
lead foram exercitados. Os testes existentes cobrem contratos de domínio,
permissões, estados de clientes, navegação e smoke SSR.

| Rota | Prancha | Implementação em `packages/web/src/screens` |
|---|---|---|
| `#overview` | [TelaVisaoGeral](TelaVisaoGeral.dc.html) | `overview.jsx` |
| `#today` | [TelaMinhasAtividades](TelaMinhasAtividades.dc.html) | `today.jsx` |
| `#training` | [TelaTreinamentos](TelaTreinamentos.dc.html) | `training.jsx` |
| `#pipeline` | [TelaPipeline](TelaPipeline.dc.html) | `pipeline.jsx` |
| `#customers` | [TelaClientes](TelaClientes.dc.html) | `customers.jsx` |
| `#proposals` | [TelaPropostas](TelaPropostas.dc.html) | `proposals.jsx` |
| `#offers` | [TelaLinksPagamento](TelaLinksPagamento.dc.html) | `offers.jsx` |
| `#contracts` | [TelaContratos](TelaContratos.dc.html) | `contracts.jsx` |
| `#intform` | [TelaFormularioIntegracao](TelaFormularioIntegracao.dc.html) | `integration-forms.jsx` |
| `#agenda` | [TelaAgenda](TelaAgenda.dc.html) | `agenda.jsx` |
| `#whatsapp` | [TelaInbox](TelaInbox.dc.html) | `whatsapp.jsx` |
| `#tickets` | [TelaTickets](TelaTickets.dc.html) | `tickets/index.jsx` |
| `#quick_replies` | [TelaRespostasRapidas](TelaRespostasRapidas.dc.html) | `quick-replies.jsx` |
| `#support_settings` | [TelaConfiguracoesSLA](TelaConfiguracoesSLA.dc.html) | `support-settings.jsx` |
| `#social` | [TelaRedesSociais](TelaRedesSociais.dc.html) | `social.jsx` |
| `#metrics` | [TelaPublicidade](TelaPublicidade.dc.html) | `metrics.jsx` |
| `#forms` | [TelaFormularios](TelaFormularios.dc.html) | `forms.jsx` |
| `#creative` | [TelaCanvas](TelaCanvas.dc.html) | `creative.jsx` |
| `#disparos` | [TelaDisparos](TelaDisparos.dc.html) | `disparos.jsx` |
| `#blog` | [TelaBlog](TelaBlog.dc.html) | `blog.jsx` |
| `#analise` | [TelaAnalisePace](TelaAnalisePace.dc.html) | `analise.jsx` |
| `#calls` | [TelaAnalisePitches](TelaAnalisePitches.dc.html) | `calls.jsx` |
| `#integrations` | [TelaAnaliseIntegracao](TelaAnaliseIntegracao.dc.html) | `integrations.jsx` |
| `#desempenho` | [TelaAnaliseDesempenho](TelaAnaliseDesempenho.dc.html) | `desempenho.jsx` |
| `#tasks` | [TelaTarefas](TelaTarefas.dc.html) | `tasks/index.jsx` |
| `#metas` | [TelaMetas](TelaMetas.dc.html) | `metas.jsx` |
| `#expenses` | [TelaFinanceiro](TelaFinanceiro.dc.html) | `expenses.jsx` |
| `#remuneracao` | [TelaRemuneracao](TelaRemuneracao.dc.html) | `remuneracao.jsx` |
| `#mindmaps` | [TelaMapasMentais](TelaMapasMentais.dc.html) | `mindmaps.jsx` |
| `#settings` | [TelaConfiguracoes](TelaConfiguracoes.dc.html) | `settings.jsx` |

## Reproduzir a conferência

Em `packages/web`, executar `npm run preview:tela -- --port 5200` e abrir:
`http://localhost:5200/responsive.html?width=390&screen=overview`.
Larguras disponíveis: 390, 1440, 1920; `screen` recebe a rota da tabela.
Esse harness usa os dublês existentes, sem iniciar a API ou conectar ao banco.

Validação de entrega: `npm test` em `packages/api`, `npm test` e
`npm run build` em `packages/web`. O deploy no Easypanel permanece uma ação
manual do Leonardo após o merge, conforme sua autorização para esta entrega.

Resultado desta entrega: API 1.729 testes aprovados; web 9 testes de navegação/cliente
aprovados e smoke SSR completo; build de produção aprovado.
