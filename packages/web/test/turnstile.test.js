import test from "node:test";
import assert from "node:assert/strict";
import { captchaError, renderTurnstile, setTurnstileKeyForTest, turnstileEnabled } from "../src/lib/turnstile.js";

// Turnstile dos formulários do LeverId: sem a chave de build nada é
// carregado; com ela, o widget entrega o token e some quando a tela sai.
const tick = () => new Promise((r) => setTimeout(r, 0));

test("sem VITE_TURNSTILE_SITE_KEY o Turnstile fica desligado", () => {
  setTurnstileKeyForTest("");
  assert.equal(turnstileEnabled(), false);
});

test("com a chave: desenha com ela, repassa token, expiração e erro, e remove na saída", async () => {
  const drawn = [];
  const removed = [];
  globalThis.turnstile = {
    render(el, opts) { drawn.push({ el, opts }); return `w${drawn.length}`; },
    remove(id) { removed.push(id); },
  };
  setTurnstileKeyForTest("chave-de-site");
  const tokens = [];
  const el = { id: "caixa" };
  const stop = renderTurnstile(el, (t) => tokens.push(t), "login");
  await tick();
  const [{ el: where, opts }] = drawn;
  assert.equal(where, el);
  assert.equal(opts.sitekey, "chave-de-site");
  assert.equal(opts.action, "login");
  opts.callback("tok-1");
  opts["expired-callback"]();
  opts["error-callback"]();
  assert.deepEqual(tokens, ["tok-1", "", ""]);
  stop();
  assert.deepEqual(removed, ["w1"]);
});

test("tela que sai antes do script carregar não desenha nada", async () => {
  const drawn = [];
  globalThis.turnstile = { render() { drawn.push(1); return "w"; }, remove() {} };
  setTurnstileKeyForTest("chave-de-site");
  renderTurnstile({}, () => {})();
  await tick();
  assert.equal(drawn.length, 0);
});

test("recusa do captcha pelo GoTrue vira mensagem; outras recusas, não", () => {
  assert.match(captchaError({ code: "captcha_failed", message: "captcha protection: request disallowed" }), /anti-robô/);
  assert.match(captchaError({ status: 500, message: "captcha verification process failed" }), /anti-robô/);
  assert.equal(captchaError({ code: "invalid_credentials", message: "Invalid login credentials" }), null);
  assert.equal(captchaError(null), null);
});
