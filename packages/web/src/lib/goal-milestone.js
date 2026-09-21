// O alvo visual avança sem alterar a meta cadastrada nem as métricas de venda.
export function goalMilestone({ target, sold = 0, expectedProgress, ended = false, remainingBusinessDays = 0 }) {
  const baseCents = Math.round(Number(target) * 100);
  if (!(baseCents > 0)) return null;
  const soldCents = Math.round((Number(sold) || 0) * 100);
  const percent = !ended && soldCents >= baseCents
    ? (Math.floor(soldCents * 5 / baseCents) + 1) * 20 : 100;
  const targetCents = Math.round(baseCents * percent / 100);
  const missingCents = Math.max(0, targetCents - soldCents);
  const expectedCents = expectedProgress == null ? null : Math.round(targetCents * expectedProgress);
  return {
    percent, target: targetCents / 100, missing: missingCents / 100,
    paceDelta: expectedCents == null ? null : (soldCents - expectedCents) / 100,
    requiredDailyPace: !ended && remainingBusinessDays > 0
      ? Math.round(missingCents / remainingBusinessDays) / 100 : null,
  };
}
