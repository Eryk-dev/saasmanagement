// Etiquetas de papel do usuário (user.roles) que as rotas consultam antes de
// liberar ações de gestão.

// "admin" é o dono da operação (Leo, Eryk, Jonathan): não é vaga de funil e,
// por padrão, não gera treinamento obrigatório.
export function isAdmin(user) {
  return (user?.roles || []).includes("admin");
}

// Chave mestre agindo em nome de alguém (cabeçalho `x-act-as`, auth.js): a
// pessoa entra em `req.authUser` só para a AUTORIA (quem moveu o card, quem
// logou o toque); o ACESSO continua o da chave. Símbolo: não sai no JSON e
// sobrevive a `{ ...user }`.
const VIA_MASTER_KEY = Symbol("chave-mestre");
export function markViaMasterKey(user) {
  user[VIA_MASTER_KEY] = true;
  return user;
}
// Acesso total: sem usuário (chave mestre) ou a chave mestre em nome de alguém.
// É o teste que as checagens de permissão usam no lugar do `!user`.
export const isMasterKey = (user) => !user || user[VIA_MASTER_KEY] === true;

// Vagas operacionais: quem tem uma delas é cobrado no treinamento por padrão.
export const TRAINING_ROLES = ["sdr", "closer", "integrator", "social"];

// Treinamento obrigatório (Configurações → Equipe, coluna "Treino", 03/11/2026).
// É UMA régua só pra tudo que cobra: o portão do treino diário no SPA, o quadro
// da aba Equipe dos Treinamentos e o lembrete do Discord. `user.trainingRequired`
// gravado (true/false) manda; sem ele vale a regra antiga: tem vaga e não é
// admin. Não mexe no ESTUDO — quem não é cobrado continua podendo treinar.
export function trainingRequired(user) {
  if (typeof user?.trainingRequired === "boolean") return user.trainingRequired;
  return !isAdmin(user) && (user?.roles || []).some((r) => TRAINING_ROLES.includes(r));
}
