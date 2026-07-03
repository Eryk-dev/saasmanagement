# Reativando a visão de portfólio (multi-SaaS)

Em julho/2026 a UI do cockpit foi simplificada pra operar UM produto (LeverAds).
**O modelo de dados continua 100% multi-SaaS**: toda collection carrega o campo
`saas`, cada produto define seu próprio funil/perguntas, e a API não mudou nada.
Este documento diz o que foi guardado e como reativar quando o segundo SaaS
entrar (previsão: início de 2027).

## O que já volta sozinho (zero código)

Basta criar o segundo produto (`POST /api/products` ou Ajustes) e:

- **Abas de SaaS** reaparecem automaticamente em Pipeline, Formulários,
  Propostas, Assinaturas, Tarefas e Ajustes. Todas estão atrás de guardas
  `SAAS.length > 1` (procure por esse padrão em `packages/web/src/screens/`).
- O **chip do produto** no rodapé da sidebar (`SaasFootChip` em
  `packages/web/src/chrome.jsx`) mostra a contagem; é o lugar natural pra virar
  um alternador global de produto.

## O que precisa de decisão/código

As telas de Visão geral, Clientes e Métricas assumem `SAAS[0]` como produto
ativo (comentado nos arquivos). Com 2+ produtos, escolha entre:

1. **Alternador global** (recomendado): estado `activeSaas` no `app.jsx`,
   controlado pelo chip da sidebar, passado às telas. Meio dia de trabalho.
2. **Home agregada de portfólio**: soma dos produtos + drill-down. Mais caro;
   só vale com 3+ produtos.

## O que foi removido (e onde recuperar)

Removidos no PR da fase 2 do redesign (branch `feat/simplify-single-saas`,
jul/2026). Recupere pelo git se precisar de referência:

| Item | Arquivo (no histórico) | Nota |
|---|---|---|
| Home de portfólio | `packages/web/src/screens/portfolio.jsx` | agregava NRR/health fake (`PORTFOLIO_CONST`); refazer com dados reais |
| Dashboard por SaaS | `packages/web/src/screens/saas_dashboard.jsx` | substituído pela Visão geral |
| NPS | `packages/web/src/screens/nps.jsx` | collection `nps` segue viva na API |
| Metas | `packages/web/src/screens/goals.jsx` | "meta ao vivo" nunca foi implementada |
| Ranking do time | `packages/web/src/screens/leaderboard.jsx` | dados 100% manuais, nada recalculava |
| Marketing | `packages/web/src/screens/marketing.jsx` | virou a tela Métricas |
| Seed de demonstração | `packages/api/src/seed-data.demo.js` | Quill/Mesa; `npm run seed:demo` também saiu |

As collections dessas telas (`nps`, `goals`, `leaderboard_*`, `attention`)
continuam existindo na API e no bootstrap; só a superfície visual saiu.

## Checklist pra quando o 2º SaaS entrar

1. Criar o produto com funil próprio (Ajustes) e `leadQuestions`.
2. Apontar o form público do novo SaaS pro cockpit (mesmo padrão do LeverAds:
   form nativo em `/f/:id` ou espelho via `POST /api/leads` + `x-api-key`).
3. Implementar o alternador global de produto (opção 1 acima).
4. Revisar Visão geral/Métricas: filtrar por produto ativo em vez de `SAAS[0]`.
5. Se quiser a home agregada, recuperar `portfolio.jsx` do histórico como base,
   trocando os agregados fake por rollups reais.
