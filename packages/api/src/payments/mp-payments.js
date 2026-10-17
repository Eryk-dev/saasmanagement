// Financeiro · espelho de pagamentos do Mercado Pago (mp_payments).
//
// A verdade mora no MP; aqui fica o índice que o cockpit consegue mostrar:
// quem pagou, quanto, COMO (PIX/cartão/boleto, parcelas) e casado com qual
// cliente/fatura. Dois caminhos alimentam o espelho com a MESMA função:
//   - webhook /public/mp/webhook (tempo real, topic payment)
//   - poller startMpSync (reconciliação: funciona mesmo SEM webhook no painel)
//
// Casamento (nesta ordem, primeiro que acertar vence):
//   1. external_reference = id de FATURA (links gerados pelo cockpit)
//   2. external_reference = id de ASSINATURA (preapproval, fase 4)
//   3. e-mail do pagador = e-mail de exatamente UM cliente (senão UM lead)
//   4. nada casou → fica na lista de "não identificados" com vínculo manual
//
// Baixa de fatura: só pagamento APROVADO e no máximo UMA fatura por mpPaymentId
// (idempotência global — webhook + poller + redelivery nunca baixam 2x). Por
// e-mail a baixa exige valor EXATO e candidata única: melhor sobrar pro vínculo
// manual do que baixar a fatura errada.

import { repo as defaultRepo } from "../platform/db.js";
import { mp as defaultMp } from "./mp.js";
import { discord as defaultDiscord } from "../integrations/discord.js";
import { syncCustomerArr } from "../billing/billing.js";
import { logActivity } from "../crm/lead-flow.js";
import { classifyMpPayment, scrubMpOwnDoc, MP_CLASS_V, SALE_KINDS } from "./mp-classify.js";
import { ruleMatches, rulesFor } from "./fin-rules.js";
import { paidProofKindOf } from "../metrics/metrics-core.js";
import { gatewayOf, gatewayLabel, mirrorIdOf, phoneKey } from "./gateways.js";

// Id da conta (collector_id) — GET /users/me uma vez, carimbado em app_config
// "mp_account"; env MERCADOPAGO_COLLECTOR_ID vale como fallback/override.
export async function resolveCollectorId(repo, mp) {
  const env = String(process.env.MERCADOPAGO_COLLECTOR_ID || "").trim();
  if (env) return env;
  const cfg = await repo.get("app_config", "mp_account").catch(() => null);
  if (cfg?.collectorId) return String(cfg.collectorId);
  if (!mp?.me) return "";
  try {
    const me = await mp.me();
    const id = me?.id != null ? String(me.id) : "";
    if (!id) return "";
    const stamp = { id: "mp_account", collectorId: id, nickname: me.nickname || "", email: me.email || "", at: new Date().toISOString() };
    if (cfg) await repo.update("app_config", "mp_account", stamp, { silent: true });
    else await repo.create("app_config", stamp);
    return id;
  } catch { return ""; }
}

// O /v1/payments/search devolve o pagador MASCARADO (e-mail "xxxxxxxxxx",
// nome/CPF vazios ou só x's) — máscara não é dado: vira "" pra UI não mostrar
// lixo nem o vínculo por e-mail comparar contra x's. O GET /v1/payments/:id
// (webhook e enriquecimento do sync) é que traz o pagador de verdade.
const masked = (s) => /^x+$/i.test(String(s || "").replace(/[@.\s_-]/g, ""));
export const cleanMasked = (s) => { const v = String(s || "").trim(); return masked(v) ? "" : v; };
const clean = cleanMasked;

// Nome do pagador com fallback: payer → additional_info (checkout) → titular
// do cartão. O primeiro costuma vir vazio até no doc completo. PIX de banco
// externo NÃO traz o nome da pessoa — o bank_info.payer.long_name é a
// INSTITUIÇÃO (ex.: a cooperativa Sicredi) e vai pro campo payerBank.
function payerNameOf(pmt) {
  return clean([pmt.payer?.first_name, pmt.payer?.last_name].filter(Boolean).join(" "))
    || clean([pmt.additional_info?.payer?.first_name, pmt.additional_info?.payer?.last_name].filter(Boolean).join(" "))
    || clean(pmt.card?.cardholder?.name)
    || "";
}

// Campos do /v1/payments do MP → doc do espelho (valores em reais, como o resto).
export function normalizeMpPayment(pmt) {
  return {
    mpId: String(pmt.id),
    status: pmt.status || "",             // approved|pending|in_process|rejected|refunded|cancelled|charged_back
    statusDetail: pmt.status_detail || "",
    amount: Number(pmt.transaction_amount) || 0,
    netAmount: Number(pmt.transaction_details?.net_received_amount) || 0,
    method: pmt.payment_method_id || "",  // pix|bolbradesco|master|visa|account_money…
    methodType: pmt.payment_type_id || "",// bank_transfer|ticket|credit_card|account_money…
    installments: Number(pmt.installments) || 1,
    payerEmail: clean(pmt.payer?.email).toLowerCase(),
    payerName: payerNameOf(pmt),
    payerDoc: clean(pmt.payer?.identification?.number),
    payerBank: clean(pmt.point_of_interaction?.transaction_data?.bank_info?.payer?.long_name),
    description: pmt.description || "",
    externalReference: String(pmt.external_reference || ""),
    dateCreated: pmt.date_created || "",
    dateApproved: pmt.date_approved || "",
    // Quem paga / quem recebe / que operação — a matéria-prima da classificação
    // (mp-classify.js). Taxa REAL do MP = bruto − líquido recebido.
    operationType: pmt.operation_type || "",
    collectorId: pmt.collector_id != null ? String(pmt.collector_id) : "",
    payerId: pmt.payer?.id != null ? String(pmt.payer.id) : "",
    posId: pmt.pos_id != null ? String(pmt.pos_id) : "",
    feeAmount: Number(pmt.transaction_details?.net_received_amount) > 0
      ? Math.round(((Number(pmt.transaction_amount) || 0) - Number(pmt.transaction_details.net_received_amount)) * 100) / 100
      : 0,
  };
}

// Baixa uma fatura com os dados REAIS do pagamento (data, forma, parcelas) e
// recupera a assinatura past_due quando não sobra vencida — mesma regra do
// applyMpPayment da fase 4, com o "como pagou" carimbado na fatura.
//
// `gateway` (mp | asaas | appmax): de onde veio o pagamento — vai na prova
// (paidProof.kind) e em paidGateway; `mpPaymentId` é o id NO gateway.
export async function settleInvoice(repo, invoice, pmt, { discord, log, gateway = "mp" } = {}) {
  const paidAt = pmt.date_approved || pmt.date_created || new Date().toISOString();
  const paid = await repo.update("invoices", invoice.id, {
    status: "paid", paidAt, mpPaymentId: String(pmt.id),
    paidGateway: gateway,
    paidMethod: pmt.payment_method_id || "",
    paidMethodType: pmt.payment_type_id || "",
    paidInstallments: Number(pmt.installments) || 1,
    // A prova do recebimento: pagamento aprovado do gateway. Fatura que nasceu
    // paga no fechamento (presumida) vira FATO aqui.
    paidProof: { kind: gateway, at: paidAt, mpPaymentId: String(pmt.id), ...(invoice.paidProof?.kind === "closing" ? { confirmedFrom: "closing" } : {}) },
  });
  if (invoice.subscription) {
    const sub = await repo.get("subscriptions", invoice.subscription);
    const stillOverdue = (await repo.list("invoices"))
      .some((i) => i.subscription === invoice.subscription && i.status === "overdue");
    if (sub?.status === "past_due" && !stillOverdue) {
      await repo.update("subscriptions", sub.id, { status: "active" });
      await syncCustomerArr(repo, sub.customer);
    }
  }
  if (discord?.configured()) {
    try {
      const customer = invoice.customer ? await repo.get("customers", invoice.customer) : null;
      await discord.invoicePaid({ invoice: paid, customerName: customer?.name, via: gatewayLabel(gateway) });
    } catch (err) { log?.warn?.({ invoice: invoice.id, err: err.message }, "MP: aviso Discord falhou"); }
  }
  return paid;
}

// Qual fatura um pagamento aprovado baixa, dado o vínculo encontrado?
export function settleTarget(invoices, link, base) {
  const open = (i) => i.status === "open" || i.status === "overdue";
  // Fatura que NASCEU paga no fechamento à vista (presumida, sem mpPaymentId):
  // o pagamento do MP de valor exato é a prova que faltava — ela vira fato em
  // vez de ficar presumida pra sempre ao lado de um pagamento "sem fatura".
  const presumed = (i) => i.status === "paid" && !i.mpPaymentId && paidProofKindOf(i) === "closing";
  // Parcela de um parcelamento do Asaas (um doc por parcela): o valor exato é
  // o do GRUPO, e só quando todas as parcelas estão confirmadas (cartão
  // confirma todas de uma vez; carnê de boleto só no fim).
  const groupOk = base.installmentId && base.installmentAllPaid && Number(base.installmentTotal) > 0;
  const exact = (i) => Math.abs(Number(i.amount) - base.amount) < 0.01
    || (groupOk && Math.abs(Number(i.amount) - Number(base.installmentTotal)) < 0.01);
  if (link.invoice) {
    const inv = invoices.find((i) => i.id === link.invoice);
    if (!inv) return null;
    // Parcela solta de um parcelamento ainda em curso não baixa a fatura
    // inteira: espera o grupo fechar (ou um valor que bata sozinho).
    if (base.installmentId && !groupOk && !exact(inv)) return null;
    return open(inv) || (presumed(inv) && exact(inv)) ? inv : null;
  }
  if (link.subscription) {
    const abertas = invoices
      .filter((i) => i.subscription === link.subscription && open(i))
      .sort((a, b) => String(a.dueDate || "").localeCompare(String(b.dueDate || "")));
    if (abertas.length) return abertas[0];
    const pres = invoices.filter((i) => i.subscription === link.subscription && presumed(i) && exact(i));
    return pres.length === 1 ? pres[0] : null;
  }
  if (link.customer) {
    const cand = invoices.filter((i) => i.customer === link.customer && open(i) && exact(i));
    if (cand.length === 1) return cand[0];
    if (cand.length) return null;
    const pres = invoices.filter((i) => i.customer === link.customer && presumed(i) && exact(i));
    return pres.length === 1 ? pres[0] : null;
  }
  return null;
}

const sameDoc = (a, b, keys) => a && keys.every((k) => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null));

// Upsert do espelho + casamento + baixa (Mercado Pago). Normaliza e classifica
// o doc cru do MP e entrega ao núcleo genérico (ingestMirrorPayment).
export async function ingestMpPayment(repo, pmt, { discord, log, extra, collectorId } = {}) {
  const mpId = String(pmt.id);
  const prev = await repo.get("mp_payments", mirrorIdOf("mp", mpId));
  const base = normalizeMpPayment(pmt);
  base.gateway = "mp";

  // Classificação: a API (collector/payer) manda; sem ela, heurística — e a
  // classificação forte já gravada nunca regride pra heurística (o search
  // pode vir sem payer.id). Doc classificado pela API vira classV atual.
  const cls = classifyMpPayment(pmt, { collectorId });
  if (cls.kindSource === "heuristic" && prev?.kindSource === "api") {
    Object.assign(base, { kind: prev.kind, direction: prev.direction, kindSource: "api", classV: prev.classV || MP_CLASS_V });
  } else {
    Object.assign(base, cls, { classV: cls.kindSource === "api" ? MP_CLASS_V : (prev?.classV || 0) });
  }
  const scrub = scrubMpOwnDoc(base);
  if (scrub) Object.assign(base, scrub);
  return ingestMirrorPayment(repo, base, { discord, log, extra, prev });
}

// Dialeto cru do MP a partir do doc do espelho — settleInvoice fala a língua
// do /v1/payments (date_approved, payment_method_id…), seja qual for o gateway.
export const rawDialectOf = (p) => ({
  id: p.mpId, date_approved: p.dateApproved, date_created: p.dateCreated,
  payment_method_id: p.method, payment_type_id: p.methodType, installments: p.installments,
});

// Casamento por TELEFONE (gateways que mandam o telefone do pagador: Appmax,
// Asaas) — mesma régua do e-mail: exatamente UM cliente (senão UM lead).
async function matchByPhone(repo, phone) {
  if (!phone) return null;
  const byCustomer = (await repo.list("customers")).filter((c) => phoneKey(c.phone) === phone);
  if (byCustomer.length === 1) return { saas: byCustomer[0].saas || "", customer: byCustomer[0].id, matchedBy: "phone" };
  if (byCustomer.length) return null;
  const byLead = (await repo.list("leads")).filter((l) => phoneKey(l.phone) === phone);
  if (byLead.length === 1) return { saas: byLead[0].saas || "", lead: byLead[0].id, customer: byLead[0].customerId || "", matchedBy: "phone" };
  return null;
}

// NÚCLEO do espelho, igual pra todo gateway: recebe o doc JÁ normalizado
// (dialeto do espelho, com gateway/kind) e faz upsert + casamento + baixa.
// Idempotente e barato quando nada mudou (o poller repassa a mesma janela a
// cada tick — sem escrita não há SSE/refresh).
//
// `noRegress`: gateway que entrega evento por evento (Appmax; redelivery do
// Asaas) pode mandar um "pendente" velho depois do "pago" — aprovado não
// volta pra pendente por isso (estorno/chargeback/cancelado continuam valendo).
//
// `input.mirrorId`: id do doc quando o gateway tem chave melhor que o id do
// pagamento (Asaas: nº da fatura). Doc legado gravado pelo id do pagamento
// migra pro id novo na primeira passada (vínculo preservado).
export async function ingestMirrorPayment(repo, input, { discord, log, extra, prev: prevGiven, noRegress = false, rules } = {}) {
  const base = { ...input };
  const gateway = gatewayOf(base);
  base.gateway = gateway;
  const mpId = String(base.mpId);
  const legacyId = mirrorIdOf(gateway, mpId);
  const mirrorId = String(base.mirrorId || legacyId);
  delete base.mirrorId;
  let prev = prevGiven !== undefined ? prevGiven : await repo.get("mp_payments", mirrorId);
  let legacy = null;
  if (!prev && mirrorId !== legacyId) {
    legacy = await repo.get("mp_payments", legacyId);
    prev = legacy;
  }
  if (noRegress && prev?.status === "approved" && (base.status === "pending" || base.status === "in_process")) {
    base.status = prev.status;
    base.statusDetail = prev.statusDetail || base.statusDetail;
    base.dateApproved = prev.dateApproved || base.dateApproved;
  }
  // Classificação dita por HUMANO (manual) ou por regra aprendida nunca
  // regride pra API/heurística: o tick reclassifica tudo a cada passada.
  if (prev && (prev.kindSource === "manual" || prev.kindSource === "rule")) {
    Object.assign(base, { kind: prev.kind, direction: prev.direction || base.direction, kindSource: prev.kindSource, classV: prev.classV ?? base.classV, ...(prev.finRuleId ? { finRuleId: prev.finRuleId } : {}) });
  } else if (gateway === "mp" && SALE_KINDS.has(base.kind)) {
    // Regra `interna` por banco de origem (PIX da própria casa vindo do Asaas,
    // por exemplo): marca antes de qualquer casamento — dinheiro interno não
    // vincula cliente nem baixa fatura.
    const list = rules || rulesFor(await repo.list("fin_rules").catch(() => []), "");
    const r = list.find((x) => x.action === "interna" && ruleMatches(x, base));
    if (r) Object.assign(base, { kind: "interna", direction: "in", kindSource: "rule", finRuleId: r.id });
  }
  const isSale = SALE_KINDS.has(base.kind);

  // O poller re-varre a janela com o doc MAGRO do search — pagador já
  // enriquecido (webhook/GET por id/consulta de CNPJ) não pode regredir pra
  // vazio. clean() no prev também: espelho antigo pode ter guardado a máscara
  // crua. Nome do prev que é a INSTITUIÇÃO (fallback antigo guardava o
  // long_name do banco como nome) não é preservado — vira payerBank.
  if (prev) {
    base.payerBank = base.payerBank || clean(prev.payerBank);
    const prevName = clean(prev.payerName);
    base.payerName = base.payerName || (prevName && prevName !== base.payerBank ? prevName : "");
    base.payerEmail = base.payerEmail || clean(prev.payerEmail).toLowerCase();
    base.payerDoc = base.payerDoc || clean(prev.payerDoc);
    base.payerPhone = base.payerPhone || prev.payerPhone || "";
  }

  // Vínculo já feito (ingest anterior ou manual) é preservado.
  const link = {
    saas: prev?.saas || "", customer: prev?.customer || "", lead: prev?.lead || "",
    subscription: prev?.subscription || "", invoice: prev?.invoice || "",
    matchedBy: prev?.matchedBy || "",
  };
  let payerMismatch = !!prev?.payerMismatch;

  // Pagamento rastreado ao LEAD antes do Ganho (o link do card chega antes do
  // closer virar o card): quando o lead converte, o vínculo COMPLETA sozinho na
  // próxima passada do poller — cliente carimbado e a fatura elegível pra
  // baixa. Sem isso o dinheiro ficava "identificado mas sem dono" pra sempre
  // (9 pagamentos órfãos assim em 29/08: Zpack, euro neuvo, João…).
  if (link.lead && !link.customer) {
    const l = await repo.get("leads", link.lead).catch(() => null);
    if (l?.customerId) {
      link.customer = l.customerId;
      link.saas = link.saas || l.saas || "";
    }
  }

  const invoices = await repo.list("invoices");
  // Placeholder do import manual (inv_<nº>) virou o id real do pagamento: a
  // fatura baixada pelo placeholder passa a apontar pro id real — cashIn
  // continua contando UMA vez e o /unpay reconhece o pagamento.
  if (prev?.mpId && String(prev.mpId) !== mpId) {
    for (const inv of invoices.filter((i) => String(i.mpPaymentId || "") === String(prev.mpId))) {
      const patched = { mpPaymentId: mpId, ...(inv.paidProof ? { paidProof: { ...inv.paidProof, mpPaymentId: mpId } } : {}) };
      await repo.update("invoices", inv.id, patched, { silent: true });
      Object.assign(inv, patched);
    }
    log?.info?.({ mirrorId, from: prev.mpId, to: mpId }, "espelho: id do pagamento migrado");
  }
  const alreadySettled = invoices.find((i) => i.mpPaymentId === mpId) || null;
  if (alreadySettled && !link.invoice) {
    link.invoice = alreadySettled.id;
    link.customer = link.customer || alreadySettled.customer || "";
    link.saas = link.saas || alreadySettled.saas || "";
    link.subscription = link.subscription || alreadySettled.subscription || "";
    link.matchedBy = link.matchedBy || "reference";
  }

  // Só dinheiro de CLIENTE casa e baixa fatura: reserva interna, compra ou
  // despesa paga com o saldo nunca viram vínculo (o e-mail da conta bateria
  // com um cliente cadastrado com o mesmo e-mail, por exemplo).
  if (isSale && !link.customer && !link.invoice && !link.lead) {
    const ref = base.externalReference;
    const refInvoice = ref ? invoices.find((i) => i.id === ref) : null;
    const refSub = !refInvoice && ref ? await repo.get("subscriptions", ref) : null;
    const refLead = !refInvoice && !refSub && ref ? await repo.get("leads", ref) : null;
    if (refInvoice) {
      Object.assign(link, {
        saas: refInvoice.saas || "", customer: refInvoice.customer || "",
        subscription: refInvoice.subscription || "", invoice: refInvoice.id, matchedBy: "reference",
      });
    } else if (refSub) {
      // Payer cross-check (padrão da fase 4): referência forjada com pagador
      // diferente não casa nem baixa — fica visível como não identificado.
      if (refSub.payerEmail && base.payerEmail && String(refSub.payerEmail).toLowerCase() !== base.payerEmail) {
        payerMismatch = true;
        log?.error?.({ payment: mpId, sub: refSub.id }, "MP: payer mismatch no pagamento — sem vínculo");
      } else {
        Object.assign(link, {
          saas: refSub.saas || "", customer: refSub.customer || "",
          subscription: refSub.id, matchedBy: "subscription",
        });
      }
    } else if (refLead) {
      // Link criado no card do lead: o dinheiro chega rastreado à origem —
      // customer acompanha quando o lead já converteu (customerId do Ganho).
      Object.assign(link, {
        saas: refLead.saas || "", lead: refLead.id,
        customer: refLead.customerId || "", matchedBy: "reference",
      });
    } else if (base.payerEmail) {
      // Cobrança de uma RECORRÊNCIA já vinculada (mp-subscriptions.js): o MP não
      // manda external_reference nessas, mas o pagador é o mesmo da preapproval
      // — e o vínculo dela entrega a ASSINATURA, não só o cliente (então a
      // fatura do ciclo recebe a baixa). Vale antes do e-mail solto por ser mais
      // específico; ambíguo (2 recorrências do mesmo pagador) não casa.
      const byPre = gateway === "mp"
        ? (await repo.list("mp_preapprovals")).filter((p) => p.subscription && String(p.payerEmail || "").toLowerCase() === base.payerEmail)
        : [];
      if (byPre.length === 1) {
        Object.assign(link, {
          saas: byPre[0].saas || "", customer: byPre[0].customer || "",
          subscription: byPre[0].subscription, matchedBy: "preapproval",
        });
      }
      if (!link.subscription) {
        const byEmail = (await repo.list("customers"))
          .filter((c) => String(c.email || "").toLowerCase() === base.payerEmail);
        if (byEmail.length === 1) {
          Object.assign(link, { saas: byEmail[0].saas || "", customer: byEmail[0].id, matchedBy: "email" });
        } else if (!byEmail.length) {
          const byLead = (await repo.list("leads"))
            .filter((l) => String(l.email || "").toLowerCase() === base.payerEmail);
          if (byLead.length === 1) {
            Object.assign(link, {
              saas: byLead[0].saas || "", lead: byLead[0].id,
              customer: byLead[0].customerId || "", matchedBy: "email",
            });
          }
        }
      }
    }
    // E-mail não resolveu: o telefone do pagador (quando o gateway manda).
    if (!link.customer && !link.lead && base.payerPhone) {
      const byPhone = await matchByPhone(repo, base.payerPhone);
      if (byPhone) Object.assign(link, byPhone);
    }
  }

  // Regra aprendida (fin_rules): o mesmo pagador não pergunta 2x. Só pra
  // venda aprovada que NÃO casou sozinha — vincular entra na MESMA baixa do
  // vínculo manual (settleTarget abaixo); desconsiderar carimba finIgnored.
  let ruleApplied = null;
  if (isSale && base.status === "approved" && !link.customer && !link.invoice && !link.lead && !prev?.finIgnored) {
    const rules = rulesFor(await repo.list("fin_rules").catch(() => []), link.saas || "");
    const rule = rules.find((r) => ruleMatches(r, base));
    if (rule?.action === "desconsiderar") {
      Object.assign(base, { finIgnored: true, finIgnoredReason: rule.reason || "regra", finRuleId: rule.id });
      ruleApplied = rule;
    } else if (rule?.action === "vincular" && rule.customer) {
      const c = await repo.get("customers", rule.customer).catch(() => null);
      if (c) {
        Object.assign(link, { customer: c.id, saas: link.saas || c.saas || "", matchedBy: "rule" });
        base.finRuleId = rule.id;
        ruleApplied = rule;
      }
    }
    if (ruleApplied) {
      await repo.update("fin_rules", ruleApplied.id, { autoCount: (Number(ruleApplied.autoCount) || 0) + 1, lastAppliedAt: new Date().toISOString() }, { silent: true }).catch(() => {});
    }
  }

  let settledNow = null;
  if (isSale && base.status === "approved" && !alreadySettled && !base.finIgnored) {
    const target = settleTarget(invoices, link, base);
    if (target) {
      settledNow = await settleInvoice(repo, target, rawDialectOf(base), { discord, log, gateway });
      link.invoice = target.id;
      link.customer = link.customer || target.customer || "";
      link.saas = link.saas || target.saas || "";
    }
  }

  const doc = { ...base, ...link, ...extra, ...(payerMismatch ? { payerMismatch: true } : {}) };
  const KEYS = Object.keys(doc);
  let saved;
  if (legacy) {
    // Migra o doc legado (id do pagamento) pro id novo (nº da fatura),
    // carregando o que o legado tinha a mais (finIgnored, vínculo manual…).
    const { id: _omit, ...rest } = legacy;
    saved = await repo.create("mp_payments", { ...rest, id: mirrorId, ...doc, syncedAt: new Date().toISOString() });
    await repo.remove("mp_payments", legacyId).catch(() => {});
  } else if (!prev) saved = await repo.create("mp_payments", { id: mirrorId, ...doc, syncedAt: new Date().toISOString() });
  else if (!sameDoc(prev, doc, KEYS)) saved = await repo.update("mp_payments", mirrorId, { ...doc, syncedAt: new Date().toISOString() });
  else saved = prev;

  // ESTORNO/CHARGEBACK de um pagamento que o espelho já conhecia com outro
  // status: dinheiro SAINDO da conta — avisa no Discord e registra na timeline
  // do lead. Não desfaz fatura nem churna sozinho (estorno parcial e acordo
  // existem); a decisão é humana, na tela de Clientes/Financeiro. Só a
  // TRANSIÇÃO avisa (prev com status diferente): o backfill de estornos
  // antigos não vira tempestade de aviso.
  const wentBad = !!prev && prev.status !== base.status && (base.status === "refunded" || base.status === "charged_back");
  if (wentBad) {
    const badLabel = base.status === "charged_back" ? "chargeback" : "estorno";
    let customerName = "";
    if (link.customer) {
      try { customerName = (await repo.get("customers", link.customer))?.name || ""; } catch { /* segue sem nome */ }
    }
    if (link.lead) {
      try {
        await logActivity(repo, {
          saas: link.saas || "", lead: link.lead, type: "system",
          text: `Pagamento de R$ ${(Number(base.amount) || 0).toFixed(2).replace(".", ",")} sofreu ${badLabel} no ${gatewayLabel(gateway)}`,
          meta: { event: "mp_refund", mpPaymentId: base.mpId, gateway, status: base.status }, author: gateway === "mp" ? "mercadopago" : gateway,
        });
      } catch { /* timeline nunca quebra o ingest */ }
    }
    if (discord?.configured?.()) {
      try { await discord.paymentRefunded({ payment: saved, customerName }); }
      catch (err) { log?.warn?.({ payment: mpId, err: err.message }, "MP: aviso de estorno no Discord falhou"); }
    }
    log?.warn?.({ payment: mpId, gateway, status: base.status, customer: link.customer || "" }, `${gatewayLabel(gateway)}: ${badLabel} detectado no espelho`);
  }

  return {
    payment: saved,
    created: !prev,
    matched: !!(link.customer || link.lead),
    settledNow: settledNow?.id || null,
    alreadySettled: alreadySettled?.id || null,
  };
}

// Aplica as regras aprendidas nas PENDÊNCIAS que já estão no espelho (botão
// "aplicar regras" do Financeiro e o momento em que uma regra nasce). Mesma
// baixa do vínculo manual; idempotente pelo mpPaymentId na fatura.
export async function applyFinRulesToPending(repo, { saas, discord, log } = {}) {
  const [mps, allRules, invoices] = await Promise.all([repo.list("mp_payments"), repo.list("fin_rules"), repo.list("invoices")]);
  const rules = rulesFor(allRules, saas);
  let applied = 0, settled = 0;
  if (!rules.length) return { applied, settled };
  for (const p of mps) {
    if (saas && p.saas && p.saas !== saas) continue;
    if (p.status !== "approved" || p.customer || p.finIgnored || (p.kind && !SALE_KINDS.has(p.kind))) continue;
    const rule = rules.find((r) => ruleMatches(r, p));
    if (!rule) continue;
    if (rule.action === "interna") {
      if (p.kindSource === "manual") continue;
      await repo.update("mp_payments", p.id, { kind: "interna", direction: "in", kindSource: "rule", finRuleId: rule.id }, { silent: true });
    } else if (rule.action === "desconsiderar") {
      await repo.update("mp_payments", p.id, { finIgnored: true, finIgnoredReason: rule.reason || "regra", finRuleId: rule.id }, { silent: true });
    } else {
      const customer = await repo.get("customers", rule.customer).catch(() => null);
      if (!customer) continue;
      const patch = { customer: customer.id, saas: p.saas || customer.saas || "", matchedBy: "rule", finRuleId: rule.id };
      if (p.mpId && !invoices.some((i) => i.mpPaymentId === p.mpId)) {
        const alvo = settleTarget(invoices, { customer: customer.id }, p);
        if (alvo) {
          // settleInvoice fala o dialeto CRU da API do MP — traduz do espelho.
          const paid = await settleInvoice(repo, alvo, rawDialectOf(p), { discord, log, gateway: gatewayOf(p) });
          Object.assign(alvo, paid);
          patch.invoice = alvo.id;
          settled++;
        }
      }
      await repo.update("mp_payments", p.id, patch, { silent: true });
    }
    await repo.update("fin_rules", rule.id, { autoCount: (Number(rule.autoCount) || 0) + 1, lastAppliedAt: new Date().toISOString() }, { silent: true });
    applied++;
  }
  return { applied, settled };
}

// Uma passada de reconciliação: busca paginada dos pagamentos da conta desde o
// último sync (com folga de 2 dias; 1º run varre 400 dias = backfill sozinho) e
// ingere um a um. Carimbo em app_config "mp_sync" — a UI mostra o último sync.
// Versão do enriquecimento por GET /v1/payments/:id — bump quando a extração
// muda e os docs já carimbados precisam de re-fetch (v2: banco separado do
// nome; a v1 guardava a instituição do PIX como payerName).
const PAYER_DETAIL_V = 2;

// CNPJ é público: BrasilAPI (sem auth) devolve a razão social — PIX B2B fica
// identificado mesmo sem o MP entregar o nome. CPF não tem consulta pública
// (fica o número na tela pro vínculo manual).
async function lookupCnpjName(cnpj, f = globalThis.fetch) {
  const res = await f(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
  if (res.status === 404) return { ok: true, name: "" }; // CNPJ inválido/não achado: não re-tenta
  if (res.status >= 400) throw new Error(`brasilapi ${res.status}`);
  const j = await res.json();
  return { ok: true, name: clean(j.razao_social || j.nome_fantasia) };
}

export async function runMpSync(repo, mp, { discord, log, now = new Date(), backfillDays = 400, overlapDays = 2, maxPages = 40, enrichLimit = 40, cnpjLimit = 10, cnpjFetch = globalThis.fetch } = {}) {
  if (!mp?.configured?.()) return { ok: false, error: "not_configured" };
  const collectorId = await resolveCollectorId(repo, mp);
  const cfg = await repo.get("app_config", "mp_sync");
  const since = cfg?.lastAt
    ? new Date(new Date(cfg.lastAt).getTime() - overlapDays * 86_400_000)
    : new Date(now.getTime() - backfillDays * 86_400_000);

  let offset = 0, seen = 0, matched = 0, settled = 0, enriched = 0;
  for (let page = 0; page < maxPages; page++) {
    const res = await mp.searchPayments({ begin: since.toISOString(), end: now.toISOString(), limit: 50, offset });
    const results = Array.isArray(res?.results) ? res.results : [];
    for (const pmt of results) {
      // Search sem nome de pagador → busca o doc COMPLETO uma única vez
      // (payerDetail carimba a tentativa: PIX que não traz nome nem no doc
      // completo não vira re-fetch eterno). Cap por passada segura o backfill.
      let full = pmt, extra;
      if (!payerNameOf(pmt) && enriched < enrichLimit) {
        const prev = await repo.get("mp_payments", `mpp_${pmt.id}`);
        if (!prev?.payerName && prev?.payerDetail !== PAYER_DETAIL_V) {
          try { full = await mp.getPayment(pmt.id); extra = { payerDetail: PAYER_DETAIL_V }; enriched++; }
          catch { /* segue com o resumo; tenta de novo no próximo tick */ }
        }
      }
      const r = await ingestMpPayment(repo, full, { discord, log, extra, collectorId });
      seen++;
      if (r.matched) matched++;
      if (r.settledNow) settled++;
    }
    offset += results.length;
    const total = Number(res?.paging?.total ?? 0);
    if (!results.length || (total && offset >= total)) break;
  }

  // Retro-enriquecimento: docs do espelho de versão antiga (sem nome, ou sem o
  // banco separado do nome) ganham o GET por id na mesma cota — cada um tenta
  // uma vez por versão (payerDetail = PAYER_DETAIL_V). O mesmo GET reclassifica
  // o doc (classV) — com o id da conta em mãos, o espelho inteiro sai da
  // heurística em poucos ticks.
  let reclassified = 0;
  if (enriched < enrichLimit) {
    const stale = (await repo.list("mp_payments"))
      .filter((d) => gatewayOf(d) === "mp")
      .filter((d) => (d.payerDetail !== PAYER_DETAIL_V && (!d.payerName || !d.payerBank)) || (collectorId && d.classV !== MP_CLASS_V));
    for (const d of stale) {
      if (enriched >= enrichLimit) break;
      try {
        const full = await mp.getPayment(d.mpId);
        enriched++;
        const r = await ingestMpPayment(repo, full, { discord, log, extra: { payerDetail: PAYER_DETAIL_V }, collectorId });
        if (d.classV !== MP_CLASS_V && r.payment?.classV === MP_CLASS_V) reclassified++;
      } catch { /* tenta no próximo tick */ }
    }
  }

  // Razão social pelo CNPJ do pagador (payerDoc com 14 dígitos e sem nome).
  // cnpjLookup carimba a consulta feita — 404 também, pra não re-tentar lixo.
  let cnpjSeen = 0;
  const noName = (await repo.list("mp_payments")).filter((d) => {
    const digits = String(d.payerDoc || "").replace(/\D/g, "");
    return !d.payerName && !d.cnpjLookup && digits.length === 14 && !d.payerDocMp;
  });
  for (const d of noName) {
    if (cnpjSeen >= cnpjLimit) break;
    const digits = String(d.payerDoc).replace(/\D/g, "");
    try {
      const r = await lookupCnpjName(digits, cnpjFetch);
      cnpjSeen++;
      await repo.update("mp_payments", d.id, { ...(r.name ? { payerName: r.name } : {}), cnpjLookup: true });
    } catch { /* BrasilAPI fora do ar: tenta no próximo tick */ }
  }

  const stamp = { id: "mp_sync", lastAt: now.toISOString(), lastSeen: seen, updatedAt: now.toISOString(), collectorId: collectorId || "" };
  if (cfg) await repo.update("app_config", "mp_sync", stamp);
  else await repo.create("app_config", stamp);
  return { ok: true, seen, matched, settled, reclassified, collectorId: collectorId || "", since: since.toISOString() };
}

// Poller de reconciliação (modelo do startShopifySync): rede de segurança pro
// webhook — mesmo sem ele configurado no painel do MP, os pagamentos entram no
// próximo tick. Sem MERCADOPAGO_ACCESS_TOKEN, fica DORMENTE.
export function startMpSync(repo = defaultRepo, { mp = defaultMp, discord = defaultDiscord, intervalMs = 10 * 60_000, log = console } = {}) {
  if (!mp?.configured?.()) { log.info?.("mp sync: sem MERCADOPAGO_ACCESS_TOKEN — desligado"); return () => {}; }
  let running = false;
  async function tick() {
    if (running) return; running = true;
    try {
      const r = await runMpSync(repo, mp, { discord, log });
      if (r.settled || r.seen) log.info?.(`mp sync: ${r.seen} pagamento(s) vistos, ${r.matched} casados, ${r.settled} fatura(s) baixada(s)`);
    } catch (err) { log.warn?.({ err: err.message }, "mp sync falhou (re-tenta no próximo ciclo)"); }
    finally { running = false; }
  }
  tick(); // corre no boot (faz o backfill imediato)
  const timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
  return () => clearInterval(timer);
}
