// Caixa por conta (17/10/2026): quanto a casa tem em cada conta — Mercado
// Pago (disponível e reserva/POTS), Asaas, Sicredi, BTG conta corrente e BTG
// investimento. Os saldos moram em app_config "fin_accounts" e entram à mão
// (ou pelo importador de extrato, quando existir); o cockpit não tem o saque
// do MP nem os extratos dos bancos por API, então o número é um RETRATO com
// data (asOf), não um cálculo. `caixaOf` separa disponível × reserva.

const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);

export const FIN_ACCOUNTS = [
  { id: "mp", label: "Mercado Pago · disponível", kind: "gateway" },
  { id: "mp_reserva", label: "Mercado Pago · reserva (POTS)", kind: "inv" },
  { id: "asaas", label: "Asaas · saldo", kind: "gateway" },
  { id: "sicredi", label: "Sicredi · conta corrente", kind: "cc" },
  { id: "btg_cc", label: "BTG · conta corrente", kind: "cc" },
  { id: "btg_inv", label: "BTG · investimento", kind: "inv" },
];
export const isFinAccount = (id) => FIN_ACCOUNTS.some((a) => a.id === id);
export const ACCOUNT_SOURCES = new Set(["manual", "ofx", "api", "import"]);

export async function readFinAccounts(repo) {
  const cfg = await repo.get("app_config", "fin_accounts").catch(() => null);
  return { id: "fin_accounts", accounts: {}, ...(cfg || {}), accounts: { ...(cfg?.accounts || {}) } };
}

// Upsert de UMA conta. `patch` = { balance, asOf, source, note, updatedBy }.
export async function writeFinAccount(repo, account, patch = {}) {
  if (!isFinAccount(account)) throw Object.assign(new Error(`conta desconhecida: ${account}`), { statusCode: 400 });
  const balance = Number(patch.balance);
  if (patch.balance !== undefined && !Number.isFinite(balance)) throw Object.assign(new Error("saldo inválido"), { statusCode: 400 });
  const asOf = str(patch.asOf, 10);
  if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw Object.assign(new Error("data do saldo inválida (AAAA-MM-DD)"), { statusCode: 400 });
  const cur = await readFinAccounts(repo);
  const prev = cur.accounts[account] || {};
  const next = {
    ...prev,
    ...(patch.balance !== undefined ? { balance: Math.round(balance * 100) / 100 } : {}),
    ...(asOf ? { asOf } : {}),
    ...(patch.source !== undefined ? { source: ACCOUNT_SOURCES.has(patch.source) ? patch.source : "manual" } : {}),
    ...(patch.note !== undefined ? { note: str(patch.note, 300) } : {}),
    ...(patch.updatedBy !== undefined ? { updatedBy: str(patch.updatedBy, 60) } : {}),
    updatedAt: new Date().toISOString(),
  };
  const doc = { id: "fin_accounts", accounts: { ...cur.accounts, [account]: next }, updatedAt: next.updatedAt };
  const exists = await repo.get("app_config", "fin_accounts").catch(() => null);
  if (exists) await repo.update("app_config", "fin_accounts", doc, { silent: true });
  else await repo.create("app_config", doc);
  return doc;
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// O retrato pra tela: contas na ordem fixa, com saldo (ou null quando nunca
// foi lançado), total, reserva (contas `inv`) e disponível = total − reserva.
export function caixaOf(cfg) {
  const accounts = cfg?.accounts || {};
  const contas = FIN_ACCOUNTS.map((a) => {
    const s = accounts[a.id] || {};
    const has = Number.isFinite(Number(s.balance)) && s.balance !== null && s.balance !== undefined;
    return { ...a, balance: has ? round2(s.balance) : null, asOf: s.asOf || "", source: s.source || "", note: s.note || "", updatedAt: s.updatedAt || "" };
  });
  const total = round2(contas.reduce((acc, c) => acc + (c.balance || 0), 0));
  const reserva = round2(contas.filter((c) => c.kind === "inv").reduce((acc, c) => acc + (c.balance || 0), 0));
  return { contas, total, reserva, disponivel: round2(total - reserva), informadas: contas.filter((c) => c.balance !== null).length };
}
