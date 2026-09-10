// Origem "Blog" nos leads: o CTA dos posts manda utm_source=blog e o referrer
// do form é leverads.com.br/blog/<slug>. Vence a regra "site" (que também casa
// o referrer) e perde pra pago (medium=paid manda no balde de ads).
import test from "node:test";
import assert from "node:assert/strict";
import { leadOrigin, LEAD_ORIGINS } from "../src/metrics-core.js";

test("utm_source=blog cai em blog", () => {
  assert.equal(leadOrigin({ utm: { source: "blog", medium: "organic", campaign: "blog" } }), "blog");
});

test("referrer do blog cai em blog mesmo sem UTM", () => {
  assert.equal(leadOrigin({ utm: { referrer: "https://leverads.com.br/blog/como-operar-varias-contas" } }), "blog");
});

test("referrer da raiz do site continua em site", () => {
  assert.equal(leadOrigin({ utm: { referrer: "https://leverads.com.br/" } }), "site");
});

test("pago vence: medium=paid com source=blog é ads", () => {
  assert.equal(leadOrigin({ utm: { source: "blog", medium: "paid" } }), "ads_meta");
});

test("balde Blog existe na régua, antes de Site", () => {
  const keys = LEAD_ORIGINS.map((o) => o.key);
  assert.ok(keys.includes("blog"));
  assert.ok(keys.indexOf("blog") < keys.indexOf("site"));
  assert.equal(LEAD_ORIGINS.find((o) => o.key === "blog").label, "Blog");
});
