// Follow-up em 4 contatos, por DIA e sem horário (05/10/2026): régua pura
// (followup-contacts.js), sequência no lead (lead-flow.js), configuração
// global (followup-config.js) e migração do legado com hora.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import {
  DEFAULT_FOLLOWUP_CONTACTS, normalizeFollowupContacts, followupDayOf, addBusinessDays,
  dayStartIso, todayBrt, nextFollowupDay, firstFollowupDay,
} from "../src/shared/followup-contacts.js";
import { screenForRequest } from "../src/auth/screens.js";
import { migrateFollowupDays } from "../src/platform/migrations.js";

const { registerRoutes } = await import("../src/routes.js");

const FUNNEL = [
  { stage: "Qualificando", kind: "qualificacao", conv: 1, cadence: { retryDays: 1 } },
  { stage: "Call agendada", kind: "call", conv: 1 },
  { stage: "Follow-up", kind: "followup", conv: 0.5, cadence: { maxAttempts: 8, retryDays: 3 } },
  { stage: "Nutrição", kind: "contato", conv: 0.2 },
  { stage: "Ganho", kind: "ganho", conv: 1 },
];

async function buildApp() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  const app = Fastify();
  registerRoutes(app, repo);
  return { app, repo };
}

// ── Régua pura ──────────────────────────────────────────────────────────────
test("normalize: sempre 4 contatos, vazio cai no padrão e prazo fica entre 0 e 60", () => {
  assert.deepEqual(normalizeFollowupContacts(null), DEFAULT_FOLLOWUP_CONTACTS);
  const out = normalizeFollowupContacts([{ titulo: " Oi ", mensagem: "", prazoDias: "2" }, { prazoDias: 999 }, { prazoDias: -3 }]);
  assert.equal(out.length, 4);
  assert.equal(out[0].titulo, "Oi");
  assert.equal(out[0].mensagem, DEFAULT_FOLLOWUP_CONTACTS[0].mensagem);
  assert.equal(out[0].prazoDias, 2);
  assert.equal(out[1].prazoDias, 60);
  assert.equal(out[2].prazoDias, 0);
  assert.deepEqual(out[3], DEFAULT_FOLLOWUP_CONTACTS[3]);
  // Aceita o envelope { contacts }.
  assert.equal(normalizeFollowupContacts({ contacts: [{ prazoDias: 5 }] })[0].prazoDias, 5);
});

test("followupDayOf: dia puro, legado com hora e ISO com fuso viram o dia de Brasília", () => {
  assert.equal(followupDayOf("2026-10-07"), "2026-10-07");
  assert.equal(followupDayOf("2026-10-07T16:30"), "2026-10-07");
  assert.equal(followupDayOf("2026-10-08T02:00:00.000Z"), "2026-10-07"); // 23h de Brasília
  assert.equal(followupDayOf(""), "");
  assert.equal(followupDayOf("lixo"), "");
});

test("dias úteis: pula fim de semana e 0 rola sábado/domingo pra segunda", () => {
  assert.equal(addBusinessDays("2026-10-08", 1), "2026-10-09"); // qui → sex
  assert.equal(addBusinessDays("2026-10-09", 1), "2026-10-12"); // sex → seg
  assert.equal(addBusinessDays("2026-10-09", 3), "2026-10-14");
  assert.equal(addBusinessDays("2026-10-10", 0), "2026-10-12"); // sáb → seg
  assert.equal(dayStartIso("2026-10-07"), "2026-10-07T03:00:00.000Z");
  assert.equal(todayBrt(new Date("2026-10-08T02:00:00.000Z")), "2026-10-07");
});

test("próximo contato: prazo do contato SEGUINTE contado do dia do registro", () => {
  const cfg = [{ prazoDias: 1 }, { prazoDias: 2 }, { prazoDias: 5 }, { prazoDias: 4 }];
  assert.equal(firstFollowupDay(cfg, new Date("2026-10-05T15:00:00.000Z")), "2026-10-06");
  assert.equal(nextFollowupDay(cfg, 1, "2026-10-06"), "2026-10-08"); // contato 2: +2
  assert.equal(nextFollowupDay(cfg, 2, "2026-10-08"), "2026-10-15"); // contato 3: +5 úteis
  assert.equal(nextFollowupDay(cfg, 4, "2026-10-08"), "");          // depois do 4º não há
});

// ── Sequência no lead ───────────────────────────────────────────────────────
test("contatos 1→4: cada registro avança o passo e marca o dia pelo prazo; o 4º deixa o card sem dia", async () => {
  const { app, repo } = await buildApp();
  await app.inject({
    method: "PUT", url: "/api/followup-contacts",
    payload: { contacts: [{ prazoDias: 0 }, { prazoDias: 2 }, { prazoDias: 3 }, { prazoDias: 1 }] },
  });
  await repo.create("leads", { id: "l1", saas: "leverads", stage: "Qualificando", closer: "leo" });
  await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Follow-up" } });
  let lead = await repo.get("leads", "l1");
  const hoje = todayBrt();
  assert.equal(lead.followupAt, addBusinessDays(hoje, 0), "Contato 1: hoje + prazo 0");
  assert.equal(lead.followupStep, 0);

  const at = "2026-10-06T15:00:00.000Z"; // terça, 12h de Brasília
  const registra = (n, type = "whatsapp") => app.inject({
    method: "POST", url: "/api/activities",
    payload: { lead: "l1", saas: "leverads", type, text: `contato ${n}`, at, meta: { followupContact: n } },
  });
  await registra(1);
  lead = await repo.get("leads", "l1");
  assert.equal(lead.followupStep, 1);
  assert.equal(lead.followupAt, "2026-10-08", "Contato 2 = +2 dias úteis");
  assert.equal(lead.nextActionAt, dayStartIso("2026-10-08"));

  await registra(2, "call");
  lead = await repo.get("leads", "l1");
  assert.equal(lead.followupStep, 2);
  assert.equal(lead.followupAt, "2026-10-09", "Contato 3 = +3 dias úteis (ter → sex)");

  await registra(3, "email");
  lead = await repo.get("leads", "l1");
  assert.equal(lead.followupStep, 3);
  assert.equal(lead.followupAt, "2026-10-07", "Contato 4 = +1 dia útil");

  await registra(4);
  lead = await repo.get("leads", "l1");
  assert.equal(lead.followupStep, 4);
  assert.equal(lead.followupAt, "", "sequência concluída: o operador escolhe o destino");
  assert.equal(lead.nextActionAt, dayStartIso(todayBrt()));
  assert.equal(lead.stage, "Follow-up", "nada se move sozinho depois do 4º");
  await app.close();
});

test("toque SEM contato registrado (Inbox, robô, ligação avulsa) não mexe no dia nem no passo", async () => {
  const { app, repo } = await buildApp();
  await repo.create("leads", { id: "l1", saas: "leverads", stage: "Follow-up", followupAt: "2099-01-09", followupStep: 1, nextActionAt: dayStartIso("2099-01-09") });
  await app.inject({ method: "POST", url: "/api/activities", payload: { lead: "l1", saas: "leverads", type: "whatsapp", text: "oi" } });
  const lead = await repo.get("leads", "l1");
  assert.equal(lead.followupAt, "2099-01-09");
  assert.equal(lead.followupStep, 1);
  assert.equal(lead.nextActionAt, dayStartIso("2099-01-09"));
  assert.equal(lead.lastActivityType, "whatsapp");
  await app.close();
});

test("registrar um contato à frente não volta o passo (o maior vence)", async () => {
  const { app, repo } = await buildApp();
  await repo.create("leads", { id: "l1", saas: "leverads", stage: "Follow-up", followupAt: "2099-01-09", followupStep: 3 });
  await app.inject({ method: "POST", url: "/api/activities", payload: { lead: "l1", saas: "leverads", type: "call", at: "2026-10-06T15:00:00.000Z", meta: { followupContact: 2 } } });
  assert.equal((await repo.get("leads", "l1")).followupStep, 3);
  await app.close();
});

test("entrar de novo no follow-up recomeça no Contato 1", async () => {
  const { app, repo } = await buildApp();
  await repo.create("leads", { id: "l1", saas: "leverads", stage: "Nutrição", followupStep: 4, followupAt: "" });
  await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Follow-up", followupAt: "2099-02-03" } });
  const lead = await repo.get("leads", "l1");
  assert.equal(lead.followupStep, 0);
  assert.equal(lead.followupAt, "2099-02-03", "o dia escolhido na tela vence o prazo padrão");
  assert.equal(lead.nextActionAt, dayStartIso("2099-02-03"));
  await app.close();
});

// ── Configuração global ─────────────────────────────────────────────────────
test("GET/PUT /api/followup-contacts normaliza e o bootstrap leva a config", async () => {
  const { app } = await buildApp();
  const def = (await app.inject({ method: "GET", url: "/api/followup-contacts" })).json();
  assert.deepEqual(def.contacts, DEFAULT_FOLLOWUP_CONTACTS);
  const put = await app.inject({
    method: "PUT", url: "/api/followup-contacts",
    payload: { contacts: [{ titulo: "Primeiro", mensagem: "Oi {{nome}}", prazoDias: 2 }] },
  });
  assert.equal(put.statusCode, 200);
  assert.equal(put.json().contacts.length, 4);
  assert.equal(put.json().contacts[0].titulo, "Primeiro");
  const boot = (await app.inject({ method: "GET", url: "/api/bootstrap" })).json();
  assert.equal(boot.CONFIG.followupContacts[0].mensagem, "Oi {{nome}}");
  assert.equal(boot.CONFIG.followupContacts[1].prazoDias, DEFAULT_FOLLOWUP_CONTACTS[1].prazoDias);
  await app.close();
});

test("escrita da config do follow-up é da tela Configurações; leitura é livre", () => {
  assert.deepEqual(screenForRequest("PUT", "/api/followup-contacts"), ["settings"]);
  assert.deepEqual(screenForRequest("PATCH", "/api/app_config/followup_contacts"), ["settings"]);
  assert.equal(screenForRequest("GET", "/api/followup-contacts"), null);
});

// ── Migração ────────────────────────────────────────────────────────────────
test("migrateFollowupDays: hora vira dia, passo sai dos toques (máx. 3) e roda uma vez só", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  await repo.create("leads", { id: "a", saas: "leverads", stage: "Follow-up", followupAt: "2099-01-09T16:00", stageAttempts: 7 });
  await repo.create("leads", { id: "b", saas: "leverads", stage: "Follow-up", followupAt: "", nextActionAt: "2099-01-12T13:00:00.000Z", stageAttempts: 1 });
  await repo.create("leads", { id: "c", saas: "leverads", stage: "Ganho", followupAt: "2026-08-01T10:00", callAt: "2026-07-30T10:00" });
  assert.equal(await migrateFollowupDays(repo), 3);
  const a = await repo.get("leads", "a");
  assert.equal(a.followupAt, "2099-01-09");
  assert.equal(a.followupStep, 3);
  assert.equal(a.nextActionAt, dayStartIso("2099-01-09"));
  const b = await repo.get("leads", "b");
  assert.equal(b.followupAt, "2099-01-12");
  assert.equal(b.followupStep, 1);
  const c = await repo.get("leads", "c");
  assert.equal(c.followupAt, "2026-08-01");
  assert.equal(c.callAt, "2026-07-30T10:00");
  assert.equal(c.followupStep, undefined);
  await repo.update("leads", "a", { followupAt: "2099-03-03T10:00" });
  assert.equal(await migrateFollowupDays(repo), 0, "marcador: não roda de novo");
});

// ── Imagem de cada contato ──────────────────────────────────────────────────
const mpPayload = (boundary, name, mime, bytes) => Buffer.concat([
  Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${name}"\r\ncontent-type: ${mime}\r\n\r\n`),
  bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
]);

test("normalize: imagem só aceita o caminho do asset do follow-up", () => {
  const out = normalizeFollowupContacts([
    { imagem: "/public/followup/fua_abc-123" },
    { imagem: "https://evil.test/x.png" },
    { imagem: "/public/tasks/tka_1" },
  ]);
  assert.equal(out[0].imagem, "/public/followup/fua_abc-123");
  assert.equal(out[1].imagem, "");
  assert.equal(out[2].imagem, "");
  assert.equal(out[3].imagem, "");
});

test("imagem do contato: upload, serviço público, troca e remoção limpam o arquivo antigo", async () => {
  const { default: multipart } = await import("@fastify/multipart");
  const repo = makeMemRepo();
  const app = Fastify();
  await app.register(multipart);
  registerRoutes(app, repo);
  const boundary = "----cockpittest";
  const headers = { "content-type": `multipart/form-data; boundary=${boundary}` };
  const send = (name, mime, bytes) => app.inject({ method: "POST", url: "/api/followup-contacts/image", headers, payload: mpPayload(boundary, name, mime, bytes) });

  assert.equal((await send("a.svg", "image/svg+xml", Buffer.from("<svg/>"))).statusCode, 400, "só raster");
  assert.equal((await send("a.png", "image/png", Buffer.alloc(3 * 1024 * 1024 + 1))).statusCode, 413);

  const a = (await send("a.png", "image/png", Buffer.from("png-a"))).json();
  assert.match(a.url, /^\/public\/followup\/fua_/);
  const img = await app.inject({ url: a.url });
  assert.equal(img.statusCode, 200);
  assert.equal(img.headers["content-type"], "image/png");
  assert.equal(img.body, "png-a");

  const put = (contacts) => app.inject({ method: "PUT", url: "/api/followup-contacts", payload: { contacts } });
  let r = (await put([{ imagem: a.url }, {}, {}, {}])).json();
  assert.equal(r.contacts[0].imagem, a.url);
  assert.equal((await app.inject({ url: "/api/followup-contacts" })).json().contacts[0].imagem, a.url);

  // Troca: a imagem nova vale, a antiga sai do banco.
  const b = (await send("b.jpg", "image/jpeg", Buffer.from("jpg-b"))).json();
  r = (await put([{ imagem: b.url }, { imagem: a.url.replace(a.id, "fua_inexistente") }, {}, {}])).json();
  assert.equal(r.contacts[0].imagem, b.url);
  assert.equal(await repo.get("followup_assets", a.id), null);
  assert.equal((await app.inject({ url: a.url })).statusCode, 404);

  // Remoção: contato sem imagem e arquivo apagado.
  r = (await put([{}, {}, {}, {}])).json();
  assert.equal(r.contacts[0].imagem, "");
  assert.equal(await repo.get("followup_assets", b.id), null);
  assert.equal((await app.inject({ url: "/api/followup_assets" })).statusCode, 404, "fora do CRUD genérico");
});

test("upload da imagem do follow-up é escrita da tela Configurações", () => {
  assert.deepEqual(screenForRequest("POST", "/api/followup-contacts/image"), ["settings"]);
});
