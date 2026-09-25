// Credencial do SPA: sessão da identidade central (GoTrue, via @supabase/auth-js)
// ou, no login antigo, o token de sessão do cockpit em `cockpit_key`.
//
// Com VITE_AUTH_URL definido, a tela de login entra pelo GoTrue: o auth-js guarda
// a sessão em `cockpit_auth` e renova o access token (600 s) sozinho enquanto a
// aba está aberta. Sem VITE_AUTH_URL, tudo segue como antes. A API decide o que
// aceita (AUTH_MODE, packages/api/src/auth-jwt.js).

import { GoTrueClient } from "@supabase/auth-js";

const AUTH_URL = import.meta.env.VITE_AUTH_URL || "";
const LEGACY_KEY = "cockpit_key";
const SESSION_KEY = "cockpit_auth";

export const identityEnabled = !!AUTH_URL;

let client = null;
export function identity() {
  if (!identityEnabled) return null;
  if (!client) {
    client = new GoTrueClient({
      url: AUTH_URL,
      storageKey: SESSION_KEY,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      // Atrás do Kong (produção) o GoTrue exige a chave anon.
      headers: import.meta.env.VITE_AUTH_ANON_KEY ? { apikey: import.meta.env.VITE_AUTH_ANON_KEY } : {},
    });
  }
  return client;
}

const read = (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
const drop = (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } };

// Sessão guardada pelo auth-js (sem chamar a rede). null = sem sessão.
function storedSession() {
  if (!identityEnabled) return null;
  try {
    const s = JSON.parse(read(SESSION_KEY) || "null");
    return s?.access_token ? s : null;
  } catch { return null; }
}
export const hasIdentitySession = () => !!storedSession();

// Token atual, síncrono (EventSource/XHR montam a URL/headers na hora). A
// sessão da identidade vence o token antigo. VITE_API_KEY é o fallback de dev.
export function currentToken() {
  return storedSession()?.access_token || read(LEGACY_KEY) || import.meta.env.VITE_API_KEY || "";
}

// Token pronto para uma requisição: renova antes se o access token já venceu
// (aba que dormiu, notebook que hibernou).
export async function freshToken() {
  const s = storedSession();
  if (s && s.expires_at && s.expires_at * 1000 < Date.now() + 10_000) {
    try {
      const { data } = await identity().getSession();
      return data.session?.access_token || "";
    } catch { return ""; }
  }
  return currentToken();
}

// Força a renovação (a API respondeu 401 com um token que parecia válido).
export async function refreshIdentity() {
  if (!storedSession()) return false;
  try {
    const { data, error } = await identity().refreshSession();
    return !error && !!data.session;
  } catch { return false; }
}

// Header de auth: JWT vai em Authorization; o token antigo e a key, em x-api-key.
export function authHeaders(token = currentToken()) {
  if (!token) return {};
  return /^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(token) ? { authorization: `Bearer ${token}` } : { "x-api-key": token };
}

export function setLegacyToken(token) {
  try { localStorage.setItem(LEGACY_KEY, token); } catch { /* ignore */ }
}

// Sai de tudo: encerra a sessão da identidade (scope local: revoga no GoTrue o
// refresh token desta sessão, sem derrubar as outras abas/aparelhos) e apaga o
// token antigo e o usuário guardado.
export async function clearCredentials() {
  if (storedSession()) {
    try { await identity().signOut({ scope: "local" }); } catch { /* sessão já morta */ }
    drop(SESSION_KEY);
  }
  drop(LEGACY_KEY);
  drop("cockpit_user");
}

// E-mail da sessão da identidade (troca de senha confirma a atual com ele).
export const identityEmail = () => storedSession()?.user?.email || "";

// Link do e-mail "defina sua senha" (recuperação do GoTrue): volta ao cockpit
// com a sessão no hash (#access_token=…&type=recovery) ou com o erro
// (#error=…&error_code=otp_expired). null = não é um retorno desses.
export function readRecoveryHash(hash = typeof location !== "undefined" ? location.hash : "") {
  const p = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  if (p.get("type") === "recovery" && p.get("access_token") && p.get("refresh_token")) {
    return { accessToken: p.get("access_token"), refreshToken: p.get("refresh_token") };
  }
  if (p.get("error_code") || (p.get("error") && p.get("error_description"))) {
    return { error: p.get("error_code") || p.get("error"), description: p.get("error_description") || "" };
  }
  return null;
}

// Define a senha a partir do link: abre a sessão do link e grava a senha nova.
// A sessão fica guardada (a pessoa já entra logada).
export async function setPasswordFromRecovery({ accessToken, refreshToken }, password) {
  await clearCredentials();
  const client = identity();
  const { error: sessionError } = await client.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (sessionError) throw Object.assign(new Error("o link expirou ou já foi usado — peça outro"), { shown: true });
  const { error } = await client.updateUser({ password });
  if (error) throw Object.assign(new Error(error.code === "weak_password" ? "senha fraca demais — use 8+ caracteres" : error.message), { shown: true });
}

// "Esqueci minha senha" da conta Lever: o GoTrue manda o e-mail (sem dizer se
// o e-mail existe, para não revelar contas).
export async function requestPasswordEmail(email) {
  const { error } = await identity().resetPasswordForEmail(email, { redirectTo: `${location.origin}/` });
  if (error) throw Object.assign(new Error(error.status === 429 ? "muitos pedidos — espere um pouco e tente de novo" : error.message), { shown: true });
}
