import React from "react";
import "./presentation-config.css";
import { api } from "../lib/api.js";
import { SelectPopover } from "./select-popover.jsx";
import { Checkbox } from "./form-controls.jsx";
import { Choice } from "./plan-editor.jsx";
import { useAttribution, leadPain } from "../lib/pains.js";
import { calcOferta, deckChoices } from "../../../api/src/shared/deck-offer.js";

// Informações da apresentação no card de Atividades (06/10/2026). Era a tela
// zero do deck de slides num iframe: selects nativos do navegador, sem o tema
// do cockpit, e a tabela de preço copiada quando a proposta nasceu. Agora o
// card desenha a configuração com as peças do cockpit e lê os planos de hoje
// (GET /api/leads/:id/proposal-config, a projeção de Comercial → Planos). A
// conta e as escolhas são as MESMAS da página do deck (shared/deck-offer.js) e
// o salvamento é o mesmo state.deckC. Deck OEM e proposta de fora seguem no
// iframe da própria página.

const { useEffect, useRef, useState } = React;
const SAVE_DELAY = 600;
const brl = (n) => "R$ " + Math.round(Number(n) || 0).toLocaleString("pt-BR");
const PERIODOS = [{ value: "anual", label: "Anual · 12×" }, { value: "semestral", label: "Semestral · 6×" }];

// Linha de produto que o anúncio vendia, com a MESMA régua da tela zero do
// deck (proposals/proposal-catalog.js, lineOf): dor [PRICE] ou form do Price
// = Lever Price; dor [OEM], form do OEM ou nicho de autopeças = Lever OEM; o
// resto é Lever Ads. É a origem, não o que o closer escolheu no plano.
const LINE_NAMES = { oem: "Lever OEM", ads: "Lever Ads", price: "Lever Price" };
export function originLineOf(lead, painCode) {
  const code = String(painCode || lead?.sourcePain || "").toUpperCase();
  const form = String(lead?.formProduct || "");
  // Nicho com a mesma leitura de lib/segments.js (acento e grafia livres).
  const niche = String((Array.isArray(lead?.niche) ? lead.niche[0] : lead?.niche) || "")
    .normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  if (code === "PRICE" || form === "price") return "price";
  if (code === "OEM" || form === "oem" || /auto\s*-?\s*pe[cç]as?/.test(niche)) return "oem";
  return "ads";
}

// De onde o lead veio, no alto das Informações da apresentação (Leo, 15/10/2026):
// o anúncio (utm.content resolvido pelo catálogo de atribuição, com o código
// de dor no nome) e o produto que esse anúncio vendia. O closer abre a call
// sabendo o que o lead clicou, sem ir até a ficha do pipeline.
export function LeadOriginRow({ lead, saasCfg }) {
  const cat = useAttribution(lead?.saas, !!lead?.utm);
  const utm = lead?.utm || {};
  const pain = leadPain(lead, cat, saasCfg?.painMap);
  const adName = utm.content ? (cat?.ads?.[String(utm.content)]?.name || String(utm.content)) : "";
  const source = adName || utm.source || lead?.source || "";
  const line = originLineOf(lead, pain?.code);
  return (
    <div className="deck-origin" role="group" aria-label="Origem do lead">
      <div className="deck-cfg-field">
        <span className="kicker">Anúncio</span>
        <span className="deck-origin-value" title={adName || undefined}>{source || "sem anúncio · entrada direta"}</span>
      </div>
      <div className="deck-cfg-field">
        <span className="kicker">Produto de origem</span>
        <span className="deck-origin-value">
          {LINE_NAMES[line]}
          {pain ? <span className="deck-origin-pain"> · [{pain.code}] {pain.label}</span> : null}
        </span>
      </div>
    </div>
  );
}

export function PresentationConfig({ lead }) {
  const url = lead.proposal_edit_url;
  const [data, setData] = useState(null); // null = carregando · { fallback } · payload do deck
  useEffect(() => {
    let alive = true;
    setData(null);
    api.proposalConfig(lead.id)
      .then((r) => { if (alive) setData(r?.layout === "slides" && r.cfg ? r : { fallback: true }); })
      .catch(() => { if (alive) setData({ fallback: true }); });
    return () => { alive = false; };
  }, [lead.id, url]);
  if (!data) return <p className="today-script-hint" role="status">Carregando apresentação…</p>;
  if (data.fallback) return <PresentationFrame url={url} />;
  return <DeckConfig leadId={lead.id} url={url} initial={data} />;
}

function DeckConfig({ leadId, url, initial }) {
  const [catalog, setCatalog] = useState(initial.catalog);
  const [cfg, setCfgState] = useState(initial.cfg);
  const cfgRef = useRef(initial.cfg);
  const setCfg = (next) => { cfgRef.current = next; setCfgState(next); };
  const [status, setStatus] = useState(""); // "" | saving | saved | error
  const pending = useRef(null); // { timer, cfg } do salvamento que ainda não saiu
  const seq = useRef(0);

  function send(next) {
    const mine = ++seq.current;
    pending.current = null;
    return api.saveProposalConfig(leadId, next)
      .then((r) => {
        if (mine !== seq.current) return;
        setStatus("saved");
        // Sem edição depois desta: adota o que o servidor saneou e a tabela de hoje.
        if (r?.cfg && !pending.current) setCfg(r.cfg);
        if (r?.catalog) setCatalog(r.catalog);
      })
      .catch(() => { if (mine === seq.current) setStatus("error"); });
  }
  function update(patch) {
    const next = { ...cfgRef.current, ...patch };
    setCfg(next);
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = { cfg: next, timer: setTimeout(() => send(next), SAVE_DELAY) };
    setStatus("saving");
  }
  // Fechar o card logo depois de digitar não perde a edição.
  useEffect(() => () => {
    if (pending.current) { clearTimeout(pending.current.timer); send(pending.current.cfg); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const choices = deckChoices(catalog);
  const oferta = calcOferta(catalog, cfg);
  const semestral = cfg.periodo === "semestral";
  const perMonth = (x) => brl(semestral ? x.semestral : x.anual) + "/mês";
  const planOptions = choices.plataforma.map((x) => ({ value: x.key, label: x.name, group: x.group, hint: `${x.contas} contas · ${perMonth(x)}` }));
  const priceOptions = choices.price.map((x) => ({ value: x.tier, label: x.name, hint: perMonth(x) }));
  const packOptions = choices.oemPacks.map((x) => ({ value: String(x.qty), label: `${x.qty.toLocaleString("pt-BR")} anúncios`, hint: brl(x.price) }));
  const platKey = `${cfg.linha}_${cfg.tier}`;
  const plat = choices.plataforma.find((x) => x.key === platKey);
  // Contas do cliente: em branco vale o que o pacote inclui; acima disso, a
  // conta extra da tabela de Planos entra em cada parcela (a mesma regra de
  // calcOferta). Era só leitura no card, o closer ajusta aqui (13/10/2026).
  const inclusas = plat ? plat.contas : 0;
  const contas = Number(cfg.contas) > 0 ? Number(cfg.contas) : inclusas;
  const extras = Math.max(0, contas - inclusas);
  const extraPer = Number(catalog?.addons?.contaExtra?.per) || 100;
  const platHint = plat
    ? `${contas} contas · ${brl((semestral ? plat.semestral : plat.anual) + extras * extraPer)}/mês${extras ? ` · ${extras} extra${extras > 1 ? "s" : ""} a ${brl(extraPer)}` : ""}`
    : "escolha o plano";
  const priceSel = choices.price.find((x) => x.tier === cfg.priceTier);
  const packSel = choices.oemPacks.find((x) => String(x.qty) === String(cfg.oemPack));

  const numField = (key, label, placeholder) => (
    <div className="deck-cfg-field">
      <label className="kicker" htmlFor={`deck-${key}-${leadId}`}>{label}</label>
      <input id={`deck-${key}-${leadId}`} className="inp" type="text" inputMode="numeric" autoComplete="off" placeholder={placeholder}
        value={Number(cfg[key]) > 0 ? String(cfg[key]) : ""}
        onChange={(e) => update({ [key]: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
    </div>
  );

  return (
    <div className="deck-cfg">
      <div className="deck-cfg-grid">
        {numField("pedidos", "Pedidos/mês", "na call")}
        {numField("ticket", "Ticket médio (R$)", "na call")}
      </div>

      <div className="deck-cfg-products" role="group" aria-label="Produtos no plano">
        <div className="kicker">Produtos no plano</div>
        {planOptions.length > 0 && (
          <ProductRow title="LeverAds" hint={platHint}
            on={!!cfg.plataforma} onToggle={(v) => update({ plataforma: v })}>
            <div className="deck-cfg-product-row">
              <SelectPopover label="Plano LeverAds" size="sm" width={300} value={platKey} options={planOptions}
                onChange={(key) => { const x = choices.plataforma.find((p) => p.key === key); if (x) update({ linha: x.linha, tier: x.tier }); }} />
              <label className="deck-cfg-contas">
                <span className="kicker">Contas</span>
                <input id={`deck-contas-${leadId}`} className="inp" type="text" inputMode="numeric" autoComplete="off" aria-label="Contas do cliente"
                  placeholder={inclusas ? String(inclusas) : "na call"} title={`O pacote inclui ${inclusas}; cada conta a mais custa ${brl(extraPer)} por parcela`}
                  value={Number(cfg.contas) > 0 ? String(cfg.contas) : ""}
                  onChange={(e) => update({ contas: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
              </label>
            </div>
          </ProductRow>
        )}
        {priceOptions.length > 0 && (
          <ProductRow title="Lever Price" hint={priceSel ? perMonth(priceSel) : "precificação automática"}
            on={!!cfg.price} onToggle={(v) => update({ price: v })}>
            <SelectPopover label="Plano Lever Price" size="sm" width={300} value={cfg.priceTier} options={priceOptions} onChange={(v) => update({ priceTier: v })} />
          </ProductRow>
        )}
        {packOptions.length > 0 && (
          <ProductRow title="Pacote de OEM avulso" hint={packSel ? `${brl(packSel.price)} · pagamento único` : "pagamento único"}
            on={!!cfg.oem} onToggle={(v) => update({ oem: v })}>
            <SelectPopover label="Pacote de OEM" size="sm" width={260} value={String(cfg.oemPack)} options={packOptions} onChange={(v) => update({ oemPack: v })} />
          </ProductRow>
        )}
        {!planOptions.length && !priceOptions.length && !packOptions.length && (
          <p className="today-script-hint">Nenhum plano à venda no catálogo. Cadastre em Comercial → Planos.</p>
        )}
      </div>

      <div className="deck-cfg-field">
        <div className="kicker">Plano</div>
        <Choice label="Período do plano" size="sm" value={semestral ? "semestral" : "anual"} options={PERIODOS} onChange={(v) => update({ periodo: v })} />
      </div>

      <div className="deck-cfg-value">
        <div className="deck-cfg-value-body">
          <span className="deck-cfg-value-name">{oferta.planoNome}</span>
          <strong>{oferta.parcelas}× R$ {oferta.mensalFmt}</strong>
          <span>ou R$ {oferta.vistaFmt} à vista</span>
          {oferta.setupFmt !== "0" && <span>+ R$ {oferta.setupFmt} de pacote OEM na contratação</span>}
        </div>
        {url && <a className="deck-cfg-present" href={url} target="_blank" rel="noopener noreferrer">Apresentar ↗</a>}
      </div>
      <span className="deck-cfg-status mono dim" role="status" data-tone={status === "error" ? "neg" : undefined}>
        {status === "saving" ? "salvando…" : status === "saved" ? "salvo" : status === "error" ? "não salvou, tente de novo" : ""}
      </span>
    </div>
  );
}

function ProductRow({ title, hint, on, onToggle, children }) {
  return (
    <div className="deck-cfg-product" data-on={on || undefined}>
      <Checkbox checked={on} onChange={onToggle}>
        <span className="deck-cfg-product-title">{title}</span>
        <span className="deck-cfg-product-hint">{hint}</span>
      </Checkbox>
      {on && <div className="deck-cfg-product-pick">{children}</div>}
    </div>
  );
}

// Fallback: a tela zero da própria página (deck OEM, proposta de fora).
function PresentationFrame({ url }) {
  const ref = useRef(null);
  const [height, setHeight] = useState(480);
  useEffect(() => {
    const origin = new URL(url, window.location.href).origin;
    const resize = (event) => {
      if (event.source !== ref.current?.contentWindow || event.origin !== origin || event.data?.type !== "cockpit:proposal-config-height") return;
      const next = Number(event.data.height);
      if (Number.isFinite(next) && next > 0) setHeight(Math.min(2400, Math.ceil(next)));
    };
    window.addEventListener("message", resize);
    return () => window.removeEventListener("message", resize);
  }, [url]);
  return <iframe ref={ref} title="Configurar apresentação" style={{ height }} src={`${url}${url.includes("?") ? "&" : "?"}embed=config&from=cockpit`} />;
}
