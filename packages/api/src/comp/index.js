// Domínio de remuneração: extrato mensal e o fechamento do mês.

import { registerCompRoutes } from "./routes.comp.js";
import { startCompMonthClose } from "./comp-months.js";

export function register(app, repo) {
  // Extrato mensal da remuneração (o que cada mês fechado registrou).
  registerCompRoutes(app, repo);
}

export function start(repo, { log }) {
  // Fecha o mês da remuneração no dia seguinte: congela contratos, receita e o
  // bônus de time de cada pessoa. É o extrato da folha e a base do critério de
  // promoção, que não pode depender de recalcular o passado.
  startCompMonthClose(repo, { log });
}
