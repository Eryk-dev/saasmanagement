// Portal público do Suporte: o cliente acompanha e responde pelo token, abre
// chamado pelo link do produto (com o portal ligado) e NUNCA vê nota interna,
// anexo interno ou dado da equipe.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeAuthHook } from "../src/auth.js";
import { makeScreenGuardHook } from "../src/screens.js";

const { registerRoutes } = await import("../src/routes.js");

async function buildApp({ limits } = {}) {
  const repo = makeMemRepo();
  await repo.create("products", { id: "alpha", name: "Alpha", accent: 200 });
  await repo.create("users", { id: "lia", name: "Lia Atendente", roles: ["support"], supportSaas: ["alpha"] });
  await repo.create("customers", { id: "c1", saas: "alpha", name: "Loja", email: "dono@loja.com", phone: "(11) 99999-0000" });
  const app = Fastify();
  await app.register(multipart);
  // Com a chave ligada: prova que o portal está mesmo em OPEN_PREFIXES.
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
  const openPrefixes = [...src.match(/const OPEN_PREFIXES\s*=\s*\[(.*?)\];/s)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  app.addHook("onRequest", makeAuthHook({ apiKey: "test-key", repo, openPaths: new Set(), openPrefixes, providedKey: (req) => req.headers["x-api-key"] || "" }));
  app.addHook("onRequest", makeScreenGuardHook());
  registerRoutes(app, repo, limits ? { supportPortal: { limits } } : {});
  const KEY = { "x-api-key": "test-key" };
  return { app, repo, KEY };
}

test("chamado pelo token: nota interna e anexo interno nunca aparecem", async (t) => {
  const { app, repo, KEY } = await buildApp();
  t.after(() => app.close());
  const tk = (await app.inject({ method: "POST", url: "/api/tickets", headers: KEY, payload: { saas: "alpha", subject: "Erro no painel", description: "Não carrega", customerId: "c1" } })).json();
  await app.inject({ method: "POST", url: `/api/tickets/${tk.id}/messages`, headers: KEY, payload: { kind: "note", text: "SEGREDO interno: cliente inadimplente" } });
  await app.inject({ method: "POST", url: `/api/tickets/${tk.id}/messages`, headers: KEY, payload: { kind: "reply", text: "Oi! Já estamos olhando." } });
  await repo.update("tickets", tk.id, { attachments: [{ id: "tia_x", name: "interno.pdf", public: false }] });

  const json = await app.inject({ url: `/public/support/${tk.portalToken}` });
  assert.equal(json.statusCode, 200);
  const body = json.body;
  assert.ok(!body.includes("SEGREDO"), "nota interna vazou no JSON");
  assert.ok(!body.includes("interno.pdf"), "anexo interno vazou");
  assert.ok(!body.includes("sla") && !body.includes("assignee") && !body.includes("portalToken"), "dado da equipe vazou");
  const view = json.json();
  assert.equal(view.statusLabel, "Em atendimento");
  assert.deepEqual(view.messages.map((m) => m.from), ["customer", "agent"]);

  const page = await app.inject({ url: `/s/${tk.portalToken}` });
  assert.equal(page.statusCode, 200);
  assert.match(page.headers["content-type"], /text\/html/);
  assert.ok(page.body.includes("Erro no painel") && page.body.includes("Já estamos olhando"));
  assert.ok(!page.body.includes("SEGREDO"), "nota interna vazou no HTML");

  assert.equal((await app.inject({ url: "/s/00000000000000000000000000000000" })).statusCode, 404);
  assert.equal((await app.inject({ url: "/s/nao-e-token" })).statusCode, 404);
  assert.equal((await app.inject({ url: `/public/support/${tk.portalToken}/attachments/tia_x` })).statusCode, 404, "anexo interno não baixa pelo portal");
});

test("resposta do cliente reabre, notifica o responsável e respeita fechado/honeypot", async (t) => {
  const { app, repo, KEY } = await buildApp();
  t.after(() => app.close());
  const tk = (await app.inject({ method: "POST", url: "/api/tickets", headers: KEY, payload: { saas: "alpha", subject: "Dúvida", assignee: "lia", requester: { name: "Carla" } } })).json();
  await app.inject({ method: "POST", url: `/api/tickets/${tk.id}/messages`, headers: KEY, payload: { text: "Pode mandar o print?", status: "pending_customer" } });

  const bot = await app.inject({ method: "POST", url: `/public/support/${tk.portalToken}/messages`, payload: { text: "spam", _hp: "x" } });
  assert.equal(bot.statusCode, 200);
  assert.equal((await repo.get("tickets", tk.id)).messages.length, 1, "honeypot descarta");

  const r = await app.inject({ method: "POST", url: `/public/support/${tk.portalToken}/messages`, payload: { text: "Segue o print" } });
  assert.equal(r.statusCode, 201, r.body);
  const saved = await repo.get("tickets", tk.id);
  assert.equal(saved.status, "open", "cliente respondeu: volta pra equipe");
  assert.equal(saved.sla.pausedAt, "", "o relógio volta a correr");
  assert.equal(saved.messages[1].author.type, "customer");
  assert.equal(saved.messages[1].author.name, "Carla");
  assert.equal((await repo.listWhere("notifications", { user: "lia", type: "ticket_reply" })).length, 1);
  assert.equal((await repo.listWhere("ticket_events", { ticket: tk.id })).find((e) => e.type === "message" && e.by === "portal") != null, true);

  await app.inject({ method: "PATCH", url: `/api/tickets/${tk.id}`, headers: KEY, payload: { status: "closed" } });
  const closed = await app.inject({ method: "POST", url: `/public/support/${tk.portalToken}/messages`, payload: { text: "e agora?" } });
  assert.equal(closed.statusCode, 409);
  assert.ok((await app.inject({ url: `/s/${tk.portalToken}` })).body.includes("foi encerrado"));
});

const mpPayload = (boundary, name, mime, bytes) => Buffer.concat([
  Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${name}"\r\ncontent-type: ${mime}\r\n\r\n`),
  bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
]);

test("anexo do cliente nasce público e só baixa pelo token do próprio chamado", async (t) => {
  const { app, KEY } = await buildApp();
  t.after(() => app.close());
  const a = (await app.inject({ method: "POST", url: "/api/tickets", headers: KEY, payload: { saas: "alpha", subject: "A" } })).json();
  const b = (await app.inject({ method: "POST", url: "/api/tickets", headers: KEY, payload: { saas: "alpha", subject: "B" } })).json();
  const boundary = "----portal";
  const up = await app.inject({ method: "POST", url: `/public/support/${a.portalToken}/attachments`, headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, payload: mpPayload(boundary, "print.png", "image/png", Buffer.from("png")) });
  assert.equal(up.statusCode, 201, up.body);
  const att = up.json().attachment;
  const msg = await app.inject({ method: "POST", url: `/public/support/${a.portalToken}/messages`, payload: { text: "", attachments: [att.id] } });
  assert.equal(msg.statusCode, 201, msg.body);
  const served = await app.inject({ url: `/public/support/${a.portalToken}/attachments/${att.id}` });
  assert.equal(served.statusCode, 200);
  assert.match(served.headers["content-disposition"], /^inline/);
  assert.match(served.headers["content-security-policy"], /sandbox/);
  // SVG enviado pelo cliente anônimo nunca abre inline na origem do cockpit.
  const svg = await app.inject({ method: "POST", url: `/public/support/${a.portalToken}/attachments`, headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, payload: mpPayload(boundary, "x.svg", "image/svg+xml", Buffer.from("<svg onload=alert(1)></svg>")) });
  const svgServed = await app.inject({ url: `/public/support/${a.portalToken}/attachments/${svg.json().attachment.id}` });
  assert.match(svgServed.headers["content-disposition"], /^attachment/);
  assert.equal((await app.inject({ url: `/public/support/${b.portalToken}/attachments/${att.id}` })).statusCode, 404);
});

test("abrir chamado pelo link do produto: só com o portal ligado, valida e vincula o cliente", async (t) => {
  const { app, repo, KEY } = await buildApp({ limits: { open: 50 } });
  t.after(() => app.close());
  assert.equal((await app.inject({ url: "/s/new/alpha" })).statusCode, 404, "portal nasce desligado");
  assert.equal((await app.inject({ method: "POST", url: "/public/support/new/alpha", payload: { name: "X", email: "x@x.com", subject: "s", description: "d" } })).statusCode, 404);

  await app.inject({ method: "PUT", url: "/api/support/settings/alpha", headers: KEY, payload: { portal: { enabled: true, intro: "Respondemos em 1 dia <b>útil</b>" }, categories: ["Acesso"] } });
  const page = await app.inject({ url: "/s/new/alpha" });
  assert.equal(page.statusCode, 200);
  assert.ok(page.body.includes("Respondemos em 1 dia &lt;b&gt;útil&lt;/b&gt;"), "texto do produto sai escapado");
  assert.equal((await app.inject({ url: "/s/new/nao-existe" })).statusCode, 404);

  assert.equal((await app.inject({ method: "POST", url: "/public/support/new/alpha", payload: { name: "Dono", email: "sem-arroba", subject: "s", description: "d" } })).json().code, "email_invalid");
  assert.equal((await app.inject({ method: "POST", url: "/public/support/new/alpha", payload: { name: "Dono", email: "a@b.com", subject: "", description: "d" } })).json().code, "fields_required");
  const bot = await app.inject({ method: "POST", url: "/public/support/new/alpha", payload: { name: "Bot", email: "b@b.com", subject: "s", description: "d", _hp: "1" } });
  assert.equal(bot.statusCode, 200);
  assert.equal((await repo.list("tickets")).length, 0, "honeypot não cria");

  const ok = await app.inject({ method: "POST", url: "/public/support/new/alpha", payload: { name: "Dono da Loja", email: "DONO@loja.com", phone: "", subject: "Não acesso", description: "Senha não funciona", category: "Acesso" } });
  assert.equal(ok.statusCode, 201, ok.body);
  const created = (await repo.list("tickets"))[0];
  assert.equal(ok.json().url, `/s/${created.portalToken}`);
  assert.equal(created.channel, "portal");
  assert.equal(created.customerId, "c1", "e-mail do cliente vincula");
  assert.equal(created.createdBy, "portal");
  assert.equal(created.category, "Acesso");
  assert.equal((await repo.listWhere("notifications", { user: "lia", type: "ticket_new" })).length, 1, "atendente do produto é avisado");

  const byPhone = await app.inject({ method: "POST", url: "/public/support/new/alpha", payload: { name: "Outro", email: "outro@x.com", phone: "11 99999-0000", subject: "Pelo telefone", description: "d" } });
  assert.equal(byPhone.statusCode, 201, byPhone.body);
  assert.equal((await repo.list("tickets")).find((x) => x.subject === "Pelo telefone").customerId, "c1", "telefone vincula quando o e-mail não bate");
});

test("rate limit por IP na abertura", async (t) => {
  const { app, KEY } = await buildApp({ limits: { open: 2 } });
  t.after(() => app.close());
  await app.inject({ method: "PUT", url: "/api/support/settings/alpha", headers: KEY, payload: { portal: { enabled: true } } });
  const send = () => app.inject({ method: "POST", url: "/public/support/new/alpha", payload: { name: "A", email: "a@a.com", subject: "s", description: "d" } });
  assert.equal((await send()).statusCode, 201);
  assert.equal((await send()).statusCode, 201);
  assert.equal((await send()).statusCode, 429);
});
