// Conferência do horário da integração AO SALVAR (07/10/2026). A grade do
// cockpit já trava o que conhece, mas entre abrir a grade e confirmar o cliente
// pode ter marcado pelo link de convite (a rotina google/booking-sync.js só liga
// a marcação ao card na leitura seguinte). Aqui a API confere de novo:
//   1. cockpit: outro card do MESMO integrador com integração sobreposta;
//   2. Google: evento ocupado na agenda dele, lida ao vivo, quando ele conectou
//      a conta. Sem conexão (ou com o Google fora do ar), vale só o cockpit.
// Os eventos do próprio card (sala, espelho, marcação) não contam: remarcar não
// esbarra em si mesmo.

import { brtToIso } from "./lead-flow.js";

export const INTEGRATION_MIN = 60;
const MIN = 60_000;

export function integrationEventIds(lead) {
  return new Set([lead?.integrationMeetEventId, lead?.calIntegEventId, lead?.integrationBookedEventId].filter(Boolean));
}

export async function integrationSlotConflict(repo, gu, { lead, at, integrator, now = new Date() }) {
  const s = Date.parse(brtToIso(at));
  if (!integrator || !Number.isFinite(s) || s <= now.getTime()) return null;
  const e = s + INTEGRATION_MIN * MIN;
  const overlaps = (a, b) => a < e && b > s;

  for (const o of await repo.listWhere("leads", { integrator })) {
    if (o.id === lead?.id || !o.integrationAt) continue;
    const os = Date.parse(brtToIso(o.integrationAt));
    if (Number.isFinite(os) && overlaps(os, os + INTEGRATION_MIN * MIN)) return { source: "cockpit", lead: o };
  }

  if (gu?.configured?.() && (await gu.connectedFor(integrator).catch(() => false))) {
    try {
      const skip = integrationEventIds(lead);
      const busy = await gu.listBusy(integrator, new Date(s).toISOString(), new Date(e).toISOString(), { fresh: true });
      if (busy.some((b) => !skip.has(b.id) && overlaps(Date.parse(b.start), Date.parse(b.end)))) return { source: "google" };
    } catch { /* Google fora do ar: vale o que o cockpit sabe */ }
  }
  return null;
}

export function integrationConflictMessage(conflict, integratorName = "quem integra") {
  return conflict.source === "cockpit"
    ? `${integratorName} já tem integração com ${conflict.lead?.name || "outro cliente"} nesse horário: escolha outro`
    : `esse horário acabou de ser ocupado na agenda do Google de ${integratorName}: escolha outro`;
}
