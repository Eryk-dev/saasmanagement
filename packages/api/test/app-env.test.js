// APP_ENV e travas de boot: fora de produção a API não sobe apontando para
// banco ou API de produção, e os jobs de fundo nascem desligados.

import test from "node:test";
import assert from "node:assert/strict";
import { resolveAppEnv, prodTargets, assertSafeBoot, makeJobGate } from "../src/platform/app-env.js";

const CLOUD = "postgresql://postgres.hsooljludhobvsznvnir:segredo@aws-0-sa-east-1.pooler.supabase.com:6543/postgres";

test("APP_ENV: explícito vence; sem ele, imagem de produção conta como prod e o resto como local", () => {
  assert.equal(resolveAppEnv({ APP_ENV: "DEV" }), "dev");
  assert.equal(resolveAppEnv({ NODE_ENV: "production" }), "production");
  assert.equal(resolveAppEnv({}), "local");
  assert.equal(resolveAppEnv({ APP_ENV: "dev", NODE_ENV: "production" }), "dev");
  assert.throws(() => resolveAppEnv({ APP_ENV: "staging" }), /APP_ENV=staging inválido/);
});

test("trava de boot: fora de prod, banco ou API de produção no env recusa subir", () => {
  assert.throws(() => assertSafeBoot({ APP_ENV: "local", COCKPIT_DB_URL: CLOUD }), /COCKPIT_DB_URL/);
  assert.throws(() => assertSafeBoot({ APP_ENV: "dev", LEVERCOPY_DB_URL: "postgres://u:p@187.127.52.46:5432/postgres" }), /LEVERCOPY_DB_URL/);
  assert.throws(() => assertSafeBoot({ APP_ENV: "dev", ELO_DB_URL: "postgres://u:p@lp-tunnel:5432/db" }), /ELO_DB_URL/);
  assert.throws(() => assertSafeBoot({ APP_ENV: "dev", LEVERADS_API_URL: "https://api.leverads.com.br" }), /LEVERADS_API_URL/);
  assert.throws(() => assertSafeBoot({ APP_ENV: "dev", LEVERADS_API_URL: "https://copy.levermoney.com.br" }), /LEVERADS_API_URL/);
  assert.throws(() => assertSafeBoot({ APP_ENV: "dev", LEVERCOPY_API_URL: "https://leverads.com.br" }), /LEVERCOPY_API_URL/);
  assert.throws(() => assertSafeBoot({ APP_ENV: "dev", COCKPIT_DB_URL: "postgres://u:p@db.interno:5432/x", PROD_HOSTS: "db.interno" }), /COCKPIT_DB_URL/);
  // Em produção a trava não se aplica.
  assert.equal(assertSafeBoot({ APP_ENV: "production", COCKPIT_DB_URL: CLOUD }), "production");
});

test("trava de boot: destinos de dev e locais passam", () => {
  const env = {
    APP_ENV: "dev",
    COCKPIT_DB_URL: "postgres://cockpit:x@levercopy-dev-db:5432/postgres",
    LEVERCOPY_DB_URL: "postgres://u:p@localhost:5432/postgres",
    LEVERADS_API_URL: "https://dev.leverads.com.br",
    LEVERCOPY_API_URL: "http://copylever-dev.82.112.245.65.sslip.io",
  };
  assert.deepEqual(prodTargets(env), []);
  assert.equal(assertSafeBoot(env), "dev");
});

test("trava de boot: a mensagem cita variável e host, nunca a senha", () => {
  try {
    assertSafeBoot({ APP_ENV: "local", COCKPIT_DB_URL: CLOUD });
    assert.fail("devia recusar");
  } catch (err) {
    assert.match(err.message, /aws-0-sa-east-1\.pooler\.supabase\.com/);
    assert.ok(!err.message.includes("segredo"));
  }
});

test("jobs: prod liga tudo, fora dela nada; JOBS_ENABLED e JOBS decidem", () => {
  assert.equal(makeJobGate({ APP_ENV: "production" })("billing"), true);
  assert.equal(makeJobGate({ APP_ENV: "production", JOBS_ENABLED: "0" })("billing"), false);
  assert.equal(makeJobGate({ APP_ENV: "dev" })("billing"), false);
  assert.equal(makeJobGate({ APP_ENV: "dev", JOBS_ENABLED: "1" })("billing"), true);
  const only = makeJobGate({ APP_ENV: "dev", JOBS: "ticketSla, taskReminder" });
  assert.equal(only("ticketSla"), true);
  assert.equal(only("taskReminder"), true);
  assert.equal(only("billing"), false);
});
