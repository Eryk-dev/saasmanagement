// Transcritor: escolha de backend pela chave, chamada certa em cada um.
import test from "node:test";
import assert from "node:assert/strict";
import { makeTranscriber } from "../src/transcribe.js";

function fakeFetch(capture, response) {
  return async (url, opts) => {
    capture.url = url; capture.opts = opts;
    return { ok: true, status: 200, async json() { return response; } };
  };
}

test("OpenRouter é o padrão quando a chave existe: manda input_audio com o formato do mime", async () => {
  const cap = {};
  const t = makeTranscriber({
    fetch: fakeFetch(cap, { choices: [{ message: { content: "  olá, tudo bem?  " } }] }),
    openrouterKey: "or-key", openaiKey: "oai-key", // as duas: OpenRouter ganha
  });
  assert.equal(t.provider, "openrouter");
  assert.match(t.model, /gemini/);

  const out = await t.transcribe(Buffer.from("FAKEAUDIO"), { mime: "audio/webm;codecs=opus", prompt: "LeverAds, Ruann" });
  assert.equal(out, "olá, tudo bem?"); // trim aplicado
  assert.match(cap.url, /openrouter\.ai/);
  const body = JSON.parse(cap.opts.body);
  assert.equal(body.temperature, 0);
  const audio = body.messages[0].content.find((c) => c.type === "input_audio");
  assert.equal(audio.input_audio.format, "webm"); // webm/opus → "webm"
  assert.match(body.messages[0].content[0].text, /nunca invente/i);
  assert.match(body.messages[0].content[0].text, /LeverAds, Ruann/); // nomes próprios no prompt
});

test("força openai: cai no Whisper (multipart) mesmo com a chave do OpenRouter presente", async () => {
  const cap = {};
  const t = makeTranscriber({
    fetch: fakeFetch(cap, { text: "transcrição do whisper" }),
    openrouterKey: "or-key", openaiKey: "oai-key", provider: "openai",
  });
  assert.equal(t.provider, "openai");
  assert.equal(t.model, "whisper-1");
  const out = await t.transcribe(Buffer.from("A"), { mime: "audio/webm" });
  assert.equal(out, "transcrição do whisper");
  assert.match(cap.url, /api\.openai\.com/);
  assert.ok(cap.opts.body instanceof FormData);
});

test("mapeia mimes comuns pro formato do input_audio", async () => {
  const cases = [["audio/webm", "webm"], ["audio/ogg", "ogg"], ["audio/mp4", "m4a"], ["audio/mpeg", "mp3"], ["audio/wav", "wav"], ["", "webm"]];
  for (const [mime, fmt] of cases) {
    const cap = {};
    const t = makeTranscriber({ fetch: fakeFetch(cap, { choices: [{ message: { content: "x" } }] }), openrouterKey: "k" });
    await t.transcribe(Buffer.from("A"), { mime });
    const audio = JSON.parse(cap.opts.body).messages[0].content.find((c) => c.type === "input_audio");
    assert.equal(audio.input_audio.format, fmt, `${mime} → ${fmt}`);
  }
});

test("sem chave nenhuma: não configurado e transcrever lança", async () => {
  const t = makeTranscriber({ openrouterKey: "", openaiKey: "" });
  assert.equal(t.configured(), false);
  await assert.rejects(() => t.transcribe(Buffer.from("A"), {}), /não configurada/);
});

test("erro do provedor vira mensagem legível", async () => {
  const t = makeTranscriber({
    fetch: async () => ({ ok: false, status: 429, async json() { return { error: { message: "rate limited" } }; } }),
    openrouterKey: "k",
  });
  await assert.rejects(() => t.transcribe(Buffer.from("A"), {}), /429.*rate limited/);
});
