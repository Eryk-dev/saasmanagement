// Semântica de estágios do funil. O funil de cada produto é dado editável
// (product.funnel = [{ stage, kind, conv, color, staleDays, cadence }]) e
// `lead.stage` guarda o NOME do estágio — nomes são livres. Todo código que
// precisa DECIDIR algo por estágio (é ganho? é perda? qual cadência?) decide
// pelo `kind`, nunca pelo nome. Funis antigos sem `kind` caem em heurística
// por nome (fallback), então nada quebra antes das migrações rodarem.

export const KINDS = [
  "novo",           // lead recém-chegado, ninguém tocou (SLA de 1º contato)
  "contato",        // SDR tentando falar (cadência de tentativas)
  "qualificacao",   // conversa rolando, SDR qualificando
  "call",           // reunião agendada com o closer
  "proposta",       // proposta enviada
  "followup",       // pós-call/proposta, negociação com próximo toque agendado
  "integracao",     // pós-venda: setup/kickoff antes de marcar ganho
  "posvenda",       // CS: acompanhamento pós-integração (aumento de consciência/sucesso)
  "ganho",          // fechado ganho (vira customer)
  "perdido",        // fechado perdido (exige motivo)
  "desqualificado", // fora do ICP (exige motivo)
  "outro",          // estágio custom sem semântica especial
];

export const SDR_KINDS = new Set(["novo", "contato", "qualificacao"]);
export const CLOSER_KINDS = new Set(["call", "proposta", "followup", "integracao"]);
export const LOSS_KINDS = new Set(["perdido", "desqualificado"]);
export const TERMINAL_KINDS = new Set(["ganho", "perdido", "desqualificado"]);

// Tipos de activity que contam como "toque" no lead (alimentam SLA de 1º
// contato, contador de tentativas do estágio e o reagendamento da cadência).
export const TOUCH_TYPES = new Set(["whatsapp", "call", "email", "meeting"]);

// Etapa de "No show" (cliente furou a call): o kind dela é `contato` (mesma
// cadência de retomada da Nutrição), então a identidade vem do NOME — espelho
// do isNoShowStage do front (lib/scripts.js, destinationsFor do Meu dia). Os
// placares usam pra contar furo de call mesmo sem o motivo de perda.
export const isNoShowStage = (stage) => /no.?show/i.test(String(stage || ""));

// Heurística por nome pra funis criados antes do `kind` existir (pt/en).
// index/length desempatam: 1º estágio sem nome reconhecível = "novo".
export function guessKind(stageName, index = -1, length = 0) {
  const n = String(stageName || "").toLowerCase();
  if (/ganho|won/.test(n)) return "ganho";
  if (/perdid|lost|sem resposta/.test(n)) return "perdido";
  if (/desqualific|disqualified/.test(n)) return "desqualificado";
  if (/integra/.test(n)) return "integracao";
  if (/acompanhament|p[óo]s.?venda|sucesso|cs\b/.test(n)) return "posvenda";
  if (/follow/.test(n)) return "followup";
  if (/proposta|proposal|negocia/.test(n)) return "proposta";
  if (/call|reuni|demo/.test(n)) return "call";
  if (/qualific/.test(n)) return "qualificacao";
  if (/contato|contact/.test(n)) return "contato";
  if (/novo|inbox|new|entrada/.test(n)) return "novo";
  if (index === 0 && length > 0) return "novo";
  return "outro";
}

// Garante `kind` válido em toda linha do funil e saneia `cadence` (números
// positivos; campo inválido é descartado). NUNCA rejeita — coerção, coerente
// com o resto do repo schemaless.
export function normalizeFunnel(funnel) {
  if (!Array.isArray(funnel)) return [];
  return funnel.map((f, i) => {
    const row = { ...(f || {}) };
    if (!KINDS.includes(row.kind)) row.kind = guessKind(row.stage, i, funnel.length);
    if (row.cadence && typeof row.cadence === "object") {
      const c = {};
      for (const k of ["maxAttempts", "retryDays", "firstTouchHours"]) {
        const v = Number(row.cadence[k]);
        if (Number.isFinite(v) && v > 0) c[k] = v;
      }
      if (Object.keys(c).length) row.cadence = c; else delete row.cadence;
    } else {
      delete row.cadence;
    }
    return row;
  });
}

function funnelOf(product) {
  return Array.isArray(product?.funnel) ? product.funnel : [];
}

function rowOf(product, stageName) {
  return funnelOf(product).find((f) => f && f.stage === stageName) || null;
}

// Kind de um estágio pelo nome. Fallback legado (funil sem a linha ou sem
// kind): nomes históricos que o código antigo tratava por Set hardcoded.
export function kindOf(product, stageName) {
  const row = rowOf(product, stageName);
  if (row) {
    if (KINDS.includes(row.kind)) return row.kind;
    return guessKind(row.stage, funnelOf(product).indexOf(row), funnelOf(product).length);
  }
  if (stageName === "Ganho" || stageName === "Closed Won") return "ganho";
  if (stageName === "Perdido") return "perdido";
  if (stageName === "Desqualificado" || stageName === "disqualified") return "desqualificado";
  return null;
}

// Substitui o antigo WON_STAGES: um lead "ganhou" quando o kind do estágio é
// ganho — por linha do funil ou pelos nomes legados (SaaS sem funil configurado).
export function isWon(product, stageName) {
  return kindOf(product, stageName) === "ganho";
}

// A venda como FATO do lead, não como posição do card. Enquanto o Ganho era a
// última etapa o card nunca saía de lá, então "está em Ganho" e "vendeu" eram a
// mesma coisa. Com o Ganho ANTES da Integração o card segue pra entrega, e
// medir pela posição faria a receita sumir justamente depois de reconhecida.
//
// `customerId` é o carimbo certo: convertWonLead grava ao criar o cliente
// (routes.js), é idempotente e NUNCA é limpo, então sobrevive a qualquer
// movimento posterior do card. Conferido em produção: 10 de 10 ganhos têm.
//
// Use ESTA função em tudo que é dinheiro e placar; `isWon` (por estágio) segue
// valendo pra decidir o que fazer no MOMENTO do movimento (criar cliente,
// cobrar valor, sair do drip).
export function isWonLead(product, lead) {
  if (!lead) return false;
  return !!lead.customerId || isWon(product, lead.stage);
}

// QUANDO a venda aconteceu. `stageSince` é recarimbado a cada movimento, então
// sozinho ele joga o ganho pro mês da etapa seguinte assim que o card anda.
// `wonAt` (gravado por convertWonLead) é a data real; o fallback cobre lead
// antigo, sem carimbo, que ainda está parado no Ganho.
export function wonAtOf(lead) {
  return lead?.wonAt || lead?.stageSince || "";
}

export function isLoss(product, stageName) {
  return LOSS_KINDS.has(kindOf(product, stageName));
}

// Régua de progresso: estágios até o 1º kind "ganho" (inclusive). Fallback
// pré-kind: corta no nome "Ganho" (comportamento do marketing hoje); sem
// "Ganho", régua = funil inteiro.
export function ladderOf(product) {
  const funnel = funnelOf(product);
  const names = funnel.map((f) => f.stage);
  let cut = funnel.findIndex((f) => kindOf(product, f.stage) === "ganho");
  if (cut === -1) return names;
  return names.slice(0, cut + 1);
}

// 1º estágio do funil com um dado kind (ex.: pra onde mandar um lead
// desqualificado). null quando o funil não tem o kind.
export function stageByKind(product, kind) {
  return funnelOf(product).find((f) => kindOf(product, f.stage) === kind) || null;
}

// Estágio de entrada do funil (convenção: lead com stage "" está nele).
export function firstStage(product) {
  return funnelOf(product)[0]?.stage || "";
}

export function cadenceOf(product, stageName) {
  const row = rowOf(product, stageName);
  return row && row.cadence && typeof row.cadence === "object" ? row.cadence : {};
}
