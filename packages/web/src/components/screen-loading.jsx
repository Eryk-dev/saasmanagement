import React from "react";
import { activateNavigation, createNavigationLoad, trackChunk } from "../lib/navigation-loading.js";
import { ErrorBoundary } from "./error-boundary.jsx";
import "./screen-loading.css";

// Tela carregada sob demanda: o bundle deixou de ser um arquivo só de 2 MB com
// as 35 telas (17/09/2026) — cada tela vira um chunk que o navegador baixa na
// primeira visita. O download conta como leitura da navegação (trackChunk),
// então o splash segura até chunk + GETs iniciais da tela.
// Falha no download = quase sempre deploy no meio do caminho: o container novo
// não tem mais os chunks com hash antigo que esta aba conhece. Recarrega UMA vez
// (o index.html é no-store, então vem o shell novo); se falhar de novo, o erro
// sobe pro ErrorBoundary da tela como qualquer outro.
const CHUNK_RELOAD_KEY = "cockpit_chunk_reload";
export function lazyScreen(loader, exportName) {
  return React.lazy(() => trackChunk(loader()).then(
    (mod) => {
      try { sessionStorage.removeItem(CHUNK_RELOAD_KEY); } catch { /* sem storage */ }
      return { default: mod[exportName] };
    },
    (err) => {
      try {
        if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
          sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
          location.reload();
          return new Promise(() => {}); // a página vai embora; não renderiza erro no meio
        }
      } catch { /* sem storage: cai no erro */ }
      throw err;
    },
  ));
}

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
// The SSR smoke harness has a document stub, but no DOM to paint.
const useBeforePaint = typeof document !== "undefined" && document.createElement ? React.useLayoutEffect : React.useEffect;

export function LoadingSplash({ compact = false, fullscreen = false, leaving = false, slow = false, onContinue, actionLabel = "Exibir tela" }) {
  return <div className={`screen-splash${compact ? " screen-splash--compact" : ""}${fullscreen ? " screen-splash--fullscreen" : ""}${leaving ? " screen-splash--leaving" : ""}`}>
    <div role="status" aria-live="polite" aria-label={slow ? "O carregamento está demorando mais que o esperado" : "Carregando tela"}>
      <svg className="screen-splash__mark" width="64" height="70" viewBox="356 342 710 770" aria-hidden="true">
        <circle className="screen-splash__orbit" cx="719.19" cy="688.58" r="340" fill="none" strokeOpacity=".8" strokeWidth="9" strokeLinecap="round" strokeDasharray="300 1836.3" strokeDashoffset="0" />
        <path fill="var(--fg-1)" d="M519.22,843.75l-45.1,15.11c53.94,77.43,143.68,128.2,245.06,128.2,4.38,0,8.76-.08,13.07-.3l-14.13-45.02c-80.76-.3-152.75-38.68-198.9-97.98ZM719.19,390.03c-164.61,0-298.55,133.94-298.55,298.55,0,29.46,4.31,58.02,12.31,84.91l39.13-29.31c-4-17.9-6.12-36.49-6.12-55.6,0-139.6,113.62-253.22,253.22-253.22s253.15,113.62,253.15,253.22c0,99.49-57.71,185.84-141.42,227.16v49.63c109.39-44.27,186.74-151.69,186.74-276.79,0-164.61-133.86-298.55-298.47-298.55Z" />
        <polygon fill="var(--brand-mark)" points="800.7 535.53 800.7 1103.92 763 983.8 749.25 939.91 691.16 754.61 501.54 817.84 457.65 832.42 362.47 864.14 443.6 803.33 481.22 775.08 800.7 535.53" />
      </svg>
    </div>
    {slow && !leaving && <div className="screen-splash__slow">
      <p>O carregamento está demorando mais que o esperado.</p>
      <button type="button" onClick={onContinue}>{actionLabel}</button>
    </div>}
  </div>;
}

export function ScreenTransition({ navigationKey, overview, onReady, suppressSplash = false, children }) {
  const load = React.useMemo(() => createNavigationLoad({ minimumMs: reducedMotion() ? 0 : 180 }), [navigationKey]);
  const state = React.useSyncExternalStore(load.subscribe, load.getSnapshot, load.getSnapshot);
  const [dismissed, setDismissed] = React.useState(null);
  const readyCallback = React.useRef(onReady);
  readyCallback.current = onReady;
  // Layout runs before the children's passive effects start their requests.
  useBeforePaint(() => activateNavigation(load), [load]);
  React.useEffect(() => {
    if (!state.ready) return;
    readyCallback.current?.();
    // Mesmo ritmo em toda tela (17/09: a Visão geral tinha 650 ms de mínimo e
    // 450 ms de saída, ~0,7 s a mais por abertura além do tempo real).
    const timer = setTimeout(() => setDismissed(load), reducedMotion() ? 0 : 180);
    return () => clearTimeout(timer);
  }, [load, state.ready]);
  return <div className="screen-transition" aria-busy={!state.ready}>
    <div className="screen-transition__content" data-ready={state.ready} aria-hidden={!state.ready ? true : undefined} inert={!state.ready ? "" : undefined}>
      {children}
    </div>
    {!suppressSplash && dismissed !== load && <LoadingSplash compact={!overview} leaving={state.ready} slow={state.slow} onContinue={load.reveal} />}
  </div>;
}

// Keep one splash mounted from bootstrap through the first screen's queries.
// loadApp resolves with SEED already in place (main.jsx espera o bootstrap e o
// chunk do app juntos): nenhum módulo pode ler window.SEED em escopo de módulo,
// só dentro de função/componente — o app.jsx agora é avaliado em paralelo.
export function AppStartup({ loadApp, renderError }) {
  const [App, setApp] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [ready, setReady] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);
  const [slow, setSlow] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => { if (alive) setSlow(true); }, 12000);
    Promise.resolve().then(loadApp).then((Component) => {
      if (alive) setApp(() => Component);
    }).catch((err) => { if (alive) setError(err); });
    return () => { alive = false; clearTimeout(timer); };
  }, [loadApp]);
  React.useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => setDismissed(true), reducedMotion() ? 0 : 450);
    return () => clearTimeout(timer);
  }, [ready]);
  if (error) return renderError(error);
  return <ErrorBoundary label="app" fallback={renderError}>
    {App && <div aria-hidden={!ready ? true : undefined} inert={!ready ? "" : undefined}>
      <App onInitialReady={() => setReady(true)} initialLoading={!dismissed} />
    </div>}
    {!dismissed && <LoadingSplash fullscreen leaving={ready} slow={slow} onContinue={() => location.reload()} actionLabel="Tentar novamente" />}
  </ErrorBoundary>;
}
