// Admin API da Shopify (loja da UniqueKids) — SÓ LEITURA de pedidos, pra
// reconciliar com o cockpit. Factory com fetch injetável (mesmo padrão de
// meta.js/google.js/whatsapp.js). É a REDE DE SEGURANÇA do fluxo de upsell da
// consulta da Ana: o webhook orders/paid é o caminho em tempo real, mas se ele
// falhar ou não estiver registrado (foi o que aconteceu: 8 dias sem lead novo
// desde o backfill de 13/07), este client puxa os pedidos e o poller preenche
// o que faltou. Sem token, fica dormente.
const API_VERSION = "2024-07";

export function makeShopify({ fetch: f = globalThis.fetch, store = "", token = "" } = {}) {
  // store = "4b778b.myshopify.com" (host completo ou só o handle).
  const host = store ? (store.includes(".") ? store : `${store}.myshopify.com`) : "";
  const configured = () => !!(host && token);
  const base = () => `https://${host}/admin/api/${API_VERSION}`;

  async function get(url) {
    const res = await f(url, { headers: { "X-Shopify-Access-Token": token, accept: "application/json" } });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = {}; }
    if (res.status >= 400) {
      const err = new Error(`Shopify Admin -> ${res.status}: ${JSON.stringify(body.errors || text.slice(0, 200))}`);
      err.status = res.status;
      throw err;
    }
    // O cursor da próxima página vem no header Link (rel="next").
    const link = res.headers?.get?.("link") || "";
    const next = /<([^>]+)>;\s*rel="next"/.exec(link)?.[1] || "";
    return { body, next };
  }

  // Pedidos PAGOS criados desde `sinceIso` (ISO). Segue a paginação por cursor
  // (Link header) até o cap de segurança. O gatilho (tarefas diárias) e a
  // idempotência ficam com quem chama — aqui é só a lista crua.
  async function paidOrdersSince(sinceIso, { cap = 1000 } = {}) {
    if (!configured()) return [];
    const fields = "id,name,created_at,email,phone,customer,line_items,shipping_address,billing_address,total_price,current_total_price";
    let url = `${base()}/orders.json?status=any&financial_status=paid&created_at_min=${encodeURIComponent(sinceIso)}&limit=250&fields=${encodeURIComponent(fields)}`;
    const out = [];
    while (url && out.length < cap) {
      const { body, next } = await get(url);
      for (const o of body.orders || []) out.push(o);
      url = next; // o page_info já carrega os filtros; não reanexar query
    }
    return out;
  }

  return { configured, paidOrdersSince };
}
