// Widget do Cloudflare Turnstile para os formulários do LeverId. Sem
// VITE_TURNSTILE_SITE_KEY não renderiza nada. Para um token novo (cada um vale
// uma tentativa), quem usa troca a `key` do componente.
import React from "react";
import { renderTurnstile, turnstileEnabled } from "../lib/turnstile.js";

export default function Turnstile({ onToken, action = "login" }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!ref.current || !turnstileEnabled()) return undefined;
    return renderTurnstile(ref.current, onToken, action);
  }, [onToken, action]);
  if (!turnstileEnabled()) return null;
  return <div ref={ref} data-testid="turnstile" style={{ minHeight: 65, display: "flex", justifyContent: "center" }} />;
}
