// Manual da Família (UniqueKids · Protocolo de Rotina) — o entregável final da
// mentoria de 8 consultas, prometido na apresentação ("Manual da sua família com
// tudo o que foi construído"). Um registro por cliente na collection
// `deliverables`: snapshot das seções do template abaixo, moduladas ao longo da
// jornada pelas transcrições/resumos das consultas (IA propõe, a Ana edita) e
// entregue na consulta 8 como página pública /m/:id com a marca UniqueKids.
import { randomUUID } from "node:crypto";

// As seções espelham EXATAMENTE o que a apresentação promete (slide de
// investimento do pt_uniquekids). `hint` orienta a Ana (e a IA) sobre o que vai
// em cada uma; não aparece na página pública.
export const MANUAL_SECTIONS = [
  {
    key: "raio_x",
    title: "Raio-x da Rotina",
    hint: "O retrato da casa no início da jornada: como a rotina chegou, o nó principal (e em qual pilar do R.O.T.I.N.A ele mora), o que a família já tinha tentado e por que não colava. Modulado principalmente pela consulta 1.",
  },
  {
    key: "plano_rotina",
    title: "Plano de Rotina · quadro Tarefas Diárias",
    hint: "Os blocos da rotina (manhã, tarde e noite) montados pra realidade dessa família, como usar o quadro Tarefas Diárias no dia a dia e o ritual de check das tarefas com a criança.",
  },
  {
    key: "guia_birras",
    title: "Guia de Respostas à Birra",
    hint: "Os gatilhos mapeados dessa criança e a resposta pronta pra cada um, na hora exata. Inclui o que evitar (as reações que reforçam a birra).",
  },
  {
    key: "banco_falas",
    title: "Banco de Falas",
    hint: "As falas que acessam o cérebro da criança (perguntas em vez de ordens), organizadas por situação: transições, telas, tarefas e sono. Priorize as falas que a família TESTOU e funcionaram na jornada.",
  },
  {
    key: "cantinho_calma",
    title: "Cantinho da Calma + Autocuidado de quem cuida",
    hint: "Como montar e usar o cantinho da calma na casa, e a rotina mínima de autocuidado de quem cuida: sinais de sobrecarga e o que fazer quando aparecerem (pilar NA).",
  },
  {
    key: "jornada",
    title: "A Jornada da Família",
    hint: "A evolução encontro a encontro: onde a família começou, as vitórias do caminho e os próximos passos pra rotina continuar andando sozinha depois da mentoria (o método fica com vocês).",
  },
];

// Cria o Manual de um cliente: snapshot das seções do template (igual proposta:
// mudar o template depois não mexe nos manuais já criados).
export function newManual({ saas = "uniquekids", customerId = "", leadId = "", clientName = "", childName = "" } = {}) {
  const now = new Date().toISOString();
  return {
    id: "dv_" + randomUUID(),
    saas, customerId, leadId, clientName, childName,
    status: "building", // building | delivered
    deliveredAt: "",
    sections: MANUAL_SECTIONS.map((s) => ({ ...s, content: "", sources: [], updatedAt: "" })),
    createdAt: now,
  };
}

// Mesma família? Matcher canônico entre consulta e manual (e entre consultas):
// compara customerId quando AMBOS têm, senão leadId quando ambos têm, senão o
// nome (case-insensitive). Assim uma consulta criada "digitando o nome" casa com
// o manual criado via cliente do select, e vice-versa — sem manual duplicado e
// sem material ficando de fora do compose.
export function sameFamily(a, b) {
  if (!a || !b) return false;
  if (a.customerId && b.customerId) return a.customerId === b.customerId;
  if (a.leadId && b.leadId) return a.leadId === b.leadId;
  const an = String(a.clientName || "").trim().toLowerCase();
  const bn = String(b.clientName || "").trim().toLowerCase();
  return !!an && an === bn;
}

// Projeção pública do manual (página /m/:id): só o que a família deve ver —
// nada de hint/sources/ids internos, e só seções com conteúdo.
export function publicManual(m) {
  return {
    id: m.id,
    clientName: m.clientName || "",
    childName: m.childName || "",
    status: m.status || "building",
    deliveredAt: m.deliveredAt || "",
    sections: (m.sections || [])
      .filter((s) => String(s.content || "").trim())
      .map((s) => ({ key: s.key, title: s.title, content: s.content })),
  };
}
