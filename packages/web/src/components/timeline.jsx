import React from "react";
import { Avatar } from "../atoms.jsx";
import { api, assetUrl } from "../lib/api.js";
import { displayName, currentUser } from "../lib/users.js";

// Timeline do lead: activities (pontos de contato + eventos automáticos) +
// comments[] legados mesclados visualmente como notas. Append-only na UI.
// Toque registrado aqui re-agenda o próximo passo sozinho (servidor,
// onActivityCreated) — registrar o contato É marcar o próximo.

const TYPE_META = {
  note:     { glyph: "✎", label: "nota" },
  whatsapp: { glyph: "W", label: "whatsapp" },
  call:     { glyph: "✆", label: "call" },
  email:    { glyph: "@", label: "e-mail" },
  meeting:  { glyph: "◈", label: "reunião" },
  stage:    { glyph: "→", label: "estágio" },
  system:   { glyph: "⚙", label: "sistema" },
};

const SYSTEM_TEXT = {
  meet_created: (m) => `Meet criado na agenda${(m.attendees || []).length ? ` · ${m.attendees.length} convidado(s)` : ""}`,
  lead_created: (m) => `Lead criado${m.via === "form" ? " pelo formulário" : ""}${m.stage ? ` em “${m.stage}”` : ""}`,
  proposal_viewed: (m) => `Proposta visualizada${m.viewer === "cliente" ? " pelo cliente" : m.viewer === "time" ? " (pelo time)" : " pela 1ª vez"}${m.device ? ` · ${m.device}` : ""}`,
  proposal_shared: (m) => `Proposta enviada pro cliente${m.label ? ` · ${m.label}` : ""}`,
  proposal_accepted: (m) => `Proposta aceita${m.stage ? ` → “${m.stage}”` : ""}`,
  customer_created: () => "Virou cliente 🎉",
};

function when(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  const hm = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (days === 0) return `hoje ${hm}`;
  if (days === 1) return `ontem ${hm}`;
  if (days < 7) return `${days}d atrás`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}

function itemText(a) {
  // Resumo de call e briefing de integração gerados pela IA: texto completo
  // multiline + link da gravação.
  if (a.type === "system" && (a.meta?.event === "call_summary" || a.meta?.event === "integration_brief")) {
    return (
      <div>
        <div style={{ whiteSpace: "pre-wrap", color: "var(--fg-1)" }}>{a.text}</div>
        {a.meta.recordingUrl && (
          <a href={a.meta.recordingUrl} target="_blank" rel="noopener noreferrer"
            style={{ color: "var(--accent)", fontSize: 11.5, display: "inline-block", marginTop: 6 }}>
            🎥 ver gravação no Drive
          </a>
        )}
      </div>
    );
  }
  if (a.type === "stage") {
    const from = a.meta?.from || "?";
    const to = a.meta?.to || "?";
    const lost = a.meta?.lostReason ? ` · motivo: ${a.meta.lostReason}` : "";
    return `${from} → ${to}${lost}`;
  }
  if (a.type === "system") {
    const f = SYSTEM_TEXT[a.meta?.event];
    return f ? f(a.meta || {}) : (a.text || a.meta?.event || "evento");
  }
  return a.text || TYPE_META[a.type]?.label || "";
}

// Mescla comments[] legados (shape { id, author, text, at }) como notas.
export function mergeTimeline(activities, comments) {
  const legacy = (Array.isArray(comments) ? comments : []).map((c) => ({
    id: `cm_${c.id}`, type: "note", text: c.text, author: c.author, at: c.at, _legacy: true,
  }));
  return [...(activities || []), ...legacy]
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
}

export function ActivityList({ activities, comments, compact }) {
  const items = mergeTimeline(activities, comments);
  if (!items.length) {
    return <div className="mono dim" style={{ fontSize: 11.5, padding: "10px 0" }}>nenhum contato registrado ainda</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {items.map((a) => {
        const meta = TYPE_META[a.type] || TYPE_META.note;
        const auto = a.type === "stage" || a.type === "system";
        return (
          <div key={a.id} style={{ display: "flex", gap: 9, padding: compact ? "5px 0" : "7px 0", borderBottom: "1px solid var(--line-1)", alignItems: "flex-start" }}>
            <span className="mono" title={meta.label} style={{
              width: 20, height: 20, borderRadius: 6, flexShrink: 0, marginTop: 1,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, background: auto ? "var(--bg-2)" : "var(--bg-3)",
              border: "1px solid var(--line-1)", color: auto ? "var(--fg-4)" : "var(--fg-2)",
            }}>{meta.glyph}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: compact ? 12 : 12.5, color: auto ? "var(--fg-3)" : "var(--fg-1)", overflowWrap: "break-word" }}>
                {itemText(a)}
              </div>
              {/* Print anexado ao toque: miniatura que abre o original em outra
                  aba (a rota é aberta, então o link funciona fora do cockpit). */}
              {a.meta?.photo && (
                <a href={assetUrl(a.meta.photo)} target="_blank" rel="noopener noreferrer" title="abrir a imagem"
                  style={{ display: "inline-block", marginTop: 6 }}>
                  <img src={assetUrl(a.meta.photo)} alt="anexo do contato" loading="lazy"
                    style={{ maxWidth: compact ? 130 : 200, maxHeight: compact ? 130 : 200, borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", display: "block" }} />
                </a>
              )}
              <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", marginTop: 2, display: "flex", alignItems: "center", gap: 5 }}>
                {when(a.at)}
                {a.author && a.author !== "system" && a.author !== "api" && a.author !== "lead" && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    · <Avatar id={a.author} name={displayName(a.author)} size={13} /> {displayName(a.author)}
                  </span>
                )}
                {a.author === "lead" && <span>· lead</span>}
                {a._legacy && <span title="comentário antigo (pré-timeline)">· comentário</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Composer: registra toque/nota + atalho de próximo contato. O atalho faz PATCH
// de nextActionAt junto — sem ele, toque re-agenda sozinho pela cadência.
const NEXT_PRESETS = [
  { key: "+1d", label: "+1d", ms: 86_400_000 },
  { key: "+2d", label: "+2d", ms: 2 * 86_400_000 },
  { key: "+1sem", label: "+1sem", ms: 7 * 86_400_000 },
];

// Print grande demais vira imagem de 1800px de lado (o servidor recusa acima de
// 5MB). Abaixo disso vai o arquivo ORIGINAL: recomprimir print de conversa só
// borraria o texto, que é justamente o que se quer ler depois.
const MAX_SIDE = 1800;
function shrinkImage(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.max(img.width, img.height);
      if (side <= MAX_SIDE && file.size <= 4 * 1024 * 1024) return resolve(file);
      const scale = Math.min(1, MAX_SIDE / side);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => resolve(b || file), "image/jpeg", 0.9);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

export function ActivityComposer({ lead, onLogged }) {
  const [type, setType] = React.useState("whatsapp");
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [photo, setPhoto] = React.useState(null); // { blob, preview, name }
  const [err, setErr] = React.useState("");
  const fileRef = React.useRef(null);

  // A foto só sobe no "registrar": escolher e desistir não deixa anexo órfão no
  // banco. Até lá o preview é um blob local.
  const attach = async (file) => {
    if (!file || !/^image\//.test(file.type || "")) return;
    setErr("");
    const blob = await shrinkImage(file);
    setPhoto((old) => {
      if (old?.preview) URL.revokeObjectURL(old.preview);
      return { blob, preview: URL.createObjectURL(blob), name: file.name || "print.png" };
    });
  };
  const dropPhoto = () => setPhoto((old) => { if (old?.preview) URL.revokeObjectURL(old.preview); return null; });
  React.useEffect(() => () => { if (photo?.preview) URL.revokeObjectURL(photo.preview); }, [photo?.preview]);

  async function log(nextMs) {
    if (busy) return;
    const t = text.trim();
    if (!t && !photo && type === "note") return; // nota vazia não existe
    setBusy(true); setErr("");
    try {
      let photoUrl = "";
      if (photo) photoUrl = (await api.activityAsset(photo.blob, photo.name)).url;
      const a = await api.logActivity({
        saas: lead.saas, lead: lead.id, type, text: t,
        author: currentUser()?.id || "",
        // preset de próximo contato vence o re-agendamento automático da cadência
        ...(nextMs || photoUrl ? { meta: { ...(nextMs ? { reschedule: false } : {}), ...(photoUrl ? { photo: photoUrl } : {}) } } : {}),
      });
      if (nextMs) {
        await api.update("leads", lead.id, { nextActionAt: new Date(Date.now() + nextMs).toISOString() });
      }
      setText(""); dropPhoto();
      onLogged && onLogged(a);
    } catch (e) {
      console.warn("activity não registrada:", e.message);
      setErr(e.message || "não deu pra registrar");
    } finally {
      setBusy(false);
    }
  }

  const seg = (k, label) => (
    <button key={k} onClick={() => setType(k)} style={{
      height: 24, padding: "0 9px", borderRadius: 4, fontSize: 11, fontFamily: "var(--mono)",
      background: type === k ? "var(--bg-3)" : "transparent",
      color: type === k ? "var(--fg-1)" : "var(--fg-3)",
      border: "1px solid " + (type === k ? "var(--line-2)" : "transparent"),
    }}>{label}</button>
  );

  return (
    <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-inset)", padding: 8 }}>
      <div style={{ display: "flex", gap: 2, marginBottom: 6, flexWrap: "wrap" }}>
        {seg("whatsapp", "wpp")}{seg("call", "call")}{seg("meeting", "reunião")}{seg("email", "e-mail")}{seg("note", "nota")}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) log(); }}
        // Print vem do Ctrl+V na maioria das vezes (recorte da conversa direto
        // da área de transferência), então colar anexa sem passar pelo seletor.
        onPaste={(e) => {
          const f = [...(e.clipboardData?.files || [])].find((x) => /^image\//.test(x.type));
          if (f) { e.preventDefault(); attach(f); }
        }}
        rows={2}
        placeholder={type === "note" ? "anotação… (cole um print pra anexar)" : "o que rolou nesse contato? (⌘↵ registra · cole um print pra anexar)"}
        style={{ width: "100%", padding: "7px 9px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 12.5, resize: "vertical" }}
      />
      {photo && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
          <img src={photo.preview} alt="anexo" style={{ width: 46, height: 46, objectFit: "cover", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)" }} />
          <span className="mono dim" style={{ fontSize: 10.5, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{photo.name}</span>
          <button onClick={dropPhoto} title="remover anexo" className="mono dim" style={{ fontSize: 10.5, textDecoration: "underline", textUnderlineOffset: 3 }}>remover</button>
        </div>
      )}
      {err && <div className="mono" style={{ fontSize: 10.5, color: "var(--neg)", marginTop: 6 }}>{err}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; attach(f); }} />
        <button onClick={() => fileRef.current?.click()} title="anexar uma foto/print ao contato"
          style={{ height: 22, padding: "0 8px", borderRadius: 4, fontSize: 10.5, fontFamily: "var(--mono)", background: photo ? "var(--accent-soft)" : "var(--bg-2)", border: "1px solid " + (photo ? "var(--accent-line, var(--accent))" : "var(--line-2)"), color: photo ? "var(--accent)" : "var(--fg-2)", cursor: "pointer" }}>
          {photo ? "1 foto" : "+ foto"}
        </button>
        <span className="mono" style={{ fontSize: 10, color: "var(--fg-4)" }}>registrar + próximo:</span>
        {NEXT_PRESETS.map((p) => (
          <button key={p.key} disabled={busy} onClick={() => log(p.ms)} title={`registra o ${TYPE_META[type].label} e marca o próximo contato pra ${p.label}`}
            style={{ height: 22, padding: "0 8px", borderRadius: 4, fontSize: 10.5, fontFamily: "var(--mono)", background: "var(--bg-2)", border: "1px solid var(--line-2)", color: "var(--fg-2)", cursor: "pointer" }}>
            {p.label}
          </button>
        ))}
        <button disabled={busy} onClick={() => log()} style={{
          marginLeft: "auto", height: 24, padding: "0 12px", borderRadius: 4, fontSize: 11.5, fontWeight: 600,
          background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg, #fff))", border: "none", cursor: "pointer", opacity: busy ? 0.6 : 1,
        }}>registrar</button>
      </div>
    </div>
  );
}
