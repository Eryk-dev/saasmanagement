// Domínios da API, na ordem em que registram as rotas. Cada um exporta
// `register(app, repo, ctx)` e, quando tem rotina em segundo plano,
// `start(repo, { clients, log, stops })`.
//
// A ordem segue as dependências entre clientes do ctx: google cria o Meet e o
// mailer (usados por marketing, calls, suporte, clientes e CRM); whatsapp cria
// o cliente que SDR, clientes e o bootstrap do CRM recebem por valor. O CRM
// fica por último porque o bootstrap informa o estado de todas as integrações.
// O roteador do Fastify não depende da ordem das rotas (a estática vence a
// paramétrica), então a ordem só importa para os clientes.

import * as platform from "./platform/index.js";
import * as auth from "./auth/index.js";
import * as google from "./google/index.js";
import * as forms from "./forms/index.js";
import * as proposals from "./proposals/index.js";
import * as billing from "./billing/index.js";
import * as payments from "./payments/index.js";
import * as marketing from "./marketing/index.js";
import * as blog from "./blog/index.js";
import * as calls from "./calls/index.js";
import * as training from "./training/index.js";
import * as metrics from "./metrics/index.js";
import * as tasks from "./tasks/index.js";
import * as support from "./support/index.js";
import * as whatsapp from "./whatsapp/index.js";
import * as sdr from "./sdr/index.js";
import * as customers from "./customers/index.js";
import * as comp from "./comp/index.js";
import * as crm from "./crm/index.js";
import { makeJobGate } from "./platform/app-env.js";

export const DOMAINS = [
  platform, auth, google, forms, proposals, billing, payments, marketing, blog,
  calls, training, metrics, tasks, support, whatsapp, sdr, customers, comp, crm,
];

// Sobe as rotinas em segundo plano de todos os domínios (chamado pelo index.js
// depois do listen). `stops` recebe o que precisa ser parado no onClose;
// `jobOn(nome)` liga ou desliga cada rotina; sem ele, vale a regra do app-env.js
// (só produção roda rotina, salvo JOBS_ENABLED/JOBS no env).
export function startDomains(repo, { clients, log, stops, jobOn = makeJobGate() }) {
  for (const domain of DOMAINS) domain.start?.(repo, { clients, log, stops, jobOn });
}
