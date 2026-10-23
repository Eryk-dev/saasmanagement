// Ajustes do robô SDR que só admin muda (aba Robô da Inbox): a IA que ele usa
// e os botões que até aqui só mudavam por PATCH direto no product.sdrBot. As
// chaves de ligar/desligar (enabled, firstTouch, conversation…) continuam no
// card da aba Automações. Os padrões moram em sdrBotConfig (sdr-flow.js); aqui
// é só o que cada chave aceita.
import { AI_PROVIDERS } from "./sdr-ai.js";

const int = (min, max) => ({ kind: "int", min, max });
const bool = { kind: "bool" };
const oneOf = (...values) => ({ kind: "enum", values });
const days = { kind: "days", min: 1, max: 60, size: 6 };

export const SDR_ADMIN_KEYS = {
  debounceSec: int(5, 120),
  freshHours: int(1, 168),
  ladderColdDays: int(2, 30),
  ladderWarmDays: days,
  ladderDropHours: int(12, 240),
  ladderDrop: bool,
  ladderPerDay: int(1, 300),
  ladderCooldownDays: int(1, 14),
  backlogRescue: bool,
  backlogRescuePerBatch: int(1, 300),
  backlogRescueMaxFailPct: int(1, 100),
  backlogRescueMinSample: int(1, 200),
  humanMuteHours: int(1, 48),
  humanMuteOffHours: bool,
  humanMuteHourStart: int(0, 23),
  humanMuteHourEnd: int(1, 23),
  promptVersion: oneOf("v1", "v2"),
  offerContract: oneOf("v1", "v2"),
  guardsMode: oneOf("audit", "enforce"),
};

// { patch } com as chaves válidas, ou { error } com a primeira inválida.
// `ai` = { provider: ""|openrouter|anthropic, model: slug }.
export function sanitizeSdrAdmin(body = {}) {
  const patch = {};
  for (const [key, spec] of Object.entries(SDR_ADMIN_KEYS)) {
    if (!(key in body)) continue;
    const v = body[key];
    if (spec.kind === "int") {
      const n = Number(v);
      if (!Number.isInteger(n) || n < spec.min || n > spec.max) return { error: `${key}: use um inteiro de ${spec.min} a ${spec.max}` };
      patch[key] = n;
    } else if (spec.kind === "bool") {
      if (typeof v !== "boolean") return { error: `${key}: use true ou false` };
      patch[key] = v;
    } else if (spec.kind === "enum") {
      if (!spec.values.includes(v)) return { error: `${key}: use ${spec.values.join(" ou ")}` };
      patch[key] = v;
    } else if (spec.kind === "days") {
      const list = Array.isArray(v) ? v.map(Number) : [];
      const ok = list.length >= 1 && list.length <= spec.size && list.every((n, i) => Number.isInteger(n) && n >= spec.min && n <= spec.max && (i === 0 || n > list[i - 1]));
      if (!ok) return { error: `${key}: de 1 a ${spec.size} dias crescentes, entre ${spec.min} e ${spec.max}` };
      patch[key] = list;
    }
  }
  if ("humanMuteHourStart" in patch && "humanMuteHourEnd" in patch && patch.humanMuteHourEnd <= patch.humanMuteHourStart) {
    return { error: "horário comercial do robô: o fim precisa ser depois do início" };
  }
  if ("ai" in body) {
    const provider = String(body.ai?.provider || "");
    const model = String(body.ai?.model || "").trim();
    if (provider && !AI_PROVIDERS.includes(provider)) return { error: "ai.provider: use openrouter, anthropic ou vazio (padrão do servidor)" };
    if (model.length > 120 || /\s/.test(model)) return { error: "ai.model: slug do modelo sem espaços" };
    patch.ai = { provider, model };
  }
  return { patch };
}

// Chaves de admin que mudariam (ou sumiriam) se `next` substituísse o sdrBot
// atual. O card da aba Automações manda o sdrBot inteiro com o que já estava,
// então só acusa o que de fato mudou.
export function sdrAdminKeysChanged(prev, next) {
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return [...Object.keys(SDR_ADMIN_KEYS), "ai"].filter((k) => !same(prev?.[k], next?.[k]));
}
