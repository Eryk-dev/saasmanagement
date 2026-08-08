---
name: cockpit-ui-review
description: Revisa e ajusta a UI/UX das telas do cockpit (painel gerencial), aplicando um design system único e um checklist de auditoria consistente. Use SEMPRE que o usuário pedir para revisar, auditar, melhorar, padronizar ou "dar uma ajeitada" em qualquer tela, componente, tabela, formulário, filtro, modal ou layout do cockpit — mesmo que ele não fale as palavras "UI", "UX" ou "design". Use também quando ele reclamar que uma tela está "feia", "confusa", "poluída", "diferente das outras" ou "quebrada no mobile", e quando for criar uma tela nova que precise seguir o padrão das existentes.
---

# Revisão de UI/UX do cockpit

Painel gerencial com muitas telas. O maior problema desse tipo de sistema não é
cada tela isolada — é a **divergência entre elas**. Duas tabelas com paddings
diferentes, três estilos de botão primário, cada tela com um jeito de mostrar
"nenhum resultado". A prioridade sempre é padronizar antes de embelezar.

## Regras que não se quebram

1. **Nunca invente um design novo.** O padrão é o que já existe em
   `references/design-system.md`. Se algo não estiver lá, pergunte ou proponha
   e registre no arquivo depois de aprovado.
2. **Nunca refatore lógica de negócio junto com UI.** Se encontrar um bug de
   dados ou de cálculo, anote no relatório e siga — não conserte no mesmo passo.
3. **Uma tela por vez.** Nada de "revisei as 12 telas" num commit só.
4. **Achado ≠ mudança.** Primeiro entregue o relatório, espere o OK, depois aplique.

## Fluxo

### Passo 1 — Inventário (só na primeira vez)

Mapeie as telas do cockpit a partir das rotas do projeto e monte uma tabela:
rota, arquivo, função da tela, componentes principais que usa. Salve em
`references/inventario-telas.md`. Esse arquivo é a lista de trabalho.

### Passo 2 — Extrair/atualizar o design system

Leia `references/design-system.md`. Se estiver vazio ou desatualizado, varra o
código em busca dos tokens reais em uso (cores, tipografia, espaçamento, raio de
borda, sombras) e dos componentes base (botão, input, select, tabela, card,
badge, modal, toast). Registre o padrão **dominante** e liste as divergências
encontradas como dívida.

Se houver mais de um padrão concorrendo, não escolha sozinho: mostre as opções
lado a lado e pergunte qual vira o oficial.

### Passo 3 — Auditar a tela

Leia `references/checklist.md` e percorra todos os itens para a tela escolhida.
Entregue o resultado nesse formato:

```
## Tela: <nome> (<rota>)

### Bloqueante
- [ ] <problema> — <arquivo:linha> — <por que quebra o uso> — <correção proposta>

### Importante
- [ ] ...

### Polimento
- [ ] ...

### Fora de escopo (anotado, não vou mexer)
- <bug de dados / regra de negócio / performance>
```

Regra de severidade:
- **Bloqueante** — impede ou induz o usuário ao erro: ação destrutiva sem
  confirmação, dado financeiro ilegível, formulário sem feedback de erro,
  tela inutilizável no mobile, ação sem estado de loading (gera duplo clique).
- **Importante** — atrito real: divergência de padrão, hierarquia visual errada,
  filtro que perde estado, tabela sem estado vazio, contraste insuficiente.
- **Polimento** — alinhamento, espaçamento, microcopy, ícone.

Não liste mais de ~15 itens por tela. Se passar disso, a tela precisa de
redesenho, não de auditoria — diga isso explicitamente.

### Passo 4 — Aplicar

Depois do OK, aplique em ordem: bloqueantes → importantes → polimento.

- Se a correção se repete em várias telas, **corrija no componente
  compartilhado**, não na tela. Diga quais outras telas foram afetadas.
- Um commit por grupo de severidade, com mensagem descrevendo o efeito para o
  usuário final ("confirmação antes de excluir lançamento"), não o meio
  ("adiciona modal").
- Ao terminar, atualize `references/design-system.md` se algum padrão novo foi
  estabelecido, e marque a tela como revisada no inventário.

## Prioridade quando ele não disser por onde começar

1. Telas de uso diário (dashboard, lançamentos, listagens principais)
2. Componentes compartilhados (tabela, filtro, formulário) — maior alavancagem
3. Telas de cadastro/configuração
4. Telas raras (relatórios pontuais, admin)

## Arquivos de referência

- `references/design-system.md` — tokens e componentes oficiais. **Leia sempre.**
- `references/checklist.md` — checklist de auditoria. **Leia sempre no Passo 3.**
- `references/inventario-telas.md` — lista de telas e status de revisão.
