import { PORTFOLIO_CONST } from "../platform/seed-data.js";
import { isChurnedCustomer } from "../billing/churn.js";

// Receita e nº de clientes são DERIVADOS da coleção `customers`, não dos campos
// crus do produto — assim um SaaS nunca exibe receita sem clientes registrados.
// `customers` = qtd de clientes daquele saas; `arr` = soma do ARR deles; `mrr` = arr/12.
// Cliente CHURNADO (endedAt no passado — régua única em churn.js) fica fora dos
// três números: o arr dele segue congelado no cadastro só como histórico.
export function rollupProduct(p, customers) {
  const mine = customers.filter((c) => c.saas === p.id && !isChurnedCustomer(c));
  const arr = mine.reduce((a, c) => a + (Number(c.arr) || 0), 0);
  return { ...p, customers: mine.length, arr, mrr: Math.round(arr / 12) };
}

export const rollupProducts = (products, customers) => products.map((p) => rollupProduct(p, customers));

export async function computePortfolio(repo) {
  const [products, customers] = await Promise.all([repo.list("products"), repo.list("customers")]);
  const saas = rollupProducts(products, customers);
  const sum = (k) => saas.reduce((a, s) => a + (Number(s[k]) || 0), 0);
  return {
    mrr: sum("mrr"),
    arr: sum("arr"),
    mrrDelta: sum("mrrDelta"),
    tcv: sum("tcv"),
    customers: sum("customers"),
    nrr: PORTFOLIO_CONST.nrr,
    mrrSeries30d: PORTFOLIO_CONST.mrrSeries30d,
  };
}
