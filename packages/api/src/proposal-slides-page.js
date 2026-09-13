// Apresentação em SLIDES (opção C) — página pública /p/:id no formato de deck
// 16:9, portada do arquivo que o Leo trouxe em 12/09/2026
// (Lever-Apresentacao-Slides-standalone.html).
//
// O que muda em relação ao deck de sempre (proposal-page.js): lá a apresentação
// é uma PÁGINA que rola, com trava magnética, e o closer edita campo a campo.
// Aqui é um PALCO de 1920×1080 escalado pra tela, um slide por vez, e o jeito de
// editar é OUTRO: uma tela zero ("Configurar") onde o closer monta o plano em
// toggles e todos os números do deck saem dali. Nenhum número é escrito no
// texto do slide.
//
// A conta do plano é a MESMA no servidor e na tela zero: calcOferta() é uma
// função só, injetada no script da página por toString(). Os preços vêm do
// catálogo v2 (proposal-catalog.js / migrations.ensureProposalCatalog), nunca
// escritos aqui: Lever Ads e Lever OEM × Essencial/Escala, Lever Price ×
// Essencial/Escala/Enterprise, pacote de OEM avulso e conta extra.
//
// Funcionalidades preservadas do original: escala pra caber na tela, navegação
// por teclado (setas, PgUp/PgDn, espaço, Home/End, número, R), toque nas metades
// da tela, contador que some sozinho, impressão com um slide por página e as
// notas do apresentador (aqui atrás do N, só no modo closer). Do cockpit:
// contagem de views (na rota), aceite do cliente e o estado salvo pelo editKey.
//
// REGRA DO ARQUIVO (igual ao proposal-page.js): o HTML é UM template literal —
// nada de crase dentro dele nem do script do cliente, que usa concatenação.

const DECK_CSS = `
/* Lever Premium Design — cores
   Regra de ouro: no máximo UMA cor forte por linha de UI.
   Status = ponto 6px + palavra. Marketplace = dot 8px + nome (nunca pílula de fundo). */

:root {
  /* Superfícies */
  --paper: #F7F8FA;         /* fundo de página */
  --paper-card: #FFFFFF;    /* cards */
  --paper-tinted: #EEF1F3;  /* trilhos, pílulas neutras, hovers de filtro */
  --paper-subtle: #FBFCFD;  /* campos, sub-cards, hover de linha */

  /* Tinta */
  --ink: #0C1D2B;           /* texto principal, botão primário, navy */
  --ink-soft: #3D4F5C;      /* texto de botões outline, chips */
  --ink-muted: #5A6B77;     /* texto secundário, subtítulos */
  --ink-faint: #8B99A4;     /* meta, rótulos de seção, placeholders fortes */
  --ink-disabled: #98A5AF;  /* placeholder, texto desabilitado */

  /* Linhas */
  --line: #E4E8EB;          /* bordas padrão */
  --line-strong: #CBD4DA;   /* borda hover, dashed */
  --line-faint: #EEF1F3;    /* divisórias internas de tabela */

  /* Marca (teal) */
  --brand: #0F766E;
  --brand-deep: #0B5D57;
  --brand-soft: #E9F5F3;

  /* Semânticas */
  --success: #177A4C;
  --warning: #A16207;
  --warning-soft: #FBF4E6;
  --info: #175CD3;
  --info-soft: #EDF3FC;
  --danger: #B42318;
  --danger-soft: #FDF3F2;

  /* Marketplaces — apenas dots de 8px */
  --ml-yellow: #EBC800;
  --shopee-orange: #EE4D2D;

  /* Controles */
  --control-disabled-bg: #F1F3F5;
  --control-disabled-text: #98A5AF;
  --toggle-off: #D6DDE2;

  /* Botão primário (navy, sem glow) */
  --btn-primary-bg: var(--ink);
  --btn-primary-bg-hover: #1B3140;
  --btn-primary-text: #FFFFFF;

  /* Aliases semânticos */
  --surface-page: var(--paper);
  --surface-card: var(--paper-card);
  --surface-hover: var(--paper-subtle);
  --text-body: var(--ink);
  --text-secondary: var(--ink-muted);
  --text-tertiary: var(--ink-faint);
  --link: var(--brand);
  --focus-ring: var(--ink);
}

/* Tema escuro — aplicar data-theme="dark" no html/body ou num contêiner */
[data-theme="dark"] {
  --paper: #0B141D;
  --paper-card: #101E29;
  --paper-tinted: #1D2B36;
  --paper-subtle: #0B141D;

  --ink: #EDF2F5;
  --ink-soft: #B9C7D1;
  --ink-muted: #8CA0AD;
  --ink-faint: #5E7280;
  --ink-disabled: #4C5E6B;

  --line: #1D2B36;
  --line-strong: #263643;
  --line-faint: #1D2B36;

  --brand: #3ECCBF;
  --brand-deep: #5BD9CE;
  --brand-soft: rgba(62, 204, 191, 0.1);

  --success: #4FBE84;
  --warning: #D6A249;
  --warning-soft: rgba(214, 162, 73, 0.12);
  --info: #7EA9E8;
  --info-soft: rgba(126, 169, 232, 0.12);
  --danger: #E2695A;
  --danger-soft: rgba(226, 105, 90, 0.12);

  --control-disabled-bg: #1D2B36;
  --control-disabled-text: #5E7280;
  --toggle-off: #263643;

  /* Botão primário vira claro-sobre-escuro */
  --btn-primary-bg: #EDF2F5;
  --btn-primary-bg-hover: #FFFFFF;
  --btn-primary-text: #0C1D2B;

  --surface-hover: #13212C;
  --focus-ring: #EDF2F5;
}

/* Lever Premium Design — espaçamento, raios, sombras, movimento */
:root {
  /* Raios */
  --radius-card: 12px;    /* cards de nível de página */
  --radius-inner: 10px;   /* cards internos, campos, barras */
  --radius-control: 8px;  /* botões, inputs, filtros */
  --radius-segment: 9px;  /* trilho de segmented control */
  --radius-badge: 5px;    /* badges retangulares */
  --radius-pill: 999px;   /* chips, contadores, toggles */

  /* Sombras (sutis; nunca glow) */
  --shadow-card: 0 1px 2px rgba(16, 24, 40, 0.03);
  --shadow-btn: 0 1px 2px rgba(16, 24, 40, 0.1);
  --shadow-segment: 0 1px 2px rgba(16, 24, 40, 0.08);
  --shadow-knob: 0 1px 2px rgba(16, 24, 40, 0.15);

  /* Espaçamento */
  --space-card: 28px;               /* padding de card */
  --space-card-y: 20px;             /* linhas de tabela/preferência: 20px 24px */
  --space-page: 40px 32px 64px;     /* padding da coluna central */
  --page-max: 1000px;               /* largura padrão */
  --page-max-narrow: 860px;         /* fila de leitura (Perguntas) */

  /* Topbar */
  --topbar-height: 58px;
  --topbar-pad-x: 28px;

  /* Movimento — sem transform, sem glow */
  --transition-ui: background 0.12s, border-color 0.12s, color 0.12s; /* @kind other */
}

/* Foco visível padrão */
:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }

/* Lever Premium Design — tipografia */
/* latin-ext */
/* latin */
/* latin-ext */
/* latin */
/* latin-ext */
/* latin */
/* latin-ext */
/* latin */
/* cyrillic-ext */
/* cyrillic */
/* greek */
/* vietnamese */
/* latin-ext */
/* latin */
/* cyrillic-ext */
/* cyrillic */
/* greek */
/* vietnamese */
/* latin-ext */
/* latin */
/* cyrillic-ext */
/* cyrillic */
/* greek */
/* vietnamese */
/* latin-ext */
/* latin */
:root {
  /* Famílias */
  --font-sans: 'Instrument Sans', -apple-system, 'Segoe UI', sans-serif; /* toda a UI */
  --font-mono: 'JetBrains Mono', monospace; /* só IDs, SKU, código, números de passo */

  /* Escala (nunca abaixo de 11px) */
  --text-badge: 11px;       /* badges */
  --text-meta: 12.5px;      /* meta, timestamps */
  --text-dense: 13px;       /* corpo denso, botões pequenos, chips */
  --text-control: 13.5px;   /* nav, botões, IDs mono */
  --text-body: 14px;        /* corpo */
  --text-body-lg: 14.5px;   /* subtítulo de página, corpo confortável */
  --text-card-title: 15.5px;/* título de card */
  --text-section: 17px;     /* título de seção */
  --text-page: 26px;        /* título de página */
  --text-kpi: 30px;         /* número de KPI */

  /* Pesos */
  --weight-regular: 400;
  --weight-medium: 500;   /* texto interativo em repouso */
  --weight-semibold: 600; /* ativo/selecionado, títulos de card */
  --weight-bold: 700;     /* títulos de página/seção, valores */

  /* Tracking */
  --tracking-title: -0.02em;  /* títulos de página */
  --tracking-card: -0.01em;   /* títulos de card */
}

/* Números sempre tabulares em dados */
.tabular, [data-tabular] { font-variant-numeric: tabular-nums; }

/* Lever Premium Design — cores
   Regra de ouro: no máximo UMA cor forte por linha de UI.
   Status = ponto 6px + palavra. Marketplace = dot 8px + nome (nunca pílula de fundo). */

:root {
  /* Superfícies */
  --paper: #F7F8FA;         /* fundo de página */
  --paper-card: #FFFFFF;    /* cards */
  --paper-tinted: #EEF1F3;  /* trilhos, pílulas neutras, hovers de filtro */
  --paper-subtle: #FBFCFD;  /* campos, sub-cards, hover de linha */

  /* Tinta */
  --ink: #0C1D2B;           /* texto principal, botão primário, navy */
  --ink-soft: #3D4F5C;      /* texto de botões outline, chips */
  --ink-muted: #5A6B77;     /* texto secundário, subtítulos */
  --ink-faint: #8B99A4;     /* meta, rótulos de seção, placeholders fortes */
  --ink-disabled: #98A5AF;  /* placeholder, texto desabilitado */

  /* Linhas */
  --line: #E4E8EB;          /* bordas padrão */
  --line-strong: #CBD4DA;   /* borda hover, dashed */
  --line-faint: #EEF1F3;    /* divisórias internas de tabela */

  /* Marca (teal) */
  --brand: #0F766E;
  --brand-deep: #0B5D57;
  --brand-soft: #E9F5F3;

  /* Semânticas */
  --success: #177A4C;
  --warning: #A16207;
  --warning-soft: #FBF4E6;
  --info: #175CD3;
  --info-soft: #EDF3FC;
  --danger: #B42318;
  --danger-soft: #FDF3F2;

  /* Marketplaces — apenas dots de 8px */
  --ml-yellow: #EBC800;
  --shopee-orange: #EE4D2D;

  /* Controles */
  --control-disabled-bg: #F1F3F5;
  --control-disabled-text: #98A5AF;
  --toggle-off: #D6DDE2;

  /* Botão primário (navy, sem glow) */
  --btn-primary-bg: var(--ink);
  --btn-primary-bg-hover: #1B3140;
  --btn-primary-text: #FFFFFF;

  /* Aliases semânticos */
  --surface-page: var(--paper);
  --surface-card: var(--paper-card);
  --surface-hover: var(--paper-subtle);
  --text-body: var(--ink);
  --text-secondary: var(--ink-muted);
  --text-tertiary: var(--ink-faint);
  --link: var(--brand);
  --focus-ring: var(--ink);
}

/* Tema escuro — aplicar data-theme="dark" no html/body ou num contêiner */
[data-theme="dark"] {
  --paper: #0B141D;
  --paper-card: #101E29;
  --paper-tinted: #1D2B36;
  --paper-subtle: #0B141D;

  --ink: #EDF2F5;
  --ink-soft: #B9C7D1;
  --ink-muted: #8CA0AD;
  --ink-faint: #5E7280;
  --ink-disabled: #4C5E6B;

  --line: #1D2B36;
  --line-strong: #263643;
  --line-faint: #1D2B36;

  --brand: #3ECCBF;
  --brand-deep: #5BD9CE;
  --brand-soft: rgba(62, 204, 191, 0.1);

  --success: #4FBE84;
  --warning: #D6A249;
  --warning-soft: rgba(214, 162, 73, 0.12);
  --info: #7EA9E8;
  --info-soft: rgba(126, 169, 232, 0.12);
  --danger: #E2695A;
  --danger-soft: rgba(226, 105, 90, 0.12);

  --control-disabled-bg: #1D2B36;
  --control-disabled-text: #5E7280;
  --toggle-off: #263643;

  /* Botão primário vira claro-sobre-escuro */
  --btn-primary-bg: #EDF2F5;
  --btn-primary-bg-hover: #FFFFFF;
  --btn-primary-text: #0C1D2B;

  --surface-hover: #13212C;
  --focus-ring: #EDF2F5;
}

/* Lever Premium Design — espaçamento, raios, sombras, movimento */
:root {
  /* Raios */
  --radius-card: 12px;    /* cards de nível de página */
  --radius-inner: 10px;   /* cards internos, campos, barras */
  --radius-control: 8px;  /* botões, inputs, filtros */
  --radius-segment: 9px;  /* trilho de segmented control */
  --radius-badge: 5px;    /* badges retangulares */
  --radius-pill: 999px;   /* chips, contadores, toggles */

  /* Sombras (sutis; nunca glow) */
  --shadow-card: 0 1px 2px rgba(16, 24, 40, 0.03);
  --shadow-btn: 0 1px 2px rgba(16, 24, 40, 0.1);
  --shadow-segment: 0 1px 2px rgba(16, 24, 40, 0.08);
  --shadow-knob: 0 1px 2px rgba(16, 24, 40, 0.15);

  /* Espaçamento */
  --space-card: 28px;               /* padding de card */
  --space-card-y: 20px;             /* linhas de tabela/preferência: 20px 24px */
  --space-page: 40px 32px 64px;     /* padding da coluna central */
  --page-max: 1000px;               /* largura padrão */
  --page-max-narrow: 860px;         /* fila de leitura (Perguntas) */

  /* Topbar */
  --topbar-height: 58px;
  --topbar-pad-x: 28px;

  /* Movimento — sem transform, sem glow */
  --transition-ui: background 0.12s, border-color 0.12s, color 0.12s; /* @kind other */
}

/* Foco visível padrão */
:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }

/* Lever Premium Design — tipografia */
/* latin-ext */
/* latin */
/* latin-ext */
/* latin */
/* latin-ext */
/* latin */
/* latin-ext */
/* latin */
/* cyrillic-ext */
/* cyrillic */
/* greek */
/* vietnamese */
/* latin-ext */
/* latin */
/* cyrillic-ext */
/* cyrillic */
/* greek */
/* vietnamese */
/* latin-ext */
/* latin */
/* cyrillic-ext */
/* cyrillic */
/* greek */
/* vietnamese */
/* latin-ext */
/* latin */
:root {
  /* Famílias */
  --font-sans: 'Instrument Sans', -apple-system, 'Segoe UI', sans-serif; /* toda a UI */
  --font-mono: 'JetBrains Mono', monospace; /* só IDs, SKU, código, números de passo */

  /* Escala (nunca abaixo de 11px) */
  --text-badge: 11px;       /* badges */
  --text-meta: 12.5px;      /* meta, timestamps */
  --text-dense: 13px;       /* corpo denso, botões pequenos, chips */
  --text-control: 13.5px;   /* nav, botões, IDs mono */
  --text-body: 14px;        /* corpo */
  --text-body-lg: 14.5px;   /* subtítulo de página, corpo confortável */
  --text-card-title: 15.5px;/* título de card */
  --text-section: 17px;     /* título de seção */
  --text-page: 26px;        /* título de página */
  --text-kpi: 30px;         /* número de KPI */

  /* Pesos */
  --weight-regular: 400;
  --weight-medium: 500;   /* texto interativo em repouso */
  --weight-semibold: 600; /* ativo/selecionado, títulos de card */
  --weight-bold: 700;     /* títulos de página/seção, valores */

  /* Tracking */
  --tracking-title: -0.02em;  /* títulos de página */
  --tracking-card: -0.01em;   /* títulos de card */
}

/* Números sempre tabulares em dados */
.tabular, [data-tabular] { font-variant-numeric: tabular-nums; }

html,body{margin:0;padding:0;background:var(--paper);color:var(--ink);font-family:var(--font-sans);-webkit-font-smoothing:antialiased}
*{box-sizing:border-box}
a{color:var(--brand);text-decoration:none}
a:hover{color:var(--brand-deep)}

/* ── Palco (o deck-stage do original, portado) ──────────────────────────── */
html, body { height: 100%; margin: 0; overflow: hidden; background: #0B141D; }
.stage { position: fixed; inset: 0; overflow: hidden; }
/* O palco tem tamanho de projeto (1920x1080) e é ESCALADO pra caber. A
   centralização é calculada no JS (left/top em px) porque o transform não muda
   a CAIXA do elemento: centrar por flex ou por translate(-50%) usa a largura
   de 1920, não a escalada, e o slide sai torto. */
.canvas { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; transform-origin: 0 0;
  background: var(--paper); overflow: hidden; box-shadow: 0 10px 60px rgba(0,0,0,.45); }
.canvas > section { position: absolute; inset: 0; width: 1920px; height: 1080px;
  visibility: hidden; opacity: 0; transition: opacity .18s linear; }
.canvas > section[data-deck-active] { visibility: visible; opacity: 1; }
.img-slot { width: 100%; height: 100%; min-height: 120px; border-radius: 12px;
  background: var(--paper-tinted); border: 1px dashed var(--line-strong);
  display: flex; align-items: center; justify-content: center; text-align: center;
  padding: 16px; color: var(--ink-faint); font-size: 22px; }
.logo { display: block; }

/* Contador + dicas: some sozinho e volta no movimento do mouse. */
.hud { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 14px; padding: 8px 14px; border-radius: 999px;
  background: rgba(12,29,43,.82); color: #EDF2F5; font: 500 13px/1 var(--font-sans);
  backdrop-filter: blur(6px); opacity: 0; transition: opacity .25s; z-index: 40; pointer-events: none; }
.hud[data-on] { opacity: 1; pointer-events: auto; }
.hud button { background: none; border: 0; color: inherit; font: inherit; cursor: pointer; padding: 2px 6px; border-radius: 6px; }
.hud button:hover { background: rgba(255,255,255,.14); }
.hud .num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.hud .dica { opacity: .55; font-size: 11.5px; }

/* Notas do apresentador (N) — nunca no link do cliente. */
.notas { position: fixed; left: 0; right: 0; bottom: 0; max-height: 38vh; overflow: auto;
  padding: 18px 26px 22px; background: rgba(12,29,43,.94); color: #EDF2F5;
  font: 400 16px/1.5 var(--font-sans); z-index: 45; display: none; }
.notas[data-on] { display: block; }
.notas b { display: block; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; opacity: .6; margin-bottom: 6px; }

/* Fita do preview do template (/p/t/:id). */
.fita { position: fixed; top: 0; left: 0; right: 0; z-index: 50; padding: 6px 14px;
  background: var(--warning); color: #fff; font: 600 12px/1.4 var(--font-sans); text-align: center; }

/* ── Tela zero (o jeito novo de editar) ─────────────────────────────────── */
.cfg-input, .cfg-select { width: 100%; height: 34px; padding: 0 10px; border: 1px solid var(--line);
  border-radius: var(--radius-control); background: var(--paper-card); color: var(--ink);
  font: 400 13px/1 var(--font-sans); }
.cfg-input:focus, .cfg-select:focus { outline: 2px solid var(--brand); outline-offset: 1px; }
.cfg-card { background: var(--paper-card); border: 1px solid var(--line); border-radius: var(--radius-card);
  box-shadow: var(--shadow-card); padding: 22px; display: flex; flex-direction: column; gap: 12px; }
.cfg-kicker { font-size: 13px; font-weight: 600; letter-spacing: .02em; text-transform: uppercase; color: var(--ink-faint); }
.cfg-prod { display: flex; gap: 12px; align-items: flex-start; padding: 14px; border: 1px solid var(--line);
  border-radius: var(--radius-inner); cursor: pointer; }
.cfg-prod[data-on] { border-color: var(--brand); background: var(--brand-soft); }
.cfg-prod input[type=checkbox] { width: 16px; height: 16px; accent-color: var(--brand); margin-top: 2px; cursor: pointer; }
.cfg-prod strong { display: block; font-size: 15.5px; font-weight: 600; letter-spacing: -.01em; }
.cfg-prod .sub { display: block; font-size: 12.5px; color: var(--ink-muted); margin: 2px 0 8px; }
.cfg-seg { display: inline-flex; padding: 3px; gap: 2px; background: var(--paper-tinted); border-radius: var(--radius-segment); }
.cfg-seg button { flex: 1; padding: 7px 14px; border: 0; border-radius: var(--radius-control); background: none;
  color: var(--ink-muted); font: 500 13px/1 var(--font-sans); cursor: pointer; }
.cfg-seg button[data-on] { background: var(--paper-card); color: var(--ink); font-weight: 600; box-shadow: var(--shadow-segment); }
.cfg-btn { display: inline-flex; align-items: center; justify-content: center; padding: 11px 20px;
  border: 0; border-radius: var(--radius-control); background: var(--btn-primary-bg); color: var(--btn-primary-text);
  font: 600 14px/1 var(--font-sans); box-shadow: var(--shadow-btn); cursor: pointer; }
.cfg-salvo { font-size: 11.5px; color: var(--ink-faint); }

/* Aceite (só no link do cliente). */
.accept-btn { padding: 14px 26px; border: 0; border-radius: var(--radius-control);
  background: var(--brand); color: #fff; font: 700 24px/1 var(--font-sans); cursor: pointer; }
.accept-btn:hover { background: var(--brand-deep); }
.accept-ok { color: var(--success); font-weight: 700; font-size: 24px; }

/* ── Impressão: um slide por página, no tamanho de projeto ──────────────── */
@media print {
  @page { size: 1920px 1080px; margin: 0; }
  html, body { overflow: visible; background: #fff; height: auto; }
  .stage { position: static; display: block; }
  .canvas { transform: none !important; width: 1920px; height: auto; box-shadow: none; }
  .canvas > section { position: relative; inset: auto; visibility: visible; opacity: 1;
    break-after: page; page-break-after: always; }
  .canvas > section[hidden] { display: none; }
  .hud, .notas, .fita { display: none !important; }
}
`;

const SLIDES = `
<section data-label="Capa" data-screen-label="Capa" data-speaker-notes="Abertura. Confirme quem está na sala e diga em uma frase o que vem: quem somos, o método, a demonstração e o investimento." data-theme="dark" style="background:var(--paper);color:var(--ink);font-family:var(--font-sans);padding:96px 112px 88px;display:flex;flex-direction:column;justify-content:space-between">
  <div style="display:flex;align-items:center;gap:18px">
    <span class="logo logo-light" style="height:44px;width:auto;display:block"><svg viewBox="350 380 700 760" fill="currentColor" style="height:100%;width:auto;display:block" aria-hidden="true"><path d="M519.22,843.75l-45.1,15.11c53.94,77.43,143.68,128.2,245.06,128.2,4.38,0,8.76-.08,13.07-.3l-14.13-45.02c-80.76-.3-152.75-38.68-198.9-97.98ZM719.19,390.03c-164.61,0-298.55,133.94-298.55,298.55,0,29.46,4.31,58.02,12.31,84.91l39.13-29.31c-4-17.9-6.12-36.49-6.12-55.6,0-139.6,113.62-253.22,253.22-253.22s253.15,113.62,253.15,253.22c0,99.49-57.71,185.84-141.42,227.16v49.63c109.39-44.27,186.74-151.69,186.74-276.79,0-164.61-133.86-298.55-298.47-298.55Z"></path><polygon points="800.7 535.53 800.7 1103.92 763 983.8 749.25 939.91 691.16 754.61 501.54 817.84 457.65 832.42 362.47 864.14 443.6 803.33 481.22 775.08 800.7 535.53"></polygon></svg></span>
    <span style="font-size:32px;font-weight:700;letter-spacing:-0.02em">LeverAds</span>
  </div>
  <div style="display:flex;flex-direction:column;gap:32px;max-width:1300px">
    <div style="font-size:24px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint)">Proposta comercial</div>
    <h1 style="margin:0;font-size:104px;line-height:1.02;letter-spacing:-0.03em;font-weight:700;text-wrap:balance">O método que usamos para escalar, rodando na operação de <span data-f="f.empresa"></span>.</h1>
    <div style="font-size:30px;color:var(--ink-muted);line-height:1.45"><span data-f="planoNome"></span> · <span data-f="parcelas"></span>× R$ <span data-f="mensalFmt"></span></div>
  </div>
  <div style="display:flex;align-items:center;justify-content:space-between;gap:24px;padding-top:28px;border-top:1px solid var(--line);font-size:24px;color:var(--ink-faint)">
    <span><span data-f="f.nome"></span> · <span data-f="f.empresa"></span></span>
    <span style="font-family:var(--font-mono);font-variant-numeric:tabular-nums"><span data-f="hoje"></span></span>
  </div>
</section>

<section data-label="Quem somos" data-screen-label="01 Quem somos" data-speaker-notes="Credibilidade primeiro: somos sellers. Conte a história do primeiro barracão ao galpão de hoje e conecte com a dor que o cliente vive." data-theme="dark" style="background:var(--paper);color:var(--ink);font-family:var(--font-sans);padding:88px 112px 80px;display:flex;flex-direction:column">
  <div style="display:flex;align-items:center;justify-content:space-between;gap:24px;padding-bottom:24px;border-bottom:1px solid var(--line);margin-bottom:48px">
    <span style="font-size:24px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint)">Quem somos</span>
    <span style="font-family:var(--font-mono);font-size:24px;color:var(--ink-faint)">01</span>
  </div>
  <div style="flex:1;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,0.95fr);gap:72px;align-items:center">
    <div style="min-width:0">
      <h2 style="margin:0 0 14px;font-size:62px;line-height:1.04;letter-spacing:-0.025em;font-weight:700;text-wrap:balance">Mais um sistema criado por quem <span style="color:var(--brand)">nunca vendeu?</span></h2>
      <div style="font-size:34px;font-weight:600;color:var(--brand);margin-bottom:34px;letter-spacing:-0.015em">Longe disso.</div>
      <p style="margin:0 0 22px;font-size:28px;line-height:1.5;color:var(--ink-muted);text-wrap:pretty">A Lever foi feita de seller pra seller. Ninguém aqui aprendeu marketplace em curso: a gente construiu uma operação de verdade, do primeiro barracão ao galpão de hoje, girando produto todo dia.</p>
      <p style="margin:0;font-size:28px;line-height:1.5;color:var(--ink-muted);text-wrap:pretty">Cada fluxo dentro da plataforma nasceu de uma dor nossa. A dor de uma operação que fatura dezenas de milhões por ano e precisava crescer sem inchar a equipe.</p>
    </div>
    <div style="min-width:0;display:flex;flex-direction:column;gap:16px">
      <div style="font-size:24px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint)">A operação por dentro</div>
      <div style="display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);grid-template-rows:232px 232px;gap:12px">
        <div style="grid-row:span 2;min-width:0"><div class="img-slot">Foto do galpão</div></div>
        <div style="min-width:0"><div class="img-slot">Foto do estoque</div></div>
        <div style="min-width:0"><div class="img-slot">Foto da expedição</div></div>
      </div>
      <div style="font-size:24px;color:var(--ink-faint);line-height:1.45">Milhares de peças girando todo dia. A operação que virou ferramenta.</div>
    </div>
  </div>
</section>

<section data-label="A operação em números" data-screen-label="01b Números" data-speaker-notes="Prova em número. R$ 8 mi faturados pelos clientes dentro da Lever, R$ 1 mi vindo de anúncios criados pela plataforma. Deixe o 12% no ar antes de virar o slide." style="background:var(--paper);color:var(--ink);font-family:var(--font-sans);padding:88px 112px 80px;display:flex;flex-direction:column">
  <div style="display:flex;align-items:center;justify-content:space-between;gap:24px;padding-bottom:24px;border-bottom:1px solid var(--line);margin-bottom:56px">
    <span style="font-size:24px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint)">A operação em números</span>
    <span style="font-family:var(--font-mono);font-size:24px;color:var(--ink-faint)">01</span>
  </div>
  <div style="flex:1;display:flex;flex-direction:column;justify-content:center">
  <p style="margin:0 0 64px;font-size:52px;line-height:1.25;letter-spacing:-0.02em;font-weight:500;max-width:1500px;text-wrap:pretty">O resultado: nossos clientes já faturaram <strong style="font-weight:700">R$ 8 mi</strong> dentro da Lever. E <strong style="font-weight:700">R$ 1 mi</strong> disso veio de anúncios que a própria plataforma criou. <strong style="font-weight:700;color:var(--brand)">12% do faturamento deles</strong> não existiria sem o nosso método.</p>
  <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px">
    <div style="background:var(--paper-card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow-card);padding:36px"><div style="font-size:68px;font-weight:700;letter-spacing:-0.03em;line-height:1;font-variant-numeric:tabular-nums">+R$ 30 mi</div><div style="font-size:26px;color:var(--ink-muted);margin-top:14px">de faturamento próprio em 2026</div></div>
    <div style="background:var(--paper-card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow-card);padding:36px"><div style="font-size:68px;font-weight:700;letter-spacing:-0.03em;line-height:1;font-variant-numeric:tabular-nums">+10 mil</div><div style="font-size:26px;color:var(--ink-muted);margin-top:14px">pedidos por mês</div></div>
    <div style="background:var(--paper-card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow-card);padding:36px"><div style="font-size:68px;font-weight:700;letter-spacing:-0.03em;line-height:1;font-variant-numeric:tabular-nums">+10 anos</div><div style="font-size:26px;color:var(--ink-muted);margin-top:14px">de marketplace</div></div>
  </div>
  </div>
</section>

<section data-label="O método" data-screen-label="02 Método" data-speaker-notes="Slide de virada. Deixe claro que a venda não é de software: é do processo. Os próximos slides são os produtos do plano escolhido." data-theme="dark" style="background:var(--paper);color:var(--ink);font-family:var(--font-sans);padding:88px 112px 80px;display:flex;flex-direction:column">
  <div style="display:flex;align-items:center;justify-content:space-between;gap:24px;padding-bottom:24px;border-bottom:1px solid var(--line)">
    <span style="font-size:24px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint)">O método</span>
    <span style="font-family:var(--font-mono);font-size:24px;color:var(--ink-faint)">02</span>
  </div>
  <div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:36px;max-width:1450px">
    <h2 style="margin:0;font-size:76px;line-height:1.05;letter-spacing:-0.03em;font-weight:700;text-wrap:balance">Não é um software. É o método que usamos pra escalar a nossa operação, <span style="color:var(--brand)">alavancado por tecnologia.</span></h2>
    <p style="margin:0;font-size:30px;line-height:1.5;color:var(--ink-muted);max-width:1000px;text-wrap:pretty">Tecnologia qualquer um compra. O que faz o número mudar é o processo por trás dela. Este é o método que vamos ligar na sua operação.</p>
  </div>
</section>

<section data-if="ads" data-label="Lever Ads" data-screen-label="02a Lever Ads" data-speaker-notes="Efeito teia: um anúncio publicado vira N anúncios no ar. Use o número de contas do cliente que está na tela." style="background:var(--paper);color:var(--ink);font-family:var(--font-sans);padding:88px 112px 80px;display:flex;flex-direction:column">
  <div style="display:flex;align-items:center;justify-content:space-between;gap:24px;padding-bottom:24px;border-bottom:1px solid var(--line);margin-bottom:52px">
    <span style="font-size:24px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint)">Lever Ads · método</span>
    <span style="font-family:var(--font-mono);font-size:24px;color:var(--ink-faint)">02</span>
  </div>
  <div style="flex:1;display:grid;grid-template-columns:minmax(0,0.92fr) minmax(0,1.08fr);gap:72px;align-items:center">
    <div style="min-width:0">
      <div style="width:88px;height:88px;border-radius:12px;background:var(--ink);display:flex;align-items:center;justify-content:center;margin-bottom:28px"><svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2.2"></circle><circle cx="4" cy="6" r="1.6"></circle><circle cx="20" cy="6" r="1.6"></circle><circle cx="4" cy="18" r="1.6"></circle><circle cx="20" cy="18" r="1.6"></circle><path d="M10.3 10.6 5.3 7M13.7 10.6 18.7 7M10.3 13.4 5.3 17M13.7 13.4 18.7 17"></path></svg></div>
      <h3 style="margin:0 0 20px;font-size:64px;line-height:1.03;letter-spacing:-0.03em;font-weight:700">Efeito teia.</h3>
      <p style="margin:0;font-size:28px;line-height:1.5;color:var(--ink-muted);text-wrap:pretty">Hoje, cada conta nova é trabalho dobrado. Com o efeito teia, um anúncio publicado vira <span data-f="f.contas"></span> anúncios no ar, e uma edição chega em todas as contas de uma vez. Mais alcance, mesma equipe.</p>
    </div>
    <div style="min-width:0;display:flex;flex-direction:column;gap:16px">
      <div style="display:flex;gap:22px;align-items:flex-start;background:var(--paper-card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow-card);padding:28px"><span style="flex:none;width:56px;height:56px;border-radius:10px;background:var(--paper-tinted);display:flex;align-items:center;justify-content:center"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"></rect><path d="M3 9h18M8 21h8"></path></svg></span><div><div style="font-size:30px;font-weight:600;letter-spacing:-0.01em;margin-bottom:8px">Múltiplas contas, um painel</div><div style="font-size:25px;color:var(--ink-muted);line-height:1.45">Todas conectadas, cada uma com as próprias regras respeitadas.</div></div></div>
      <div style="display:flex;gap:22px;align-items:flex-start;background:var(--paper-card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow-card);padding:28px"><span style="flex:none;width:56px;height:56px;border-radius:10px;background:var(--paper-tinted);display:flex;align-items:center;justify-content:center"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="7" height="7" rx="1.5"></rect><rect x="13" y="13" width="7" height="7" rx="1.5"></rect><path d="M11 7.5h4.5v4M13 16.5H8.5v-4"></path></svg></span><div><div style="font-size:30px;font-weight:600;letter-spacing:-0.01em;margin-bottom:8px">Replicação automática</div><div style="font-size:25px;color:var(--ink-muted);line-height:1.45">Anúncio novo se espalha sozinho. SKU editado, atualizado em todas.</div></div></div>
      <div style="display:flex;gap:22px;align-items:flex-start;background:var(--paper-card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow-card);padding:28px"><span style="flex:none;width:56px;height:56px;border-radius:10px;background:var(--paper-tinted);display:flex;align-items:center;justify-content:center"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v10H9l-5 4z"></path><path d="M8 9h8M8 12h5"></path></svg></span><div><div style="font-size:30px;font-weight:600;letter-spacing:-0.01em;margin-bottom:8px">Atendimento automático</div><div style="font-size:25px;color:var(--ink-muted);line-height:1.45">Perguntas e pós-venda respondidos por IA com o contexto do seu catálogo.</div></div></div>
    </div>
  </div>
</section>

<section data-if="oem" data-label="OEM" data-screen-label="02b OEM" data-speaker-notes="Estoque parado é o gancho. Mostre o volume do pacote contratado e diga que ninguém digita título." style="background:var(--paper);color:var(--ink);font-family:var(--font-sans);padding:88px 112px 80px;display:flex;flex-direction:column">
  <div style="display:flex;align-items:center;justify-content:space-between;gap:24px;padding-bottom:24px;border-bottom:1px solid var(--line);margin-bottom:52px">
    <span style="font-size:24px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint)">OEM · método</span>
    <span style="font-family:var(--font-mono);font-size:24px;color:var(--ink-faint)">02</span>
  </div>
  <div style="flex:1;display:grid;grid-template-columns:minmax(0,0.92fr) minmax(0,1.08fr);gap:72px;align-items:center">
    <div style="min-width:0">
      <div style="width:88px;height:88px;border-radius:12px;background:var(--ink);display:flex;align-items:center;justify-content:center;margin-bottom:28px"><svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M7 9h10M7 12.5h10M7 16h6"></path><path d="m16.5 15.5 1.5 1.5 3-3" stroke-width="2"></path></svg></div>
      <h3 style="margin:0 0 20px;font-size:64px;line-height:1.03;letter-spacing:-0.03em;font-weight:700">Anúncio perfeito.</h3>
      <p style="margin:0;font-size:28px;line-height:1.5;color:var(--ink-muted);text-wrap:pretty">Estoque sem anúncio é dinheiro parado na prateleira. Você cola a lista de códigos; a Lever busca ficha, fotos, categoria e compatibilidade, monta e publica. <span data-f="oemPackFmt"></span> anúncios no ar sem ninguém digitar um título.</p>
    </div>
    <div style="min-width:0;display:flex;flex-direction:column;gap:16px">
      <div style="display:flex;gap:22px;align-items:flex-start;background:var(--paper-card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow-card);padding:28px"><span style="flex:none;width:56px;height:56px;border-radius:10px;background:var(--paper-tinted);display:flex;align-items:center;justify-content:center"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h10M4 17h7"></path><path d="m16 15 2 2 4-4"></path></svg></span><div><div style="font-size:30px;font-weight:600;letter-spacing:-0.01em;margin-bottom:8px">Título do jeito que o comprador busca</div><div style="font-size:25px;color:var(--ink-muted);line-height:1.45">Otimizado dentro do limite de cada marketplace.</div></div></div>
      <div style="display:flex;gap:22px;align-items:flex-start;background:var(--paper-card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow-card);padding:28px"><span style="flex:none;width:56px;height:56px;border-radius:10px;background:var(--paper-tinted);display:flex;align-items:center;justify-content:center"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6z"></path><path d="M15 3v4h4M9 12h6M9 16h6"></path></svg></span><div><div style="font-size:30px;font-weight:600;letter-spacing:-0.01em;margin-bottom:8px">Descrição específica da peça</div><div style="font-size:25px;color:var(--ink-muted);line-height:1.45">Ficha técnica e aplicação, não texto genérico copiado.</div></div></div>
      <div style="display:flex;gap:22px;align-items:flex-start;background:var(--paper-card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow-card);padding:28px"><span style="flex:none;width:56px;height:56px;border-radius:10px;background:var(--paper-tinted);display:flex;align-items:center;justify-content:center"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16l1.5-5h11L19 16"></path><rect x="3" y="16" width="18" height="3" rx="1"></rect><circle cx="7" cy="20" r="1.5"></circle><circle cx="17" cy="20" r="1.5"></circle></svg></span><div><div style="font-size:30px;font-weight:600;letter-spacing:-0.01em;margin-bottom:8px">Compatibilidade completa</div><div style="font-size:25px;color:var(--ink-muted);line-height:1.45">A peça aparece na busca por veículo, onde o cliente realmente procura.</div></div></div>
    </div>
  </div>
</section>

<section data-if="price" data-label="Lever Price" data-screen-label="02c Lever Price" data-speaker-notes="Fale de margem, não de preço. A régua é a margem mínima que o cliente define." style="background:var(--paper);color:var(--ink);font-family:var(--font-sans);padding:88px 112px 80px;display:flex;flex-direction:column">
  <div style="display:flex;align-items:center;justify-content:space-between;gap:24px;padding-bottom:24px;border-bottom:1px solid var(--line);margin-bottom:52px">
    <span style="font-size:24px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint)">Lever Price · método</span>
    <span style="font-family:var(--font-mono);font-size:24px;color:var(--ink-faint)">02</span>
  </div>
  <div style="flex:1;display:grid;grid-template-columns:minmax(0,0.92fr) minmax(0,1.08fr);gap:72px;align-items:center">
    <div style="min-width:0">
      <div style="width:88px;height:88px;border-radius:12px;background:var(--ink);display:flex;align-items:center;justify-content:center;margin-bottom:28px"><svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.7"></path><path d="M20 4v4h-4"></path><path d="M12 8v8M9.8 10.3c0-1 1-1.6 2.2-1.6s2.2.6 2.2 1.5c0 2.3-4.4 1.2-4.4 3.6 0 .9 1 1.6 2.2 1.6s2.2-.6 2.2-1.6"></path></svg></div>
      <h3 style="margin:0 0 20px;font-size:64px;line-height:1.03;letter-spacing:-0.03em;font-weight:700">Espiral do lucro.</h3>
      <p style="margin:0;font-size:28px;line-height:1.5;color:var(--ink-muted);text-wrap:pretty">Ganhar o catálogo baixando preço no susto é queimar margem. Você define a margem mínima; a Lever ajusta em massa, o dia inteiro, e só entra em promoção quando ela ainda dá lucro.</p>
    </div>
    <div style="min-width:0;display:flex;flex-direction:column;gap:16px">
      <div style="display:flex;gap:22px;align-items:flex-start;background:var(--paper-card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow-card);padding:28px"><span style="flex:none;width:56px;height:56px;border-radius:10px;background:var(--paper-tinted);display:flex;align-items:center;justify-content:center"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 4.5 3.4 7.8 8 9 4.6-1.2 8-4.5 8-9V6z"></path><path d="M12 8v8M10 10.5c0-.8.9-1.3 2-1.3s2 .5 2 1.2c0 1.8-4 .9-4 2.8 0 .7.9 1.3 2 1.3s2-.5 2-1.3"></path></svg></span><div><div style="font-size:30px;font-weight:600;letter-spacing:-0.01em;margin-bottom:8px">Margem mínima protegida</div><div style="font-size:25px;color:var(--ink-muted);line-height:1.45">Cada SKU trabalha dentro da margem que você definiu. Nunca abaixo.</div></div></div>
      <div style="display:flex;gap:22px;align-items:flex-start;background:var(--paper-card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow-card);padding:28px"><span style="flex:none;width:56px;height:56px;border-radius:10px;background:var(--paper-tinted);display:flex;align-items:center;justify-content:center"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V4M4 20h16"></path><path d="M7 15l4-4 3 3 5-6"></path></svg></span><div><div style="font-size:30px;font-weight:600;letter-spacing:-0.01em;margin-bottom:8px">Reprecificação em massa</div><div style="font-size:25px;color:var(--ink-muted);line-height:1.45">Milhares de anúncios ajustados de uma vez, em todas as contas.</div></div></div>
      <div style="display:flex;gap:22px;align-items:flex-start;background:var(--paper-card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow-card);padding:28px"><span style="flex:none;width:56px;height:56px;border-radius:10px;background:var(--paper-tinted);display:flex;align-items:center;justify-content:center"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4"></path><path d="m9 12 2 2 4-4"></path></svg></span><div><div style="font-size:30px;font-weight:600;letter-spacing:-0.01em;margin-bottom:8px">Promoção com critério</div><div style="font-size:25px;color:var(--ink-muted);line-height:1.45">Entra e sai de campanhas com base na margem real.</div></div></div>
    </div>
  </div>
</section>

<section data-label="Demonstração" data-screen-label="03 Demonstração" data-speaker-notes="Pare o deck aqui e abra a plataforma. Volte para o slide seguinte quando terminar a demo." data-theme="dark" style="background:var(--paper);color:var(--ink);font-family:var(--font-sans);padding:88px 112px 80px;display:flex;flex-direction:column">
  <div style="display:flex;align-items:center;justify-content:space-between;gap:24px;padding-bottom:24px;border-bottom:1px solid var(--line)">
    <span style="font-size:24px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint)">Demonstração</span>
    <span style="font-family:var(--font-mono);font-size:24px;color:var(--ink-faint)">03</span>
  </div>
  <div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:32px;max-width:1300px">
    <h2 style="margin:0;font-size:110px;line-height:1;letter-spacing:-0.035em;font-weight:700">Vamos ver funcionando.</h2>
    <p style="margin:0;font-size:32px;line-height:1.45;color:var(--ink-muted);max-width:900px;text-wrap:pretty">Vou abrir a plataforma e mostrar <span data-f="demoLista"></span> rodando em contas reais, agora.</p>
  </div>
</section>

<section data-label="Como você entra" data-screen-label="04 Como você entra" data-speaker-notes="Tire o medo da implantação: grupo no WhatsApp no dia 0, call de plano de ação, processos liberados na primeira semana e acompanhamento mensal." style="background:var(--paper);color:var(--ink);font-family:var(--font-sans);padding:88px 112px 80px;display:flex;flex-direction:column">
  <div style="display:flex;align-items:center;justify-content:space-between;gap:24px;padding-bottom:24px;border-bottom:1px solid var(--line);margin-bottom:44px">
    <span style="font-size:24px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint)">O que acontece depois do sim</span>
    <span style="font-family:var(--font-mono);font-size:24px;color:var(--ink-faint)">04</span>
  </div>
  <div style="flex:1;display:flex;flex-direction:column;justify-content:center">
  <h2 style="margin:0 0 18px;font-size:60px;line-height:1.05;letter-spacing:-0.025em;font-weight:700;max-width:1200px;text-wrap:balance">Você fecha hoje. <span style="color:var(--brand)">Em dias, está rodando.</span></h2>
  <p style="margin:0 0 72px;font-size:28px;line-height:1.45;color:var(--ink-muted);max-width:900px;text-wrap:pretty">Sem manual pra ler, sem ficar sozinho com um login. A gente entra junto na sua operação e só sai quando o número aparece.</p>
  <div style="position:relative;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:28px">
    <div style="position:absolute;left:36px;right:36px;top:35px;height:1px;background:var(--line)"></div>
    <div style="position:relative;display:flex;flex-direction:column;gap:16px">
      <div style="width:72px;height:72px;border-radius:999px;background:var(--ink);color:#FFFFFF;display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-weight:600;font-size:28px;border:8px solid var(--paper)">1</div>
      <div style="font-size:24px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint)">Dia 0</div>
      <div style="font-size:32px;font-weight:600;letter-spacing:-0.015em;line-height:1.2">Grupo no WhatsApp</div>
      <div style="font-size:25px;color:var(--ink-muted);line-height:1.45">Você, seu time e o nosso no mesmo canal. Resposta direta, sem ticket.</div>
    </div>
    <div style="position:relative;display:flex;flex-direction:column;gap:16px">
      <div style="width:72px;height:72px;border-radius:999px;background:var(--ink);color:#FFFFFF;display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-weight:600;font-size:28px;border:8px solid var(--paper)">2</div>
      <div style="font-size:24px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint)">Dia 1–2</div>
      <div style="font-size:32px;font-weight:600;letter-spacing:-0.015em;line-height:1.2">Call de plano de ação</div>
      <div style="font-size:25px;color:var(--ink-muted);line-height:1.45">Conectamos as <span data-f="f.contas"></span> contas, definimos regras e o que ataca primeiro.</div>
    </div>
    <div style="position:relative;display:flex;flex-direction:column;gap:16px">
      <div style="width:72px;height:72px;border-radius:999px;background:var(--ink);color:#FFFFFF;display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-weight:600;font-size:28px;border:8px solid var(--paper)">3</div>
      <div style="font-size:24px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint)">Semana 1</div>
      <div style="font-size:32px;font-weight:600;letter-spacing:-0.015em;line-height:1.2">Processos liberados</div>
      <div style="font-size:25px;color:var(--ink-muted);line-height:1.45">Os mesmos fluxos que rodam na nossa operação, ativos no seu painel.</div>
    </div>
    <div style="position:relative;display:flex;flex-direction:column;gap:16px">
      <div style="width:72px;height:72px;border-radius:999px;background:var(--brand-soft);color:var(--brand);border:8px solid var(--paper);box-shadow:inset 0 0 0 1px var(--brand);display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-weight:600;font-size:28px">∞</div>
      <div style="font-size:24px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint)">Todo mês</div>
      <div style="font-size:32px;font-weight:600;letter-spacing:-0.015em;line-height:1.2">Acompanhamento</div>
      <div style="font-size:25px;color:var(--ink-muted);line-height:1.45">Resultado conferido com você, em reais, dentro do painel.</div>
    </div>
  </div>
  </div>
</section>

<section data-label="Foco no resultado" data-screen-label="05 Foco no resultado" data-speaker-notes="A plataforma é o meio. Percorra o ciclo com o dedo na tela: estratégia aplicada, alcance multiplicado, faturamento maior." data-theme="dark" style="background:var(--paper);color:var(--ink);font-family:var(--font-sans);padding:88px 112px 80px;display:flex;flex-direction:column">
  <div style="display:flex;align-items:center;justify-content:space-between;gap:24px;padding-bottom:24px;border-bottom:1px solid var(--line);margin-bottom:48px">
    <span style="font-size:24px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint)">Foco no resultado</span>
    <span style="font-family:var(--font-mono);font-size:24px;color:var(--ink-faint)">05</span>
  </div>
  <div style="flex:1;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,0.85fr);gap:80px;align-items:center">
    <div style="min-width:0">
      <h2 style="margin:0 0 32px;font-size:64px;line-height:1.04;letter-spacing:-0.03em;font-weight:700;text-wrap:balance">Nosso objetivo é você <span style="color:var(--brand)">faturando e lucrando mais.</span></h2>
      <p style="margin:0 0 22px;font-size:28px;line-height:1.5;color:var(--ink-muted);text-wrap:pretty">A plataforma é o meio. O fim é o número na sua conta no fim do mês. É por ele que a gente se mede.</p>
      <p style="margin:0;font-size:28px;line-height:1.5;color:var(--ink-muted);text-wrap:pretty">Cada estratégia que rodamos na nossa operação entra na sua. Quanto mais ela gira, mais a Lever se paga sozinha.</p>
    </div>
    <div style="min-width:0;background:var(--paper-card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow-card);padding:36px">
      <div style="font-size:24px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint);margin-bottom:20px">O ciclo</div>
      <div style="position:relative;aspect-ratio:1;max-width:560px;margin:0 auto">
        <svg viewBox="0 0 200 200" width="100%" height="100%" fill="none" style="display:block">
          <defs><marker id="cyc-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5 0 10z" fill="var(--brand)"></path></marker></defs>
          <circle cx="100" cy="100" r="52" stroke="var(--line-strong)" stroke-width="1.2"></circle>
          <path d="M100 48 A52 52 0 0 1 145 74" stroke="var(--brand)" stroke-width="2.5" stroke-linecap="round" marker-end="url(#cyc-arrow)"></path>
          <path d="M145 126 A52 52 0 0 1 100 152" stroke="var(--brand)" stroke-width="2.5" stroke-linecap="round" marker-end="url(#cyc-arrow)"></path>
          <path d="M55 126 A52 52 0 0 1 55 74" stroke="var(--brand)" stroke-width="2.5" stroke-linecap="round" marker-end="url(#cyc-arrow)"></path>
        </svg>
        <div style="position:absolute;left:50%;top:24%;transform:translate(-50%,-50%);width:56px;height:56px;border-radius:999px;background:var(--paper-card);border:1px solid var(--brand);color:var(--brand);display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-size:22px;font-weight:600">01</div>
        <div style="position:absolute;left:72.5%;top:63%;transform:translate(-50%,-50%);width:56px;height:56px;border-radius:999px;background:var(--paper-card);border:1px solid var(--brand);color:var(--brand);display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-size:22px;font-weight:600">02</div>
        <div style="position:absolute;left:27.5%;top:63%;transform:translate(-50%,-50%);width:56px;height:56px;border-radius:999px;background:var(--brand-soft);border:1px solid var(--brand);color:var(--brand);display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-size:22px;font-weight:600">03</div>
        <div style="position:absolute;left:50%;top:-2%;transform:translateX(-50%);width:64%;font-size:24px;font-weight:600;line-height:1.25;letter-spacing:-0.01em;text-align:center">A plataforma aplica nossas estratégias</div>
        <div style="position:absolute;right:-4%;top:78%;width:44%;font-size:24px;font-weight:600;line-height:1.25;letter-spacing:-0.01em;text-align:center">Você multiplica seu alcance</div>
        <div style="position:absolute;left:-4%;top:78%;width:44%;font-size:24px;font-weight:600;line-height:1.25;letter-spacing:-0.01em;text-align:center">Isso aumenta seu faturamento</div>
        <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;font-size:24px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--ink-faint);line-height:1.4">E o ciclo recomeça</div>
      </div>
    </div>
  </div>
</section>

<section data-if="resultados" data-label="Quem já está dentro" data-screen-label="06 Resultados" data-speaker-notes="Troque os colchetes pelos cases reais mais parecidos com o nicho deste cliente antes da reunião." style="background:var(--paper);color:var(--ink);font-family:var(--font-sans);padding:88px 112px 80px;display:flex;flex-direction:column">
  <div style="display:flex;align-items:center;justify-content:space-between;gap:24px;padding-bottom:24px;border-bottom:1px solid var(--line);margin-bottom:44px">
    <span style="font-size:24px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint)">Quem já está dentro</span>
    <span style="font-family:var(--font-mono);font-size:24px;color:var(--ink-faint)">06</span>
  </div>
  <h2 style="margin:0 0 16px;font-size:60px;line-height:1.05;letter-spacing:-0.025em;font-weight:700;max-width:1300px;text-wrap:balance">Sellers com a mesma dor que a sua. <span style="color:var(--brand)">O que mudou.</span></h2>
  <p style="margin:0 0 56px;font-size:28px;line-height:1.45;color:var(--ink-muted)">Números conferidos no painel, não em depoimento.</p>
  <div style="flex:1;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px">
    <div style="background:var(--paper-card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow-card);padding:32px;display:flex;flex-direction:column;gap:16px"><div style="font-family:var(--font-mono);font-size:24px;color:var(--ink-faint)">[CLIENTE] · [NICHO]</div><div style="font-size:54px;font-weight:700;letter-spacing:-0.03em;line-height:1;color:var(--brand);font-variant-numeric:tabular-nums">[R$ xx mil]</div><div style="font-size:25px;color:var(--ink-muted);line-height:1.35">faturados por anúncios da Lever em [x] meses</div><div style="margin-top:auto;font-size:24px;line-height:1.45;color:var(--ink-soft);border-top:1px solid var(--line-faint);padding-top:18px">[Ex.: Tinha 2 contas e 1 pessoa cadastrando. Ligou o efeito teia e triplicou os anúncios no ar sem contratar.]</div></div>
    <div style="background:var(--paper-card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow-card);padding:32px;display:flex;flex-direction:column;gap:16px"><div style="font-family:var(--font-mono);font-size:24px;color:var(--ink-faint)">[CLIENTE] · [NICHO]</div><div style="font-size:54px;font-weight:700;letter-spacing:-0.03em;line-height:1;color:var(--brand);font-variant-numeric:tabular-nums">[+xx%]</div><div style="font-size:25px;color:var(--ink-muted);line-height:1.35">de faturamento em [x] meses</div><div style="margin-top:auto;font-size:24px;line-height:1.45;color:var(--ink-soft);border-top:1px solid var(--line-faint);padding-top:18px">[Ex.: Estoque cheio, anúncio fraco. Publicou 1.000 OEM em uma semana e o catálogo passou a aparecer na busca por veículo.]</div></div>
    <div style="background:var(--paper-card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow-card);padding:32px;display:flex;flex-direction:column;gap:16px"><div style="font-family:var(--font-mono);font-size:24px;color:var(--ink-faint)">[CLIENTE] · [NICHO]</div><div style="font-size:54px;font-weight:700;letter-spacing:-0.03em;line-height:1;color:var(--brand);font-variant-numeric:tabular-nums">[x mil]</div><div style="font-size:25px;color:var(--ink-muted);line-height:1.35">anúncios publicados em [x] dias</div><div style="margin-top:auto;font-size:24px;line-height:1.45;color:var(--ink-soft);border-top:1px solid var(--line-faint);padding-top:18px">[Ex.: Levaria 4 meses de cadastro manual. Saiu em 9 dias, com compatibilidade completa.]</div></div>
    <div style="background:var(--paper-card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow-card);padding:32px;display:flex;flex-direction:column;gap:16px"><div style="font-family:var(--font-mono);font-size:24px;color:var(--ink-faint)">[CLIENTE] · [NICHO]</div><div style="font-size:54px;font-weight:700;letter-spacing:-0.03em;line-height:1;color:var(--brand);font-variant-numeric:tabular-nums">[x h/mês]</div><div style="font-size:25px;color:var(--ink-muted);line-height:1.35">de trabalho manual que voltaram pro dono</div><div style="margin-top:auto;font-size:24px;line-height:1.45;color:var(--ink-soft);border-top:1px solid var(--line-faint);padding-top:18px">[Ex.: Passava as tardes respondendo pergunta. Hoje a IA responde e ele cuida de compra e margem.]</div></div>
  </div>
</section>

<section data-label="Entregáveis" data-screen-label="07 Entregáveis" data-speaker-notes="Recapitule item a item o que entra no plano montado no configurador. É a ponte para o preço." style="background:var(--paper);color:var(--ink);font-family:var(--font-sans);padding:88px 112px 80px;display:flex;flex-direction:column">
  <div style="display:flex;align-items:center;justify-content:space-between;gap:24px;padding-bottom:24px;border-bottom:1px solid var(--line);margin-bottom:40px">
    <span style="font-size:24px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint)">Recapitulando</span>
    <span style="font-family:var(--font-mono);font-size:24px;color:var(--ink-faint)">07</span>
  </div>
  <h2 style="margin:0 0 44px;font-size:56px;line-height:1.05;letter-spacing:-0.025em;font-weight:700;max-width:1300px;text-wrap:balance">Tudo o que entra na sua operação <span style="color:var(--brand)">com este plano.</span></h2>
  <div style="flex:1;display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px;align-items:stretch">
    <div data-entregaveis style="display:contents"></div>
  </div>
</section>

<section data-label="Investimento" data-screen-label="08 Investimento" data-speaker-notes="Diga o valor com calma e fique em silêncio. O próximo slide traduz a parcela em vendas." data-theme="dark" style="background:var(--paper);color:var(--ink);font-family:var(--font-sans);padding:88px 112px 80px;display:flex;flex-direction:column">
  <div style="display:flex;align-items:center;justify-content:space-between;gap:24px;padding-bottom:24px;border-bottom:1px solid var(--line)">
    <span style="font-size:24px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint)">Investimento</span>
    <span style="font-family:var(--font-mono);font-size:24px;color:var(--ink-faint)">08</span>
  </div>
  <div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:40px">
    <div style="font-size:44px;font-weight:600;letter-spacing:-0.02em;color:var(--ink-muted)">Plano <span data-f="periodoLabel"></span> · <span data-f="planoNome"></span></div>
    <div style="display:flex;align-items:flex-end;gap:24px;font-variant-numeric:tabular-nums">
      <div style="display:flex;flex-direction:column;gap:10px;font-size:40px;font-weight:600;color:var(--ink-muted);line-height:1;padding-bottom:26px"><span><span data-f="parcelas"></span>×</span><span>R$</span></div>
      <div style="font-size:230px;font-weight:700;letter-spacing:-0.05em;line-height:0.86"><span data-f="mensalFmt"></span></div>
      <div style="font-size:40px;font-weight:600;color:var(--ink-muted);line-height:1;padding-bottom:26px">,00</div>
    </div>
    <div style="font-size:36px;font-weight:600;letter-spacing:-0.02em;color:var(--brand)">ou R$ <span data-f="vistaFmt"></span> à vista</div>
  </div>
</section>

<section data-label="Na prática" data-screen-label="09 Tangibilidade" data-speaker-notes="Traduza a parcela em pedidos: com o ticket médio informado, são poucas vendas a mais por mês. Tudo acima disso é lucro novo." style="background:var(--paper);color:var(--ink);font-family:var(--font-sans);padding:88px 112px 80px;display:flex;flex-direction:column">
  <div style="display:flex;align-items:center;justify-content:space-between;gap:24px;padding-bottom:24px;border-bottom:1px solid var(--line);margin-bottom:48px">
    <span style="font-size:24px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint)">Na prática</span>
    <span style="font-family:var(--font-mono);font-size:24px;color:var(--ink-faint)">09</span>
  </div>
  <div style="flex:1;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,0.95fr);gap:72px;align-items:center">
    <div style="min-width:0">
      <h2 style="margin:0 0 28px;font-size:62px;line-height:1.04;letter-spacing:-0.03em;font-weight:700;text-wrap:balance"><span style="color:var(--brand)"><span data-f="vendasNecessarias"></span> vendas a mais</span> por mês. É isso que paga a Lever.</h2>
      <p style="margin:0 0 28px;font-size:28px;line-height:1.5;color:var(--ink-muted);text-wrap:pretty">Com ticket médio de R$ <span data-f="ticketFmt"></span>, a parcela equivale a <span data-f="vendasNecessarias"></span> pedidos. Você já faz <span data-f="pedidosFmt"></span> por mês. Estamos falando de <strong style="color:var(--ink);font-weight:700"><span data-f="percentualExtra"></span></strong> a mais. Tudo acima disso é lucro novo.</p>
      <div style="font-size:24px;color:var(--ink-faint);line-height:1.45">Parcela ÷ ticket médio, arredondado pra cima. Sem contar a hora de equipe que volta.</div>
    </div>
    <div style="min-width:0;background:var(--paper-card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow-card);padding:36px">
      <div style="font-size:24px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint);margin-bottom:20px">Retorno × investimento</div>
      <div style="position:relative">
        <svg viewBox="0 0 400 260" width="100%" style="display:block;overflow:visible" fill="none">
          <path d="M28 232H386" stroke="var(--line-strong)" stroke-width="1.5"></path><path d="M28 232V22" stroke="var(--line-strong)" stroke-width="1.5"></path>
          <path d="M380 228l6 4-6 4M24 28l4-6 4 6" stroke="var(--line-strong)" stroke-width="1.5"></path>
          <path d="M28 232C110 150 170 128 380 126" stroke="var(--ink-faint)" stroke-width="2" stroke-dasharray="5 5"></path>
          <path d="M28 232C120 232 150 70 290 58" stroke="var(--brand)" stroke-width="2.5" stroke-dasharray="6 5"></path>
          <circle cx="134.9" cy="156.5" r="13" stroke="var(--danger)" stroke-width="3"></circle>
        </svg>
        <div style="position:absolute;left:34%;top:66%;font-size:24px;font-weight:600;line-height:1.3;color:var(--danger)">Retorno sobre<br>investimento</div>
        <div style="position:absolute;right:0;top:50%;font-size:24px;font-weight:600;text-align:right;line-height:1.3;color:var(--ink-faint)">Valor<br>investido</div>
        <div style="position:absolute;right:0;top:2%;text-align:right;max-width:34%"><div style="font-size:64px;font-weight:700;letter-spacing:-0.03em;line-height:1;color:var(--brand);font-variant-numeric:tabular-nums">+<span data-f="vendasNecessarias"></span></div><div style="font-size:24px;font-weight:600;color:var(--ink-muted);margin-top:8px;line-height:1.3">vendas a mais<br>por mês</div></div>
      </div>
    </div>
  </div>
</section>

<section data-label="Garantia" data-screen-label="10 Garantia" data-speaker-notes="Feche o risco: 60% de uso nos dois primeiros meses, faturamento não subiu no valor da parcela, devolvemos tudo. Depois pergunte se faz sentido começar." data-theme="dark" style="background:var(--paper);color:var(--ink);font-family:var(--font-sans);padding:88px 112px 80px;display:flex;flex-direction:column">
  <div style="display:flex;align-items:center;justify-content:space-between;gap:24px;padding-bottom:24px;border-bottom:1px solid var(--line);margin-bottom:48px">
    <span style="font-size:24px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint)">Garantia incondicional</span>
    <span style="font-family:var(--font-mono);font-size:24px;color:var(--ink-faint)">10</span>
  </div>
  <div style="flex:1;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:80px;align-items:center">
    <div style="min-width:0">
      <h2 style="margin:0 0 28px;font-size:64px;line-height:1.04;letter-spacing:-0.03em;font-weight:700;text-wrap:balance">Se a Lever não pagar a própria parcela, <span style="color:var(--brand)">você recebe tudo de volta.</span></h2>
      <p style="margin:0 0 36px;font-size:28px;line-height:1.5;color:var(--ink-muted);max-width:1000px;text-wrap:pretty">Use a plataforma com pelo menos 60% da capacidade nos primeiros 2 meses. Se o seu faturamento não subir no valor da parcela, devolvemos cada centavo. Sem letra miúda.</p>
      <div style="border-top:1px solid var(--line);padding-top:28px;max-width:1000px;display:flex;flex-direction:column;gap:10px">
        <div style="font-size:26px;color:var(--ink-muted);line-height:1.45">Até hoje, nenhum cliente precisou acionar a garantia.</div>
        <div style="font-size:26px;font-weight:600;color:var(--ink);line-height:1.45">O risco dessa decisão é nosso. O único risco seu é continuar como está.</div>
      </div>
    </div>
    <div style="width:320px;height:320px;border-radius:999px;background:var(--paper-card);border:1px solid var(--line);display:flex;align-items:center;justify-content:center">
      <svg width="55%" height="55%" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5 4 5.5v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10v-6z"></path><path d="m8.5 12 2.3 2.3L15.5 9.5" stroke-width="2"></path></svg>
    </div>
  </div>
</section>

<section data-label="Encerramento" data-screen-label="11 Encerramento" data-speaker-notes="Último slide: repita o plano e a condição, e combine o próximo passo ainda na call." style="background:var(--paper);color:var(--ink);font-family:var(--font-sans);padding:96px 112px 88px;display:flex;flex-direction:column;justify-content:space-between">
  <div style="display:flex;align-items:center;gap:18px">
    <span class="logo" style="height:44px;width:auto;display:block"><svg viewBox="350 380 700 760" fill="currentColor" style="height:100%;width:auto;display:block" aria-hidden="true"><path d="M519.22,843.75l-45.1,15.11c53.94,77.43,143.68,128.2,245.06,128.2,4.38,0,8.76-.08,13.07-.3l-14.13-45.02c-80.76-.3-152.75-38.68-198.9-97.98ZM719.19,390.03c-164.61,0-298.55,133.94-298.55,298.55,0,29.46,4.31,58.02,12.31,84.91l39.13-29.31c-4-17.9-6.12-36.49-6.12-55.6,0-139.6,113.62-253.22,253.22-253.22s253.15,113.62,253.15,253.22c0,99.49-57.71,185.84-141.42,227.16v49.63c109.39-44.27,186.74-151.69,186.74-276.79,0-164.61-133.86-298.55-298.47-298.55Z"></path><polygon points="800.7 535.53 800.7 1103.92 763 983.8 749.25 939.91 691.16 754.61 501.54 817.84 457.65 832.42 362.47 864.14 443.6 803.33 481.22 775.08 800.7 535.53"></polygon></svg></span>
    <span style="font-size:32px;font-weight:700;letter-spacing:-0.02em">LeverAds</span>
  </div>
  <div style="display:flex;flex-direction:column;gap:28px">
    <div style="font-size:24px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint)">Proposta · <span data-f="f.empresa"></span></div>
    <div style="font-size:64px;font-weight:700;letter-spacing:-0.03em;line-height:1.05"><span data-f="planoNome"></span></div>
    <div style="font-size:44px;font-weight:600;letter-spacing:-0.02em;color:var(--ink-muted);font-variant-numeric:tabular-nums"><span data-f="parcelas"></span>× R$ <span data-f="mensalFmt"></span> <span style="color:var(--brand)">ou R$ <span data-f="vistaFmt"></span> à vista</span></div>
  </div>
  <div style="display:flex;align-items:center;justify-content:space-between;gap:24px;padding-top:28px;border-top:1px solid var(--line);font-size:24px;color:var(--ink-faint)">
    <span class="accept-wrap" data-client-only hidden><button type="button" class="accept-btn" data-act="aceitar">Quero começar</button></span>
    <span>Condições válidas apenas no dia da apresentação</span>
    <span style="font-family:var(--font-mono);font-variant-numeric:tabular-nums"><span data-f="hoje"></span></span>
  </div>
</section>


`;

// ── A conta do plano ────────────────────────────────────────────────────────
// UMA função, usada no servidor (pra montar o deck do link do cliente) e
// injetada no script da tela zero por toString() — assim o número que o closer
// vê montando e o que o cliente recebe não podem divergir. Sem crases: ela é
// serializada dentro do template literal da página.
export function calcOferta(cat, st) {
  var prods = (cat && cat.products) || {};
  var anual = st.periodo !== "semestral";
  var parcelas = anual ? 12 : 6;
  var fmt = function (n) { return Math.round(Number(n) || 0).toLocaleString("pt-BR"); };
  var contas = Math.max(1, Math.round(Number(st.contas) || 1));
  var extraPer = Number(((cat.addons || {}).contaExtra || {}).per) || 100;
  var mensal = 0, setup = 0, nomes = [], entregaveis = [];

  var plat = st.plataforma ? prods[st.linha + "_" + st.tier] : null;
  if (plat) {
    var per = Number((anual ? plat.anu : plat.sem).per) || 0;
    var inclusas = Number(plat.contas) || 0;
    var extras = Math.max(0, contas - inclusas);
    mensal += per + extras * extraPer;
    nomes.push(plat.name);
    entregaveis.push({
      tag: plat.name,
      itens: ((plat.inclui || {}).motor || []).concat((plat.inclui || {}).plataforma || []),
      notaDestaque: extras ? "Contas extras:" : "Contas inclusas:",
      nota: extras
        ? extras + " conta" + (extras > 1 ? "s" : "") + " além das " + inclusas + " do pacote, R$ " + fmt(extraPer) + " por conta em cada parcela."
        : inclusas + " contas no pacote, prontas pra receber os anúncios."
    });
  }

  var price = st.price ? prods["price_" + st.priceTier] : null;
  if (price) {
    mensal += Number((anual ? price.anu : price.sem).per) || 0;
    nomes.push(price.name);
    entregaveis.push({
      tag: price.name,
      itens: ((price.inclui || {}).motor || []).concat((price.inclui || {}).plataforma || []),
      notaDestaque: "Margem primeiro:",
      nota: "o preço se move sozinho o dia inteiro, sempre acima da margem que você definir."
    });
  }

  var packs = (cat.oemPacks || []);
  var pack = st.oem ? packs.filter(function (x) { return Number(x.qty) === Number(st.oemPack); })[0] : null;
  if (pack) {
    setup += Number(pack.price) || 0;
    nomes.push("OEM " + fmt(pack.qty));
    entregaveis.push({
      tag: "OEM · anúncio perfeito",
      itens: [
        fmt(pack.qty) + " anúncios criados e publicados",
        "Título otimizado por marketplace",
        "Descrição e ficha técnica específicas",
        "Compatibilidade completa de veículos"
      ],
      notaDestaque: "Pagamento único:",
      nota: "R$ " + fmt(setup) + " na contratação, fora das parcelas do plano."
    });
  }

  entregaveis.push({
    tag: "O lado humano",
    itens: [
      "Suporte humano via WhatsApp",
      "Call de plano de ação e setup",
      "Resultado conferido mês a mês",
      "Garantia incondicional de 2 meses"
    ],
    notaDestaque: "Time Lever dentro da sua operação:",
    nota: "quem vende todo dia, cuidando de quem vende todo dia."
  });

  var vistaPct = Math.min(90, Math.max(0, Number(st.vistaPct) || 0));
  var vista = mensal * parcelas * (1 - vistaPct / 100);
  var ticket = Math.max(1, Number(st.ticket) || 1);
  var vendas = mensal ? Math.ceil(mensal / ticket) : 0;
  var pedidos = Math.max(0, Number(st.pedidos) || 0);
  var pct = pedidos ? (vendas / pedidos * 100) : 0;
  var demo = nomes.length ? nomes.join(", ").replace(/, ([^,]*)$/, " e $1") : "a plataforma";

  return {
    planoNome: nomes.length ? nomes.join(" + ") : "Selecione um produto",
    demoLista: demo,
    periodoLabel: anual ? "anual" : "semestral",
    parcelas: parcelas,
    mensal: mensal,
    mensalFmt: fmt(mensal),
    vistaFmt: fmt(vista),
    setupFmt: fmt(setup),
    oemPackFmt: pack ? fmt(pack.qty) : "0",
    pedidosFmt: fmt(pedidos),
    ticketFmt: fmt(ticket),
    vendasNecessarias: vendas,
    percentualExtra: pct ? pct.toFixed(1).replace(".", ",") + "%" : "—",
    entregaveis: entregaveis,
    mostra: {
      ads: !!plat,
      oem: st.linha === "oem" && !!plat ? true : !!pack,
      price: !!price,
      resultados: true
    }
  };
}

// Configuração da apresentação: o que a tela zero guarda (state.deckC). Nasce
// dos dados do lead e do produto que a régua do catálogo já sugere — o closer
// abre a tela zero com o plano montado, não em branco.
export function deckConfig(p, { suggested = "" } = {}) {
  const s = (p.state && p.state.deckC) || {};
  const lead = (p.data && p.data.lead) || {};
  const [linhaSug, tierSug] = String(suggested || "ads_essencial").split("_");
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : d);
  return {
    nome: String(s.nome || lead.firstName || lead.name || "").slice(0, 60),
    empresa: String(s.empresa || lead.company || "").slice(0, 80),
    contas: num(s.contas, num(p.state && p.state.seats, 2)),
    pedidos: num(s.pedidos, 300),
    ticket: num(s.ticket, 120),
    vistaPct: Math.min(90, Math.max(0, Number(s.vistaPct != null ? s.vistaPct : 20) || 0)),
    plataforma: s.plataforma != null ? !!s.plataforma : true,
    linha: ["ads", "oem"].includes(String(s.linha || "")) ? String(s.linha) : (linhaSug === "oem" ? "oem" : "ads"),
    tier: ["essencial", "escala"].includes(String(s.tier || "")) ? String(s.tier) : (tierSug === "escala" ? "escala" : "essencial"),
    price: !!s.price,
    priceTier: ["essencial", "escala", "enterprise"].includes(String(s.priceTier || "")) ? String(s.priceTier) : "essencial",
    oem: !!s.oem,
    oemPack: String(s.oemPack || "1000"),
    periodo: s.periodo === "semestral" ? "semestral" : "anual",
  };
}

// O catálogo que a PÁGINA precisa (nomes, preços, entregáveis, contas do
// pacote). Só vai pro navegador no modo closer — o link do cliente recebe os
// números já calculados, nunca a tabela.
export function slimCatalog(catalog) {
  const src = (catalog && catalog.products) || {};
  const products = {};
  for (const [k, v] of Object.entries(src)) {
    products[k] = {
      name: v.name || k, line: v.line || k.split("_")[0], tier: v.tier || k.split("_")[1],
      contas: v.contas || 0, inclui: v.inclui || {}, anu: v.anu || {}, sem: v.sem || {},
    };
  }
  return {
    products,
    addons: { contaExtra: (catalog && catalog.addons && catalog.addons.contaExtra) || { per: 100 } },
    oemPacks: (catalog && catalog.oemPacks) || [],
    lines: (catalog && catalog.lines) || {},
  };
}

const escJson = (obj) => JSON.stringify(obj).replace(/</g, "\\u003c");
const escHtml = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Tela zero: o jeito NOVO de editar a apresentação. Três cartões (cliente,
// produtos, plano) e o resumo do que o cliente vai ver. Só existe no modo
// closer (?k=…): o link do cliente abre direto na capa.
function cfgScreen() {
  return `<section data-cfg-screen data-label="Configurar" data-speaker-notes="Tela de preparo, antes da reunião: preencha cliente, contas, ticket e os produtos do plano. Todos os números do restante do deck vêm daqui." style="background:var(--paper);color:var(--ink);font-family:var(--font-sans);display:flex;align-items:center;justify-content:center">
  <div style="zoom:1.7;width:1129px;padding:0 40px;display:flex;flex-direction:column;gap:22px">
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:20px;padding-bottom:16px;border-bottom:1px solid var(--line)">
      <div>
        <div class="cfg-kicker" style="margin-bottom:6px">Configurar apresentação</div>
        <div style="font-size:26px;font-weight:700;letter-spacing:-0.02em">Monte a proposta antes de começar</div>
      </div>
      <div style="display:flex;align-items:center;gap:12px">
        <span class="cfg-salvo" data-salvo></span>
        <button type="button" class="cfg-btn" data-act="capa">Começar apresentação</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:300px minmax(0,1fr) 300px;gap:20px;align-items:start">
      <div class="cfg-card">
        <div class="cfg-kicker">Cliente</div>
        <label style="display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--ink-muted)"><span>Nome</span>
          <input class="cfg-input" data-cfg="nome"></label>
        <label style="display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--ink-muted)"><span>Empresa</span>
          <input class="cfg-input" data-cfg="empresa"></label>
        <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px">
          <label style="min-width:0;display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--ink-muted)"><span>Contas</span>
            <input class="cfg-input" type="number" min="1" data-cfg="contas"></label>
          <label style="min-width:0;display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--ink-muted)"><span>Pedidos/mês</span>
            <input class="cfg-input" type="number" min="0" data-cfg="pedidos"></label>
        </div>
        <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px">
          <label style="min-width:0;display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--ink-muted)"><span>Ticket médio (R$)</span>
            <input class="cfg-input" type="number" min="1" data-cfg="ticket"></label>
          <label style="min-width:0;display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--ink-muted)"><span>Desc. à vista (%)</span>
            <input class="cfg-input" type="number" min="0" max="90" data-cfg="vistaPct"></label>
        </div>
      </div>

      <div class="cfg-card">
        <div class="cfg-kicker">Produtos no plano</div>
        <label class="cfg-prod" data-prod="plataforma">
          <input type="checkbox" data-cfg="plataforma">
          <span style="flex:1;min-width:0">
            <strong>Plataforma</strong>
            <span class="sub" data-preco="plataforma"></span>
            <span style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px">
              <select class="cfg-select" data-cfg="linha"></select>
              <select class="cfg-select" data-cfg="tier"></select>
            </span>
          </span>
        </label>
        <label class="cfg-prod" data-prod="price">
          <input type="checkbox" data-cfg="price">
          <span style="flex:1;min-width:0">
            <strong>Lever Price</strong>
            <span class="sub" data-preco="price">Espiral do lucro · precificação automática</span>
            <select class="cfg-select" data-cfg="priceTier"></select>
          </span>
        </label>
        <label class="cfg-prod" data-prod="oem">
          <input type="checkbox" data-cfg="oem">
          <span style="flex:1;min-width:0">
            <strong>Pacote de OEM avulso</strong>
            <span class="sub">Criação em massa por código OEM · pagamento único</span>
            <select class="cfg-select" data-cfg="oemPack"></select>
          </span>
        </label>
      </div>

      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="cfg-card">
          <div class="cfg-kicker">Plano</div>
          <div class="cfg-seg" data-seg="periodo">
            <button type="button" data-v="anual">Anual · 12×</button>
            <button type="button" data-v="semestral">Semestral · 6×</button>
          </div>
          <div style="font-size:12.5px;color:var(--ink-muted);line-height:1.5" data-nota-plano></div>
        </div>
        <div style="background:var(--ink);color:var(--btn-primary-text);border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:6px">
          <div style="font-size:12.5px;opacity:0.7"><span data-f="planoNome"></span></div>
          <div style="font-size:30px;font-weight:700;letter-spacing:-0.02em;line-height:1;font-variant-numeric:tabular-nums"><span data-f="parcelas"></span>× R$ <span data-f="mensalFmt"></span></div>
          <div style="font-size:12.5px;opacity:0.7">ou R$ <span data-f="vistaFmt"></span> à vista</div>
          <div style="font-size:12.5px;opacity:0.7" data-setup hidden>+ R$ <span data-f="setupFmt"></span> de pacote OEM na contratação</div>
        </div>
      </div>
    </div>
  </div>
</section>`;
}

export function proposalSlidesPageHtml(p, { editable = false, previewBanner = false, catalog = null, suggested = "" } = {}) {
  const cfg = deckConfig(p, { suggested });
  const slim = slimCatalog(catalog || {});
  const oferta = calcOferta(slim, cfg);
  const titulo = escHtml(p.name || "Proposta");
  const dados = {
    id: p.id,
    editable: !!editable,
    salvavel: !!editable && p.id !== "preview",
    aceito: !!p.accepted,
    cfg,
    oferta,
    catalog: editable ? slim : null,
    hoje: new Date().toLocaleDateString("pt-BR"),
  };
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${titulo}</title>
<meta name="robots" content="noindex,nofollow">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${DECK_CSS}</style>
</head>
<body>
${previewBanner ? '<div class="fita">Pré-visualização do template · nada aqui é salvo</div>' : ""}
<div class="stage">
  <div class="canvas" id="canvas">${editable ? cfgScreen() : ""}${SLIDES}</div>
</div>
<div class="hud" id="hud">
  <button type="button" data-act="prev" aria-label="Slide anterior">‹</button>
  <span class="num"><span id="hud-i">1</span> / <span id="hud-n">1</span></span>
  <button type="button" data-act="next" aria-label="Próximo slide">›</button>
  <span class="dica" id="hud-dica">setas pra navegar${editable ? " · N pra ver as notas" : ""}</span>
</div>
${editable ? '<div class="notas" id="notas"><b>Notas do apresentador</b><span id="notas-txt"></span></div>' : ""}
<script>
(function () {
  var D = ${escJson(dados)};
  var calcOferta = ${calcOferta.toString()};
  var cfg = D.cfg;
  var canvas = document.getElementById("canvas");
  var todos = [].slice.call(canvas.children);

  // ── Os números do deck ────────────────────────────────────────────────
  // Nenhum número é escrito no slide: tudo vem da oferta montada na tela
  // zero. No link do cliente a conta já veio pronta do servidor.
  function oferta() { return D.editable ? calcOferta(D.catalog, cfg) : D.oferta; }
  function cardEntregavel(e) {
    var d = document.createElement("div");
    d.setAttribute("style", "background:var(--paper-card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow-card);padding:32px;display:flex;flex-direction:column;gap:22px;min-width:0");
    var tag = document.createElement("div");
    tag.setAttribute("style", "font-size:24px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:var(--ink-faint)");
    tag.textContent = e.tag;
    d.appendChild(tag);
    var lista = document.createElement("div");
    lista.setAttribute("style", "display:flex;flex-direction:column;gap:16px");
    (e.itens || []).forEach(function (t) {
      var li = document.createElement("div");
      li.setAttribute("style", "display:flex;gap:14px;font-size:25px;color:var(--ink);line-height:1.35");
      li.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex:none;margin-top:4px"><path d="m5 12.5 4.5 4.5L19 7"></path></svg>';
      var sp = document.createElement("span");
      sp.textContent = t;
      li.appendChild(sp);
      lista.appendChild(li);
    });
    d.appendChild(lista);
    var nota = document.createElement("div");
    nota.setAttribute("style", "margin-top:auto;background:var(--brand-soft);border-radius:10px;padding:20px;font-size:24px;line-height:1.4;color:var(--ink-soft)");
    var forte = document.createElement("span");
    forte.setAttribute("style", "color:var(--brand);font-weight:600");
    forte.textContent = e.notaDestaque || "";
    nota.appendChild(forte);
    nota.appendChild(document.createTextNode(" " + (e.nota || "")));
    d.appendChild(nota);
    return d;
  }

  function pintar() {
    var o = oferta();
    var vals = {
      "f.nome": cfg.nome, "f.empresa": cfg.empresa || "sua operação", "f.contas": cfg.contas,
      hoje: D.hoje, planoNome: o.planoNome, demoLista: o.demoLista, periodoLabel: o.periodoLabel,
      parcelas: o.parcelas, mensalFmt: o.mensalFmt, vistaFmt: o.vistaFmt, setupFmt: o.setupFmt,
      oemPackFmt: o.oemPackFmt, pedidosFmt: o.pedidosFmt, ticketFmt: o.ticketFmt,
      vendasNecessarias: o.vendasNecessarias, percentualExtra: o.percentualExtra
    };
    [].forEach.call(document.querySelectorAll("[data-f]"), function (el) {
      var v = vals[el.getAttribute("data-f")];
      el.textContent = v == null ? "" : String(v);
    });
    var grid = document.querySelector("[data-entregaveis]");
    if (grid) {
      grid.innerHTML = "";
      (o.entregaveis || []).forEach(function (e) { grid.appendChild(cardEntregavel(e)); });
    }
    // Slide de produto que não está no plano sai da apresentação.
    todos.forEach(function (s) {
      var cond = s.getAttribute("data-if");
      if (cond) s.hidden = !o.mostra[cond];
    });
    var setup = document.querySelector("[data-setup]");
    if (setup) setup.hidden = !(Number(o.setupFmt.replace(/\\D/g, "")) > 0);
    recontar();
  }

  // ── Palco ─────────────────────────────────────────────────────────────
  var atual = 0, vis = [];
  function recontar() {
    vis = todos.filter(function (s) { return !s.hidden; });
    if (atual >= vis.length) atual = Math.max(0, vis.length - 1);
    mostrar(atual, "recount");
  }
  function fit() {
    var w = window.innerWidth, h = window.innerHeight;
    var k = Math.min(w / 1920, h / 1080);
    canvas.style.transform = "scale(" + k + ")";
    canvas.style.left = Math.round((w - 1920 * k) / 2) + "px";
    canvas.style.top = Math.round((h - 1080 * k) / 2) + "px";
  }
  function mostrar(i, motivo) {
    if (!vis.length) return;
    atual = Math.max(0, Math.min(vis.length - 1, i));
    todos.forEach(function (s) { s.removeAttribute("data-deck-active"); });
    var s = vis[atual];
    s.setAttribute("data-deck-active", "");
    document.getElementById("hud-i").textContent = String(atual + 1);
    document.getElementById("hud-n").textContent = String(vis.length);
    var nt = document.getElementById("notas-txt");
    if (nt) nt.textContent = s.getAttribute("data-speaker-notes") || "sem notas neste slide";
    if (motivo !== "recount") hudAcordar();
  }
  function ir(d) { mostrar(atual + d, "nav"); }
  window.deckGoTo = function (i) { mostrar(i, "api"); };

  var hud = document.getElementById("hud"), hudT = null;
  function hudAcordar() {
    hud.setAttribute("data-on", "");
    clearTimeout(hudT);
    hudT = setTimeout(function () { hud.removeAttribute("data-on"); }, 1800);
  }
  window.addEventListener("mousemove", hudAcordar);
  hud.addEventListener("mouseenter", function () { clearTimeout(hudT); });
  hud.addEventListener("mouseleave", hudAcordar);

  document.addEventListener("keydown", function (e) {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || "")) return;
    var k = e.key;
    if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown" || k === " ") { e.preventDefault(); ir(1); }
    else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp") { e.preventDefault(); ir(-1); }
    else if (k === "Home") { e.preventDefault(); mostrar(0, "nav"); }
    else if (k === "End") { e.preventDefault(); mostrar(vis.length - 1, "nav"); }
    else if (/^[0-9]$/.test(k)) { mostrar(Number(k) === 0 ? 9 : Number(k) - 1, "nav"); }
    else if (k === "r" || k === "R") { mostrar(0, "nav"); }
    else if (k === "n" || k === "N") {
      var n = document.getElementById("notas");
      if (n) { if (n.hasAttribute("data-on")) n.removeAttribute("data-on"); else n.setAttribute("data-on", ""); }
    }
  });
  // Toque: metade esquerda volta, metade direita avança (link, botão e campo
  // do slide seguem funcionando).
  canvas.addEventListener("click", function (e) {
    if (e.target.closest('a[href], button, input, select, textarea, label, [data-act]')) return;
    if (!window.matchMedia("(hover: none)").matches) return;
    ir(e.clientX < window.innerWidth / 2 ? -1 : 1);
  });
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]");
    if (!b) return;
    var a = b.getAttribute("data-act");
    if (a === "prev") ir(-1);
    else if (a === "next") ir(1);
    else if (a === "capa") mostrar(D.editable ? 1 : 0, "api");
    else if (a === "aceitar") aceitar(b);
  });
  window.addEventListener("resize", fit);

  // ── Aceite (só no link do cliente) ────────────────────────────────────
  function aceitar(btn) {
    btn.disabled = true;
    fetch("/public/proposals/" + encodeURIComponent(D.id) + "/accept", { method: "POST" })
      .then(function (r) { if (!r.ok) throw new Error("falha"); marcarAceito(); })
      .catch(function () { btn.disabled = false; btn.textContent = "tente de novo"; });
  }
  function marcarAceito() {
    var w = document.querySelector(".accept-wrap");
    if (w) w.innerHTML = '<span class="accept-ok">✓ Proposta aceita, vamos te chamar</span>';
  }
  if (!D.editable) {
    [].forEach.call(document.querySelectorAll("[data-client-only]"), function (el) { el.hidden = false; });
    if (D.aceito) marcarAceito();
  }

  // ── Tela zero ─────────────────────────────────────────────────────────
  if (D.editable) {
    var salvoEl = document.querySelector("[data-salvo]");
    var salvarT = null;
    function salvar() {
      if (!D.salvavel) { if (salvoEl) salvoEl.textContent = "pré-visualização, nada é salvo"; return; }
      clearTimeout(salvarT);
      if (salvoEl) salvoEl.textContent = "salvando…";
      salvarT = setTimeout(function () {
        fetch("/public/proposals/" + encodeURIComponent(D.id), {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({ k: new URLSearchParams(location.search).get("k"), deckC: cfg })
        }).then(function (r) {
          if (salvoEl) salvoEl.textContent = r.ok ? "salvo" : "não salvou, tente de novo";
        }).catch(function () { if (salvoEl) salvoEl.textContent = "não salvou, tente de novo"; });
      }, 600);
    }
    function opts(sel, lista, valor) {
      sel.innerHTML = "";
      lista.forEach(function (o) {
        var op = document.createElement("option");
        op.value = o.v; op.textContent = o.t;
        if (String(o.v) === String(valor)) op.selected = true;
        sel.appendChild(op);
      });
    }
    function precoDe(key) {
      var pr = D.catalog.products[key];
      if (!pr) return "";
      var per = Number((cfg.periodo === "semestral" ? pr.sem : pr.anu).per) || 0;
      return "R$ " + per.toLocaleString("pt-BR") + "/mês";
    }
    function tiersDa(linha) {
      return ["essencial", "escala"].filter(function (t) { return D.catalog.products[linha + "_" + t]; })
        .map(function (t) {
          var pr = D.catalog.products[linha + "_" + t];
          return { v: t, t: (t === "escala" ? "Escala" : "Essencial") + " · " + (pr.contas || 0) + " contas · " + precoDe(linha + "_" + t) };
        });
    }
    function pintarCfg() {
      [].forEach.call(document.querySelectorAll("[data-cfg]"), function (el) {
        var k = el.getAttribute("data-cfg");
        if (el.type === "checkbox") el.checked = !!cfg[k];
        else if (el.tagName !== "SELECT") el.value = cfg[k];
      });
      var linhas = ["ads", "oem"].filter(function (l) { return D.catalog.products[l + "_essencial"] || D.catalog.products[l + "_escala"]; })
        .map(function (l) { return { v: l, t: l === "oem" ? "Lever OEM (autopeças)" : "Lever Ads" }; });
      opts(document.querySelector('[data-cfg="linha"]'), linhas, cfg.linha);
      opts(document.querySelector('[data-cfg="tier"]'), tiersDa(cfg.linha), cfg.tier);
      opts(document.querySelector('[data-cfg="priceTier"]'), ["essencial", "escala", "enterprise"]
        .filter(function (t) { return D.catalog.products["price_" + t]; })
        .map(function (t) {
          var pr = D.catalog.products["price_" + t];
          return { v: t, t: pr.name.replace("Lever Price · ", "") + " · " + precoDe("price_" + t) };
        }), cfg.priceTier);
      opts(document.querySelector('[data-cfg="oemPack"]'), (D.catalog.oemPacks || []).map(function (pk) {
        return { v: String(pk.qty), t: Number(pk.qty).toLocaleString("pt-BR") + " anúncios · R$ " + Number(pk.price).toLocaleString("pt-BR") };
      }), cfg.oemPack);
      var pl = D.catalog.products[cfg.linha + "_" + cfg.tier];
      var sub = document.querySelector('[data-preco="plataforma"]');
      if (sub) sub.textContent = pl ? (pl.name + " · " + precoDe(cfg.linha + "_" + cfg.tier)) : "selecione a linha e o pacote";
      [].forEach.call(document.querySelectorAll("[data-prod]"), function (el) {
        var on = !!cfg[el.getAttribute("data-prod")];
        if (on) el.setAttribute("data-on", ""); else el.removeAttribute("data-on");
      });
      [].forEach.call(document.querySelectorAll('[data-seg="periodo"] button'), function (b) {
        if (b.getAttribute("data-v") === cfg.periodo) b.setAttribute("data-on", ""); else b.removeAttribute("data-on");
      });
      var nota = document.querySelector("[data-nota-plano]");
      if (nota && pl) {
        var extra = (D.catalog.addons.contaExtra || {}).per || 100;
        nota.textContent = "Anual: 12× R$ " + Number(pl.anu.per || 0).toLocaleString("pt-BR") +
          ". Semestral: 6× R$ " + Number(pl.sem.per || 0).toLocaleString("pt-BR") +
          ". Conta além das " + (pl.contas || 0) + " do pacote: R$ " + Number(extra).toLocaleString("pt-BR") + " por parcela.";
      }
    }
    document.addEventListener("input", function (e) {
      var el = e.target.closest("[data-cfg]");
      if (!el) return;
      var k = el.getAttribute("data-cfg");
      cfg[k] = el.type === "checkbox" ? el.checked : (el.type === "number" ? Number(el.value) : el.value);
      if (k === "linha") { var t = tiersDa(cfg.linha); if (!t.some(function (x) { return x.v === cfg.tier; })) cfg.tier = t[0] ? t[0].v : "essencial"; }
      pintarCfg(); pintar(); salvar();
    });
    document.addEventListener("change", function (e) {
      var el = e.target.closest("[data-cfg]");
      if (el && el.tagName === "SELECT") { cfg[el.getAttribute("data-cfg")] = el.value; pintarCfg(); pintar(); salvar(); }
    });
    document.addEventListener("click", function (e) {
      var b = e.target.closest('[data-seg="periodo"] button');
      if (!b) return;
      cfg.periodo = b.getAttribute("data-v");
      pintarCfg(); pintar(); salvar();
    });
    pintarCfg();
  }

  fit();
  pintar();
  mostrar(0, "init");
  hudAcordar();
})();
</script>
</body>
</html>`;
}
