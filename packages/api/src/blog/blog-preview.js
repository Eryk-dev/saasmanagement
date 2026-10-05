// Assinatura da prévia dos posts (link com validade) e o reconhecimento do proxy
// do site pelo header x-blog-proxy. Usado pelas páginas públicas do blog e pela
// rota de prévia do editor.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const PREVIEW_TTL_SEC = 30 * 60;

// ── fronted / preview ────────────────────────────────────────────────────────
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
};

// true só quando o token está configurado E a request trouxe o mesmo valor.
export function isFronted(req, env = process.env) {
  const token = String(env.BLOG_PROXY_TOKEN || "").trim();
  if (!token) return false;
  const h = req?.headers?.["x-blog-proxy"];
  const got = Array.isArray(h) ? h[0] : h;
  return safeEqual(got, token);
}

let processSecret = "";

export function previewSecret(env = process.env) {
  const s = String(env.BLOG_PREVIEW_SECRET || env.COCKPIT_API_KEY || "").trim();
  if (s) return s;
  if (!processSecret) processSecret = randomBytes(32).toString("hex"); // dev sem chave: vale só neste processo
  return processSecret;
}

export function signPreview(id, exp, secret) {
  return createHmac("sha256", String(secret)).update(`${id}.${exp}`).digest("base64url");
}

export function verifyPreview({ id, exp, sig } = {}, secret, nowSec = Math.floor(Date.now() / 1000)) {
  if (!id || !sig || !secret) return false;
  if (!/^\d{1,12}$/.test(String(exp))) return false;
  const expN = Number(exp);
  if (!Number.isInteger(expN) || expN <= nowSec) return false;
  return safeEqual(sig, signPreview(id, expN, secret));
}

// `base` = host público do COCKPIT (publicBase(req) em platform/request.js), não o do blog.
export function previewUrlFor({ base, id, secret, now = Date.now(), ttlSec = PREVIEW_TTL_SEC } = {}) {
  const exp = Math.floor(now / 1000) + ttlSec;
  const sig = signPreview(id, exp, secret);
  const root = String(base || "").replace(/\/+$/, "");
  return { url: `${root}/public/blog/preview/${encodeURIComponent(id)}?exp=${exp}&sig=${sig}`, expiresAt: new Date(exp * 1000).toISOString() };
}
