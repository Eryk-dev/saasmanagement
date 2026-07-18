// Meet automático da integração: card que entra em Integração com horário
// marcado (fechamento saindo da call) ganha o link do Meet sozinho — o convite
// da chamada vai pro cliente e o cartão já chega com o link pro integrador.
// Tudo offline (fake do Google).

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");

const FUNNEL = [
  { stage: "Novo lead", kind: "novo", conv: 1 },
  { stage: "Call agendada", kind: "call", conv: 1 },
  { stage: "Integração", kind: "integracao", conv: 1 },
  { stage: "Ganho", kind: "ganho", conv: 1 },
  { stage: "Perdido", kind: "perdido", conv: 0 },
];

function googleFake() {
  const created = [];
  return {
    created,
    configured: () => true,
    connected: async () => true,
    createMeetEvent: async (args) => {
      created.push(args);
      return { meetUrl: `https://meet.google.com/aaa-bbbb-cc${created.length}`, eventId: `ev${created.length}`, htmlLink: "https://calendar/x" };
    },
    configureSpace: async () => ({ open: true, recording: true, transcription: true }),
  };
}

async function setup() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  await repo.create("leads", {
    id: "l1", saas: "leverads", name: "Danilo", company: "rotadosbordados",
    stage: "Call agendada", email: "danitec2000@gmail.com", callAt: "2026-07-17T17:00",
    callUrl: "https://meet.google.com/venda-ja-existia", meetEventId: "ev_venda",
  });
  const google = googleFake();
  const app = Fastify();
  registerRoutes(app, repo, { google });
  return { repo, app, google };
}

const waitFor = async (cond) => { for (let i = 0; i < 60 && !(await cond()); i++) await new Promise((r) => setImmediate(r)); };

test("fechar saindo da call com integração marcada cria o Meet da integração sozinho", async () => {
  const { repo, app, google } = await setup();
  // O Meu dia grava stage + integrationAt no MESMO patch ao mandar pra integração.
  await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Integração", integrator: "eryk", integrationAt: "2026-07-20T15:00" } });
  await waitFor(async () => (await repo.get("leads", "l1")).integrationCallUrl);

  const lead = await repo.get("leads", "l1");
  assert.ok(String(lead.integrationCallUrl).includes("meet.google.com"), "cartão da integração já tem o link");
  assert.equal(lead.integrationMeetEventId, "ev1");
  // A call de VENDA não foi tocada (campos próprios da integração).
  assert.equal(lead.callUrl, "https://meet.google.com/venda-ja-existia");
  assert.equal(lead.meetEventId, "ev_venda");

  // O evento nasce no horário da INTEGRAÇÃO, com o cliente convidado.
  assert.equal(google.created.length, 1);
  assert.ok(google.created[0].summary.startsWith("Integração"));
  assert.equal(google.created[0].start.dateTime, "2026-07-20T15:00:00");
  assert.deepEqual(google.created[0].attendees, ["danitec2000@gmail.com"]);

  // Activity de rastro (meet_created kind integracao).
  const acts = (await repo.list("activities")).filter((a) => a.lead === "l1" && a.meta?.event === "meet_created");
  assert.equal(acts.length, 1);
  assert.equal(acts[0].meta.kind, "integracao");
  await app.close();
});

test("não duplica: patch seguinte com link já criado não gera outro Meet", async () => {
  const { repo, app, google } = await setup();
  await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Integração", integrationAt: "2026-07-20T15:00" } });
  await waitFor(async () => (await repo.get("leads", "l1")).integrationCallUrl);
  assert.equal(google.created.length, 1);

  // Reatribuir/reagendar SEM limpar o link não recria (remarcação de evento é manual).
  await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { integrationAt: "2026-07-21T10:00" } });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(google.created.length, 1);
  await app.close();
});

test("sem horário marcado não cria nada (o gatilho espera a data); a data marcada depois dispara", async () => {
  const { repo, app, google } = await setup();
  // Fechou direto (gate do modal não pede horário): entra em Integração sem data.
  await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Integração", amount: 7180 } });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(google.created.length, 0);

  // O integrador marca a data no drawer → o Meet nasce sozinho.
  await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { integrationAt: "2026-07-22T14:00" } });
  await waitFor(async () => (await repo.get("leads", "l1")).integrationCallUrl);
  assert.equal(google.created.length, 1);
  assert.equal(google.created[0].start.dateTime, "2026-07-22T14:00:00");
  await app.close();
});
