// Etiquetas de papel do usuário (user.roles) que as rotas consultam antes de
// liberar ações de gestão.

// "admin" é o dono da operação (Leo, Eryk, Jonathan): não é vaga de funil e
// não gera treinamento obrigatório.
export function isAdmin(user) {
  return (user?.roles || []).includes("admin");
}
