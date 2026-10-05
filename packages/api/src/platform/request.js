// Leitura da request HTTP compartilhada pelas rotas: IP do cliente (atrás do
// proxy) e a base das URLs públicas.

export const clientIp = (req) =>
  String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || "?";

// Base das URLs públicas gravadas no lead (proposalUrl). Prioridade:
// COCKPIT_PUBLIC_URL > host da request (x-forwarded-* do proxy) > localhost.
// Proto: host público = sempre https (a cadeia de proxies reescreve
// x-forwarded-proto pra http e não dá pra confiar nele); localhost = http.
// Deployment público em http puro não existe — e se existir, é a env que manda.
export function publicBase(req) {
  if (process.env.COCKPIT_PUBLIC_URL) return process.env.COCKPIT_PUBLIC_URL.replace(/\/+$/, "");
  const raw = req?.headers?.["x-forwarded-host"] || req?.headers?.host;
  if (raw) {
    const host = String(raw).split(",")[0].trim();
    const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host);
    return `${local ? "http" : "https"}://${host}`;
  }
  return `http://localhost:${process.env.API_PORT || 8787}`;
}
