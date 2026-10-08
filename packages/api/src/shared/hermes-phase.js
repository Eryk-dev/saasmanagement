// Fase do Hermes pelo estado do card do Linear — compartilhado com a SPA (a tela
// de Configurações de SLA mostra o "automático" de cada coluna com a mesma
// régua da API, support/ticket-hermes.js). Módulo puro: sem Node, sem imports.
//
// O tipo do Linear não distingue Validar de Aprovado (os dois são `started`),
// então vale o NOME da coluna; o de-para manual por id (configuração) manda
// por cima disto.

export const HERMES_PHASE_KEYS = ["relato", "pergunta", "trabalhando", "revisao", "validar", "aprovado", "no_ar", "cancelado"];
export const HERMES_PHASE_LABEL = {
  relato: "Relato novo", pergunta: "Aguardando resposta", trabalhando: "Investigando / corrigindo",
  revisao: "Revisão da IA", validar: "Validar", aprovado: "Aprovado", no_ar: "No ar", cancelado: "Cancelado",
};

export const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Tipo concluído/cancelado manda primeiro (coluna "Waiting for release" do
// tipo completed é no ar, não pergunta). Depois o nome: "Aguardando resposta"
// só quando é resposta/pergunta ("Aguardando deploy" não chama ninguém),
// "Aprovado" antes de "In Review" (nomes do time LEV; outros ajustam pelo mapa).
export function phaseByName(state) {
  const n = fold(state?.name);
  const type = String(state?.type || "");
  if (type === "canceled" || type === "duplicate") return "cancelado";
  if (type === "completed") return "no_ar";
  if (/aguardando (resposta|retorno)|resposta|waiting for (reply|response|answer|input)|pergunt|needs? (info|input)/.test(n)) return "pergunta";
  if (/validar|validac|validat/.test(n)) return "validar";
  if (/aprovad|approved/.test(n)) return "aprovado";
  if (/review|revis/.test(n)) return "revisao";
  if (/cancel/.test(n)) return "cancelado";
  if (/\bdone\b|conclu|no ar/.test(n)) return "no_ar";
  if (type === "started" || /progress|andamento|fazendo/.test(n)) return "trabalhando";
  return "relato";
}
