import React from "react";
// Breakpoint único do app: <= 768px = mobile. As telas usam o hook pra decidir
// layout estrutural (drawer, nav horizontal); o resto é CSS em tokens.css.

const QUERY = "(max-width: 768px)";

export function useIsMobile() {
  const [mobile, setMobile] = React.useState(() =>
    typeof window !== "undefined" && window.matchMedia(QUERY).matches
  );
  React.useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = (e) => setMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return mobile;
}
