import React from "react";

// Aviso de versão nova do cockpit. O deploy troca o hash do bundle de entrada
// referenciado no index.html (servido com no-store), mas uma aba já aberta
// continua rodando o JS antigo até alguém recarregar — foi assim que um layout
// já corrigido "não aparecia" mesmo com o deploy certo no ar. Este watcher
// compara, a cada 5 min e ao voltar pra aba, o entry em execução com o do
// index atual do servidor; mudou, oferece recarregar. Em dev (entry sem hash)
// fica mudo.
export function UpdateNudge() {
  const [stale, setStale] = React.useState(false);
  const snoozed = React.useRef(false); // "depois" silencia até o fim da sessão
  React.useEffect(() => {
    const current = document.querySelector('script[src*="/assets/index-"]')?.getAttribute("src") || "";
    if (!current) return undefined;
    let alive = true;
    const check = async () => {
      if (snoozed.current) return;
      try {
        const html = await fetch("/", { cache: "no-store" }).then((r) => (r.ok ? r.text() : ""));
        const next = html.match(/\/assets\/index-[\w-]+\.js/)?.[0] || "";
        if (alive && next && next !== current) setStale(true);
      } catch { /* offline/instável: tenta no próximo tick */ }
    };
    const t0 = setTimeout(check, 20e3); // primeiro check fora do boot
    const id = setInterval(check, 5 * 60 * 1000);
    const onVis = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; clearTimeout(t0); clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, []);
  if (!stale) return null;
  return (
    <div style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: 18, zIndex: 260, display: "flex", alignItems: "center", gap: 12, padding: "10px 12px 10px 16px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-pop)", maxWidth: "min(92vw, 480px)" }}>
      <span style={{ fontSize: 13, color: "var(--fg-2)", lineHeight: 1.45 }}><b style={{ color: "var(--fg-1)" }}>Versão nova do cockpit no ar.</b> Recarregue pra usar as últimas mudanças.</span>
      <button onClick={() => window.location.reload()} style={{ flex: "0 0 auto", fontSize: 12.5, fontWeight: 600, padding: "7px 13px", borderRadius: 8, border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--accent-fg)", cursor: "pointer" }}>Atualizar</button>
      <button onClick={() => { snoozed.current = true; setStale(false); }} title="Lembrar depois" style={{ flex: "0 0 auto", fontSize: 12.5, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-3)", cursor: "pointer" }}>depois</button>
    </div>
  );
}
