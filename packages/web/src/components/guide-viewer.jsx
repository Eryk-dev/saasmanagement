// Leitor de guia (03/11/2026): um passo por vez, com o texto, a dica e os
// prints grandes. Abre da tela Guias e do card da Integração ("como fazer →"
// no item do checklist, já no passo certo), sempre por cima da tela onde se
// está. O texto do passo é o markdown simples dos tickets (LinearMarkdown:
// nada entra por innerHTML).

import React from "react";
import { createPortal } from "react-dom";
import "./guide-viewer.css";
import { api } from "../lib/api.js";
import { Modal } from "./overlay.jsx";
import { LinearMarkdown } from "../screens/tickets/linear-markdown.jsx";

const { useState, useEffect } = React;

export const AUDIENCE_LABEL = { integrador: "Integração", cs: "CS", suporte: "Suporte" };
export const PRODUCT_LABEL = { leverads: "LeverAds", leverprice: "LeverPrice" };

// Print do guia: a rota exige sessão, então baixa em blob (cache por sessão).
export function GuideImage({ id, caption, onOpen }) {
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setSrc(""); setError("");
    api.guideAssetUrl(id).then((u) => alive && setSrc(u)).catch((e) => alive && setError(e.message || "não carregou"));
    return () => { alive = false; };
  }, [id]);
  return <figure className="guide-figure">
    {src
      ? <button type="button" className="guide-figure-img" onClick={() => onOpen?.(src, caption)} title="ver o print inteiro"><img src={src} alt={caption || "print da tela"} /></button>
      : <div className="guide-figure-wait" role={error ? "alert" : "status"}>{error ? `print não carregou · ${error}` : "carregando print…"}</div>}
    {caption && <figcaption>{caption}</figcaption>}
  </figure>;
}

export function GuideStep({ step, index, total }) {
  const [zoom, setZoom] = useState(null);
  return <article className="guide-step" aria-label={`Passo ${index + 1}: ${step.title}`}>
    <div className="guide-step-kicker">passo {index + 1} de {total}</div>
    <h3>{step.title}</h3>
    {step.body ? <div className="guide-step-body"><LinearMarkdown text={step.body} /></div> : null}
    {(step.images || []).length > 0 && <div className="guide-figures">
      {step.images.map((im) => <GuideImage key={im.id} id={im.id} caption={im.caption} onOpen={(src, cap) => setZoom({ src, cap })} />)}
    </div>}
    {step.tip ? <p className="guide-tip"><b>dica</b>{step.tip}</p> : null}
    {zoom && createPortal(<Modal onClose={() => setZoom(null)} label={zoom.cap || "Print"} largura={1400} padding={12}>
      <img src={zoom.src} alt={zoom.cap || "print da tela"} style={{ display: "block", width: "100%", height: "auto", borderRadius: "var(--r-4)" }} />
      {zoom.cap && <p style={{ margin: 0, padding: "10px 16px", fontSize: 12.5, color: "var(--fg-3)" }}>{zoom.cap}</p>}
    </Modal>, document.body)}
  </article>;
}

// O guia inteiro: passos à esquerda (no celular, em linha), o passo à direita.
// `next` ({ title, onOpen }): o próximo guia da trilha, oferecido no último passo.
export function GuideViewer({ guideId, guide: given = null, stepId = "", onClose, onEdit, next = null }) {
  const [guide, setGuide] = useState(given);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (given) { setGuide(given); return undefined; }
    let alive = true;
    setError("");
    api.guide(guideId).then((g) => alive && setGuide(g)).catch((e) => alive && setError(e.message || "não foi possível abrir o guia"));
    return () => { alive = false; };
  }, [guideId, given, attempt]);
  useEffect(() => {
    if (!guide) return;
    const i = (guide.steps || []).findIndex((s) => s.id === stepId);
    setIndex(i >= 0 ? i : 0);
  }, [guide?.id, stepId]); // eslint-disable-line react-hooks/exhaustive-deps

  const steps = guide?.steps || [];
  const step = steps[index];
  return createPortal(<Modal onClose={onClose} label={guide ? `Guia · ${guide.title}` : "Guia"} largura={1080} painelStyle={{ overflow: "hidden", display: "flex", flexDirection: "column", height: "min(860px, calc(100dvh - 32px))" }}>
    <header className="guide-viewer-head">
      <div style={{ minWidth: 0 }}>
        <h2>{guide?.title || "Guia"}</h2>
        {guide && <p>{[AUDIENCE_LABEL[guide.audience], PRODUCT_LABEL[guide.product], guide.status === "rascunho" ? "rascunho" : ""].filter(Boolean).join(" · ")}</p>}
      </div>
      {onEdit && guide && <button type="button" className="guide-btn" onClick={() => onEdit(guide)}>Editar</button>}
      <button type="button" className="guide-close" aria-label="Fechar guia" onClick={onClose}>✕</button>
    </header>
    {!guide
      ? <div className="guide-viewer-wait" role={error ? "alert" : "status"}>
          {error || "carregando o guia…"}
          {error && <button type="button" onClick={() => setAttempt((n) => n + 1)}>tentar de novo</button>}
        </div>
      : <div className="guide-viewer-body">
          <nav className="guide-viewer-nav" aria-label="Passos do guia">
            {guide.summary && <p className="guide-viewer-summary">{guide.summary}</p>}
            <ol>
              {steps.map((s, i) => <li key={s.id}>
                <button type="button" aria-current={i === index ? "step" : undefined} onClick={() => setIndex(i)}>
                  <span className="tnum">{i + 1}</span>{s.title}
                </button>
              </li>)}
            </ol>
          </nav>
          <div className="guide-viewer-main">
            {step ? <GuideStep key={step.id} step={step} index={index} total={steps.length} /> : <p className="guide-viewer-wait">Este guia ainda não tem passos.</p>}
            {(steps.length > 1 || next) && <footer className="guide-viewer-foot">
              <button type="button" className="guide-btn" disabled={index === 0} onClick={() => setIndex(index - 1)}>‹ anterior</button>
              {index < steps.length - 1 || !next
                ? <button type="button" className="guide-btn guide-btn-primary" disabled={index >= steps.length - 1} onClick={() => setIndex(index + 1)}>próximo ›</button>
                : <button type="button" className="guide-btn guide-btn-primary guide-next-guide" onClick={next.onOpen}>próximo guia: {next.title} ›</button>}
            </footer>}
          </div>
        </div>}
  </Modal>, document.body);
}
