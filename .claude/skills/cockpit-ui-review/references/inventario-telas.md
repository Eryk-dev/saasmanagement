# Inventário de telas do cockpit

Gerado em 2026-08-08 a partir de `app.jsx` (mapa de rotas `crumbsFor` + render).
Rota = hash (`#pipeline`). Arquivos em `packages/web/src/screens/`.
**Revisão** = auditoria da skill (checklist completo), não mexida pontual.

> **Varredura de padronização 2026-08-08 (PRs #631/#633/#634): TODAS as telas e
> componentes receberam a régua de cabeçalhos, toast de erro nas mutações das
> telas diárias, Esc nos modais e verde WA por token.** A coluna Revisão abaixo
> continua rastreando o CHECKLIST COMPLETO (12 blocos), que só o Meu dia tem.

## Telas navegáveis

| Rota | Arquivo | Tela (NAV) | Função | Componentes-chave | Revisão |
|---|---|---|---|---|---|
| `overview` | overview.jsx | Visão geral | placar do funil, metas e pace por pessoa (modelo ago/2026: réguas+donuts) | StatTile, IcpCard, charts, period-picker | — |
| `overview` (Elo) | overview-elo.jsx | Visão geral · Elo | visão B2C do app (checkout, ativação, retenção) | charts | — |
| `today` | today.jsx | Minhas atividades | fila do dia (Hoje/Amanhã/Próximos) + roteiros de call + mini fila WhatsApp | FilterTab, LeadDetail | **auditada + 12 achados aplicados (#631)** |
| `pipeline` | pipeline.jsx | Comercial · Pipeline | kanban do funil por produto, SSE tempo real, agenda de slots | LeadDetail, stage-move, schedule-call | — |
| `outbound` | outbound.jsx | Comercial · Outbound | prospecção ativa (classes Semente/Rede/Alvo, Receita Previsível) | tabela manual | — |
| `customers` | customers.jsx | Comercial · Clientes | clientes ARR/MRR + aba Assinaturas (`subscriptions` é alias) | tabela manual, EntityForm | — |
| `proposals` | proposals.jsx | Comercial · Propostas | templates e propostas (snapshots), editor + preview | editor-split, ProposalActions | — |
| `offers` | offers.jsx | Comercial · Link pagamento | os 3 links MP editáveis (anual/semestral/único) | — | — |
| `contracts` | contracts.jsx | Comercial · Contratos | biblioteca de modelos de contrato | — | — |
| `agenda` | agenda.jsx | Comercial · Agenda | agenda única do time: slots, compromissos, bloqueios, Meet | SlotGrid próprio | — |
| `whatsapp` | whatsapp.jsx | Comercial · Inbox | inbox multi-número + chat (Cloud API), promove lead no 1º toque | whatsapp-chat, wa-thread | — |
| `consultas` | consultas.jsx | Comercial · Consultas | consultas UniqueKids (gravação, upsell Mentoria) | — | — |
| `social` | social.jsx | Marketing · Redes sociais | publicar IG/FB, métricas, comentários (webhook) | social-metrics | — |
| `metrics` | metrics.jsx | Marketing · Publicidade | gerenciador Meta Ads: colunas ABC, Por dor, regras, origem dos leads, ROAS | insights, meta-connect, period? | — |
| `landingpages` | landingpages.jsx | Marketing · Landing pages | páginas e SEO da home | — | — |
| `forms` | forms.jsx | Marketing · Formulários | dashboard do form diagnóstico (5 etapas, drop-off) | charts, theme-inputs | — |
| `creative` | creative.jsx | Marketing · Canvas | editor de estáticos (18 templates) | canvas próprio | — |
| `disparos` | disparos.jsx | Marketing · Disparos | nutrição da base: WhatsApp assistido + e-mail + drip | tabela manual | — |
| `eloapp` | eloapp.jsx | Análises · Análise do App | métricas do app Elo | charts | — |
| `aquisicao` | aquisicao.jsx | Análises · Análise de Aquisição | funil de mídia, CPL, origem | charts, period-picker | — |
| `calls` | calls.jsx | Análises · Análise de Pitches | calls transcritas + resumo IA, estrutura do pitch | — | — |
| `integrations` | integrations.jsx | Análises · Análise de Integração | ordens de serviço de integração (briefing, checklist) | — | — |
| `analise` | analise.jsx | Análises · Análise de Pace | engenharia reversa da meta (gap → ganhos → calls → leads) | charts | — |
| `funcionarios` | funcionarios.jsx | Análises · Análise de Equipe | carga e cobertura por pessoa | tabela manual | — |
| `tasks` | tasks.jsx | Geral · Tarefas | quadro de tarefas + cards vindos do widget de feedback | board próprio | — |
| `remuneracao` | remuneracao.jsx | Geral · Remuneração | plano de remuneração (admin-only, comp_plans) | tabela manual | — |
| `mindmaps` | mindmaps.jsx | Geral · Mapas mentais | mapas mentais | canvas próprio | — |
| `metas` | metas.jsx | Geral · Metas | metas por vaga/pessoa, SUPER METAS, regra de crescimento (#622) | réguas próprias | — |
| `training` | training.jsx | Treinamentos | flashcards FSRS por pessoa + provas + dash da equipe + manual da empresa | IcpCard, CardHead, SectionHead, FocusShell | **piloto da régua de cabeçalhos (#621)** · checklist completo pendente |
| `expenses` | expenses.jsx + finance.jsx | Geral · Financeiro | abas Pagamentos (espelho MP, cobrança, baixa) + Custos (% por lançamento) | tabela manual | — |
| `settings` | settings.jsx | Geral · Configurações | usuários/telas, produto (funil, ICP), integrações, tema | EntityForm, theme-inputs | — |

## Sub-telas, overlays e chrome (auditar junto da tela-mãe ou como lote próprio)

| Peça | Arquivo | O que é |
|---|---|---|
| LeadDetail | screens/deal.jsx | drawer de lead usado por pipeline/today/whatsapp/agenda (o maior overlay do app) |
| FocusShell | screens/training-focus.jsx | modo foco do treino (tela cheia escura) |
| Aba Assinaturas | subscriptions.jsx | renderizada dentro de Clientes (`initialTab="billing"`) |
| Análise de clientes | customers-analysis.jsx | bloco dentro de Clientes |
| Métricas sociais | social-metrics.jsx | bloco dentro de Redes sociais |
| Elo (marca) | brand-elo.jsx, overview-elo.jsx | variantes do workspace Elo |
| NavRail + TopBar | chrome.jsx | sidebar, breadcrumb, sino, seletor de produto |
| CommandSearch | components/CommandSearch.jsx | busca global ⌘K |
| Widget de feedback | components/feedback-widget.jsx | FAB bug/melhoria em toda tela |
| WaHotAlert | components/wa-hot-alert.jsx | alerta de lead quente (salta em qualquer tela) |
| TrainingGate | training.jsx | portão do treino diário (overlay global) |
| SettingsLite | settings.jsx | Configurações reduzida p/ quem não tem a tela |

## Ordem sugerida de auditoria (uso diário primeiro)

1. `today` (fila do dia — a tela mais usada pelo time)
2. `pipeline` + LeadDetail (coração do comercial)
3. `overview` (a tela do gestor)
4. `whatsapp` (inbox diário)
5. componentes compartilhados (tabela, botão secundário, toast/loading — maior alavancagem, resolve o resto por tabela)
6. demais telas por categoria (Comercial → Marketing → Análises → Geral)
