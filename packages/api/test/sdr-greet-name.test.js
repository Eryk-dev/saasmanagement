import test from "node:test";
import assert from "node:assert/strict";
import { greetName } from "../src/sdr/sdr-flow.js";

// Nome grudado do form (raio-x 30/09): "Entendi BrenoHenrique", "Oiii, Joãogabriel".
test("greetName: nome grudado do form separa na troca de caixa e fica com o primeiro #R-007", () => {
  assert.equal(greetName("BrenoHenrique"), "Breno");
  assert.equal(greetName("CarlosEduardo"), "Carlos");
  assert.equal(greetName("JoãoGabriel"), "João");
  assert.equal(greetName("JulioFranco"), "Julio");
  assert.equal(greetName("Rafael Silva"), "Rafael");
  assert.equal(greetName("PEDRO"), "Pedro");
  assert.equal(greetName("GMS"), "");
  assert.equal(greetName("Ribeiroafonso"), ""); // grudado SEM troca de caixa: longo demais, cai no fallback sem nome
});

test("greetName: caixa alta grudada em caixa baixa ('HELANOtelris') separa e saúda 'Helano'; formNameIn/leadGreetName preferem o nome do form ao perfil-empresa do WhatsApp", async () => {
  const { leadGreetName, formNameIn } = await import("../src/sdr/sdr-flow.js");
  assert.equal(greetName("HELANOtelris"), "Helano");
  assert.equal(greetName("PEDRO"), "Pedro");
  assert.equal(greetName("MariaClara"), "Maria");
  const msgs = [{ direction: "in", text: "Oi, me chamo Sousa e quero saber mais sobre o Lever Price. Minha operação: Autopeças, 500 a 1.000 anúncios ativos." }];
  assert.equal(formNameIn(msgs), "Sousa");
  assert.equal(leadGreetName({ name: "Central de Pedidos - SeuPosto.Com" }, msgs), "Sousa");
  assert.equal(leadGreetName({ name: "Rafael Silva" }, []), "Rafael");
  assert.equal(leadGreetName({ name: "Rafael Silva" }, [{ direction: "in", text: "oi" }]), "Rafael");
});
