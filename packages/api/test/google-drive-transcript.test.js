// Fallback de transcrição pelo Drive: quando a Meet API não devolve o
// conferenceRecord (quem hospeda a call é outra conta), o cockpit lê o Doc de
// transcrição direto do Drive do organizador. Offline (fetch fake).

import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeGoogle } from "../src/google.js";
import { makeAnthropic } from "../src/anthropic.js";
import { makeCallSummarizer } from "../src/call-summaries.js";

// fetch fake do Google: token ok, space ok, conferenceRecords VAZIO (= Meet API
// não vê a call), evento do Calendar com título+horário, busca no Drive acha o
// Doc e o export devolve o texto da transcrição.
function googleFetch({ transcriptText = "Leo: Oi Tania!\nTania: Oi, tudo bem?", records = [] } = {}) {
  const calls = [];
  const f = async (url) => {
    const u = String(url);
    calls.push(u);
    const okJson = (body) => ({ status: 200, json: async () => body, text: async () => JSON.stringify(body) });
    if (u.includes("oauth2.googleapis.com/token")) return okJson({ access_token: "at", expires_in: 3600 });
    if (u.includes("/v2/spaces/")) return okJson({ name: "spaces/sp1" });
    if (u.includes("/v2/conferenceRecords")) return okJson({ conferenceRecords: records });
    if (u.includes("/calendar/v3/calendars/") && u.includes("/events/")) {
      return okJson({ summary: "Call LeverAds · Tania", start: { dateTime: "2026-07-13T15:00:00-03:00" }, attachments: [] });
    }
    if (u.includes("/drive/v3/files/") && u.includes("/export")) return { status: 200, text: async () => transcriptText };
    if (u.includes("/drive/v3/files")) return okJson({ files: [{ id: "doc1", name: "Call LeverAds · Tania (2026-07-13) - Transcrição", createdTime: "2026-07-13T16:10:00Z" }] });
    return okJson({});
  };
  f.calls = calls;
  return f;
}

test("fetchTranscriptFromDrive: acha o Doc pelo título/horário e exporta como texto", async () => {
  const repo = makeMemRepo();
  await repo.create("app_config", { id: "google_oauth", refreshToken: "rt", account: "contato@uniquebox.com.br" });
  const f = googleFetch();
  const g = makeGoogle({ fetch: f, clientId: "cid", clientSecret: "sec", repo });

  const t = await g.fetchTranscriptFromDrive({ eventId: "ev1", leadName: "Tania", since: "2026-07-13T18:00:00Z" });
  assert.ok(t, "achou a transcrição");
  assert.ok(t.text.includes("Tania"));
  assert.equal(t.source, "drive");
  assert.ok(t.recordingUrl.includes("doc1"));

  const search = decodeURIComponent((f.calls.find((u) => u.includes("/drive/v3/files?")) || "").replace(/\+/g, "%20"));
  assert.ok(search.includes("name contains 'ranscri'"));  // só docs de transcrição
  assert.ok(search.includes("Tania"));                    // casa pelo nome do lead (após o "·")
  assert.ok(search.includes("createdTime >"));            // janela a partir do horário da call
});

test("fetchTranscriptFromDrive: usa o anexo (Doc) do evento sem precisar buscar no Drive", async () => {
  const repo = makeMemRepo();
  await repo.create("app_config", { id: "google_oauth", refreshToken: "rt", account: "contato@uniquebox.com.br" });
  const calls = [];
  const f = async (url) => {
    const u = String(url); calls.push(u);
    const ok = (b) => ({ status: 200, json: async () => b, text: async () => JSON.stringify(b) });
    if (u.includes("oauth2.googleapis.com/token")) return ok({ access_token: "at", expires_in: 3600 });
    if (u.includes("/calendar/v3/") && u.includes("/events/")) {
      return ok({ summary: "Call LeverAds · Tania", start: { dateTime: "2026-07-13T15:00:00-03:00" },
        attachments: [
          { fileId: "rec1", title: "Tania (Gravação)", mimeType: "video/mp4" },
          { fileId: "att1", title: "Tania (Transcrição)", mimeType: "application/vnd.google-apps.document" },
        ] });
    }
    if (u.includes("/drive/v3/files/att1/export")) return { status: 200, text: async () => "Leo: oi\nTania: oi, tudo bem" };
    if (u.includes("/drive/v3/files")) throw new Error("não deveria buscar no Drive quando o evento tem anexo de transcrição");
    return ok({});
  };
  const g = makeGoogle({ fetch: f, clientId: "c", clientSecret: "s", repo });

  const t = await g.fetchTranscriptFromDrive({ eventId: "ev1", leadName: "Tania" });
  assert.ok(t.text.includes("Tania"));
  assert.ok(t.recordingUrl.includes("att1")); // pegou o anexo de transcrição, não a gravação
  assert.ok(!calls.some((u) => u.includes("/drive/v3/files?")), "não caiu na busca (usou o anexo do evento)");
});

test("summarizer: kind=integracao usa os campos da integração + summarizeIntegration, sem tocar a venda", async () => {
  const repo = makeMemRepo();
  await repo.create("app_config", { id: "google_oauth", refreshToken: "rt", account: "contato@uniquebox.com.br" });
  await repo.create("products", { id: "uniquekids", name: "UniqueKids", funnel: [] });
  await repo.create("leads", {
    id: "le1", saas: "uniquekids", name: "Maria", stage: "Integração",
    callUrl: "https://meet.google.com/aaa-aaaa-aaa", meetEventId: "evVenda", meetScheduledAt: "2026-07-10T18:00:00.000Z", callSummaryFor: "evVenda",
    integrationCallUrl: "https://meet.google.com/vam-otkm-zum", integrationMeetEventId: "evInteg", integrationScheduledAt: "2026-07-13T18:00:00.000Z",
  });

  const google = makeGoogle({ fetch: googleFetch(), clientId: "c", clientSecret: "s", repo }); // conferenceRecords vazio → Drive fallback
  const integ = { resumo: "Setup feito", sentimento: "satisfeito", sentimentoPorque: "entendeu tudo", configurado: ["Conta criada"], pendencias: [{ item: "Enviar foto", responsavel: "cliente" }], proximosPassos: ["Acompanhar em 7 dias"], followup: { quando: "", nota: "checar uso", whatsapp: "Oi Maria, deu tudo certo?" } };
  const anthropic = makeAnthropic({ fetch: async () => ({ status: 200, json: async () => ({ model: "m", content: [{ type: "text", text: JSON.stringify(integ) }] }) }), apiKey: "sk-test" });
  const w = makeCallSummarizer({ repo, google, anthropic, log: { info() {}, warn() {} } });

  const r = await w.summarizeLead("le1", { kind: "integracao" });
  assert.equal(r.ok, true);
  assert.equal(r.kind, "integracao");
  const act = (await repo.list("activities")).find((a) => a.meta?.event === "call_summary");
  assert.ok(act, "activity call_summary criada");
  assert.equal(act.meta.kind, "integracao");
  assert.ok(act.text.includes("Resumo da integração"));
  assert.ok(act.text.includes("Configurado"));
  const lead = await repo.get("leads", "le1");
  assert.equal(lead.integrationSummaryFor, "evInteg"); // marcou o dedup da integração
  assert.equal(lead.callSummaryFor, "evVenda");        // NÃO mexeu na call de venda
});

test("summarizer: Meet API vazia → usa o fallback do Drive e grava o call_summary", async () => {
  const repo = makeMemRepo();
  await repo.create("app_config", { id: "google_oauth", refreshToken: "rt", account: "contato@uniquebox.com.br" });
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [] });
  await repo.create("leads", {
    id: "le1", saas: "leverads", name: "Tania", stage: "Follow-up",
    callUrl: "https://meet.google.com/vam-otkm-zum", meetEventId: "ev1", meetScheduledAt: "2026-07-13T18:00:00.000Z",
  });

  const google = makeGoogle({ fetch: googleFetch(), clientId: "cid", clientSecret: "sec", repo }); // conferenceRecords vazio
  const anthropicFetch = async () => ({
    status: 200,
    json: async () => ({ model: "m", content: [{ type: "text", text: JSON.stringify({
      resumo: "Tania topou seguir", temperatura: "quente", temperaturaPorque: "x",
      dores: [], objecoes: [], compromissos: [], followup: { quando: "", nota: "", whatsapp: "" },
    }) }] }),
  });
  const anthropic = makeAnthropic({ fetch: anthropicFetch, apiKey: "sk-test" });
  const w = makeCallSummarizer({ repo, google, anthropic, log: { info() {}, warn() {} } });

  const r = await w.summarizeLead("le1");
  assert.equal(r.ok, true, "resumiu via Drive");
  const act = (await repo.list("activities")).find((a) => a.meta?.event === "call_summary");
  assert.ok(act, "activity call_summary criada a partir do Drive");
  assert.equal(act.meta.recordingUrl.includes("doc1"), true);
});
