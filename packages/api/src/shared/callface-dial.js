// Discagem pela Callface (telefonia com IA, assinada em 29/10/2026 pras SDRs
// ligarem de dentro do cockpit). Não existe API de click-to-call: a extensão
// Chrome da própria Callface só abre o discador do app com o número na URL, e
// o cockpit faz o mesmo, sem depender da extensão (ela nem reconhece o nosso
// domínio). Quem clica precisa estar logado em app.callface.ai no navegador.
//
// Formato (lido na extensão v2.4.10, clickToCall.js):
//   https://app.callface.ai/calls?call_to=<DDD+número>&deal_id=<id>
// `call_to` vai SEM o 55: o backend deles monta o E.164 sozinho (`+55${call_to}`).
// `deal_id` é o nosso id do lead; volta no webhook de saída (calls/callface.js)
// e é o que casa a ligação com o card. Nome fixo da janela: ligações seguidas
// reaproveitam a mesma aba do discador, igual a extensão faz.
//
// Puro e sem dependências: o web empacota este arquivo (components/callface-button.jsx).

export const CALLFACE_DIAL_URL = "https://app.callface.ai/calls";
export const CALLFACE_WINDOW = "Callface";

// Número NACIONAL discável (DDD + número, 10 ou 11 dígitos) ou "" quando o
// telefone não é brasileiro ou não dá pra discar. Não reaproveita o phoneKey
// dos gateways: aquele aceita número estrangeiro e não valida DDD.
export function callfaceDialDigits(phone) {
  let d = String(phone == null ? "" : phone).replace(/\D/g, "");
  if (!d) return "";
  // DDI 55 só sai quando o resto tem tamanho nacional (10 ou 11): "55 9xxxx-xxxx"
  // é DDD 55 (Santa Maria/RS) e perderia o próprio DDD.
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  // Zero de tronco ("041 9...") digitado no form.
  if (d.length === 11 && d[0] === "0") d = d.slice(1);
  if (d.length === 12 && d[0] === "0") d = d.slice(1);
  if (!/^[1-9][1-9]\d{8,9}$/.test(d)) return "";
  // Celular com 11 dígitos tem o 9 na frente; fixo com 10 começa em 2-9.
  if (d.length === 11 && d[2] !== "9") return "";
  if (d.length === 10 && !/[2-9]/.test(d[2])) return "";
  return d;
}

// URL do discador com o número e o id do lead (deal_id), ou "" sem número discável.
export function callfaceDialUrl({ phone, leadId = "" } = {}) {
  const digits = callfaceDialDigits(phone);
  if (!digits) return "";
  const params = new URLSearchParams({ call_to: digits });
  if (leadId) params.set("deal_id", String(leadId));
  return `${CALLFACE_DIAL_URL}?${params.toString()}`;
}
