// Ponto único de registro das tools. Cada módulo cobre uma tela (ou um grupo de
// telas) do cockpit e recebe o mesmo registrador — que padroniza erro, marca o
// que escreve e alimenta o catálogo lido por `cockpit_help`.
//
// A ordem importa só pra leitura humana do catálogo: manual primeiro, depois o
// que o time olha todo dia, e a compatibilidade por último.

import { makeTool } from "../core/register.js";

import { registerDocsTools } from "./docs.js";
import { registerAnalyticsTools } from "./analytics.js";
import { registerAdsTools } from "./ads.js";
import { registerPipelineTools } from "./pipeline.js";
import { registerCustomersTools } from "./customers.js";
import { registerFinanceTools } from "./finance.js";
import { registerWhatsappTools } from "./whatsapp.js";
import { registerSocialTools } from "./social.js";
import { registerOutboundTools } from "./outbound.js";
import { registerFormsTools } from "./forms.js";
import { registerAgendaTools } from "./agenda.js";
import { registerWorkspaceTools } from "./workspace.js";
import { registerTrainingTools } from "./training.js";
import { registerDataTools } from "./data.js";
import { registerCompatTools } from "./compat.js";

export function registerTools(server) {
  const tool = makeTool(server);
  registerDocsTools(tool);
  registerAnalyticsTools(tool);
  registerAdsTools(tool);
  registerPipelineTools(tool);
  registerCustomersTools(tool);
  registerFinanceTools(tool);
  registerWhatsappTools(tool);
  registerSocialTools(tool);
  registerOutboundTools(tool);
  registerFormsTools(tool);
  registerAgendaTools(tool);
  registerWorkspaceTools(tool);
  registerTrainingTools(tool);
  registerDataTools(tool);
  registerCompatTools(tool);
}
