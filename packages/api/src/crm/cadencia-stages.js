// Cadência de 7 dias como ETAPAS REAIS do funil.
//
// Uma coluna por dia, entre "Novo lead" e "Qualificando". O lead ANDA de
// verdade entre elas — não é agrupamento derivado de uma tela. Isso importa
// porque no board por etapa "Qualificando" junta lead de hoje com lead de duas
// semanas, e ninguém vê quem esticou.
//
// Duas consequências do desenho, decididas em 10/09:
//
// 1) O lead anda SOZINHO quando vira o dia. A coluna passa a significar o dia
//    real da cadência, sempre. Lead parado no Dia 5 sem nenhum toque fica
//    visível como falha — que é exatamente o que a tela existe pra mostrar. Se
//    o movimento dependesse do toque, o card ficaria no Dia 2 pra sempre e a
//    coluna deixaria de significar "dia".
//
// 2) Quem move pra "Qualificando" é a RESPOSTA do lead, não o toque do SDR.
//    Hoje o primeiro toque já promove o lead, o que enche a etapa de gente que
//    nunca respondeu e apaga a diferença entre "ainda não falei" e "estou
//    conversando".
//
// Dia 1 é a etapa "Novo lead" que já existe — não se cria coluna duplicada pro
// primeiro dia.

export const CADENCIA_FLAG = "cadencia_dias";
export const ETAPA_DIA_1 = "Novo lead";
export const ETAPA_NUTRICAO = "Nutrição";
export const ETAPA_QUALIFICANDO = "Qualificando";

// Dias 2 a 7. Os toques seguem o perfil prioritário: dias sem toque agendado
// (4 e 6) existem como coluna mesmo assim — são a espera, e ver a espera é
// metade do valor do board.
export const DIAS = [
  { dia: 2, stage: "Dia 2", canal: "ligacao", janela: "oposta-ao-d1" },
  { dia: 3, stage: "Dia 3", canal: "audio", janela: "manha" },
  { dia: 4, stage: "Dia 4", canal: "", janela: "" },
  { dia: 5, stage: "Dia 5", canal: "ligacao", janela: "oposta-ao-d2" },
  { dia: 6, stage: "Dia 6", canal: "", janela: "" },
  { dia: 7, stage: "Dia 7", canal: "whats", janela: "encerramento" },
];

export const NOMES_DIAS = DIAS.map((d) => d.stage);
// Toda etapa em que a cadência de 7 dias está correndo.
export const ETAPAS_CADENCIA = [ETAPA_DIA_1, ...NOMES_DIAS];

// Linha de funil pronta pro `product.funnel`. `kind: contato` porque é SDR
// tentando alcançar — é o kind que o resto do sistema já usa pra isso.
export function funnelRowDo(d) {
  const cadence = { maxAttempts: 1, retryDays: 1 };
  if (d.canal) cadence.steps = [{ day: 0, canal: d.canal, ...(d.janela ? { janela: d.janela } : {}) }];
  return { stage: d.stage, kind: "contato", conv: 1, cadence };
}

const DIA_MS = 86_400_000;

// Dia da cadência em que o lead ESTÁ, contado da entrada. Dia 1 = dia da
// chegada. Dias de calendário, não úteis: o relógio do lead corre no fim de
// semana também, e fingir que não corre esconde exatamente o atraso que a tela
// deveria denunciar.
export function diaDaCadencia(lead, now = Date.now()) {
  const base = new Date(lead?.cadenciaDesde || lead?.createdAt || 0).getTime();
  if (!Number.isFinite(base) || base <= 0) return 1;
  const dias = Math.floor((now - base) / DIA_MS);
  return dias < 0 ? 1 : dias + 1;
}

// Etapa em que o lead DEVERIA estar agora. `null` = não mexe (já passou dos 7
// dias e a nutrição não existe no funil, ou já está onde deveria).
export function etapaAlvo(lead, now = Date.now(), { temNutricao = true } = {}) {
  const dia = diaDaCadencia(lead, now);
  if (dia <= 1) return ETAPA_DIA_1;
  const encontrada = DIAS.find((d) => d.dia === dia);
  if (encontrada) return encontrada.stage;
  return temNutricao ? ETAPA_NUTRICAO : null; // passou do dia 7
}

// O lead está numa etapa onde a cadência corre? Só esses andam sozinhos —
// quem já foi qualificado, marcou call, fechou ou foi descartado nunca é
// movido pelo relógio.
export const estaNaCadencia = (stage) => ETAPAS_CADENCIA.includes(String(stage || ""));
