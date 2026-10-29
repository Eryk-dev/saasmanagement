import React from "react";
import "./callface-button.css";
import { toast } from "../atoms.jsx";
import { callfaceDialUrl, CALLFACE_WINDOW } from "../../../api/src/shared/callface-dial.js";

// Botão "Ligar" pela Callface (29/10/2026): abre o discador deles com o número
// do lead e o id do card (deal_id), na aba fixa "Callface", igual a extensão
// faz nos CRMs que ela reconhece. Não registra nada ao clicar: a ligação real
// volta pelo webhook (api calls/callface.js) com resumo, áudio e duração, e aí
// vira toque na timeline. Sem número BR discável o botão some (o número
// estrangeiro continua visível no LeadPhoneCopy).
//
// `variant="action"`: botão da fileira "A ação de agora", no tamanho dos
// outros (32px). `variant="inline"`: texto clicável ao lado do telefone, no
// cabeçalho do card compacto e da ficha do cliente.
const TITLE = "Discar pela Callface (precisa estar logado em app.callface.ai neste navegador)";

export function CallfaceButton({ phone, leadId = "", variant = "action", title = TITLE }) {
  const url = callfaceDialUrl({ phone, leadId });
  if (!url) return null;
  const dial = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const w = window.open(url, CALLFACE_WINDOW);
    if (!w) toast("O navegador bloqueou a janela da Callface · libere pop-ups pra este site", "warn");
  };
  const inline = variant === "inline";
  return (
    <button type="button" onClick={dial} title={title} aria-label="Ligar pela Callface"
      className={inline ? "callface-inline" : "callface-action"}>
      <span aria-hidden="true" className="callface-glyph">✆</span>
      <span>{inline ? "ligar" : "Ligar"}</span>
    </button>
  );
}
