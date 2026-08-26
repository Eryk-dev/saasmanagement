// Avisos do funil num canal Discord (webhook único) — lead novo, proposta
// vista/aceita, pagamento/assinatura MP, baixa manual e dunning.
//
// Fail-open SEMPRE: sem DISCORD_WEBHOOK_URL vira no-op (configured() = false,
// quem chama nem monta o payload); erro de rede/timeout (3s) nunca propaga —
// notificação jamais quebra rota, muito menos a superfície pública.
// Factory com fetch injetável pra testar offline (mesmo padrão do mp.js).

export function makeDiscord({ fetch: f = globalThis.fetch, webhookUrl = "" } = {}) {
  const configured = () => !!webhookUrl;

  const COLORS = { green: 5763719, blue: 5793266, gold: 16705372, red: 15548997, gray: 10070709 };
  const money = (v) => `R$ ${(Number(v) || 0).toLocaleString("pt-BR")}`;
  const who = (lead = {}, fallback = "?") => lead.name || lead.company || lead.email || fallback;

  // Posta um embed; nunca lança (best-effort). Campos vazios são filtrados —
  // o Discord rejeita field sem value.
  async function send({ title, description = "", color = COLORS.gray, fields = [] }) {
    if (!configured()) return false;
    try {
      await f(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(3000),
        body: JSON.stringify({
          username: "Cockpit",
          embeds: [{
            title: String(title).slice(0, 256),
            description: String(description).slice(0, 2000),
            color,
            fields: fields
              .filter((x) => x && x.value != null && String(x.value).trim() !== "")
              .map((x) => ({ name: x.name, value: String(x.value).slice(0, 1024), inline: x.inline !== false })),
            timestamp: new Date().toISOString(),
          }],
        }),
      });
      return true;
    } catch {
      return false;
    }
  }

  return {
    configured,

    // Lead novo (form ou manual). `lead.source` já vem descritivo do form
    // ("Form · Nome do form"); proposalUrl entra quando o dispatcher gerou.
    leadNew({ lead = {}, productName } = {}) {
      return send({
        title: `🟢 Lead novo: ${who(lead, lead.id)}`,
        color: COLORS.green,
        fields: [
          { name: "Empresa", value: lead.company },
          { name: "SaaS", value: productName || lead.saas },
          { name: "Origem", value: lead.source },
          { name: "E-mail", value: lead.email },
          { name: "Telefone", value: lead.phone },
          ...(Number(lead.amount) > 0 ? [{ name: "Valor", value: money(lead.amount) }] : []),
          ...(lead.proposalUrl ? [{ name: "Proposta", value: lead.proposalUrl, inline: false }] : []),
        ],
      });
    },

    proposalViewed({ proposal = {}, lead = {} } = {}) {
      return send({
        title: `👀 Proposta visualizada: ${who(lead, proposal.name || proposal.id)}`,
        color: COLORS.blue,
        fields: [
          { name: "SaaS", value: proposal.saas },
          { name: "Empresa", value: lead.company },
          { name: "Link", value: lead.proposalUrl, inline: false },
        ],
      });
    },

    proposalAccepted({ proposal = {}, lead = {}, stage = "" } = {}) {
      return send({
        title: `🎉 Proposta ACEITA: ${who(lead, proposal.name || proposal.id)}`,
        color: COLORS.green,
        fields: [
          { name: "SaaS", value: proposal.saas },
          { name: "Empresa", value: lead.company },
          { name: "Telefone", value: lead.phone },
          ...(stage ? [{ name: "Movido para", value: stage }] : []),
        ],
      });
    },

    invoicePaid({ invoice = {}, customerName, via } = {}) {
      return send({
        title: `💰 Fatura paga: ${customerName || invoice.customer || "?"} — ${money(invoice.amount)}`,
        color: COLORS.gold,
        fields: [
          { name: "SaaS", value: invoice.saas },
          { name: "Via", value: via },
          { name: "Tipo", value: invoice.kind },
        ],
      });
    },

    // status já mapeado pro vocabulário do Cockpit (active|canceled|paused).
    subscriptionStatus({ sub = {}, customerName, status } = {}) {
      const label = {
        active: "✅ Assinatura ativada",
        canceled: "❌ Assinatura cancelada",
        paused: "⏸️ Assinatura pausada",
      }[status];
      if (!label) return Promise.resolve(false);
      return send({
        title: `${label}: ${customerName || sub.customer || "?"}`,
        color: status === "active" ? COLORS.green : COLORS.red,
        fields: [
          { name: "SaaS", value: sub.saas },
          { name: "Valor", value: `${money(sub.price)} (${sub.cycle || "?"})` },
        ],
      });
    },

    // Cliente marcado como CHURN (botão da ficha ou cancelamento no MP).
    // `mrr` = quanto ele valia por mês na hora da saída (arr congelado ÷ 12).
    customerChurned({ customer = {}, productName, reasonLabel, source, mrr } = {}) {
      return send({
        title: `📉 Churn: ${customer.name || customer.id || "?"}${mrr > 0 ? ` — ${money(mrr)}/mês` : ""}`,
        color: COLORS.red,
        fields: [
          { name: "SaaS", value: productName || customer.saas },
          { name: "Motivo", value: reasonLabel },
          { name: "Origem", value: source === "mp" ? "Mercado Pago (cancelou a recorrência)" : "marcado no cockpit" },
        ],
      });
    },

    // Estorno/chargeback detectado no espelho de pagamentos do MP. Aviso, não
    // ação: fatura e churn continuam decisão humana (estorno parcial existe).
    paymentRefunded({ payment = {}, customerName } = {}) {
      const kind = payment.status === "charged_back" ? "Chargeback" : "Estorno";
      return send({
        title: `↩️ ${kind} no Mercado Pago: ${customerName || payment.payerName || payment.payerEmail || "?"} — ${money(payment.amount)}`,
        description: "Confira o cliente no cockpit — estorno não desfaz fatura nem marca churn sozinho.",
        color: COLORS.red,
        fields: [
          { name: "SaaS", value: payment.saas },
          { name: "Forma", value: payment.method },
          { name: "Pagamento", value: payment.mpId },
        ],
      });
    },

    // Disparado pelo tick do billing quando marcou overdue/past_due NOVOS;
    // `lines` lista o estoque vencido (montado pela rota, que tem o repo).
    billingAlert({ report = {}, lines = [] } = {}) {
      return send({
        title: `⚠️ Dunning: ${report.overdue || 0} fatura(s) vencida(s), ${report.pastDue || 0} assinatura(s) inadimplente(s)`,
        description: lines.slice(0, 10).join("\n"),
        color: COLORS.red,
      });
    },

    // Formulário de integração respondido pelo cliente recém-fechado: o
    // integrador pode preparar a call sem esperar ninguém avisar.
    integrationFormFilled({ customerName, productName, summary, url } = {}) {
      return send({
        title: `📋 Formulário de integração respondido: ${customerName || "cliente"}`,
        color: COLORS.blue,
        fields: [
          { name: "SaaS", value: productName },
          { name: "Resumo", value: summary },
          ...(url ? [{ name: "Respostas", value: url, inline: false }] : []),
        ],
      });
    },

    // Lembrete diário dos treinamentos: pessoas com flashcards vencendo
    // (`lines` montadas pelo job, que tem o repo).
    trainingReminder({ lines = [] } = {}) {
      return send({
        title: `📚 Treinamento do dia: ${lines.length} pessoa(s) com cards pra revisar`,
        description: lines.slice(0, 20).join("\n"),
        color: COLORS.blue,
      });
    },
  };
}

// Singleton de produção (env). Testes usam makeDiscord com fetch mockado.
export const discord = makeDiscord({ webhookUrl: process.env.DISCORD_WEBHOOK_URL || "" });
