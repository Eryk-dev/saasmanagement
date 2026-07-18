// Saúde do WhatsApp (Cloud API) — snapshot do que os webhooks de qualidade/status
// contam, guardado em app_config "wa_health". Serve pra proteger o número: avisar
// quando a qualidade cai / a conta é restrita / um template é reprovado, e pausar
// os disparos antes de tomar ban. Depende de assinar na Meta os fields:
// phone_number_quality_update, message_template_status_update,
// message_template_quality_update, account_update/account_alerts.
const EMPTY = { id: "wa_health", number: {}, templates: {}, account: {}, webhook: {}, updatedAt: "" };

export async function getWaHealth(repo) {
  const h = await repo.get("app_config", "wa_health");
  return h || { ...EMPTY };
}

// Prova de que a Meta ENTREGA no nosso webhook, e por qual número. Sem isso,
// "não chegou mensagem" é ambíguo: pode ser webhook não configurado na Meta ou
// erro nosso. O payload traz value.metadata.phone_number_id — que é o id do
// número que RECEBEU, ou seja, o que deveria estar no WHATSAPP_PHONE_NUMBER_ID.
// Escreve no máximo 1×/min (mensagem em massa não vira enxurrada de update),
// mas sempre que o número mudar.
export async function recordWebhookDelivery(repo, { phoneNumberId = "", display = "" } = {}) {
  const cur = await getWaHealth(repo);
  const prev = cur.webhook || {};
  const at = new Date().toISOString();
  const sameNumber = String(prev.phoneNumberId || "") === String(phoneNumberId || "");
  if (sameNumber && prev.at && Date.now() - new Date(prev.at).getTime() < 60_000) return cur;
  const next = {
    ...cur, id: "wa_health", updatedAt: at,
    webhook: { at, phoneNumberId: String(phoneNumberId || ""), display: display || prev.display || "" },
  };
  return cur.updatedAt ? repo.update("app_config", "wa_health", next) : repo.create("app_config", next);
}

// Aplica UM evento de webhook de saúde ao snapshot (merge + upsert). `field` é o
// nome do campo do webhook; `value` o `change.value`.
export async function applyHealthEvent(repo, field, value = {}) {
  const cur = await getWaHealth(repo);
  const at = new Date().toISOString();
  const next = { ...cur, id: "wa_health", number: { ...cur.number }, templates: { ...cur.templates }, account: { ...cur.account }, webhook: { ...cur.webhook }, updatedAt: at };

  if (field === "phone_number_quality_update") {
    next.number = { event: value.event || "", limit: value.current_limit || value.messaging_limit || "", display: value.display_phone_number || cur.number.display || "", at };
  } else if (field === "message_template_status_update") {
    const name = value.message_template_name || value.message_template_id || "template";
    next.templates[name] = { ...(cur.templates[name] || {}), status: value.event || "", reason: value.reason || "", at };
  } else if (field === "message_template_quality_update") {
    const name = value.message_template_name || value.message_template_id || "template";
    next.templates[name] = { ...(cur.templates[name] || {}), quality: value.new_quality_score || "", at };
  } else if (field === "account_update" || field === "account_alerts" || field === "account_review_update") {
    next.account = { event: value.event || value.alert_status || value.decision || field, detail: value.reason || value.ban_info?.waba_ban_state || value.violation_info?.violation_type || "", at };
  } else {
    return cur; // field que não é de saúde: ignora
  }
  const saved = cur.updatedAt ? await repo.update("app_config", "wa_health", next) : await repo.create("app_config", next);
  return saved;
}

const DANGER_ACCOUNT = /RESTRICT|BAN|DISABLE|VIOLAT/i;

// Resumo pra UI: nível (ok/warn/danger) + mensagens curtas. `danger` = segura os
// disparos; `warn` = fique de olho.
export function waHealthSummary(h) {
  const health = h || EMPTY;
  const messages = [];
  let level = "ok";
  const bump = (l) => { if (l === "danger" || (l === "warn" && level === "ok")) level = l; };

  const nEvent = String(health.number?.event || "").toUpperCase();
  if (nEvent === "FLAGGED") { bump("danger"); messages.push("Número SINALIZADO pela Meta (qualidade baixa). Segure os disparos até normalizar."); }
  else if (nEvent === "DOWNGRADE") { bump("warn"); messages.push("Limite de envio do número foi REBAIXADO. Reduza o volume dos disparos."); }

  const acc = health.account || {};
  if (acc.event && DANGER_ACCOUNT.test(String(acc.event) + " " + String(acc.detail || ""))) {
    bump("danger"); messages.push(`Conta (WABA) com problema: ${acc.event}${acc.detail ? ` (${acc.detail})` : ""}. Verifique no Meta Business.`);
  }

  for (const [name, t] of Object.entries(health.templates || {})) {
    const q = String(t.quality || "").toUpperCase();
    const st = String(t.status || "").toUpperCase();
    if (q === "RED") { bump("danger"); messages.push(`Template "${name}" com qualidade VERMELHA. Pause esse template.`); }
    else if (q === "YELLOW") { bump("warn"); messages.push(`Template "${name}" com qualidade amarela. Fique de olho.`); }
    if (st === "REJECTED" || st === "DISABLED" || st === "PAUSED") { bump("warn"); messages.push(`Template "${name}": ${st.toLowerCase()}.`); }
  }

  // `webhook` não entra no nível de risco (é diagnóstico de configuração, não
  // saúde do número): a tela usa pra dizer se a Meta já entregou algo aqui.
  return { level, messages, number: health.number || {}, account: health.account || {}, templates: health.templates || {}, webhook: health.webhook || {}, updatedAt: health.updatedAt || "" };
}
