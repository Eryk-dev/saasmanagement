# Checklist de auditoria — telas de painel gerencial

Percorra todos os blocos. Item que não se aplica à tela, marque como N/A.

## 1. Consistência com o design system
- [ ] Cores vêm dos tokens (nenhum hex solto no arquivo da tela)
- [ ] Espaçamentos seguem a escala definida
- [ ] Tipografia: tamanhos e pesos da escala; no máximo 3 níveis por tela
- [ ] Botões usam as variantes oficiais; **um único** botão primário por tela
- [ ] Ícones do mesmo conjunto e mesmo tamanho base
- [ ] Componentes compartilhados usados em vez de reimplementação local

## 2. Hierarquia e leitura
- [ ] O dado mais importante da tela é o elemento mais evidente
- [ ] Título deixa claro onde o usuário está; breadcrumb quando há profundidade
- [ ] Ação principal está visível sem rolagem
- [ ] Não há mais de ~7 elementos disputando atenção acima da dobra
- [ ] Agrupamento visual reflete agrupamento lógico (proximidade, não bordas)

## 3. Estados (o buraco mais comum)
- [ ] **Carregando**: skeleton ou spinner — nunca tela em branco
- [ ] **Vazio**: explica o que é aquilo e oferece a ação para popular
- [ ] **Erro**: mensagem em linguagem humana + como tentar de novo
- [ ] **Sem permissão**: diferenciado de "vazio"
- [ ] **Parcial**: carregou tabela mas não o gráfico → cada bloco tem seu estado
- [ ] Botão que dispara requisição fica desabilitado/em loading enquanto roda

## 4. Tabelas e listagens
- [ ] Colunas mais importantes à esquerda; ações à direita
- [ ] Números alinhados à direita, com separador de milhar e casas decimais fixas
- [ ] Datas em formato único no sistema inteiro
- [ ] Ordenação indicada visualmente na coluna ativa
- [ ] Paginação ou scroll infinito com total de registros visível
- [ ] Linha inteira clicável ou ação óbvia — não um ícone minúsculo
- [ ] Densidade adequada: painel gerencial pede linhas compactas, não arejadas
- [ ] Coluna com texto longo trunca com tooltip, não quebra o layout

## 5. Filtros e busca
- [ ] Filtros ativos ficam visíveis (chips) e removíveis individualmente
- [ ] Estado do filtro persiste ao voltar de uma tela de detalhe
- [ ] Filtro de período tem atalhos (hoje, 7 dias, mês, mês passado)
- [ ] "Limpar filtros" existe quando há mais de 2 filtros
- [ ] Busca tem debounce e indica que está buscando

## 6. Formulários
- [ ] Um campo por linha em formulário longo; agrupamento por seção
- [ ] Label sempre visível (nunca só placeholder)
- [ ] Validação no blur, não só no submit
- [ ] Mensagem de erro embaixo do campo, dizendo como corrigir
- [ ] Campos obrigatórios marcados; opcionais também podem ser marcados
- [ ] Teclado correto no mobile (numérico para valores, e-mail para e-mail)
- [ ] Máscara para dinheiro, CPF/CNPJ, telefone, CEP
- [ ] Enter submete; Esc fecha modal
- [ ] Alerta ao sair com alterações não salvas

## 7. Ações destrutivas e feedback
- [ ] Excluir/cancelar/estornar pede confirmação nomeando o item
- [ ] Confirmação diz a consequência, não só "tem certeza?"
- [ ] Toda ação bem-sucedida gera confirmação visível (toast ou atualização óbvia)
- [ ] Desfazer disponível onde for barato implementar

## 8. Dados financeiros e métricas
- [ ] Moeda sempre com símbolo e mesmo número de casas
- [ ] Valor negativo visualmente distinto (cor + sinal, nunca só cor)
- [ ] Todo indicador tem período explícito ("últimos 30 dias", não "vendas")
- [ ] Comparativo indica a base ("vs. mês anterior")
- [ ] Gráfico tem eixo rotulado e unidade; sem eixo Y truncado enganosamente
- [ ] Arredondamento consistente entre card, tabela e exportação

## 9. Responsivo
- [ ] Funciona em ~380px de largura
- [ ] Tabela vira cards ou tem scroll horizontal com coluna fixa
- [ ] Alvos de toque com pelo menos 44px
- [ ] Modal não estoura a tela nem trava o scroll do fundo
- [ ] Menu lateral colapsa

## 10. Acessibilidade mínima
- [ ] Contraste de texto ≥ 4.5:1 (≥ 3:1 para texto grande)
- [ ] Informação nunca transmitida só por cor
- [ ] Foco visível na navegação por teclado; ordem de tabulação lógica
- [ ] Botão só com ícone tem rótulo acessível
- [ ] Imagem/gráfico tem alternativa em texto ou tabela

## 11. Microcopy
- [ ] Botão descreve a ação ("Salvar lançamento", não "OK")
- [ ] Sem jargão técnico vazando para a interface ("erro 500", "null")
- [ ] Termos iguais em todo o sistema (não "pedido" numa tela e "venda" em outra)
- [ ] Tom consistente e direto

## 12. Percepção de performance
- [ ] Nada bloqueia a tela inteira por causa de um bloco lento
- [ ] Feedback imediato ao clique, mesmo que o dado demore
- [ ] Listas longas virtualizadas quando passam de algumas centenas de linhas
