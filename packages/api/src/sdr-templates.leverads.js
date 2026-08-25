// Templates de WhatsApp do SDR automatizado (Meta exige template aprovado pra
// mensagem INICIADA pelo negócio fora da janela de 24h). Submetidos pela rota
// POST /api/whatsapp/templates/sdr-setup (routes.sdr.js); a aprovação da Meta
// leva de minutos a dias, por isso a submissão é a Fase 0 do projeto.
//
// Os nomes são contrato com o motor (sdr-flow.js lê product.sdrBot.templates,
// que tem estes nomes como default) — renomear aqui exige renomear lá.
// Categoria: primeiro toque é MARKETING (recontato pós-form, régua da Meta);
// confirmação/lembrete/resgate são UTILITY (compromisso marcado). A Meta pode
// recategorizar na revisão; o que importa pro envio é estar APPROVED.
//
// Copy: sem travessão (regra da casa), curta, 1 pergunta por vez, e a
// confirmação VENDE a call no formato que fecha (demo dentro da conta) e puxa
// o sócio (decisor ausente = 0/5 no histórico de pitch).
// v2 do 1º toque e da confirmação (22/08, correção do Leo): a gente NÃO entra
// nas contas do lead — a call é uma DEMONSTRAÇÃO da ferramenta funcionando.
// Template aprovado não pode ser editado sem nova revisão, e nome apagado fica
// 30 dias bloqueado na Meta; por isso versão nova com sufixo _v2 (o motor
// aponta pro _v2 por default; os antigos ficam órfãos na WABA, sem uso).
// Copy calibrada na mineração do histórico real (ago/2026): abertura "Oiii" da
// persona do número, zero emoji digitado, referência ao diagnóstico, pergunta
// única no fim. Lembrete e resgate reaproveitam as mensagens que o time JÁ
// manda na mão e que comprovadamente respondem/recuperam.
export const SDR_TEMPLATES = [
  // 1º toque POR DOR DE ORIGEM (copys validadas pelo Leo, 23/08): a abertura é
  // pergunta de DESCOBERTA ("isso ajudaria na sua operação?"), não convite de
  // agenda — o horário entra na resposta seguinte, quando o lead engaja.
  {
    name: "sdr_primeiro_toque_multi",
    category: "MARKETING",
    language: "pt_BR",
    body: "Oiii, {{1}}. {{2}} falando, da LeverAds. Recebi seu diagnóstico aqui: {{3}}. A LeverAds te ajuda a gerenciar múltiplas contas de Mercado Livre e Shopee de forma automática, com clonagem de anúncios, estoque, atendimento e edição em um lugar só. Isso ajudaria na sua operação hoje?",
    example: ["Rafael", "Manuela", "3 a 5 contas de autopeças"],
  },
  {
    name: "sdr_primeiro_toque_oem",
    category: "MARKETING",
    language: "pt_BR",
    body: "Oiii, {{1}}. {{2}} falando, da LeverAds. Recebi seu diagnóstico aqui: {{3}}. A LeverAds cria o anúncio completo da sua autopeça só com o OEM (part number): fotos, título de 200 caracteres, descrição e compatibilidade inteira, pronto pra revisar e publicar em menos de 5 minutos. Isso ajudaria na sua operação?",
    example: ["Rafael", "Manuela", "3 a 5 contas de autopeças"],
  },
  // Fallback do 1º toque enquanto os dois de cima não estiverem aprovados.
  {
    name: "sdr_primeiro_toque_v2",
    category: "MARKETING",
    language: "pt_BR",
    body: "Oiii, {{1}}. {{2}} falando, da LeverAds. Recebi seu diagnóstico aqui: {{3}}. Consigo te mostrar a plataforma funcionando ao vivo, numa demonstração rápida. Ainda essa semana, qual período fica melhor pra você: manhã ou tarde?",
    example: ["Rafael", "Manuela", "3 a 5 contas de autopeças"],
  },
  {
    name: "sdr_confirmacao_call_v2",
    category: "UTILITY",
    language: "pt_BR",
    body: "Fechado, {{1}}! Nossa call fica {{2}} então. Nosso especialista vai te fazer uma demonstração ao vivo, com a ferramenta clonando anúncios na prática. Se tiver sócio ou alguém que decida junto, traz pra call que a conversa rende mais. Qualquer coisa me chama por aqui!",
    example: ["Rafael", "amanhã às 10h"],
  },
  // Segundo toque: 1º toque sem NENHUMA resposta há 24h. É a retomada que a
  // Manuela já manda na mão (mineração ago/2026, dezenas de usos): curta e
  // pedindo só um ok.
  {
    name: "sdr_retomada_conversa",
    category: "MARKETING",
    language: "pt_BR",
    body: "Oiii {{1}}, tudo bem? Vamos retomar nossa conversa sobre a LeverAds? Me dá um ok aqui, por favor",
    example: ["Rafael"],
  },
  // Retomada da NUTRIÇÃO (campanha de resgate do backlog): quem já disse "não
  // agora" ouve novidade, não cobrança. Curta, 1 pergunta, sem promessa de
  // número (claim em template de marketing arrisca reprovação na Meta).
  {
    name: "sdr_retomada_novidades",
    category: "MARKETING",
    language: "pt_BR",
    body: "Oiii {{1}}, tudo bem? Aqui é a {{2}}, da LeverAds. Seguimos ajudando lojas de marketplace a espelhar contas e criar anúncios de autopeças só com o código OEM. Se quiser retomar de onde paramos, me dá um ok que eu te mostro as novidades",
    example: ["Rafael", "Manuela"],
  },
  {
    name: "sdr_lembrete_conversa",
    category: "UTILITY",
    language: "pt_BR",
    body: "Oi {{1}}! Está tudo certo pra nossa conversa {{2}}? Nosso especialista vai estar te esperando pra te mostrar como escalar sua operação nos marketplaces. Te espero lá!",
    example: ["Rafael", "hoje às 14h"],
  },
  // 2ª tentativa do NO-SHOW (24h depois do furo, Leo 24/08). Sai sempre por
  // template: um dia depois a janela de 24h da Meta já fechou. Leva os DOIS
  // horários reais da agenda no corpo — oferta fechada converte muito mais que
  // "me diz um horário".
  {
    name: "sdr_remarcar_noshow",
    category: "UTILITY",
    language: "pt_BR",
    body: "Oi {{1}}, consegui dois horários novos com nosso especialista: {{2}} ou {{3}}. Qual fica melhor pra você?",
    example: ["Rafael", "amanhã às 10h", "amanhã às 15h"],
  },
  {
    name: "sdr_resgate_conversa",
    category: "UTILITY",
    language: "pt_BR",
    body: "Oi {{1}}, passei no nosso horário marcado e não te encontrei, acontece! Quer que eu remarque? Me diz um horário que fica bom pra você que eu já reservo.",
    example: ["Rafael"],
  },
];
