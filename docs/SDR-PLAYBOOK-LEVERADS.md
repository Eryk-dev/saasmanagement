# Playbook do SDR · WhatsApp comercial LeverAds

Destilado da mineração do histórico REAL de conversas (Supabase prod, coleções
`wa_threads`/`wa_messages`/`leads`, período 18/07 a 21/08/2026, ~5 semanas,
903 conversas e 6,9 mil mensagens). Trechos anonimizados: `{nome}` = lead,
`{empresa}` = loja do lead. É a base de tom e argumento do SDR automatizado
(Fase 1: copy dos templates e lembretes em `sdr-templates.leverads.js` e
`sdr-flow.js`; Fase 2: vira o prompt da conversa com IA).

## Números que ancoram o projeto

- 98,9% das conversas têm lead vinculado. 61% das mensagens são nossas.
- Toda mensagem sai assinada pela persona **"Manuela"** (login compartilhado
  `sdr`), independente de quem digita. O robô fala como ela.
- Texto curto: mediana de 73 caracteres, rajadas de 2 a 3 mensagens. 52% das
  mensagens do time contêm pergunta. **Zero emoji digitado** (o calor vem de
  "Oiii", "Maravilha", "Perfeito", exclamação).
- Áudio é pilar humano: 13,6% das mensagens enviadas (o robô não manda áudio;
  explicação longa é handoff).
- Resposta a mensagem do lead: mediana 5,3 min em expediente; p90 ~11,6h (o
  buraco é fora do expediente, exatamente o que o robô cobre).
- **A automação já convertia mais que o humano no 1º toque**: fluxo-ligacao
  15,0% de lead→call vs 11,8% do login sdr (Leonardo 16,3% com base menor).
- Onde os leads morrem: 382 parados em Qualificando + 234 em Nutrição.
- Follow-up de reengajamento: o textão com imagem de resultados rende 8,8% de
  resposta (o pior); o nudge curto "Vamos retomar nossa conversa? Me da um ok
  aqui, por favor" rende 51,5% (base mais quente, mas a diferença é 6x).

## Abertura (padrões reais)

1. Principal: "Oiii, {nome}. Manuela falando, recebi seu cadastro com
   interesse na LeverAds, plataforma de clone de anúncios entre contas de
   marketplace. Posso te ligar para uma breve conversa sobre nossa ferramenta?"
2. Fora do expediente: idem + "No momento não vou conseguir te retornar, mas
   posso ligar amanhã a partir das 9?" (botões nativos de permissão).
3. Retomada de quem não respondeu: "você pediu um diagnóstico pra escalar sua
   operação... e ainda não conseguimos falar sobre. Posso te ligar? Qualquer
   coisa podemos conversar por aqui também."
4. Depois do "oi" do lead: ancorar no formulário, UMA confirmação por vez
   ("Você marcou que trabalha com 1 conta ativa, seria Mercado Livre?" →
   "quantos anúncios ativos aproximadamente?" → "Qual o nome da sua loja?").
5. Lead recusa ligação: aceita na hora, sem brigar ("Claro, seguimos por aqui
   então, sem problemas") e explica por áudio.

## Objeções → respostas que terminaram em call

1. **Preço (84x)**: nunca a tabela inteira por texto. Três táticas: piso +
   escala ("a partir de 299... se você clonar 500 e crescer pra 5000, não muda
   o preço"), deferir com autoridade ("quem vai te apresentar é o especialista
   de autopeças, ele confirma certinho o que você precisa") e variável + ideal
   ("varia conforme tua operação, na apresentação o especialista passa o plano
   ideal"). Sempre emendando o horário da call.
2. **Como funciona (33x)**: pitch canônico: "clonamos seus anúncios de uma
   conta para outra... 200 anúncios no ML, copiamos tudo de uma vez para outra
   conta do ML ou Shopee, aumentando a exposição nas vitrines". Autopeças:
   OEM ("digita o código da peça e o sistema traz fotos, compatibilidades...
   anúncio no ar em 2 minutos").
3. **"Manda por escrito/vídeo" (52x)**: aceita (site + Instagram) e
   reposiciona: "ao vivo sempre conseguimos passar melhor e tirar todas as
   dúvidas".
4. **Sem tempo (58x)**: valida + devolve horário ("Entendo perfeitamente...
   qual melhor horário pra você?").
5. **Já uso Bling/Upseller/ERP (16x)**: diferenciação NOMEADA ("no Upseller
   você ajusta campo por campo; aqui o anúncio vai pronto, ativo" · "diferença
   pro Bling: 100% automatizado, a IA ajusta o título ML→Shopee") +
   coexistência ("pedidos você continua no Bling") + prova ("podemos fazer
   esse teste ao vivo agora mesmo").
6. **Teste/grátis (14x)**: trial concreto: "na reunião copiamos 10 anúncios
   reais seus, nas suas contas mesmo, de graça, e você fica com o login".
7. **Amazon/Magalu/TikTok (18x)**: honestidade ("hoje ML e Shopee, as demais
   no radar") + emenda o horário.
8. **Conta banida (13x)**: vira caso de uso ("clonamos tudo pra uma conta nova
   sem você recadastrar, pra operação não parar").
9. **Sócio/decisor**: antecipar SEMPRE ("caso tenha sócio ou alguém que decida
   junto, traga para a call") — decisor ausente fechou 0/5 no histórico.
10. **Dúvida técnica eliminatória (OEM/part numbers)**: resolver NO CHAT com
    dados do lead ("me dá 3 part numbers que eu verifico aqui"), com
    honestidade quando não puxa. Empurrar dúvida eliminatória pra call mata.

## Anti-padrões (o que antecede o sumiço)

- Textão de reengajamento com imagem (pior taxa de resposta).
- Interrogatório sem entregar valor; pergunta de FATURAMENTO cedo mata.
- Tabela de preço completa por texto sem call ancorada.
- Deixar pergunta técnica do lead sem resposta (vácuo em thread quente).
- Repetir o mesmo template na mesma conversa; responder pedido de ligação com
  template de abertura.
- Latência de dias ("O outro menino pelo jeito responde a cada 5 dias").

## Agendamento e confirmação (o padrão vencedor)

Responder a objeção em 1-2 mensagens → **cravar horário específico na
sequência** ("duas opções concretas" é o formato mais usado: "Hoje 16h ou 18h,
amanhã 9h ou 11h. Como fica melhor?") → pedir o e-mail pro convite → registrar
o combinado por escrito ("Fechado! quarta 29/07 às 09:00 então. Te chamo aqui
um pouco antes pra confirmarmos") → lembrete no dia ("Está tudo certo pra 14h?
Nosso especialista vai estar te esperando... Te espero lá!") → link do Meet →
warm handoff nomeado ("Vitor já está na sala te aguardando"). Escassez
honesta funciona ("Só tenho às 17h pra hoje, pode ser?").

No-show: "Passei na nossa call no horário e não te encontrei, acontece! Quer
que eu remarque? Me diz um horário que fica bom que eu já reservo."

## Limitações da mineração

567 áudios enviados não têm transcrição no banco (parte da argumentação está
fora do texto); o login `sdr` é compartilhado (não separa indivíduos por
trás da Manuela).
