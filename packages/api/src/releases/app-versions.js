// Versão em execução de cada app da Lever, lida de fora (o que está NO AR, não
// o que a main diz). Cada app responde do seu jeito:
//   · cockpit     → este processo: impressão digital de packages/api/src
//                   (a mesma do /api/health) e a hora em que subiu;
//   · leverads    → GET {LEVERADS_API_URL}/api/version (público): versão,
//                   commit, subida, e a identidade de cada worker;
//   · leverid     → GET {IDENTITY_AUTH_URL}/health do GoTrue (versão dele),
//                   com a chave de serviço que o Kong exige;
//   · leverprice  → ainda não tem endpoint de versão: só diz se responde
//                   (GET {LEVERPRICE_API_URL}/api/health), quando configurado.
// Falha de um app nunca derruba os outros: vira `ok: false` com o motivo.

import { srcFingerprint } from "../build-info.js";

const STARTED_AT = new Date().toISOString();
const TIMEOUT_MS = 4000;
const trim = (u) => String(u || "").replace(/\/+$/, "");

async function getJson(fetchImpl, url, headers = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const notConfigured = (env) => ({ ok: false, configured: false, error: `defina ${env}` });

async function leverads(fetchImpl, env) {
  const base = trim(env.LEVERADS_API_URL || "https://copy.levermoney.com.br");
  const v = await getJson(fetchImpl, `${base}/api/version`);
  const workers = (Array.isArray(v.workers) ? v.workers : []).map((w) => ({
    service: String(w.service || ""), version: String(w.version || ""), commit: String(w.commit || "").slice(0, 12),
    startedAt: w.started_at || "", seenAt: w.seen_at || "",
  }));
  return {
    ok: true, version: String(v.version || ""), commit: String(v.commit || "").slice(0, 12),
    startedAt: v.started_at || "", url: base, workers,
  };
}

async function leverid(fetchImpl, env) {
  const base = trim(env.IDENTITY_AUTH_URL);
  if (!base) return notConfigured("IDENTITY_AUTH_URL");
  const key = env.IDENTITY_SERVICE_KEY || "";
  const h = await getJson(fetchImpl, `${base}/health`, key ? { apikey: key } : {});
  return { ok: true, version: String(h.version || ""), detail: String(h.name || "GoTrue"), url: base };
}

async function leverprice(fetchImpl, env) {
  const base = trim(env.LEVERPRICE_API_URL);
  if (!base) return notConfigured("LEVERPRICE_API_URL");
  await getJson(fetchImpl, `${base}/api/health`);
  return { ok: true, version: "", detail: "no ar; ainda sem endpoint de versão", url: base };
}

const APPS = [
  { id: "leverads", name: "LeverAds", read: leverads },
  { id: "leverid", name: "LeverId", read: leverid },
  { id: "leverprice", name: "LeverPrice", read: leverprice },
];

export async function appVersions({ fetchImpl = fetch, env = process.env, now = () => new Date() } = {}) {
  const cockpit = { id: "cockpit", name: "Cockpit", ok: true, version: "", build: srcFingerprint(), startedAt: STARTED_AT };
  const others = await Promise.all(APPS.map(async (app) => {
    try {
      return { id: app.id, name: app.name, ...(await app.read(fetchImpl, env)) };
    } catch (err) {
      const error = err?.name === "AbortError" ? `sem resposta em ${TIMEOUT_MS / 1000}s` : String(err?.message || err);
      return { id: app.id, name: app.name, ok: false, configured: true, error };
    }
  }));
  return { at: now().toISOString(), apps: [cockpit, ...others] };
}
