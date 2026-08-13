import React from "react";
import { Card } from "../components/viz.jsx";

// Manual de marca do Elo — embutido no Canvas do workspace Elo, abaixo das
// abas de criação: quem monta o criativo tem a referência da marca na mesma
// tela. Tudo que alguém precisa pra produzir um post, um anúncio ou uma página
// SEM desviar da marca: logo e usos, paleta, tipografia, voz e assets.
// Fontes reais da marca (Playfair Display + DM Sans) carregam do Google Fonts
// só quando a seção monta — o resto do cockpit segue com as fontes dele.

const { useEffect } = React;

const GOLD_GRAD = "linear-gradient(135deg, #d7914b, #e3bd90)";

// Paleta oficial (mesmos tokens do app e da LP).
const PALETTE = [
  { hex: "#0c0a08", name: "Preto Elo", use: "fundo principal (LP, materiais dark)" },
  { hex: "#1a1610", name: "Fundo secundário", use: "cards e superfícies sobre o preto" },
  { hex: "#d7914b", name: "Ouro base", use: "início do gradiente do logo" },
  { hex: "#e3bd90", name: "Ouro claro", use: "fim do gradiente do logo" },
  { hex: "#e8a84a", name: "Gold médio", use: "acentos e destaques de texto" },
  { hex: "#f0c060", name: "Gold brilhante", use: "CTAs e highlights" },
  { hex: "#c47a58", name: "Rose", use: "acento quente (categoria Ação)" },
];

const VOICE_DO = [
  "Direto e intencional — fala com quem AGE pelo relacionamento",
  "Masculino sem ser tóxico: convida, não cobra",
  "Concreto: \"uma missão por dia\", \"cada um responde sozinho\"",
  "Emocional com pé no chão — memória, hábito, história do casal",
  "Usar \"premiação\" (nunca \"sorteio\" — regulação SECAP)",
];
const VOICE_DONT = [
  "Clichê de terapia de casal (\"reacenda a chama\")",
  "Tom de autoajuda ou de ultimato (\"salve seu casamento\")",
  "Genérico de app (\"a melhor experiência\", \"revolucione\")",
  "Diminutivo e voz infantilizada (\"amorzinho\", \"joguinho\")",
  "Prometer resultado clínico — o Elo é hábito, não terapia",
];

const COPY_SAMPLES = [
  { label: "Tagline oficial", text: "Cada dia um elo a mais na história de vocês." },
  { label: "Tese da LP (problema)", text: "Você quer ser presente. Só falta um caminho claro." },
  { label: "CTA final da LP", text: "Seja o cara que não espera dar errado pra agir." },
  { label: "Mecânica em uma frase", text: "Uma missão por dia. Dois respondem sozinhos. A revelação é junta." },
];

function Swatch({ hex, name, use }) {
  const light = ["#e3bd90", "#f0c060", "#e8a84a"].includes(hex);
  return (
    <div style={{ borderRadius: "var(--r-3)", overflow: "hidden", border: "1px solid var(--line-1)", minWidth: 0 }}>
      <div style={{ height: 64, background: hex, display: "flex", alignItems: "flex-end", padding: 8 }}>
        <span className="mono" style={{ fontSize: 10.5, color: light ? "#0c0a08" : "#e3bd90" }}>{hex}</span>
      </div>
      <div style={{ padding: "8px 10px", background: "var(--bg-1)" }}>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{name}</div>
        <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 1 }}>{use}</div>
      </div>
    </div>
  );
}

function Rule({ ok, children }) {
  return (
    <li style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.5 }}>
      <span style={{ color: ok ? "var(--pos)" : "var(--neg)", fontWeight: 700, flexShrink: 0 }}>{ok ? "✓" : "✗"}</span>
      <span>{children}</span>
    </li>
  );
}

function EloBrandManual() {
  // Fontes da marca (uma vez por sessão; o link fica no <head> depois que carrega).
  useEffect(() => {
    const id = "elo-brand-fonts";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;800&family=DM+Sans:wght@400;500;600&display=swap";
    document.head.appendChild(link);
  }, []);

  const display = "'Playfair Display', serif";
  const body = "'DM Sans', sans-serif";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 12 }}>
        <h2 style={{ margin: 0, fontFamily: "var(--display)", fontSize: 19, fontWeight: 700, letterSpacing: "-0.01em" }}>Manual de marca</h2>
        <span style={{ fontSize: 12.5, color: "var(--fg-4)" }}>a referência pra qualquer material — post, anúncio, página, box</span>
      </div>

        {/* Logo sobre o fundo oficial */}
        <Card title="Logo" hint="versão principal: ouro sobre preto Elo">
          <div style={{ padding: "14px var(--inset-x) 18px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            <div style={{ background: "#0c0a08", borderRadius: "var(--r-3)", padding: "36px 24px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <img src="/brand/elo/elo-logo-color.svg" alt="Logo Elo" style={{ maxWidth: 240, width: "100%" }} />
            </div>
            <div style={{ background: "#0c0a08", borderRadius: "var(--r-3)", padding: "36px 24px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <img src="/brand/elo/elo-icon-color.svg" alt="Ícone Elo (elos entrelaçados)" style={{ maxWidth: 130, width: "100%" }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, justifyContent: "center" }}>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                <Rule ok>Fundo preferencial: preto Elo <span className="mono">#0c0a08</span> (ou foto bem escura)</Rule>
                <Rule ok>Respiro mínimo em volta: a altura do "o" do wordmark</Rule>
                <Rule ok>Tamanho mínimo: 24px de altura (ícone), 80px de largura (wordmark)</Rule>
                <Rule ok={false}>Não recolorir, esticar, rotacionar nem aplicar sombra</Rule>
                <Rule ok={false}>Não usar sobre fundo claro sem versão própria — o gradiente ouro some</Rule>
              </ul>
            </div>
          </div>
        </Card>

        {/* Paleta */}
        <Card title="Paleta" hint="dark theme com acentos quentes — ouro é a cor da marca, rose é apoio">
          <div style={{ padding: "14px var(--inset-x) 18px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
              {PALETTE.map((c) => <Swatch key={c.hex} {...c} />)}
            </div>
            <div style={{ marginTop: 12, borderRadius: "var(--r-3)", overflow: "hidden", border: "1px solid var(--line-1)" }}>
              <div style={{ height: 44, background: GOLD_GRAD, display: "flex", alignItems: "center", padding: "0 14px" }}>
                <span className="mono" style={{ fontSize: 11, color: "#0c0a08", fontWeight: 600 }}>gradiente do logo · 135° · #d7914b → #e3bd90</span>
              </div>
            </div>
          </div>
        </Card>

        {/* Tipografia */}
        <Card title="Tipografia" hint="Playfair Display pra títulos · DM Sans pra texto — as mesmas do app e da LP">
          <div style={{ padding: "14px var(--inset-x) 18px", display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ background: "#0c0a08", borderRadius: "var(--r-3)", padding: "24px 26px" }}>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 30, lineHeight: 1.2, backgroundImage: GOLD_GRAD, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
                Cada dia um elo a mais na história de vocês.
              </div>
              <div style={{ fontFamily: body, fontSize: 14.5, color: "#cbbfae", marginTop: 10, lineHeight: 1.6, maxWidth: 560 }}>
                Todo dia, uma missão nova pros dois. Cada um responde sozinho, sem ver o outro —
                e a revelação é o momento do casal. DM Sans no corpo, sempre com respiro.
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, fontSize: 12.5, color: "var(--fg-2)" }}>
              <div>
                <div className="kicker" style={{ marginBottom: 4 }}>Display · títulos</div>
                <div style={{ fontFamily: display, fontSize: 19, fontWeight: 700 }}>Playfair Display</div>
                <div style={{ color: "var(--fg-3)", marginTop: 3 }}>Bold/SemiBold · headlines, números-herói, capa. Nunca em texto corrido.</div>
              </div>
              <div>
                <div className="kicker" style={{ marginBottom: 4 }}>Body · interface e texto</div>
                <div style={{ fontFamily: body, fontSize: 17, fontWeight: 500 }}>DM Sans</div>
                <div style={{ color: "var(--fg-3)", marginTop: 3 }}>Regular/Medium · parágrafos, botões, legendas. Gradiente ouro só em destaque de título.</div>
              </div>
            </div>
          </div>
        </Card>

        {/* Voz */}
        <Card title="Voz e tom" hint='tese: "o cara que investe no relacionamento" — quem baixa e convida é ele'>
          <div style={{ padding: "14px var(--inset-x) 18px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
            <div>
              <div className="kicker" style={{ marginBottom: 8 }}>A marca é</div>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                {VOICE_DO.map((v) => <Rule key={v} ok>{v}</Rule>)}
              </ul>
            </div>
            <div>
              <div className="kicker" style={{ marginBottom: 8 }}>A marca nunca é</div>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                {VOICE_DONT.map((v) => <Rule key={v} ok={false}>{v}</Rule>)}
              </ul>
            </div>
            <div style={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
              {COPY_SAMPLES.map((c) => (
                <div key={c.label} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", padding: "10px 14px", background: "var(--bg-inset)" }}>
                  <div className="kicker">{c.label}</div>
                  <div style={{ fontFamily: display, fontSize: 14.5, fontWeight: 600, marginTop: 4, lineHeight: 1.4 }}>{c.text}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Aplicação + assets */}
        <Card title="Aplicações e assets" hint="onde estão os arquivos-fonte da marca">
          <div style={{ padding: "14px var(--inset-x) 18px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
            <div style={{ borderRadius: "var(--r-3)", overflow: "hidden", border: "1px solid var(--line-1)" }}>
              <img src="/brand/elo/og-image.png" alt="OG image oficial da LP (1200×630)" style={{ display: "block", width: "100%" }} />
              <div style={{ padding: "8px 12px", fontSize: 11.5, color: "var(--fg-3)", background: "var(--bg-1)" }}>og-image oficial (1200×630) — preview de link da LP</div>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.7 }}>
              <div className="kicker" style={{ marginBottom: 6 }}>Arquivos-fonte (repo eloapp)</div>
              <div><span className="mono">tools/brand/</span> — logo e ícone ouro-sobre-preto (SVG + PNG 512/1024/2048), og-image</div>
              <div><span className="mono">public/elo-*.svg</span> — logo, ícone e wordmark (color e white)</div>
              <div><span className="mono">tools/video-overlays/</span> — gerador de cards pra vídeo UGC (5 templates)</div>
              <div><span className="mono">landing-page/</span> — LP de venda (referência de aplicação completa)</div>
              <div style={{ marginTop: 8, color: "var(--fg-3)" }}>
                Contatos oficiais: <span className="mono">suporte@appelo.com.br</span> · domínio <span className="mono">appelo.com.br</span> · app "Elo — Missões para Casais".
              </div>
            </div>
          </div>
        </Card>

    </div>
  );
}

export { EloBrandManual };
