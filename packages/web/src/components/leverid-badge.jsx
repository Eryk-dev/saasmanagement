import React from "react";
import { Popover } from "./popover.jsx";
import { Icon } from "../screens/tasks/icons.jsx";
import "./leverid-badge.css";
// Badge de LeverId ao lado do nome do cliente: só o favicon da Lever, quando a
// org do cliente já tem conta na identidade central (apagado se a org estiver
// suspensa ou apagada). O nome, a
// contagem e as contas ficam no popover (e no title/aria-label do botão). Passar o mouse abre o resumo; clicar fixa
// (fecha no Esc, no clique fora ou clicando de novo). Dentro de linha clicável
// o clique não chega na linha.
//
// `org` = { name, status, accounts: [{ email, role, lastSignInAt, createdAt,
// emailConfirmed, mfa, source }] } (GET /api/customers/leverid).

const { useEffect, useRef, useState } = React;

// Marca da Lever (o mesmo desenho do public/favicon.svg): o anel segue o texto
// do tema (some no escuro se ficasse navy) e a seta fica no ciano da marca.
function LeverMark({ size = 12 }) {
  return (
    <svg className="leverid-mark" viewBox="318.84 375.75 742.45 742.45" width={size} height={size} aria-hidden="true" focusable="false">
      <path className="leverid-mark-ring" d="M519.22,843.75l-45.1,15.11c53.94,77.43,143.68,128.2,245.06,128.2,4.38,0,8.76-.08,13.07-.3l-14.13-45.02c-80.76-.3-152.75-38.68-198.9-97.98ZM719.19,390.03c-164.61,0-298.55,133.94-298.55,298.55,0,29.46,4.31,58.02,12.31,84.91l39.13-29.31c-4-17.9-6.12-36.49-6.12-55.6,0-139.6,113.62-253.22,253.22-253.22s253.15,113.62,253.15,253.22c0,99.49-57.71,185.84-141.42,227.16v49.63c109.39-44.27,186.74-151.69,186.74-276.79,0-164.61-133.86-298.55-298.47-298.55Z" />
      <polygon fill="#23D8D3" points="800.7 535.53 800.7 1103.92 763 983.8 749.25 939.91 691.16 754.61 501.54 817.84 457.65 832.42 362.47 864.14 443.6 803.33 481.22 775.08 800.7 535.53" />
    </svg>
  );
}

const ROLE = { owner: "dono", admin: "admin", member: "membro" };
const STATUS = { suspended: "org suspensa", deleted: "org apagada" };

function lastAccess(iso) {
  if (!iso) return "ainda não entrou pelo LeverId";
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "entrou hoje";
  if (days === 1) return "entrou ontem";
  if (days < 60) return `entrou há ${days} dias`;
  return `entrou em ${d.toLocaleDateString("pt-BR")}`;
}

function copy(text) {
  try { navigator.clipboard.writeText(text); window.toast?.("Copiado.", "pos"); } catch { /* sem clipboard */ }
}

export function LeverIdBadge({ org, orgId }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(null); // null | "hover" | "pin"
  const closeTimer = useRef(null);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  if (!org || !org.accounts?.length) return null;

  const accounts = org.accounts;
  const mfa = accounts.filter((a) => a.mfa).length;
  const warn = STATUS[org.status];
  const hoverIn = () => { clearTimeout(closeTimer.current); setOpen((o) => o || "hover"); };
  const hoverOut = () => { clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setOpen((o) => (o === "hover" ? null : o)), 180); };
  const toggle = (e) => { e.stopPropagation(); setOpen((o) => (o === "pin" ? null : "pin")); };
  const label = `LeverId: ${accounts.length} ${accounts.length === 1 ? "conta" : "contas"}${warn ? ` · ${warn}` : ""}`;

  return (
    <>
      <button ref={ref} type="button" className="leverid-badge" data-off={warn ? "1" : undefined} title={label}
        aria-label={label} aria-expanded={!!open} aria-haspopup="dialog"
        onClick={toggle} onKeyDown={(e) => e.stopPropagation()} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
        <LeverMark size={16} />
      </button>
      {open && (
        <Popover anchor={ref} onClose={() => setOpen(null)} width={340} label={label}>
          <div className="leverid-pop" onMouseEnter={hoverIn} onMouseLeave={hoverOut} onClick={(e) => e.stopPropagation()}>
            <header>
              <div>
                <span className="kicker leverid-pop-kicker"><LeverMark size={12} />LeverId</span>
                <strong>{org.name || "org"}</strong>
              </div>
              <span className={`chip ${warn ? "warn" : "pos"}`}>{warn || "org ativa"}</span>
            </header>
            <p className="leverid-pop-sum">
              {accounts.length} {accounts.length === 1 ? "conta" : "contas"} · {mfa ? `${mfa} com 2FA` : "nenhuma com 2FA"}
            </p>
            <ul>
              {accounts.map((a) => (
                <li key={a.id || a.email}>
                  <div className="leverid-pop-who">
                    <span title={a.email}>{a.email}</span>
                    <small>{ROLE[a.role] || a.role}{a.mfa ? " · 2FA" : ""}{a.emailConfirmed ? "" : " · e-mail não confirmado"}</small>
                  </div>
                  <small className="leverid-pop-when" title={a.lastSignInAt ? new Date(a.lastSignInAt).toLocaleString("pt-BR") : undefined}>{lastAccess(a.lastSignInAt)}</small>
                </li>
              ))}
            </ul>
            {orgId && (
              <footer>
                <span title={orgId}>org {orgId.slice(0, 8)}…</span>
                <button type="button" onClick={() => copy(orgId)} aria-label="Copiar id da org"><Icon name="copy" size={12} /> copiar id</button>
              </footer>
            )}
          </div>
        </Popover>
      )}
    </>
  );
}
