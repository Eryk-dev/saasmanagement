// Cliente de administração da identidade central (LeverId), usado para
// ligar o staff do cockpit a um LeverId e migrar a senha no login
// (docs/PLANO-AUTH.md, Fase 3).
//
//   IDENTITY_AUTH_URL      GoTrue (admin API: criar conta, definir senha)
//   IDENTITY_SERVICE_KEY   chave service_role do GoTrue
//   IDENTITY_REST_URL      PostgREST da identidade (RPCs identity_api)
//   IDENTITY_COCKPIT_KEY   chave svc_cockpit (find_user_by_email, set_staff)
//
// Sem as quatro variáveis, o cliente é null e as rotas respondem 424.

import { COCKPIT_STAFF_ROLE } from "./auth-jwt.js";

export function makeIdentityAdmin({ env = process.env, fetchImpl = fetch } = {}) {
  const authUrl = String(env.IDENTITY_AUTH_URL || "").replace(/\/+$/, "");
  const restUrl = String(env.IDENTITY_REST_URL || "").replace(/\/+$/, "");
  const serviceKey = env.IDENTITY_SERVICE_KEY || "";
  const cockpitKey = env.IDENTITY_COCKPIT_KEY || "";
  if (!authUrl || !restUrl || !serviceKey || !cockpitKey) return null;

  async function call(url, { method = "GET", key, body }) {
    const res = await fetchImpl(url, {
      method,
      headers: { "content-type": "application/json", apikey: key, authorization: `Bearer ${key}` },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* texto puro */ }
    if (!res.ok) {
      const err = new Error(json?.msg || json?.message || json?.error_description || `identidade respondeu ${res.status}`);
      err.status = res.status;
      err.code = json?.error_code || json?.code || "";
      throw err;
    }
    return json;
  }
  const rpc = (name, body) => call(`${restUrl}/rpc/${name}`, { method: "POST", key: cockpitKey, body });

  return {
    // { userId, source, hasPassword } ou null.
    async findUserByEmail(email) {
      const rows = await rpc("find_user_by_email", { p_email: email });
      const row = Array.isArray(rows) ? rows[0] : null;
      return row ? { userId: row.user_id, source: row.source || "", hasPassword: !!row.has_password } : null;
    },
    // Conta nova do staff, sem senha (vem da migração no login ou do e-mail de
    // definir senha). E-mail já confirmado: é o e-mail de trabalho do time. O
    // GoTrue grava uma senha aleatória; `password_pending` diz que ela não vale
    // como senha da pessoa (a identidade apaga a marca na primeira troca).
    async createUser(email) {
      const user = await call(`${authUrl}/admin/users`, {
        method: "POST", key: serviceKey,
        body: { email, email_confirm: true, app_metadata: { source: "cockpit", password_pending: true } },
      });
      return user.id;
    },
    async setPassword(userId, password) {
      await call(`${authUrl}/admin/users/${encodeURIComponent(userId)}`, { method: "PUT", key: serviceKey, body: { password } });
    },
    // E-mail "defina sua senha" (recuperação do GoTrue). O link volta para
    // `redirectTo` (precisa estar na allow list do GoTrue) com a sessão no hash.
    async sendPasswordEmail(email, redirectTo) {
      await call(`${authUrl}/recover?redirect_to=${encodeURIComponent(redirectTo)}`, { method: "POST", key: serviceKey, body: { email } });
    },
    // Papéis de staff; lista vazia tira o staff (e a membership na org Lever).
    async setStaff(userId, roles) {
      await rpc("set_staff", { p_user_id: userId, p_roles: roles });
    },
  };
}

// Etiquetas do cockpit → papéis de staff na identidade. Todo usuário do time é
// staff (`team`); a etiqueta admin vira `admin` (dono da operação) e a support,
// `support`.
export function staffRolesFor(user) {
  const tags = Array.isArray(user?.roles) ? user.roles : [];
  const roles = [COCKPIT_STAFF_ROLE];
  if (tags.includes("admin")) roles.push("admin");
  if (tags.includes("support")) roles.push("support");
  return roles;
}
