// Número comercial do cockpit = o número que está CONECTADO na Cloud API
// (WHATSAPP_PHONE_NUMBER_ID). É pra ele que o formulário manda o lead falar,
// então não existe um "número de vendas" paralelo pra divergir quando o time
// troca de linha: trocou a env, trocou em todo lugar.
//
// A página do form é pública e pode receber rajada de tráfego, e a Graph tem
// limite: o número é buscado UMA vez e cacheado (1h). Falha nunca quebra a
// página, só devolve o último valor conhecido (ou vazio, e aí o form usa o
// número escrito nele).

export function makeSalesWhatsapp(getClient, { ttlMs = 3_600_000, now = () => Date.now() } = {}) {
  let cached = "";     // dígitos E.164 sem "+", ex.: 5541936183835
  let at = 0;
  let inflight = null; // uma busca por vez: 10 visitas simultâneas não viram 10 chamadas

  return async function salesWhatsappDigits() {
    if (cached && now() - at < ttlMs) return cached;
    if (inflight) return inflight;
    const wa = typeof getClient === "function" ? getClient() : getClient;
    if (!wa?.configured?.()) return cached;
    inflight = (async () => {
      try {
        const info = await wa.numberInfo();
        const digits = String(info?.display || "").replace(/\D/g, "");
        if (digits) { cached = digits; at = now(); }
      } catch { /* mantém o último conhecido: número é conveniência, não pode derrubar o form */ }
      finally { inflight = null; }
      return cached;
    })();
    return inflight;
  };
}
