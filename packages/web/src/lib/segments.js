// Segmento do lead (filtro do Pipeline, 06/10/2026). Não é campo novo: é a
// resposta `niche` dos formulários (autopecas, eletronicos, moda, casa,
// beleza, outros), que o robô do WhatsApp e o outbound também preenchem, às
// vezes em texto livre ("Autopeças", "auto peças"). O form de OEM não pergunta
// porque é autopeças por definição, então lead OEM sem resposta conta como
// autopeças. Rótulos vêm das opções da pergunta no produto (leadQuestions).

export const NO_SEGMENT = "__sem";

const fold = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

function nicheOptions(saasCfg) {
  const q = (saasCfg?.leadQuestions || []).find((x) => x?.key === "niche");
  return (q?.options || []).filter((o) => o && o.value);
}

const AUTO_RE = /auto\s*-?\s*pe[cç]as?/;
// O value da opção de autopeças do produto (o código pode não ser "autopecas":
// basta o rótulo dizer autopeças). Texto livre e OEM caem nela.
function autoValue(saasCfg) {
  const o = nicheOptions(saasCfg).find((x) => AUTO_RE.test(fold(x.value)) || AUTO_RE.test(fold(x.label)));
  return o ? String(o.value) : "autopecas";
}

// Chave do segmento: o value da opção do produto quando a resposta bate com
// ele ou com o rótulo; senão o texto livre normalizado. "" = sem segmento.
export function leadSegment(lead, saasCfg) {
  const raw = Array.isArray(lead?.niche) ? lead.niche[0] : lead?.niche;
  const k = fold(raw);
  if (k) {
    const opt = nicheOptions(saasCfg).find((o) => fold(o.value) === k || fold(o.label) === k);
    if (opt) return String(opt.value);
    return AUTO_RE.test(k) ? autoValue(saasCfg) : k;
  }
  return lead?.formProduct === "oem" ? autoValue(saasCfg) : "";
}

// Opções do filtro com a contagem de cada uma, na ordem do formulário; valores
// que só existem nos leads (texto livre) entram depois, e "sem segmento" no fim.
// Lista vazia = o produto não usa segmento (o filtro nem aparece).
export function segmentOptions(saasCfg, leads) {
  const counts = new Map();
  const free = new Map(); // chave → texto como foi escrito, pro rótulo
  for (const l of leads || []) {
    const seg = leadSegment(l, saasCfg) || NO_SEGMENT;
    counts.set(seg, (counts.get(seg) || 0) + 1);
    if (seg !== NO_SEGMENT && !free.has(seg)) free.set(seg, String((Array.isArray(l.niche) ? l.niche[0] : l.niche) || ""));
  }
  const opts = nicheOptions(saasCfg).map((o) => ({ value: String(o.value), label: o.label || String(o.value) }));
  const auto = autoValue(saasCfg);
  if (!opts.some((o) => o.value === auto) && counts.has(auto)) opts.unshift({ value: auto, label: "Autopeças" });
  for (const [seg] of counts) {
    if (seg === NO_SEGMENT || opts.some((o) => o.value === seg)) continue;
    opts.push({ value: seg, label: free.get(seg) || seg });
  }
  if (!opts.length) return [];
  if (counts.has(NO_SEGMENT)) opts.push({ value: NO_SEGMENT, label: "Sem segmento" });
  return opts.map((o) => ({ ...o, hint: String(counts.get(o.value) || 0) }));
}

export function segmentMatch(lead, saasCfg, segment) {
  if (!segment) return true;
  const seg = leadSegment(lead, saasCfg);
  return segment === NO_SEGMENT ? !seg : seg === segment;
}
