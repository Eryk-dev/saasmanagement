// Sinais compartilhados entre o motor determinístico (sdr-flow.js) e o cérebro
// (sdr-brain.js) sobre o que o LEAD escreveu. Régua única de propósito: o
// mesmo texto tem que valer "resposta" ou "não resposta" nas duas frentes.
//
// MENSAGEM PRONTA DO FORM NÃO É RESPOSTA. O form joga o lead pro WhatsApp com
// o texto pré-preenchido ("Oi, me chamo X e quero saber mais sobre…") e ele só
// aperta enviar. Contar isso como "o lead respondeu" fazia a escada de
// retomada tratar como MORNO (relógio de 3 dias, e a MESMA retomada do 2º
// toque de novo) quem nunca disse uma palavra própria: 44 das 147 conversas
// mortas de 17 a 30/09 eram exatamente "form → pergunta de descoberta → nada".
export const FORM_MSG_RX = /quero saber mais sobre|resumo da minha opera|minha opera[çc][ãa]o:/i;

export const isFormMessage = (m) => FORM_MSG_RX.test(String(m?.transcript || m?.text || ""));

// Resposta DE VERDADE do lead: mensagem recebida que não é o texto do form.
export const isRealReply = (m) => m?.direction === "in" && !isFormMessage(m);

// Última resposta real do lead na conversa (undefined se ele nunca falou).
export const lastRealReply = (msgs = []) => [...msgs].reverse().find(isRealReply);
