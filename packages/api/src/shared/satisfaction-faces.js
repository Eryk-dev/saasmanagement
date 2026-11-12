// Carinhas da pesquisa de satisfação da integração (12/11/2026): de 1 (triste,
// vermelho) a 5 (sorrindo, verde). Uma definição só para a página pública
// (customers/integration-survey-page.js) e o SPA (components/integration-survey.jsx,
// Análise de Integração). Módulo puro: o SPA empacota `shared/`.
//
// Geometria num viewBox 0 0 40 40: rosto (círculo r=17), olhos em (14,16) e
// (26,16) e a boca, uma curva de (12,27) a (28,27) cujo ponto de controle desce
// conforme a nota (sobe = triste, desce = sorriso).

export const SATISFACTION_FACES = [
  { score: 1, label: "Péssima", color: "#d64545", mouthY: 19 },
  { score: 2, label: "Ruim", color: "#e8833a", mouthY: 23 },
  { score: 3, label: "Regular", color: "#d4a106", mouthY: 27 },
  { score: 4, label: "Boa", color: "#5aa95a", mouthY: 32 },
  { score: 5, label: "Excelente", color: "#1f9d55", mouthY: 36 },
];

export const faceOf = (score) => SATISFACTION_FACES.find((f) => f.score === Number(score)) || null;

// Peças do desenho, para quem monta o SVG (string ou JSX).
export const faceParts = (score) => {
  const f = faceOf(score);
  if (!f) return null;
  return {
    color: f.color,
    mouth: `M12 27 Q20 ${f.mouthY} 28 27`,
    eyes: [[14, 16], [26, 16]],
  };
};

// SVG em texto (página pública). `fill` = tom suave do rosto.
export function faceSvg(score, { size = 40, soft = true } = {}) {
  const p = faceParts(score);
  if (!p) return "";
  return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true" focusable="false">`
    + `<circle cx="20" cy="20" r="17" fill="${soft ? p.color + "22" : "#fff"}" stroke="${p.color}" stroke-width="2.5"/>`
    + p.eyes.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.2" fill="${p.color}"/>`).join("")
    + `<path d="${p.mouth}" fill="none" stroke="${p.color}" stroke-width="2.6" stroke-linecap="round"/></svg>`;
}
