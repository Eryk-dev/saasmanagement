# Prompt para o Claude Code

Cole o texto abaixo como primeira mensagem no Claude Code, com o repositório
aberto no VS Code. Depois trabalhe uma tela por vez.

---

Você vai implementar um redesign já aprovado no cockpit deste repositório.

**Contexto do repositório:** monorepo; o app web é React com JSX em
`packages/web/src`. As telas ficam em `packages/web/src/screens/*.jsx`, os
componentes compartilhados em `components/viz.jsx` (`PageHead`, `Card`,
`Segmented`, `FilterTab`, `Pill`) e `atoms.jsx` (`PrimaryButton`,
`SecondaryButton`, `EmptyState`, `toast`, `useEsc`), os tokens em `tokens.css`, os
dados em `lib/api.js` + `data.jsx` (`useData`), e o estado do servidor chega por
SSE no evento `cockpit-change`.

**A referência de design** está em `design/handoff-cockpit/`:

- `Cockpit - Prototipo.dc.html` — protótipo funcional de 33 telas. Abra no
  navegador e use como referência de comportamento. É **HTML de referência, não
  código para copiar**: nada dele entra no bundle.
- `README.md` — regras de design, mapa protótipo → arquivos do repo, tokens,
  comportamento e as perguntas abertas. **Leia inteiro antes de começar.**
- `DECISOES-POR-TELA.md` — log de cada rodada: o que foi entregue por tela, o que
  a crítica reprovou e como foi corrigido. Consulte a seção da tela que estiver
  implementando; os defeitos listados lá são exatamente os que não devem voltar.

**Como trabalhar:**

1. Comece pela tela que eu indicar. Se eu não indicar, comece por
   `screens/today.jsx` (Minhas atividades) — é a tela de uso diário.
2. Antes de escrever código, leia o arquivo atual da tela no repositório e me
   diga, em até 10 linhas, o que muda: o que sai, o que entra, o que só muda de
   lugar. Espere meu ok.
3. Implemente **na estrutura que já existe**: mesmos componentes, mesmas rotas da
   API, mesmos tokens (`var(--fg-1)`, `var(--accent)`, `var(--pos)`…). Não
   introduza biblioteca nova, não crie sistema de estilo paralelo, não use os
   hexadecimais do protótipo.
4. Onde o protótipo calcula um número em memória, use a rota que já existe. Se não
   existir, me avise antes de criar — pode ser que o cálculo pertença ao servidor.
5. Respeite as regras de negócio que o protótipo formaliza: perder lead exige
   motivo; erro do lint bloqueia aprovar/publicar no Blog; mover para Ganho pede
   valor e plano; handoff só oferece closers; a mesma entidade nunca é renderizada
   por duas fontes.
6. Ao terminar a tela: rode o app, compare lado a lado com o protótipo e me mande
   um resumo do que ficou diferente de propósito. Só então passamos para a
   próxima.

**Restrições:**

- Um PR por tela, pequeno e revisável.
- Não refatore o que a tela não precisa.
- Não mexa em `api/` sem me avisar.
- Se a implementação exigir um endpoint novo ou um campo novo no documento,
  proponha o contrato antes de escrever.

---

## Ordem sugerida

Telas de uso diário primeiro; painéis e configuração depois.

1. Minhas atividades (`screens/today.jsx`)
2. Pipeline + card do lead (`screens/pipeline.jsx`, `screens/deal.jsx`)
3. Clientes (`screens/customers.jsx` e vizinhos)
4. Agenda (`screens/agenda.jsx`)
5. Inbox WhatsApp (`screens/whatsapp.jsx`)
6. Tarefas (`screens/tasks/`)
7. Links de pagamento, Contratos, Propostas, Formulário de integração
8. Consultas, Outbound, Treinamentos
9. Disparos, Blog, Formulários, Landing pages, Redes sociais, Canvas, Publicidade
10. Metas, Remuneração, Financeiro, Mapas mentais, Configurações
11. Análises (7 telas) e Moldura (nav, ⌘K, notificações)
