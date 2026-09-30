import test from "node:test";
import assert from "node:assert/strict";
import { greetName } from "../src/sdr-flow.js";

// Nome grudado do form (raio-x 30/09): "Entendi BrenoHenrique", "Oiii, Joãogabriel".
test("greetName: nome grudado do form separa na troca de caixa e fica com o primeiro", () => {
  assert.equal(greetName("BrenoHenrique"), "Breno");
  assert.equal(greetName("CarlosEduardo"), "Carlos");
  assert.equal(greetName("JoãoGabriel"), "João");
  assert.equal(greetName("JulioFranco"), "Julio");
  assert.equal(greetName("Rafael Silva"), "Rafael");
  assert.equal(greetName("PEDRO"), "Pedro");
  assert.equal(greetName("GMS"), "");
  assert.equal(greetName("Ribeiroafonso"), ""); // grudado SEM troca de caixa: longo demais, cai no fallback sem nome
});
