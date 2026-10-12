// Baixa AUTOMÁTICA das contas a pagar pela saída da conta Mercado Pago.
//
// O relatório do MP não diz pra quem foi a transferência (não há coluna de
// favorecido), então o casamento é por VALOR + DATA contra a conta a pagar
// em aberto — e só quando é inequívoco: valor igual (±R$ 0,01), data da saída
// até TOLERANCE_DAYS do vencimento, e UMA candidata. Duas contas com o mesmo
// valor na mesma janela (dois salários iguais) ficam na fila pra alguém
// escolher. Vale pros dois caminhos de saída: settlement report
// (mp_movements) e pagamento feito com o saldo (mp_payments kind "saida").

const TOLERANCE_DAYS = 5;
const DAY = 86_400_000;
const dayOf = (iso) => String(iso || "").slice(0, 10);
const daysBetween = (a, b) => Math.abs(new Date(`${dayOf(a)}T12:00:00Z`) - new Date(`${dayOf(b)}T12:00:00Z`)) / DAY;

export function matchCandidates(mov, payables) {
  const amount = Number(mov.amount) || 0;
  return (payables || []).filter((p) => p.status !== "paga" && !p.payableLinked
    && Math.abs((Number(p.amount) || 0) - amount) < 0.01
    && p.dueDate && dayOf(mov.at) && daysBetween(p.dueDate, mov.at) <= TOLERANCE_DAYS);
}

export async function autoMatchOutflows(repo, { log } = {}) {
  const [movs, mps, payables] = await Promise.all([repo.list("mp_movements"), repo.list("mp_payments"), repo.list("payables")]);
  const open = payables.filter((p) => p.status !== "paga");
  const taken = new Set();
  const outs = [
    ...movs.filter((m) => (m.direction || "out") === "out" && !m.payableId && !m.finIgnored).map((m) => ({ coll: "mp_movements", id: m.id, amount: m.amount, at: m.date })),
    ...mps.filter((p) => p.status === "approved" && p.kind === "saida" && !p.payableId && !p.finIgnored).map((p) => ({ coll: "mp_payments", id: p.id, amount: p.amount, at: p.dateApproved || p.dateCreated })),
  ];
  let matched = 0;
  for (const mov of outs) {
    const cands = matchCandidates(mov, open.filter((p) => !taken.has(p.id)));
    if (cands.length !== 1) continue;
    const p = cands[0];
    taken.add(p.id);
    await repo.update("payables", p.id, { status: "paga", paidAt: `${dayOf(mov.at)}T12:00:00.000Z`, paidVia: "mp", autoMatched: { source: mov.coll, id: mov.id, at: new Date().toISOString() } });
    await repo.update(mov.coll, mov.id, { payableId: p.id, autoMatched: true }, { silent: true });
    matched++;
    log?.info?.({ payable: p.id, mov: mov.id, amount: mov.amount }, "saída do MP casada sozinha com a conta a pagar");
  }
  return { matched, pending: outs.length - matched };
}
