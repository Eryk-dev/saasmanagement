// Isolamento por produto do módulo de Suporte — este é ACL de verdade, ao
// contrário de `user.saas` (só escopo de picker) e de `user.screens` (lista
// vazia = vê tudo).
//
//   chave mestre (sem authUser) → todos os produtos (MCP/integrações)
//   etiqueta `admin`            → todos os produtos
//   demais sessões              → só `user.supportSaas` (lista VAZIA = nenhum)
//
// Ticket fora do escopo não existe pra quem pergunta (404); criar num produto
// fora do escopo é 403. A lista de cada atendente é editada na tela de
// Configurações de SLA (PUT /api/support/agents/:id).

const uniq = (arr) => [...new Set(arr)];

export const sanitizeSupportSaas = (x) =>
  Array.isArray(x) ? uniq(x.map((s) => String(s ?? "").trim().toLowerCase()).filter(Boolean)) : [];

export const isAdminUser = (user) => (Array.isArray(user?.roles) ? user.roles : []).includes("admin");

// null = sem restrição; array = produtos permitidos.
export function ticketScope(user) {
  if (!user) return null;
  if (isAdminUser(user)) return null;
  return sanitizeSupportSaas(user.supportSaas);
}

export const inScope = (scope, saas) => scope === null || scope.includes(String(saas ?? ""));

// Produtos do catálogo que o escopo alcança (pra listar/contar por produto).
export const scopedProducts = (scope, products) =>
  (products || []).map((p) => String(p.id)).filter((id) => inScope(scope, id));

// Pode ser responsável por tickets do produto? (usuário completo do repo)
export const canHandleSaas = (user, saas) => inScope(ticketScope(user), saas);
