// CONTRATO DA IA DO ROBÔ SDR (v2, 15/10/2026): a IA escolhe horários por ID
// da lista e o MOTOR escreve a frase da oferta (sdr-offer.js). O modelo nunca
// mais escreve "amanhã às 9h": some a classe inteira de erro de rótulo, dia e
// par (R-020, R-021, R-022, R-026). O contrato v1 (mensagens + horario em ISO)
// continua aceito durante a transição; `draftFromAi` normaliza os dois.
//
// Qual contrato vale é config em runtime (product.sdrBot.offerContract, "v1"
// por padrão): troca e rollback por PATCH, sem deploy, depois do replay A/B.

export const ACTIONS = ["responder", "agendar", "remarcar", "desmarcar", "humano", "silencio"];

const ACAO_DESC = "responder = mandar a mensagem e seguir a conversa; agendar = o lead topou um horário da lista; remarcar = mudar a call já marcada pra um horário da lista; desmarcar = o lead cancelou a call marcada SEM escolher horário novo (o sistema tira da agenda e pergunta se o lead gostaria de remarcar, sem oferecer horários ainda); humano = precisa de gente (a mensagem vira frase de transição curta, pode ser vazia); silencio = não responder nada";

// Schema v2. `slotIds` recebe enum com os ids da lista quando ela existe:
// id inválido vira impossível na API (strict). Lista vazia: sem enum
// (enum vazio é rejeitado pelos provedores).
export function schemaV2(slotIds = []) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["acao", "partes", "oferecer", "slotIds", "email", "motivoHumano"],
    properties: {
      acao: { type: "string", enum: ACTIONS, description: ACAO_DESC },
      partes: { type: "array", maxItems: 3, items: { type: "string" }, description: "Os balões a enviar, EM SEQUÊNCIA, como gente digitando: 1 item curto quando a resposta é direta; 2 ou 3 itens curtos quando o conteúdo pedir mais (nunca um textão único). SEM dia nem hora dentro do texto: quem escreve o horário é o sistema, a partir de slotIds/oferecer. Lista vazia em agendar, remarcar, desmarcar e silencio." },
      oferecer: { type: "boolean", description: "true = esta resposta termina com a oferta de horários (o sistema escolhe os horários e escreve a frase no fim). false nas outras situações e sempre em agendar/remarcar/desmarcar/humano/silencio." },
      slotIds: { type: "array", maxItems: 2, items: slotIds.length ? { type: "string", enum: slotIds } : { type: "string" }, description: "Ids da lista de HORÁRIOS LIVRES (s1, s2…). Em agendar/remarcar: exatamente o id escolhido pelo lead. Em responder com oferecer=true: até 2 ids pra oferecer, ou vazio pra o sistema usar o PAR SUGERIDO. Vazio nas outras ações." },
      email: { type: "string", description: "E-mail do lead, se apareceu nesta mensagem dele; senão vazio." },
      motivoHumano: { type: "string", description: "Em humano: por que precisa de gente, 1 frase. Vazio nas outras ações." },
    },
  };
}

// Dá id estável (s1..sN, na ordem da lista) a cada horário.
export const slotIdsOf = (slots = []) => slots.map((s, i) => ({ ...s, id: `s${i + 1}` }));
export const slotLinesV2 = (slots = []) => slots.map((s) => `- ${s.id} · ${s.at} · ${s.label || s.at}`).join("\n");

const clean = (list) => (Array.isArray(list) ? list : [list]).map((t) => String(t || "").trim()).filter(Boolean).slice(0, 3);

// Normaliza a resposta da IA nos dois contratos pro shape que o cérebro lê:
// { acao, mensagens, mensagem, horario (ISO naive BRT), oferecer, slotIds,
// slots (objetos da lista), email, motivoHumano }.
export function draftFromAi(p = {}, { contract = "v1", slots = [] } = {}) {
  const acao = ACTIONS.includes(p.acao) ? p.acao : "humano";
  const email = String(p.email || "");
  const motivoHumano = String(p.motivoHumano || "");
  if (contract !== "v2") {
    const mensagens = clean(Array.isArray(p.mensagens) ? p.mensagens : [p.mensagem]);
    return { acao, mensagens, mensagem: mensagens.join("\n"), horario: String(p.horario || ""), oferecer: false, slotIds: [], slots: [], email, motivoHumano };
  }
  const byId = new Map(slots.map((s) => [s.id, s]));
  const slotIds = (Array.isArray(p.slotIds) ? p.slotIds : []).map(String).filter((id) => byId.has(id)).slice(0, 2);
  const chosen = slotIds.map((id) => byId.get(id));
  const mensagens = clean(Array.isArray(p.partes) ? p.partes : Array.isArray(p.mensagens) ? p.mensagens : [p.mensagem]);
  const booking = acao === "agendar" || acao === "remarcar";
  // Compat: modelo que ainda devolver `horario` em ISO é aceito.
  const horario = booking ? (chosen[0]?.at || String(p.horario || "")) : "";
  return { acao, mensagens, mensagem: mensagens.join("\n"), horario, oferecer: acao === "responder" && !!p.oferecer, slotIds, slots: chosen, email, motivoHumano };
}
