// Seed PADRÃO = instância limpa (vazia). É isto que sobe num deploy novo.
// Os dados reais entram pelos seus SaaS via API REST / MCP.
//
// Quer explorar com os dados de demonstração (3 SaaS fictícios)?  ->  npm run seed:demo
// Quer zerar tudo de novo?                                        ->  npm run seed:clear
//
// As CHAVES de COLLECTIONS precisam existir (criam as tabelas e habilitam o REST);
// só os arrays vêm vazios.

export const PORTFOLIO_CONST = {
  nrr: 1,
  mrrSeries30d: [],
};

export const COLLECTIONS = {
  products: [],
  attention: [],
  deals: [],
  people: [],
  customers: [],
  leads: [],
  nps: [],
  goals: [],
  leaderboard_month: [],
  leaderboard_all: [],
};
