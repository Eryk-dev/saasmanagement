import React from "react";

// Fronteira de erro: um crash de RENDER em qualquer filho vira um cartão de aviso
// (mensagem + ação) em vez de derrubar a árvore inteira (a "tela branca"). Sem
// isso, um ReferenceError num modal desmonta o app todo. React exige uma CLASSE
// pra capturar (getDerivedStateFromError/componentDidCatch).
//
// Props:
//  - resetKey: quando muda, limpa o erro sozinho (ex.: trocar de tela, fechar e
//    reabrir um modal com id diferente) pra não ficar preso no fallback.
//  - onReset: roda no botão de ação (ex.: fechar o modal). Se presente, o botão
//    vira "Fechar" e o clique no backdrop (variant modal) também fecha.
//  - variant: "modal" mostra como overlay central; padrão preenche o espaço.
//  - label: rótulo pro log (qual popup/tela quebrou).
//  - fallback(error, reset): render custom opcional.
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Loga e segue: o app continua vivo, dá pra investigar no console depois.
    console.error("[ErrorBoundary]", this.props.label || "", error, info?.componentStack); // eslint-disable-line no-console
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  reset = () => {
    this.setState({ error: null });
    this.props.onReset && this.props.onReset();
  };

  render() {
    if (!this.state.error) return this.props.children;
    if (typeof this.props.fallback === "function") return this.props.fallback(this.state.error, this.reset);

    const msg = String(this.state.error?.message || this.state.error || "erro inesperado");
    const card = (
      <div role="alert" style={{ border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "20px 22px", maxWidth: 440, textAlign: "center", boxShadow: "0 10px 34px rgba(0,0,0,0.20)" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--fg-1)", marginBottom: 6 }}>Algo quebrou aqui</div>
        <div className="mono dim" style={{ fontSize: 11.5, marginBottom: 14, wordBreak: "break-word", lineHeight: 1.5 }}>{msg}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button type="button" onClick={this.reset} style={{ height: 30, padding: "0 14px", borderRadius: "var(--r-2)", background: "var(--accent)", color: "var(--accent-fg)", fontSize: 12.5, fontWeight: 600 }}>
            {this.props.onReset ? "Fechar" : "Tentar de novo"}
          </button>
          <button type="button" onClick={() => location.reload()} style={{ height: 30, padding: "0 14px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg-2)", fontSize: 12.5 }}>
            Recarregar
          </button>
        </div>
      </div>
    );

    if (this.props.variant === "modal") {
      return (
        <div onClick={this.reset} style={{ position: "fixed", inset: 0, zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", background: "color-mix(in srgb, var(--bg-0) 68%, transparent)", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()}>{card}</div>
        </div>
      );
    }
    return <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>{card}</div>;
  }
}
