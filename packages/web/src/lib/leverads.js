// Orgs do produto LeverAds (GET /api/leverads-access/orgs), divididas entre o
// select "Org na LeverAds" do cadastro e a coluna "Usuário LeverAds" da tela
// Clientes. Cache de PROMESSA por sessão: cada hit no endpoint faz login
// super-admin no produto, então quem chegar primeiro busca e o resto reusa.
// Falhou (credencial LEVERADS_* ausente → 424, sessão travada), o cache limpa
// e a próxima chamada tenta de novo.
import { api } from "./api.js";

let orgsPromise = null;
export function fetchLeveradsOrgs() {
  orgsPromise ??= api.leveradsOrgs().catch((e) => { orgsPromise = null; throw e; });
  return orgsPromise;
}
