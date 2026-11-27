// Apresentação em SLIDES (nasceu como opção C; oficial desde 18/09/2026) — página pública /p/:id no formato de deck
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
// A conta do plano é a MESMA no servidor, na tela zero e no card de Atividades:
// calcOferta() e deckChoices() moram em shared/deck-offer.js e entram no script
// da página por toString(). Preços e planos vêm do catálogo v2, a projeção dos
// planos de Comercial → Planos (billing/plan-catalog.js), nunca escritos aqui.
//
// Funcionalidades preservadas do original: escala pra caber na tela, navegação
// por teclado (setas, PgUp/PgDn, espaço, Home/End, número, R), toque nas metades
// da tela, contador que some sozinho, impressão com um slide por página e as
// notas do apresentador (aqui atrás do N, só no modo closer). Do cockpit:
// contagem de views (na rota), aceite do cliente e o estado salvo pelo editKey.
//
// DESENHO (26/11/2026): o Leo trouxe o deck redesenhado em dois arquivos
// (lever-oem.zip e lever-price.zip): o MESMO deck, exportado num plano de OEM e
// num de Lever Price. Palco escuro, marca "Lever", um slide de método por
// produto, a demonstração com a tela do produto, resultados e entregáveis
// novos. O que é do cockpit continua como era: a tela zero, a conta do plano,
// os cases pelo nicho com o número do painel, o aceite e as notas do closer.
// O CSS do desenho novo mora debaixo de `.dk` (a classe de cada slide), porque
// a tela zero é clara e a apresentação de criação de anúncios divide o DECK_CSS.
//
// REGRA DO ARQUIVO (igual ao proposal-page.js): o HTML é UM template literal —
// nada de crase dentro dele nem do script do cliente, que usa concatenação.

import { calcOferta, deckChoices, deckTelas } from "../shared/deck-offer.js";

export { calcOferta, deckTelas };

// Exportado porque a apresentação de CRIAÇÃO DE ANÚNCIOS (proposal-oem-page.js)
// roda no MESMO palco: dois decks, um design system só.
export const DECK_CSS = `
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
/* Foto da operação: o slot é do tamanho do grid, a imagem preenche cortando o
   excesso (as fotos vieram do celular, cada uma numa proporção). */
.foto { width: 100%; height: 100%; display: block; object-fit: cover; border-radius: 12px;
  background: var(--paper-tinted); }
.logo-case { height: 52px; max-width: 210px; object-fit: contain; object-position: left center; display: block; }
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
/* Cadeado do desconto: fechado trava em 15%, aberto (senha de admin) libera. */
.cfg-lock { flex: none; display: inline-flex; align-items: center; justify-content: center; min-width: 34px; height: 34px;
  padding: 0 9px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--paper-card);
  color: var(--ink-muted); font: 600 12.5px/1 var(--font-sans); cursor: pointer; }
.cfg-lock:hover:not(:disabled) { color: var(--ink); }
.cfg-lock:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; }
.cfg-lock:disabled { cursor: default; }
.cfg-lock[data-open] { color: var(--brand); border-color: var(--brand); }
.cfg-desc-form { display: flex; gap: 6px; }
.cfg-desc-form[hidden] { display: none; }
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

/* ── Deck redesenhado (handoff de 26/11/2026) ──────────────────────────────
   Tudo debaixo de .dk, a classe de cada slide: --ink, --line e --brand são
   redefinidos SÓ dentro do slide. A tela zero continua clara e o deck de
   criação de anúncios, que usa este mesmo CSS, não muda. */
.canvas.dkc { background: #0A131B; }
.canvas > section.dk {
  --bg: #0A131B; --card: #101E29; --card-2: #142533;
  --line: rgba(237,242,245,.08); --line-2: rgba(237,242,245,.14);
  --ink: #EDF2F5; --ink-2: rgba(237,242,245,.74); --ink-3: rgba(237,242,245,.52); --ink-4: rgba(237,242,245,.34);
  --brand: #3ECCBF; --brand-ink: #04212A; --r: 22px;
  background: var(--bg); color: var(--ink); font-family: var(--font-sans); color-scheme: dark;
  padding: 72px 112px 80px; display: flex; flex-direction: column; overflow: hidden; line-height: 1.3; }
.dk h1,.dk h2,.dk h3,.dk p,.dk ul{margin:0;padding:0}
.dk ul{list-style:none}
.dk img{display:block;max-width:100%}
.dk [hidden]{display:none!important}

/* tipografia */
.dk .hd{display:flex;align-items:center;justify-content:space-between;gap:24px;position:relative;z-index:1}
.dk .eb{font-size:26px;font-weight:500;color:var(--ink-3);letter-spacing:-.005em}
.dk .pg{font:500 24px var(--font-mono);color:var(--ink-4)}
.dk .h{font-weight:700;letter-spacing:-.043em;line-height:1.03;text-wrap:balance}
.dk .a,.dk .p{color:var(--brand)}
.dk .lede{font-size:32px;line-height:1.55;color:var(--ink-2);text-wrap:pretty}
.dk .lede.soft{color:var(--ink-3)}
.dk .mono{font-family:var(--font-mono)}
.dk .tab{font-variant-numeric:tabular-nums}
.dk .body{flex:1;min-height:0;position:relative;z-index:1}
.dk.glow::before{content:"";position:absolute;left:50%;top:-340px;width:1700px;height:980px;transform:translateX(-50%);background:radial-gradient(closest-side,rgba(62,204,191,.17),transparent 70%);pointer-events:none}
.dk.glow.low::before{top:auto;bottom:-520px}
.dk .brand{display:inline-flex;align-items:center;gap:16px;font-weight:700;font-size:38px;letter-spacing:-.02em;position:relative;z-index:1}
.dk .brand img{width:50px;height:54px}
.dk .card{border-radius:var(--r);border:1px solid var(--line);background:linear-gradient(180deg,var(--card-2),var(--card))}
.dk .foot{display:flex;align-items:center;justify-content:space-between;gap:24px;padding-top:28px;border-top:1px solid var(--line);font-size:26px;color:var(--ink-3);position:relative;z-index:1}

/* capa e encerramento */
.dk.cover{justify-content:space-between}
.dk.cover .mid{position:relative;z-index:1;display:flex;flex-direction:column;gap:34px;max-width:1560px}

/* quem somos */
.dk .who{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(0,.92fr);gap:80px;align-items:center}
.dk .stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:34px}
.dk .stat{padding:24px 26px}
.dk .stat b{display:block;font-size:46px;font-weight:700;letter-spacing:-.045em;line-height:1;font-variant-numeric:tabular-nums}
.dk .stat span{display:block;font-size:22px;line-height:1.3;color:var(--ink-3);margin-top:12px}
.dk .photos{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);grid-template-rows:250px 250px;gap:14px}
.dk .photos .big{grid-row:span 2}
.dk .photos img{width:100%;height:100%;object-fit:cover;border-radius:18px;border:1px solid var(--line);background:var(--card)}

/* método por produto: três cards da mesma altura, título numa linha */
.dk .feat{display:flex;gap:26px;align-items:flex-start;padding:32px 34px}
.dk .feat .ic{flex:none;width:60px;height:60px;border-radius:50%;background:rgba(62,204,191,.14);display:flex;align-items:center;justify-content:center}
.dk .feat b{display:block;font-size:34px;font-weight:700;letter-spacing:-.025em;margin-bottom:8px}
.dk .feat span{display:block;font-size:27px;line-height:1.45;color:var(--ink-3)}
.dk .body:has(> div > .card.feat){grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr)!important;gap:72px!important}
.dk div:has(> .card.feat){display:grid!important;grid-template-rows:repeat(3,minmax(0,1fr));height:620px;gap:20px!important}
.dk .card.feat{align-items:center;padding:28px 40px}
.dk .card.feat b{font-size:30px;white-space:nowrap;margin-bottom:10px}
.dk .card.feat span{font-size:25px}

/* janela da demonstração */
.dk .window{position:relative;border-radius:var(--r);border:1px solid var(--line-2);background:linear-gradient(180deg,#13212D 0%,#0D1822 100%);box-shadow:0 70px 140px -70px rgba(62,204,191,.45),0 30px 60px -30px rgba(0,0,0,.7);overflow:hidden}
.dk .win-bar{display:flex;align-items:center;gap:18px;padding:16px 22px;border-bottom:1px solid var(--line)}
.dk .dots{display:flex;gap:8px}
.dk .dots i{width:12px;height:12px;border-radius:50%;opacity:.8}
.dk .dots i:nth-child(1){background:#FF5F57}.dk .dots i:nth-child(2){background:#FEBC2E}.dk .dots i:nth-child(3){background:#28C840}
.dk .win-url{flex:1;text-align:center;font:500 18px var(--font-mono);color:var(--ink-4);padding-right:64px}
.dk .window img{width:100%;height:auto}

/* passos */
.dk .track{height:3px;border-radius:3px;background:var(--line);overflow:hidden;margin-bottom:26px}
.dk .track i{display:block;height:100%;width:100%;background:linear-gradient(90deg,var(--brand),#7FE3D8)}
.dk .steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px}
.dk .steps li{border-radius:var(--r);border:1px solid var(--line);background:var(--card);padding:34px;display:flex;flex-direction:column;gap:14px}
.dk .steps .top{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.dk .steps .sn{font:600 34px var(--font-mono);color:var(--brand)}
.dk .steps .dia{font-size:26px;font-weight:500;color:var(--ink-3)}
.dk .steps h3{font-size:38px;font-weight:700;letter-spacing:-.03em;line-height:1.12}
.dk .steps p{font-size:27px;line-height:1.45;color:var(--ink-3)}

/* ciclo */
.dk .cyc{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,.85fr);gap:88px;align-items:center}
.dk .cycbox{padding:36px 40px 40px}
.dk .cyc .bd{position:absolute;width:56px;height:56px;border-radius:50%;background:var(--card);border:1px solid var(--brand);color:var(--brand);display:flex;align-items:center;justify-content:center;font:600 22px var(--font-mono)}
.dk .cyc .lb{position:absolute;font-size:25px;font-weight:600;line-height:1.25;letter-spacing:-.01em;text-align:center}

/* resultados */
.dk .cs3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}
/* faixa de cima: cada número começa onde começa o texto do card de baixo, com a legenda centrada na altura dele */
.dk .kp{display:grid;column-gap:20px;padding:0}
.dk .kp-i{display:flex;align-items:center;gap:16px;min-width:0;padding:26px 12px 26px 36px}
.dk .kp-n{flex:none;font-size:64px;font-weight:700;color:var(--brand);letter-spacing:-.045em;line-height:1;white-space:nowrap}
.dk .kp-l{min-width:0;font-size:21px;line-height:1.3;color:var(--ink-2);text-wrap:balance}
.dk .r1{padding:38px 44px 34px;display:flex;flex-direction:column;justify-content:center;min-width:0}
.dk .r2c{padding:28px 40px 14px;display:flex;flex-direction:column;min-width:0}
.dk .rrow{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:20px 0;flex:1}
.dk .rrow+.rrow{border-top:1px solid var(--line-2)}
.dk .rrow b{display:block;font-size:26px;font-weight:600;white-space:nowrap}
.dk .rrow small{display:block;margin-top:4px;font-size:20px;color:var(--ink-3)}
.dk .rrow em{font-style:normal;font-size:54px;font-weight:700;color:var(--brand);letter-spacing:-.04em;line-height:1;white-space:nowrap;font-variant-numeric:tabular-nums}
.dk .kv{font-size:20px;color:var(--ink-3)}
.dk .kv+div{margin-top:8px;font-size:32px;font-weight:700;letter-spacing:-.03em;white-space:nowrap;font-variant-numeric:tabular-nums}
.dk .sec6{display:flex;align-items:flex-start;padding-top:26px;border-top:1px solid var(--line)}
.dk .sec6 .lab{font-size:20px;line-height:24px;font-weight:500;color:var(--ink-3)}
.dk .sec6 .row{display:flex;align-items:baseline;gap:var(--g);height:34px;line-height:34px;margin-top:10px;white-space:nowrap}
.dk .sec6 .row::before{content:"\\200b";font-size:30px;font-weight:800;line-height:1;margin-right:calc(var(--g) * -1)}
.dk .sec6 .vr{align-self:stretch;width:1px;background:var(--line-2);margin-inline:40px}
.dk .wm{color:var(--ink-3);line-height:1}

/* entregáveis */
.dk .dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px;align-items:stretch}
.dk .dc{padding:34px 38px;display:flex;flex-direction:column;gap:24px;min-width:0}
.dk .dc .t{font-size:28px;font-weight:600;color:var(--ink-3)}
.dk .ticks{display:grid;gap:30px}
.dk .ticks li{display:grid;grid-template-columns:calc(var(--tk,34px) + 2px) minmax(0,1fr);gap:18px;font-size:30px;line-height:1.35;color:var(--ink)}
.dk .ticks li::before{content:"";width:var(--tk,34px);height:var(--tk,34px);margin-top:3px;border-radius:50%;background:rgba(62,204,191,.16) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 8.4l2.6 2.5L12 5.4' fill='none' stroke='%233ECCBF' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/65% no-repeat}
.dk .dl:has(.dc-one){grid-template-columns:minmax(0,1fr)}
.dk .ticks.t2{grid-template-columns:repeat(2,minmax(0,1fr));column-gap:48px}
.dk .ticks.sup{border-top:1px solid var(--line-2);padding-top:44px}
.dk .dc-one{padding:52px 56px;gap:44px}
.dk .dc-one .t{font-size:32px}
.dk .dc-one .ticks{row-gap:40px}
.dk .dc-one .ticks li{font-size:31px;white-space:nowrap}
.dk .dc-one .note{font-size:28px;padding:26px 30px}
.dk .note{margin-top:auto;border-radius:16px;background:rgba(62,204,191,.08);border:1px solid rgba(62,204,191,.2);padding:22px 24px;font-size:26px;line-height:1.4;color:var(--ink-2)}
.dk .note b{color:var(--brand);font-weight:600}
/* três produtos no plano: um card por coluna, mais justo */
.dk .dl3 .dc{padding:28px 30px;gap:18px}
.dk .dl3 .dc .t{font-size:24px}
.dk .dl3 .ticks li{gap:12px}
.dk .dl3 .ticks.sup{padding-top:22px}
.dk .dl3 .note{font-size:21px;padding:16px 18px}

/* garantia */
.dk .gar{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:90px;align-items:center}
.dk .shield{width:340px;height:340px;border-radius:50%;border:1px solid var(--line-2);background:radial-gradient(closest-side,rgba(62,204,191,.16),rgba(62,204,191,.03) 80%);display:flex;align-items:center;justify-content:center;box-shadow:0 60px 120px -60px rgba(62,204,191,.5)}

/* aceite, no palco escuro */
.dk .accept-btn{background:var(--brand);color:var(--brand-ink)}
.dk .accept-btn:hover{background:#5BD9CE}
.dk .accept-ok{color:var(--brand)}

/* ── Impressão: um slide por página, no tamanho de projeto ──────────────── */
@media print {
  @page { size: 1920px 1080px; margin: 0; }
  html, body { overflow: visible; background: #fff; height: auto; }
  .stage { position: static; display: block; }
  .canvas { transform: none !important; width: 1920px; height: auto; box-shadow: none; }
  .canvas > section { position: relative; inset: auto; visibility: visible; opacity: 1;
    break-after: page; page-break-after: always; }
  .canvas > section[hidden] { display: none; }
  .canvas > section.dk[hidden] { display: none !important; }
  .hud, .notas, .fita { display: none !important; }
}
`;

// Fotos da operação: as MESMAS do deck antigo (slide `nossa_operacao` do
// `pt_leverads`), que já rodaram em call. Moravam no bucket `proposal-assets`
// do Supabase Cloud do PRODUTO, que vai ser desligado; agora são estáticos do
// próprio cockpit (packages/web/public/proposal-assets). Caminho relativo: o
// deck só abre em página do cockpit (/p/:id, preview), em qualquer ambiente.
// Na mesma pasta ficam a logo do palco escuro e as telas do produto que entram
// na janela da demonstração (oem-criar, ads-copiar-giro, price-inicio).
const ASSETS = "/proposal-assets/leverads";
const FOTOS = {
  estoque: `${ASSETS}/operacao-interna-2.jpg`,
  interna: `${ASSETS}/operacao-interna-1.jpg`,
  galpao: `${ASSETS}/operacao-barracao-novo.jpg`,
};

// Card vazio do slide de resultados: é o que aparece quando NENHUM case está
// publicado. Mesma estrutura do card real (`cardCase`), com colchete no lugar de
// cada número, pra que o closer veja na tela o que falta autorizar em vez de um
// slide que some. Nome de cliente nunca fica escrito aqui: só entra na tela o
// case publicado e autorizado (cases.js).
const CASE_VAZIO = `<div class="card" style="padding:30px 36px;display:flex;flex-direction:column;min-width:0"><div style="font-size:24px;font-weight:600;color:var(--ink-3)">[Cliente]</div><div class="tab" style="margin-top:18px;font-size:76px;font-weight:700;color:var(--brand);letter-spacing:-.045em;line-height:1;white-space:nowrap">[R$ xx mil]</div><div style="margin-top:10px;font-size:22px;color:var(--ink-3)">gerados por anúncios da Lever</div><div style="margin-top:22px;padding-top:20px;border-top:1px solid var(--line-2);display:grid;grid-template-columns:1fr 1fr;gap:16px"><div><div class="tab" style="font-size:30px;font-weight:700;color:var(--ink)">[x mil]</div><div style="font-size:19px;color:var(--ink-3);margin-top:4px">pedidos</div></div><div><div class="tab" style="font-size:30px;font-weight:700;color:var(--ink)">[x mil]</div><div style="font-size:19px;color:var(--ink-3);margin-top:4px">anúncios criados</div></div></div></div>`;

const SLIDES = `
<section data-label="Capa" data-screen-label="Capa" data-speaker-notes="Abertura. Confirme quem está na sala e diga em uma frase o que vem: quem somos, o método, a demonstração e o investimento." class="dk cover glow">
  <div class="brand"><img src="${ASSETS}/logo-lever-dark.svg" alt="">Lever</div>
  <div class="mid">
    <div class="eb">Proposta comercial</div>
    <h1 class="h" style="font-size:112px;margin:0">O método que usamos para escalar nossa operação, <span class="a">aplicado ao seu negócio.</span></h1>
    <div style="font-size:34px;color:var(--ink-2);line-height:1.45"><span data-f="planoNome"></span></div>
  </div>
  <div class="foot">
    <span><span data-f="f.nome"></span> · <span data-f="f.empresa"></span></span>
    <span class="mono tab" style="color:var(--ink-4)"><span data-f="hoje"></span></span>
  </div>
</section>

<section class="dk" data-label="Quem somos" data-screen-label="01 Quem somos" data-speaker-notes="Credibilidade primeiro: somos sellers. Conte a história do primeiro barracão ao galpão de hoje e conecte com a dor que o cliente vive.">
  <div class="hd"><span class="eb">Quem somos</span><span class="pg">01</span></div>
  <div class="body who">
    <div style="min-width:0">
      <h2 class="h" style="font-size:72px;margin:0 0 16px">Mais um sistema criado por quem <span class="a">nunca vendeu?</span></h2>
      <div style="font-size:38px;font-weight:700;color:var(--brand);margin-bottom:28px;letter-spacing:-.03em">Longe disso.</div>
      <p class="lede" style="font-size:27px;margin-bottom:18px;color:var(--ink-2)">A Lever foi feita de seller pra seller. Ninguém aqui aprendeu marketplace em curso: a gente construiu uma operação de verdade, do primeiro barracão ao galpão de hoje, girando produto todo dia.</p>
      <p class="lede soft" style="font-size:27px">Cada fluxo dentro da plataforma nasceu de uma dor nossa. A dor de uma operação que fatura dezenas de milhões por ano e precisava crescer sem inchar a equipe.</p>
      <div class="stats">
        <div class="card stat"><b>+R$ 30 mi</b><span>de faturamento próprio em 2026</span></div>
        <div class="card stat"><b>+10 mil</b><span>pedidos por mês</span></div>
        <div class="card stat"><b>+10 anos</b><span>de marketplace</span></div>
      </div>
    </div>
    <div style="min-width:0;display:flex;flex-direction:column;gap:20px">
      <div class="eb">A operação por dentro</div>
      <div class="photos">
        <div class="big"><img src="${FOTOS.estoque}" alt="Estoque da nossa operação, com milhares de peças em prateleira"></div>
        <div><img src="${FOTOS.interna}" alt="Vista interna do galpão, com as bancadas de separação"></div>
        <div><img src="${FOTOS.galpao}" alt="Fachada do galpão de hoje"></div>
      </div>
      <div style="font-size:26px;color:var(--ink-3);line-height:1.45">Milhares de peças girando todo dia. A operação que virou ferramenta.</div>
    </div>
  </div>
</section>

<section class="dk" data-label="O método" data-screen-label="02 Método" data-speaker-notes="Slide de virada. Deixe claro que a venda não é de software: é do processo. Os próximos slides são os produtos do plano escolhido.">
  <div class="hd"><span class="eb">O método</span><span class="pg">02</span></div>
  <div class="body" style="display:flex;flex-direction:column;justify-content:center;gap:44px;max-width:1500px">
    <h2 class="h" style="font-size:100px;margin:0">Não é um software. É o método que usamos pra escalar a nossa operação, <span class="a">alavancado por tecnologia.</span></h2>
    <p class="lede soft" style="max-width:1060px">Tecnologia qualquer um compra. O que faz o número mudar é o processo por trás dela. Este é o método que vamos ligar na sua operação.</p>
  </div>
</section>

<section class="dk" data-if="oem" data-label="Lever OEM" data-screen-label="02a Efeito teia" data-speaker-notes="Abra pelo estoque parado: pergunte há quanto tempo as peças dele estão sem venda. Depois os três pilares: criação de anúncio por OEM, em que ele cola o código e a peça volta com título, compatibilidade, ficha técnica e descrição; SAC automatizado, com as perguntas e o pós-venda de todas as contas respondidos a partir da descrição dos produtos; e múltiplas contas e automações, com Mercado Livre e Shopee num painel só, anúncio, estoque e preço replicados sozinhos e a edição por SKU valendo para todas as contas.">
  <div class="hd"><span class="eb">Lever OEM · método</span><span class="pg">02</span></div>
  <div class="body" style="display:grid;grid-template-columns:minmax(0,.88fr) minmax(0,1.12fr);gap:80px;align-items:center">
    <div style="min-width:0">
      <h3 class="h" style="font-size:112px;margin:0 0 34px">Efeito <span class="a">teia.</span></h3>
      <p class="lede soft" style="color:var(--ink-2)">Estoque sem anúncio é dinheiro parado na prateleira. Com o efeito teia, um anúncio publicado vai para todas as suas contas, e uma edição chega em todas de uma vez. Mais alcance, mesma equipe.</p>
    </div>
    <div style="min-width:0;display:flex;flex-direction:column;gap:18px">
      <div class="card feat"><span class="ic"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h10M4 17h7"></path><path d="m16 15 2 2 4-4"></path></svg></span><div><b>Criação de anúncio por OEM</b><span>Cole o código e, em 2 a 3 minutos, a peça volta com título, compatibilidade, ficha técnica e descrição prontos.</span></div></div>
      <div class="card feat"><span class="ic"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v10H9l-5 4z"></path><path d="M8 9h8M8 12h5"></path></svg></span><div><b>SAC automatizado</b><span>Perguntas e pós-venda de todas as contas num lugar só, respondidos a partir da descrição dos seus produtos.</span></div></div>
      <div class="card feat"><span class="ic"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="7" height="7" rx="1.5"></rect><rect x="13" y="13" width="7" height="7" rx="1.5"></rect><path d="M11 7.5h4.5v4M13 16.5H8.5v-4"></path></svg></span><div><b>Múltiplas contas e automações</b><span>Mercado Livre e Shopee num painel só. Anúncio, estoque e preço se replicam sozinhos, e a edição por SKU vale para todas as contas.</span></div></div>
    </div>
  </div>
</section>

<section class="dk" data-if="ads" data-label="Lever Ads" data-screen-label="02b Lever Ads" data-speaker-notes="Efeito teia: um anúncio publicado vai para todas as contas do cliente, e uma edição chega em todas de uma vez. Depois os três pilares: todas as contas num painel só, replicação automática e atendimento automático.">
  <div class="hd"><span class="eb">Lever Ads · método</span><span class="pg">02</span></div>
  <div class="body" style="display:grid;grid-template-columns:minmax(0,.88fr) minmax(0,1.12fr);gap:80px;align-items:center">
    <div style="min-width:0">
      <h3 class="h" style="font-size:112px;margin:0 0 34px">Efeito <span class="a">teia.</span></h3>
      <p class="lede soft" style="color:var(--ink-2)">Hoje, cada conta nova é trabalho dobrado. Com o efeito teia, um anúncio publicado vai para todas as suas contas, e uma edição chega em todas de uma vez. Mais alcance, mesma equipe.</p>
    </div>
    <div style="min-width:0;display:flex;flex-direction:column;gap:18px">
      <div class="card feat"><span class="ic"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"></rect><path d="M3 9h18M8 21h8"></path></svg></span><div><b>Múltiplas contas, um painel</b><span>Todas conectadas, cada uma com as próprias regras respeitadas.</span></div></div>
      <div class="card feat"><span class="ic"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="7" height="7" rx="1.5"></rect><rect x="13" y="13" width="7" height="7" rx="1.5"></rect><path d="M11 7.5h4.5v4M13 16.5H8.5v-4"></path></svg></span><div><b>Replicação automática</b><span>Anúncio novo se espalha sozinho. SKU editado, atualizado em todas.</span></div></div>
      <div class="card feat"><span class="ic"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v10H9l-5 4z"></path><path d="M8 9h8M8 12h5"></path></svg></span><div><b>Atendimento automático</b><span>Perguntas e pós-venda respondidos por IA com o contexto do seu catálogo.</span></div></div>
    </div>
  </div>
</section>

<section class="dk" data-if="price" data-label="Lever Price" data-screen-label="02c Lever Price" data-speaker-notes="A espiral do lucro é o faturamento subir com o lucro subindo junto, ou pelo menos com a mesma margem. Margem mínima: o preço se ajusta sozinho quando muda o frete do Mercado Livre ou o custo do fornecedor. Reprecificação em massa: todos os anúncios prontos para as melhores promoções, sem furar a margem. Promoção com critério: mais alcance para o anúncio, preço mais atraente e o rebate priorizado para manter ou aumentar a margem.">
  <div class="hd"><span class="eb">Lever Price · método</span><span class="pg">02</span></div>
  <div class="body" style="display:grid;grid-template-columns:minmax(0,.88fr) minmax(0,1.12fr);gap:80px;align-items:center">
    <div style="min-width:0">
      <h3 class="h" style="font-size:112px;margin:0 0 34px">Espiral do <span class="p">lucro.</span></h3>
      <p class="lede soft" style="color:var(--ink-2)">Faturamento crescendo e lucro crescendo junto. Você define a margem mínima; a Lever ajusta preço e promoções sozinha, para você vender mais com a margem igual ou maior.</p>
    </div>
    <div style="min-width:0;display:flex;flex-direction:column;gap:18px">
      <div class="card feat"><span class="ic"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 4.5 3.4 7.8 8 9 4.6-1.2 8-4.5 8-9V6z"></path><path d="M12 8v8M10 10.5c0-.8.9-1.3 2-1.3s2 .5 2 1.2c0 1.8-4 .9-4 2.8 0 .7.9 1.3 2 1.3s2-.5 2-1.3"></path></svg></span><div><b>Margem mínima protegida</b><span>Você fatura e sobra lucro. Mudou o frete do Mercado Livre ou o custo do fornecedor, o preço se ajusta sozinho.</span></div></div>
      <div class="card feat"><span class="ic"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V4M4 20h16"></path><path d="M7 15l4-4 3 3 5-6"></path></svg></span><div><b>Reprecificação em massa</b><span>Reprecifica todos os anúncios para entrar nas melhores promoções, sem passar da margem mínima.</span></div></div>
      <div class="card feat"><span class="ic"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4"></path><path d="m9 12 2 2 4-4"></path></svg></span><div><b>Promoção automática com critério</b><span>Entra nas melhores promoções: mais alcance para o anúncio, preço mais atraente e margem mantida pelo rebate.</span></div></div>
    </div>
  </div>
</section>

<section class="dk" data-label="Demonstração" data-screen-label="03 Demonstração" data-speaker-notes="Pare o deck aqui e abra a plataforma. Volte para o slide seguinte quando terminar a demo.">
  <div class="hd"><span class="eb">Demonstração</span><span class="pg">03</span></div>
  <div class="body" style="display:grid;grid-template-columns:minmax(0,.78fr) minmax(0,1.22fr);gap:72px;align-items:center">
    <div style="min-width:0;display:flex;flex-direction:column;gap:34px">
      <h2 class="h" style="font-size:100px;margin:0">Vamos ver <span class="a">funcionando.</span></h2>
      <p class="lede soft">Vou abrir a plataforma e mostrar <span data-f="demoLista"></span> rodando em contas reais, agora.</p>
    </div>
    <div style="min-width:0">
      <div class="window" data-win="oem">
        <div class="win-bar"><div class="dots"><i></i><i></i><i></i></div><div class="win-url">leverads.com.br · Anunciar peças</div></div>
        <img src="${ASSETS}/oem-criar.webp" alt="Tela Anunciar peças do Lever OEM">
      </div>
      <div class="window" data-win="ads">
        <div class="win-bar"><div class="dots"><i></i><i></i><i></i></div><div class="win-url">leverads.com.br · Copiar anúncios</div></div>
        <img src="${ASSETS}/ads-copiar-giro.webp" alt="Tela Copiar anúncios do Lever Ads">
      </div>
      <div class="window" data-win="price">
        <div class="win-bar"><div class="dots"><i></i><i></i><i></i></div><div class="win-url">leverprice.com.br · Início</div></div>
        <img src="${ASSETS}/price-inicio.webp" alt="Tela inicial do Lever Price">
      </div>
    </div>
  </div>
</section>

<section class="dk" data-label="Como você entra" data-screen-label="04 Como você entra" data-speaker-notes="Tire o medo da implantação: grupo no WhatsApp no dia 0, plano de ação e integração no dia 1 ou 2, já com os processos liberados, e acompanhamento todo mês.">
  <div class="hd"><span class="eb">O que acontece depois do sim</span><span class="pg">04</span></div>
  <div class="body" style="display:flex;flex-direction:column;justify-content:center">
    <h2 class="h" style="font-size:96px;margin:0 0 26px;max-width:1500px">Você fecha hoje. <span class="a" style="white-space:nowrap">Em dias, está rodando.</span></h2>
    <p class="lede soft" style="max-width:1100px;margin-bottom:64px">Sem manual pra ler, sem ficar sozinho com um login.<br>A gente entra junto na sua operação e só sai quando o número aparece.</p>
    <div class="track"><i></i></div>
    <ul class="steps">
      <li><div class="top"><span class="sn">1</span><span class="dia">Dia 0</span></div><h3>Grupo no WhatsApp</h3><p>Você, seu time e o nosso no mesmo canal. Resposta direta, sem ticket.</p></li>
      <li><div class="top"><span class="sn">2</span><span class="dia">Dia 1–2</span></div><h3>Plano de ação e integração</h3><p>Conectamos suas contas, definimos as regras e liberamos os processos da nossa operação.</p></li>
      <li><div class="top"><span class="sn">∞</span><span class="dia">Todo mês</span></div><h3>Acompanhamento</h3><p>Resultado conferido com você, em reais, dentro do painel.</p></li>
    </ul>
  </div>
</section>

<section class="dk" data-label="Foco no resultado" data-screen-label="05 Foco no resultado" data-speaker-notes="A plataforma é o meio. Percorra o ciclo com o dedo na tela: estratégia aplicada, alcance multiplicado, faturamento maior.">
  <div class="hd"><span class="eb">Foco no resultado</span><span class="pg">05</span></div>
  <div class="body cyc">
    <div style="min-width:0">
      <h2 class="h" style="font-size:84px;margin:0 0 36px">Nosso objetivo é você <span class="a">faturando e lucrando mais.</span></h2>
      <p class="lede soft" style="margin-bottom:22px;color:var(--ink-2)">A plataforma é o meio. O fim é o número na sua conta no fim do mês. É por ele que a gente se mede.</p>
      <p class="lede soft">Cada estratégia que rodamos na nossa operação entra na sua. Quanto mais ela gira, mais a Lever se paga sozinha.</p>
    </div>
    <div class="card cycbox" style="min-width:0">
      <div class="eb" style="margin-bottom:56px">O ciclo</div>
      <div style="position:relative;aspect-ratio:1;max-width:560px;margin:0 auto">
        <svg viewBox="0 0 200 200" width="100%" height="100%" fill="none" style="display:block">
          <defs><marker id="cyc-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5 0 10z" fill="var(--brand)"></path></marker></defs>
          <circle cx="100" cy="100" r="52" stroke="var(--line-2)" stroke-width="1.2"></circle>
          <path d="M100 48 A52 52 0 0 1 145 74" stroke="var(--brand)" stroke-width="2.5" stroke-linecap="round" marker-end="url(#cyc-arrow)"></path>
          <path d="M145 126 A52 52 0 0 1 100 152" stroke="var(--brand)" stroke-width="2.5" stroke-linecap="round" marker-end="url(#cyc-arrow)"></path>
          <path d="M55 126 A52 52 0 0 1 55 74" stroke="var(--brand)" stroke-width="2.5" stroke-linecap="round" marker-end="url(#cyc-arrow)"></path>
        </svg>
        <div class="bd" style="left:50%;top:24%;transform:translate(-50%,-50%)">01</div>
        <div class="bd" style="left:72.5%;top:63%;transform:translate(-50%,-50%)">02</div>
        <div class="bd" style="left:27.5%;top:63%;transform:translate(-50%,-50%)">03</div>
        <div class="lb" style="left:50%;top:-2%;transform:translateX(-50%);width:64%">A plataforma aplica nossas estratégias</div>
        <div class="lb" style="right:-4%;top:78%;width:44%">Você multiplica seu alcance</div>
        <div class="lb" style="left:-4%;top:78%;width:44%">Isso aumenta seu faturamento</div>
        <div class="lb" style="left:50%;top:50%;transform:translate(-50%,-50%);width:36%;color:var(--ink-3);font-weight:500">E o ciclo recomeça</div>
      </div>
    </div>
  </div>
</section>

<section class="dk" data-if="resultados" data-label="Quem já está dentro" data-screen-label="06 Resultados" data-speaker-notes="Resultados do painel de vendas da Lever. Em cima, o geral: quanto já foi vendido em anúncios que a Lever criou, que fatia das vendas dos clientes vem desses anúncios e a mediana de dias da conexão até a primeira venda. No meio, os clientes escolhidos pelo nicho deste lead, no acumulado desde a entrada de cada um: valor gerado por anúncios da Lever, pedidos e anúncios criados. Sem case publicado, a tela mostra colchetes. Embaixo, a segurança: a plataforma usa a infraestrutura tecnológica da Oracle, a mesma usada por Caixa, TIM, Zoom e Uber; e a Lever é parceira oficial da EQI, a terceira maior corretora do Brasil e a que mais faz M&amp;A. Conte o que aconteceu, sem prometer o mesmo número." style="padding-top:56px;padding-bottom:80px">
  <div class="hd" style="margin-bottom:22px"><span class="eb">Quem já está dentro</span><span class="pg">06</span></div>
  <h2 class="h" style="font-size:62px;margin:0;max-width:1500px">Sellers com a mesma dor que a sua.<br><span class="a">O que mudou com a Lever.</span></h2>
  <div style="flex:1;display:flex;flex-direction:column;justify-content:center;min-height:0;padding-block:28px;gap:20px">
    <!--RESULTADOS_VIVOS-->
    <div class="cs3" data-cases hidden></div>
    <div class="cs3" data-cases-fallback>${CASE_VAZIO.repeat(3)}</div>
    <!--RESULTADOS_FONTE-->
  </div>
  <div class="sec6">
    <div style="flex:none"><div class="lab">Segurança</div><div class="row" style="--g:12px"><span style="font-size:22px">Infraestrutura tecnológica da</span><svg role="img" aria-label="Oracle" viewBox="0 0 231 30" style="height:18px;width:auto;flex:none"><path d="M99.61,19.52h15.24l-8.05-13L92,30H85.27l18-28.17a4.29,4.29,0,0,1,7-.05L128.32,30h-6.73l-3.17-5.25H103l-3.36-5.23m69.93,5.23V0.28h-5.72V27.16a2.76,2.76,0,0,0,.85,2,2.89,2.89,0,0,0,2.08.87h26l3.39-5.25H169.54M75,20.38A10,10,0,0,0,75,.28H50V30h5.71V5.54H74.65a4.81,4.81,0,0,1,0,9.62H58.54L75.6,30h8.29L72.43,20.38H75M14.88,30H32.15a14.86,14.86,0,0,0,0-29.71H14.88a14.86,14.86,0,1,0,0,29.71m16.88-5.23H15.26a9.62,9.62,0,0,1,0-19.23h16.5a9.62,9.62,0,1,1,0,19.23M140.25,30h17.63l3.34-5.23H140.64a9.62,9.62,0,1,1,0-19.23h16.75l3.38-5.25H140.25a14.86,14.86,0,1,0,0,29.71m69.87-5.23a9.62,9.62,0,0,1-9.26-7h24.42l3.36-5.24H200.86a9.61,9.61,0,0,1,9.26-7h16.76l3.35-5.25h-20.5a14.86,14.86,0,0,0,0,29.71h17.63l3.35-5.23h-20.6" transform="translate(-0.02 0)" fill="#C74634"></path></svg></div></div>
    <div style="margin-left:56px;margin-right:auto;flex:none"><div class="lab">A mesma de</div><div class="row" style="--g:28px"><span class="wm" style="font-size:23px;font-weight:800;letter-spacing:.05em">CAIXA</span><span class="wm" style="font-size:23px;font-weight:800;letter-spacing:.08em">TIM</span><span class="wm" style="font-size:27px;font-weight:800;letter-spacing:-0.03em">zoom</span><span class="wm" style="font-size:25px;font-weight:600;letter-spacing:-0.01em">Uber</span></div></div>
    <div class="vr"></div>
    <div style="flex:1;min-width:0"><div class="lab">Parceria</div><div class="row" style="--g:10px"><span style="font-size:22px">Parceiro oficial da EQI</span><span style="color:var(--ink-3);font-size:19px">· 3ª maior corretora do Brasil</span><span style="margin-left:auto;font-size:30px;font-weight:800;letter-spacing:-0.02em;line-height:1">EQI</span></div></div>
  </div>
</section>

<section class="dk" data-if="price" data-label="Quem já usa o Lever Price" data-screen-label="06 Resultados · Lever Price" data-speaker-notes="Cases do Lever Price, identificados só pelo nicho. À esquerda, uma autopeças antes e depois de ligar o Price: junho a agosto contra outubro e novembro até o dia 12. A sobra subiu R$ 112.478 por mês, a margem foi de 6,1% para 8,6%, as vendas no prejuízo caíram de 762 para 54 por mês, a mensalidade se paga 43 vezes e o rebate do Mercado Livre foi de R$ 0 em setembro para R$ 17.745 em outubro. À direita, o rebate de setembro para outubro em outras operações: pesca e camping de R$ 118 para R$ 7.006, importados de R$ 121 para R$ 3.971 e pet de R$ 24.330 para R$ 44.902. Em outubro, os clientes do Price recuperaram R$ 557.696 de rebate. Embaixo, a segurança: a plataforma usa a infraestrutura tecnológica da Oracle, a mesma usada por Caixa, TIM, Zoom e Uber; e a Lever é parceira oficial da EQI, a terceira maior corretora do Brasil e a que mais faz M&amp;A. Conte o que aconteceu, sem prometer o mesmo número." style="padding-top:56px;padding-bottom:80px">
  <div class="hd" style="margin-bottom:22px"><span class="eb">Quem já está dentro</span><span class="pg">06</span></div>
  <h2 class="h" style="font-size:62px;margin:0;max-width:1500px">Sellers com a mesma dor que a sua. <span class="p">O que mudou com o Lever Price.</span></h2>
  <div style="flex:1;display:flex;flex-direction:column;justify-content:center;min-height:0;padding-block:34px">
    <div style="display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:24px;align-items:stretch">
      <div class="card r1">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:16px"><span style="font-size:26px;font-weight:600;white-space:nowrap">Autopeças</span><span style="font-size:21px;color:var(--ink-3);white-space:nowrap">jun a ago → out e nov</span></div>
        <div class="tab" style="margin-top:18px;font-size:116px;font-weight:700;color:var(--brand);letter-spacing:-.05em;line-height:1;white-space:nowrap">+R$&nbsp;112.478</div>
        <div style="margin-top:10px;font-size:26px;color:var(--ink-2)">a mais de sobra todo mês</div>
        <div style="margin-top:28px;padding-top:24px;border-top:1px solid var(--line-2);display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px 20px">
          <div><div class="kv">Margem</div><div>6,1% → 8,6%</div></div>
          <div><div class="kv">Vendas no prejuízo</div><div style="color:var(--brand)">762 → 54<span style="font-size:20px;font-weight:600;margin-left:10px">−93%</span></div></div>
          <div><div class="kv">A mensalidade se paga</div><div>43×</div></div>
          <div><div class="kv">Rebate do Mercado Livre <span>· set → out</span></div><div style="color:var(--brand)">R$ 0 → R$ 17.745</div></div>
        </div>
      </div>
      <div class="card r2c"><div style="display:flex;align-items:baseline;justify-content:space-between;gap:16px;padding-bottom:8px"><span style="font-size:26px;font-weight:600;white-space:nowrap">Rebate do Mercado Livre</span><span style="font-size:21px;color:var(--ink-3);white-space:nowrap">setembro → outubro</span></div>
        <div class="rrow"><div style="min-width:0"><b>Pesca e camping</b><small>antes R$ 118</small></div><em>R$ 7.006</em></div>
        <div class="rrow"><div style="min-width:0"><b>Importados</b><small>antes R$ 121</small></div><em>R$ 3.971</em></div>
        <div class="rrow"><div style="min-width:0"><b>Pet</b><small>antes R$ 24.330</small></div><em>R$ 44.902</em></div>
      </div>
    </div>
  </div>
  <div class="sec6">
    <div style="flex:none"><div class="lab">Segurança</div><div class="row" style="--g:12px"><span style="font-size:22px">Infraestrutura tecnológica da</span><svg role="img" aria-label="Oracle" viewBox="0 0 231 30" style="height:18px;width:auto;flex:none"><path d="M99.61,19.52h15.24l-8.05-13L92,30H85.27l18-28.17a4.29,4.29,0,0,1,7-.05L128.32,30h-6.73l-3.17-5.25H103l-3.36-5.23m69.93,5.23V0.28h-5.72V27.16a2.76,2.76,0,0,0,.85,2,2.89,2.89,0,0,0,2.08.87h26l3.39-5.25H169.54M75,20.38A10,10,0,0,0,75,.28H50V30h5.71V5.54H74.65a4.81,4.81,0,0,1,0,9.62H58.54L75.6,30h8.29L72.43,20.38H75M14.88,30H32.15a14.86,14.86,0,0,0,0-29.71H14.88a14.86,14.86,0,1,0,0,29.71m16.88-5.23H15.26a9.62,9.62,0,0,1,0-19.23h16.5a9.62,9.62,0,1,1,0,19.23M140.25,30h17.63l3.34-5.23H140.64a9.62,9.62,0,1,1,0-19.23h16.75l3.38-5.25H140.25a14.86,14.86,0,1,0,0,29.71m69.87-5.23a9.62,9.62,0,0,1-9.26-7h24.42l3.36-5.24H200.86a9.61,9.61,0,0,1,9.26-7h16.76l3.35-5.25h-20.5a14.86,14.86,0,0,0,0,29.71h17.63l3.35-5.23h-20.6" transform="translate(-0.02 0)" fill="#C74634"></path></svg></div></div>
    <div style="margin-left:56px;margin-right:auto;flex:none"><div class="lab">A mesma de</div><div class="row" style="--g:28px"><span class="wm" style="font-size:23px;font-weight:800;letter-spacing:.05em">CAIXA</span><span class="wm" style="font-size:23px;font-weight:800;letter-spacing:.08em">TIM</span><span class="wm" style="font-size:27px;font-weight:800;letter-spacing:-0.03em">zoom</span><span class="wm" style="font-size:25px;font-weight:600;letter-spacing:-0.01em">Uber</span></div></div>
    <div class="vr"></div>
    <div style="flex:1;min-width:0"><div class="lab">Parceria</div><div class="row" style="--g:10px"><span style="font-size:22px">Parceiro oficial da EQI</span><span style="color:var(--ink-3);font-size:19px">· 3ª maior corretora do Brasil</span><span style="margin-left:auto;font-size:30px;font-weight:800;letter-spacing:-0.02em;line-height:1">EQI</span></div></div>
  </div>
</section>

<section class="dk" data-label="Entregáveis" data-screen-label="07 Entregáveis" data-speaker-notes="Recapitule item a item o que entra no plano montado no configurador. É a ponte para o preço." style="padding-top:56px">
  <div class="hd" style="margin-bottom:34px"><span class="eb">Recapitulando</span><span class="pg">07</span></div>
  <h2 class="h" style="font-size:80px;margin:0 0 40px;max-width:1500px">Tudo o que entra na sua operação <span class="a">com este plano.</span></h2>
  <div class="body dl">
    <div data-entregaveis style="display:contents"></div>
  </div>
</section>

<section class="dk" data-label="Investimento" data-screen-label="08 Investimento" data-speaker-notes="Diga o valor com calma e fique em silêncio. O próximo slide traduz a parcela em vendas.">
  <div class="hd"><span class="eb">Investimento</span><span class="pg">08</span></div>
  <div class="body" style="display:flex;flex-direction:column;justify-content:center;gap:44px">
    <div style="font-size:46px;font-weight:600;letter-spacing:-.025em;color:var(--ink-3)">Plano <span data-f="periodoLabel"></span> · <span data-f="planoNome"></span></div>
    <div class="tab" style="display:flex;align-items:flex-end;gap:24px">
      <div style="display:flex;flex-direction:column;gap:10px;font-size:42px;font-weight:600;color:var(--ink-3);line-height:1;padding-bottom:26px"><span><span data-f="parcelas"></span>×</span><span>R$</span></div>
      <div style="font-size:250px;font-weight:700;letter-spacing:-.055em;line-height:.86"><span data-f="mensalFmt"></span></div>
      <div style="font-size:42px;font-weight:600;color:var(--ink-3);line-height:1;padding-bottom:28px">,00</div>
    </div>
    <div style="font-size:42px;font-weight:600;letter-spacing:-.025em;color:var(--brand)">ou R$ <span data-f="vistaFmt"></span> à vista</div>
  </div>
</section>

<section class="dk" data-if="pratica" data-label="Na prática" data-screen-label="09 Na prática" data-speaker-notes="Traduza a parcela em pedidos: com o ticket médio informado, são poucas vendas a mais por mês. Tudo acima disso é lucro novo. Ticket médio e pedidos por mês vêm da tela de configuração; sem os dois, o slide não aparece.">
  <div class="hd"><span class="eb">Na prática</span><span class="pg">09</span></div>
  <div class="body" style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,.95fr);gap:72px;align-items:center">
    <div style="min-width:0">
      <h2 class="h" style="font-size:76px;margin:0 0 30px"><span class="a"><span data-f="vendasNecessarias"></span> vendas a mais</span> por mês. É isso que paga a Lever.</h2>
      <p class="lede" style="font-size:29px;margin:0 0 22px">Com ticket médio de R$ <span data-f="ticketFmt"></span>, a parcela equivale a <span data-f="vendasNecessarias"></span> pedidos. Você já faz <span data-f="pedidosFmt"></span> por mês. Estamos falando de <b style="color:var(--ink)"><span data-f="percentualExtra"></span></b> a mais. Tudo acima disso é lucro novo.</p>
      <div style="font-size:21px;color:var(--ink-4);line-height:1.45">Parcela ÷ ticket médio, arredondado pra cima. Sem contar a hora de equipe que volta.</div>
    </div>
    <div class="card" style="padding:40px 44px;min-width:0">
      <div style="font-size:24px;font-weight:500;color:var(--ink-3);margin-bottom:24px">Retorno × investimento</div>
      <div style="position:relative">
        <svg viewBox="0 0 400 260" width="100%" style="display:block;overflow:visible" fill="none" aria-hidden="true">
          <path d="M28 232H386M28 232V22" stroke="var(--line-2)" stroke-width="1.5"></path>
          <path d="M380 228l6 4-6 4M24 28l4-6 4 6" stroke="var(--line-2)" stroke-width="1.5"></path>
          <path d="M28 232C110 150 170 128 380 126" stroke="var(--ink-4)" stroke-width="2" stroke-dasharray="5 5"></path>
          <path d="M28 232C120 232 150 70 290 58" stroke="var(--brand)" stroke-width="3"></path>
          <circle cx="134.9" cy="156.5" r="12" stroke="var(--brand)" stroke-width="3" fill="var(--bg)"></circle>
        </svg>
        <div style="position:absolute;left:35%;top:66%;font-size:23px;font-weight:600;line-height:1.3;color:var(--ink)">Retorno sobre<br>investimento</div>
        <div style="position:absolute;right:0;top:50%;font-size:23px;font-weight:600;text-align:right;line-height:1.3;color:var(--ink-3)">Valor<br>investido</div>
        <div style="position:absolute;right:0;top:0;text-align:right;max-width:36%"><div class="tab" style="font-size:72px;font-weight:700;letter-spacing:-.045em;line-height:1;color:var(--brand)">+<span data-f="vendasNecessarias"></span></div><div style="font-size:22px;font-weight:600;color:var(--ink-3);margin-top:8px;line-height:1.3">vendas a mais<br>por mês</div></div>
      </div>
    </div>
  </div>
</section>

<section class="dk" data-label="Garantia" data-screen-label="10 Garantia" data-speaker-notes="Feche o risco: 60% de uso nos dois primeiros meses, faturamento não subiu no valor da parcela, devolvemos tudo. Depois pergunte se faz sentido começar.">
  <div class="hd"><span class="eb">Garantia incondicional</span><span class="pg">10</span></div>
  <div class="body gar">
    <div style="min-width:0">
      <h2 class="h" style="font-size:84px;margin:0 0 34px">Se a Lever não pagar a própria parcela, <span class="a">você recebe tudo de volta.</span></h2>
      <p class="lede soft" style="margin-bottom:38px;max-width:1100px;color:var(--ink-2)">Use a plataforma com pelo menos 60% da capacidade nos primeiros 2 meses. Se o seu faturamento não subir no valor da parcela, devolvemos cada centavo. Sem letra miúda.</p>
      <div style="border-top:1px solid var(--line);padding-top:28px;max-width:1100px;display:flex;flex-direction:column;gap:10px">
        <div style="font-size:28px;color:var(--ink-3);line-height:1.45">Até hoje, nenhum cliente precisou acionar a garantia.</div>
        <div style="font-size:28px;font-weight:600;color:var(--ink);line-height:1.45">O risco dessa decisão é nosso. O único risco seu é continuar como está.</div>
      </div>
    </div>
    <div class="shield"><svg width="55%" height="55%" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5 4 5.5v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10v-6z"></path><path d="m8.5 12 2.3 2.3L15.5 9.5" stroke-width="1.9"></path></svg></div>
  </div>
</section>

<section data-label="Encerramento" data-screen-label="11 Encerramento" data-speaker-notes="Último slide: repita o plano e a condição, e combine o próximo passo ainda na call." class="dk cover glow low">
  <div class="brand"><img src="${ASSETS}/logo-lever-dark.svg" alt="">Lever</div>
  <div class="mid" style="gap:30px">
    <div class="eb">Proposta · <span data-f="f.empresa"></span></div>
    <h2 class="h" style="font-size:116px;margin:0"><span data-f="planoNome" class="p"></span></h2>
    <div class="tab" style="font-size:56px;font-weight:600;letter-spacing:-.03em;color:var(--ink-2)"><span data-f="parcelas"></span>× R$ <span data-f="mensalFmt"></span> <span class="a">ou R$ <span data-f="vistaFmt"></span> à vista</span></div>
  </div>
  <div class="foot">
    <span class="accept-wrap" data-client-only hidden><button type="button" class="accept-btn" data-act="aceitar">Quero começar</button></span>
    <span>Condições válidas apenas no dia da apresentação</span>
    <span class="mono tab" style="color:var(--ink-4)"><span data-f="hoje"></span></span>
  </div>
</section>

`;

// Contas que o lead declarou no FORMULÁRIO. A pergunta é por faixa
// ("3-5", "6-10", "10+"): vale o piso da faixa, que é o único número que o
// formulário garante; o closer sobe na call. Sem resposta, 0 (em branco).
export function contasDoForm(answers, calc) {
  const key = (calc && calc.seatsKey) || "accounts";
  const raw = String((answers || {})[key] ?? "").trim();
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Configuração da apresentação: o que a tela zero guarda (state.deckC). Nasce
// do que o FORMULÁRIO trouxe (nome, empresa, contas) e do produto que a régua
// do catálogo sugere. Pedidos/mês, ticket médio e desconto o form não
// pergunta: ficam em branco pro closer preencher na call (Leo, 18/09/2026),
// nunca um número inventado que o cliente pudesse levar a sério.
// Com `catalog`, linha, pacote, Price e pacote de OEM só valem se forem planos
// que o catálogo vende (deckChoices); sem ele, as chaves de sempre.
//
// O desconto da negociação é travado em 15% (o teto da tela zero antiga). Acima
// disso só com o cadeado aberto: a senha de um admin conferida no servidor, que
// grava `state.descontoLiberado` FORA do deckC — o que o navegador manda nunca
// abre o próprio teto.
export const DESCONTO_TETO = 15;
export const DESCONTO_TETO_LIBERADO = 90;
export const descontoTeto = (p) => (p && p.state && p.state.descontoLiberado ? DESCONTO_TETO_LIBERADO : DESCONTO_TETO);

export function deckConfig(p, { suggested = "", catalog = null } = {}) {
  const s = (p.state && p.state.deckC) || {};
  const lead = (p.data && p.data.lead) || {};
  const answers = (p.data && p.data.answers) || {};
  const [linhaSug, tierSug] = String(suggested || "ads_essencial").split("_");
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : d);
  const choices = catalog && catalog.products ? deckChoices(catalog) : null;
  if (choices && choices.plataforma.length) {
    const plat = choices.plataforma.find((x) => x.linha === String(s.linha || "") && x.tier === String(s.tier || ""))
      || choices.plataforma.find((x) => x.key === String(suggested || ""))
      || choices.plataforma.find((x) => x.linha === String(s.linha || ""))
      || choices.plataforma[0];
    const priceTier = (choices.price.find((x) => x.tier === String(s.priceTier || "")) || choices.price[0] || {}).tier || "essencial";
    const pack = choices.oemPacks.find((x) => String(x.qty) === String(s.oemPack || "")) || choices.oemPacks[0];
    return {
      ...deckConfig(p, { suggested }),
      linha: plat.linha, tier: plat.tier, priceTier,
      oemPack: pack ? String(pack.qty) : String(s.oemPack || "1000"),
    };
  }
  return {
    nome: String(s.nome || lead.firstName || lead.name || "").slice(0, 60),
    empresa: String(s.empresa || lead.company || "").slice(0, 80),
    contas: num(s.contas, contasDoForm(answers, p.calc)),
    pedidos: num(s.pedidos, 0),
    ticket: num(s.ticket, 0),
    vistaPct: Math.min(descontoTeto(p), Math.max(0, Number(s.vistaPct) || 0)),
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
//
// NOME DO PLANO NA APRESENTAÇÃO (Leo, 26/11/2026): os planos da linha OEM são
// apresentados como "LeverOEM Essencial" e "LeverOEM Escala". O nome oficial
// do plano (Comercial → Planos, hoje "Ads Essencial + OEM") continua valendo
// no link de pagamento, na coluna Plano do cliente e no acesso do produto. A
// troca é feita AQUI porque todo mundo que mostra a apresentação lê este
// catálogo enxuto: a página, a tela zero, o card de Atividades e o painel do
// CRM Lever (/api/leads/:id/proposal-config).
export const DECK_PLAN_NAME = { oem_essencial: "LeverOEM Essencial", oem_escala: "LeverOEM Escala" };
export function slimCatalog(catalog) {
  const src = (catalog && catalog.products) || {};
  const products = {};
  for (const [k, v] of Object.entries(src)) {
    products[k] = {
      name: DECK_PLAN_NAME[k] || v.name || k, line: v.line || k.split("_")[0], tier: v.tier || k.split("_")[1],
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
function cfgScreen(configOnly = false) {
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
      <div class="cfg-card cfg-client">
        <div class="cfg-kicker">Cliente</div>
        <div style="font-size:12px;color:var(--ink-faint);line-height:1.4;margin-top:-6px">Nome, empresa e contas vêm do formulário. O que está em branco você preenche na call.</div>
        <label style="display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--ink-muted)"><span>Nome</span>
          <input class="cfg-input" data-cfg="nome"></label>
        <label style="display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--ink-muted)"><span>Empresa</span>
          <input class="cfg-input" data-cfg="empresa"></label>
        <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px">
          <label style="min-width:0;display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--ink-muted)"><span>Contas</span>
            <input class="cfg-input" type="number" min="1" placeholder="na call" data-cfg="contas"></label>
          <label style="min-width:0;display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--ink-muted)"><span>Pedidos/mês</span>
            <input class="cfg-input" type="number" min="0" placeholder="na call" data-cfg="pedidos"></label>
        </div>
        <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px">
          <label style="min-width:0;display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--ink-muted)"><span>Ticket médio (R$)</span>
            <input class="cfg-input" type="number" min="1" placeholder="na call" data-cfg="ticket"></label>
          <div data-desconto style="min-width:0;display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--ink-muted)"><label for="cfg-desconto">Desconto (%)</label>
            <span style="display:flex;gap:6px"><input id="cfg-desconto" class="cfg-input" type="number" min="0" max="15" placeholder="0" data-cfg="vistaPct">
              <button type="button" class="cfg-lock" data-desc-lock aria-expanded="false"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg></button></span></div>
        </div>
        <form class="cfg-desc-form" data-desconto data-desc-form hidden>
          <input class="cfg-input" type="password" autocomplete="off" placeholder="Senha de um admin" aria-label="Senha de um admin" data-desc-senha>
          <button type="submit" class="cfg-lock">Liberar</button>
        </form>
        <div data-desconto data-desc-msg role="status" style="font-size:12px;color:var(--ink-faint);line-height:1.4"></div>
      </div>

      <div class="cfg-card">
        <div class="cfg-kicker">Produtos no plano</div>
        <label class="cfg-prod" data-prod="plataforma">
          <input type="checkbox" data-cfg="plataforma">
          <span style="flex:1;min-width:0">
            <strong>LeverAds</strong>
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
        <div class="cfg-value" style="background:var(--ink);color:var(--btn-primary-text);border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:6px">
          <div style="font-size:12.5px;opacity:0.7"><span data-f="planoNome"></span></div>
          <div style="font-size:30px;font-weight:700;letter-spacing:-0.02em;line-height:1;font-variant-numeric:tabular-nums"><span data-f="parcelas"></span>× R$ <span data-f="mensalFmt"></span></div>
          <div style="font-size:12.5px;opacity:0.7">ou R$ <span data-f="vistaFmt"></span> à vista</div>
          <div style="font-size:12.5px;opacity:0.7" data-setup hidden>+ R$ <span data-f="setupFmt"></span> de pacote OEM na contratação</div>
          ${configOnly ? '<a class="cfg-present" target="_blank" rel="noopener noreferrer">Apresentar ↗</a>' : ""}
        </div>
      </div>
    </div>
  </div>
</section>`;
}

// Slide 06, a faixa de cima (o geral do painel) e a linha da fonte.
//
// Os números são os do painel na hora de abrir (leverads-results.js), nunca
// escritos no slide: é a decisão de 28/09/2026, a prova tem que estar
// atualizada em TODA apresentação. Sem apuração em memória (o processo acabou
// de subir e a consulta ainda não voltou), a faixa não fica em branco e não
// mostra número sem data: entram os do handoff de 26/11/2026, com o dia em que
// foram apurados escrito na fonte.
const RESULTADOS_HANDOFF = { generated: "R$ 6,1 mi", participation: "10%", days: "9 dias", date: "17/11/2026" };
const colado = (t) => escHtml(t).replace(/ /g, "&nbsp;");
function presentationResultsHtml(results) {
  const money = (n) => "R$ " + new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(n >= 1e6 ? n / 1e6 : n >= 1e3 ? n / 1e3 : n) + (n >= 1e6 ? " mi" : n >= 1e3 ? " mil" : "");
  const dias = results && results.firstSaleDays != null ? results.firstSaleDays + (results.firstSaleDays === 1 ? " dia" : " dias") : "";
  const kpis = results
    ? [
      [money(results.generated), "em vendas de anúncios que a Lever criou"],
      [new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(results.participation) + "%", "das vendas dos clientes vêm desses anúncios"],
      ...(dias ? [[dias, "da conexão até a primeira venda (mediana)"]] : []),
    ]
    : [
      [RESULTADOS_HANDOFF.generated, "em vendas de anúncios que a Lever criou"],
      [RESULTADOS_HANDOFF.participation, "das vendas dos clientes vêm desses anúncios"],
      [RESULTADOS_HANDOFF.days, "da conexão até a primeira venda (mediana)"],
    ];
  const exact = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const title = results
    ? ` title="${escHtml(exact.format(results.gmv) + " de faturamento; " + exact.format(results.generated) + " em anúncios da Lever. Mesma cobertura por cliente, na janela de até 180 dias do painel.")}"`
    : "";
  return `<div class="card kp" ${results ? "data-live-results" : "data-handoff-results"}${title} style="grid-template-columns:repeat(${kpis.length},minmax(0,1fr))">${kpis.map(([valor, rotulo]) =>
    `<div class="kp-i"><span class="tab kp-n">${colado(valor)}</span><span class="kp-l">${escHtml(rotulo)}</span></div>`).join("")}</div>`;
}
function presentationResultsSource(results) {
  const dia = results
    ? new Date(results.updatedAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : RESULTADOS_HANDOFF.date;
  return `<div style="font-size:19px;color:var(--ink-4)">Fonte: painel de vendas da Lever. Clientes: acumulado desde a entrada de cada um, números de ${escHtml(dia)}.</div>`;
}

// ── O esqueleto da apresentação, lido do próprio deck ──────────────────────
// A tela de Propostas mostra, no cartão da apresentação oficial, as telas que o
// cliente vê e a condição de cada uma. A lista sai DAQUI (regex sobre o SLIDES
// acima) em vez de uma cópia no cockpit: slide novo aparece na tela sem
// ninguém lembrar de atualizar uma segunda lista.
//
// `cond` é o data-if do slide (a chave de `mostra` em calcOferta): a tela só
// entra quando o plano montado na tela zero acende aquela chave.
const OUTLINE_SECTION = /<section\b([^>]*)>/g;
const attr = (attrs, name) => (new RegExp(name + '="([^"]*)"').exec(attrs) || [])[1] || "";
let outlineCache = null; // o deck é constante: a varredura roda uma vez por processo
export function deckOutline() {
  if (outlineCache) return outlineCache;
  const telas = [];
  let m;
  OUTLINE_SECTION.lastIndex = 0;
  while ((m = OUTLINE_SECTION.exec(SLIDES))) {
    const label = attr(m[1], "data-screen-label") || attr(m[1], "data-label");
    if (!label) continue;
    const cond = attr(m[1], "data-if");
    telas.push(cond ? { label, cond } : { label });
  }
  outlineCache = telas;
  return telas;
}

export function proposalSlidesPageHtml(p, { editable = false, previewBanner = false, catalog = null, suggested = "", results = null, configOnly = false } = {}) {
  configOnly = !!editable && !!configOnly;
  const cfg = deckConfig(p, { suggested, catalog });
  const slim = slimCatalog(catalog || {});
  // Link do CLIENTE: a oferta vai congelada no snapshot (shareProposalOffer) —
  // mexer no catálogo depois do envio não pode mudar o número que ele já viu.
  // No modo closer a conta é sempre ao vivo, a partir da tela zero.
  const oferta = (!editable && p.state && p.state.deckOferta) ? p.state.deckOferta : calcOferta(slim, cfg);
  const titulo = escHtml(p.name || "Proposta");
  const dados = {
    id: p.id,
    editable: !!editable,
    configOnly,
    salvavel: !!editable && p.id !== "preview",
    aceito: !!p.accepted,
    cfg,
    descTeto: descontoTeto(p),
    descTetoPadrao: DESCONTO_TETO,
    oferta,
    catalog: editable ? slim : null,
    hoje: new Date().toLocaleDateString("pt-BR"),
    // Cases escolhidos pelo NICHO deste lead, congelados no snapshot junto com
    // o resto da proposta (cases.js / pickCases). Vazio = o slide 06 volta pros
    // colchetes, que é o estado honesto de quem ainda não tem case autorizado.
    cases: (p.data && Array.isArray(p.data.cases)) ? p.data.cases : [],
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
<style>${DECK_CSS}
${configOnly ? `
html, body { height: auto; overflow: auto; background: var(--paper-card); }
.stage, #canvas { position: static; width: 100%; height: auto; overflow: visible; transform: none !important; }
#canvas > section { display: none !important; }
#canvas > [data-cfg-screen] { display: block !important; position: static; width: 100%; height: auto; padding: 0; background: var(--paper-card) !important; }
[data-cfg-screen] > div { zoom: 1 !important; width: 100% !important; padding: 0 !important; gap: 12px !important; }
[data-cfg-screen] > div > div:first-child { padding: 0 0 8px !important; }
[data-cfg-screen] > div > div:first-child > div:first-child, [data-act="capa"], .hud, .notas { display: none !important; }
[data-cfg-screen] > div > div:nth-child(2) { grid-template-columns: minmax(0,1fr) !important; gap: 12px !important; }
.cfg-card { padding: 0; gap: 8px; min-width: 0; border: 0; box-shadow: none; }
.cfg-kicker { font-size: 11px; }
.cfg-client { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; }
.cfg-client > div { display: contents !important; }
.cfg-client > .cfg-kicker, .cfg-client > div:nth-child(2),
.cfg-client label:has([data-cfg="nome"]), .cfg-client label:has([data-cfg="empresa"]),
.cfg-client label:has([data-cfg="contas"]), .cfg-client [data-desconto] { display: none !important; }
.cfg-prod { padding: 6px 8px; gap: 8px; }
.cfg-prod strong { font-size: 12px; }
.cfg-prod .sub, [data-nota-plano] { display: none; }
.cfg-prod:not([data-on]) .cfg-select, .cfg-prod:not([data-on]) span[style*="grid-template-columns"] { display: none !important; }
.cfg-input, .cfg-select { height: 30px; font-size: 12px; }
.cfg-value { display: grid !important; grid-template-columns: minmax(0,1fr) auto; align-items: center; padding: 10px 12px !important; gap: 4px 8px !important; }
.cfg-value > div { grid-column: 1; min-width: 0; overflow-wrap: anywhere; }
.cfg-present { grid-column: 2; grid-row: 1 / span 4; align-self: center; display: inline-flex; align-items: center; justify-content: center; min-height: 34px; padding: 0 9px; border-radius: 999px; background: var(--paper-card); color: var(--ink); font-size: 11.5px; font-weight: 600; text-decoration: none; white-space: nowrap; }
.cfg-present:focus-visible { outline: 2px solid var(--brand); outline-offset: 3px; }
.cfg-value > div:nth-child(2) { font-size: 18px !important; }
.cfg-seg button { padding: 7px 10px; font-size: 12px; }
#canvas { box-shadow: none; background: var(--paper-card); }
.cfg-seg { background: var(--paper-card); border: 1px solid var(--line); }
.cfg-seg button[data-on] { background: var(--ink); color: var(--paper-card); box-shadow: none; }
.cfg-prod span[style*="grid-template-columns"] { grid-template-columns: minmax(0,1fr) !important; }
.cfg-select { text-overflow: ellipsis; }
@media (pointer: coarse) { .cfg-input, .cfg-select, .cfg-seg button, .cfg-present { min-height: 44px; } }
` : ""}</style>
</head>
<body>
${previewBanner ? '<div class="fita">Pré-visualização do template · nada aqui é salvo</div>' : ""}
<div class="stage">
  <div class="canvas dkc" id="canvas">${editable ? cfgScreen(configOnly) : ""}${SLIDES.replace("<!--RESULTADOS_VIVOS-->", () => presentationResultsHtml(results)).replace("<!--RESULTADOS_FONTE-->", () => presentationResultsSource(results))}</div>
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
  var deckChoices = ${deckChoices.toString()};
  var deckTelas = ${deckTelas.toString()};
  var cfg = D.cfg;
  var canvas = document.getElementById("canvas");
  var todos = [].slice.call(canvas.children);
  var presentLink = document.querySelector(".cfg-present");
  if (presentLink) {
    var presentationUrl = new URL(window.location.href);
    presentationUrl.searchParams.delete("embed");
    presentLink.href = presentationUrl.href;
  }

  if (D.configOnly && window.parent !== window) {
    var configScreen = document.querySelector("[data-cfg-screen]");
    var parentOrigin = "";
    try { parentOrigin = new URL(document.referrer).origin; } catch (_) {}
    if (parentOrigin) new ResizeObserver(function () {
      window.parent.postMessage({ type: "cockpit:proposal-config-height", height: configScreen.scrollHeight + 2 }, parentOrigin);
    }).observe(configScreen);
  }


  // ── Os números do deck ────────────────────────────────────────────────
  // Nenhum número é escrito no slide: tudo vem da oferta montada na tela
  // zero. No link do cliente a conta já veio pronta do servidor.
  function oferta() { return D.editable ? calcOferta(D.catalog, cfg) : D.oferta; }
  function ticks(itens, extra) {
    var ul = document.createElement("ul");
    ul.className = "ticks" + (extra ? " " + extra : "");
    (itens || []).forEach(function (t) {
      var li = document.createElement("li");
      var sp = document.createElement("span");
      sp.textContent = t;
      li.appendChild(sp);
      ul.appendChild(li);
    });
    return ul;
  }
  // Um card por bloco da oferta: o do produto (com o nome do método, "Efeito
  // teia" ou "Espiral do lucro") e o "Lado a lado", lado a lado. Card sozinho
  // ocupa o slide inteiro, com os itens em duas colunas. Oferta congelada num
  // link já enviado é desenhada como veio, que é o que o cliente recebeu: as
  // de antes de 26/11/2026 trazem "O lado humano", e as daquele dia trazem a
  // linha de suporte (sup) embaixo do traço.
  function cardEntregavel(e, unico) {
    var d = document.createElement("div");
    d.className = "card dc" + (unico ? " dc-one" : "");
    var tag = document.createElement("div");
    tag.className = "t";
    tag.textContent = e.tag;
    d.appendChild(tag);
    d.appendChild(ticks(e.itens, unico ? "t2" : ""));
    if ((e.sup || []).length) d.appendChild(ticks(e.sup, (unico ? "t2 " : "") + "sup"));
    var nota = document.createElement("div");
    nota.className = "note";
    var forte = document.createElement("b");
    forte.textContent = e.notaDestaque || "";
    nota.appendChild(forte);
    nota.appendChild(document.createTextNode(" " + (e.nota || "")));
    d.appendChild(nota);
    return d;
  }

  // Card de case real. A 1ª métrica (a que o time pôs em primeiro) vira o
  // número grande; embaixo do traço vão dois números de apoio. Nos cases do
  // painel são sempre pedidos e anúncios criados (este sai da manchete que a
  // régua escreve, "574.780 anúncios criados pela plataforma…"). Case escrito
  // à mão usa as duas medidas seguintes e mostra a frase dele no pé.
  var ROTULO_CASE = { "gerado por anuncios da lever": "gerados por anúncios da Lever", "pedidos gerados no periodo": "pedidos" };
  function semAcento(v) { return String(v || "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").trim().toLowerCase(); }
  function rotuloCase(l) { return ROTULO_CASE[semAcento(l)] || l || ""; }
  function cardCase(c) {
    var d = document.createElement("div");
    d.className = "card";
    d.setAttribute("style", "padding:30px 36px;display:flex;flex-direction:column;min-width:0");
    var metricas = c.metrics || [];
    var m = metricas[0] || {};
    var nome = document.createElement("div");
    nome.setAttribute("style", "font-size:24px;font-weight:600;color:var(--ink)");
    nome.textContent = c.name || "";
    d.appendChild(nome);
    var num = document.createElement("div");
    num.className = "tab";
    num.setAttribute("data-case-num", "");
    num.setAttribute("style", "margin-top:18px;font-size:76px;font-weight:700;color:var(--brand);letter-spacing:-.045em;line-height:1;white-space:nowrap");
    num.textContent = m.value || "";
    d.appendChild(num);
    var leg = document.createElement("div");
    leg.setAttribute("style", "margin-top:10px;font-size:22px;color:var(--ink-3)");
    leg.textContent = rotuloCase(m.label) + (m.period && semAcento(m.period) !== "todo o periodo" ? " (" + m.period + ")" : "");
    d.appendChild(leg);
    var pares = metricas.slice(1).filter(function (x) { return x && x.value; })
      .map(function (x) { return { v: x.value, r: rotuloCase(x.label) }; });
    var criados = /^([\\d.,]+)\\s+anúncios criados/i.exec(c.headline || "");
    if (criados) pares.splice(Math.min(1, pares.length), 0, { v: criados[1], r: "anúncios criados" });
    pares = pares.slice(0, 2);
    if (pares.length) {
      var base = document.createElement("div");
      base.setAttribute("style", "margin-top:22px;padding-top:20px;border-top:1px solid var(--line-2);display:grid;grid-template-columns:1fr 1fr;gap:16px");
      pares.forEach(function (x) {
        var par = document.createElement("div");
        var v = document.createElement("div");
        v.className = "tab";
        v.setAttribute("style", "font-size:30px;font-weight:700;color:var(--ink)");
        v.textContent = x.v;
        var r = document.createElement("div");
        r.setAttribute("style", "font-size:19px;color:var(--ink-3);margin-top:4px");
        r.textContent = x.r;
        par.appendChild(v);
        par.appendChild(r);
        base.appendChild(par);
      });
      d.appendChild(base);
    }
    var frase = c.quote ? '"' + c.quote + '"' + (c.quoteAuthor ? " " + c.quoteAuthor : "") : (criados ? "" : (c.headline || ""));
    if (frase) {
      var pe = document.createElement("div");
      pe.setAttribute("style", "margin-top:18px;font-size:21px;line-height:1.4;color:var(--ink-3);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden");
      pe.textContent = frase;
      d.appendChild(pe);
    }
    return d;
  }

  function pintar() {
    var o = oferta();
    var vals = {
      "f.nome": cfg.nome, "f.empresa": cfg.empresa || "sua operação", "f.contas": cfg.contas > 0 ? cfg.contas : "[contas]",
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
      var ent = o.entregaveis || [];
      grid.innerHTML = "";
      ent.forEach(function (e) { grid.appendChild(cardEntregavel(e, ent.length === 1)); });
      // Três produtos no plano (plataforma, Price e pacote de OEM): uma coluna por card.
      grid.parentNode.style.gridTemplateColumns = ent.length > 2 ? "repeat(" + ent.length + ",minmax(0,1fr))" : "";
      grid.parentNode.classList.toggle("dl3", ent.length > 2);
    }
    // Cases reais entram no lugar dos colchetes do slide 06 (os três primeiros
    // da régua: nicho do lead, depois a ordem do time). Sem case publicado, o
    // fallback fica: colchete na tela é sinal pro closer, número inventado
    // seria mentira.
    var gc = document.querySelector("[data-cases]");
    var fb = document.querySelector("[data-cases-fallback]");
    var cs = (D.cases || []).slice(0, 3);
    if (gc) {
      gc.innerHTML = "";
      cs.forEach(function (c) { gc.appendChild(cardCase(c)); });
      gc.style.gridTemplateColumns = "repeat(" + Math.max(1, cs.length) + ",minmax(0,1fr))";
      gc.hidden = !cs.length;
    }
    if (fb) fb.hidden = !!cs.length;
    // Slide de produto que não está no plano sai da apresentação, e a janela
    // da demonstração mostra a tela do produto principal (regra em deckTelas).
    var ver = deckTelas(o.mostra);
    todos.forEach(function (s) {
      var cond = s.getAttribute("data-if");
      if (cond) s.hidden = !ver[cond];
    });
    [].forEach.call(document.querySelectorAll("[data-win]"), function (w) {
      w.hidden = w.getAttribute("data-win") !== ver.janela;
    });
    var setup = document.querySelector("[data-setup]");
    if (setup) setup.hidden = !(Number(o.setupFmt.replace(/\\D/g, "")) > 0);
    recontar();
    ajustar();
  }

  // ── Encaixe ───────────────────────────────────────────────────────────
  // O texto dos entregáveis vem do catálogo (Comercial → Planos) e o número
  // do case vem do painel: o slide não sabe o tamanho de nenhum dos dois.
  // Aqui a letra desce até caber, como o protótipo do desenho fazia.
  function ajustar() {
    if (D.configOnly) return;
    [].forEach.call(document.querySelectorAll("[data-case-num]"), function (el) {
      var px = 76;
      el.style.fontSize = px + "px";
      while (px > 44 && el.scrollWidth > el.clientWidth + 1) { px -= 4; el.style.fontSize = px + "px"; }
    });
    // Faixa de cima dos resultados: os números têm todos o mesmo tamanho, e
    // ele desce até a legenda de cada um caber em duas linhas.
    var kn = [].slice.call(document.querySelectorAll(".kp-n"));
    var kl = [].slice.call(document.querySelectorAll(".kp-l"));
    var kpx = [64, 62, 60, 58, 56, 54, 52, 50, 48];
    for (var j = 0; j < kpx.length && kn.length; j++) {
      kn.forEach(function (el) { el.style.fontSize = kpx[j] + "px"; });
      var linhas = kl.map(function (el) { return Math.round(el.offsetHeight / (parseFloat(getComputedStyle(el).lineHeight) || 28)); });
      if (Math.max.apply(null, linhas) <= 2) break;
    }
    var grid = document.querySelector("[data-entregaveis]");
    if (!grid || !grid.children.length) return;
    var corpo = grid.parentNode;
    var unico = grid.children.length === 1;
    var uls = [].slice.call(grid.querySelectorAll(".ticks"));
    var lis = [].slice.call(grid.querySelectorAll(".ticks li"));
    var justo = grid.children.length > 2;
    var passos = unico ? [31, 29, 27, 25, 23, 21] : [30, 28, 26, 24, 22, 21, 20, 19, 18, 17, 16];
    for (var i = 0; i < passos.length; i++) {
      var px = passos[i], cabe = true;
      lis.forEach(function (li) { li.style.fontSize = px + "px"; li.style.whiteSpace = ""; });
      if (unico) {
        // Duas colunas, cada item numa linha só: cada coluna fica da largura
        // do maior texto dela, e a divisão entre as duas acompanha.
        var a = 0, b = 0;
        uls.forEach(function (ul) {
          ul.style.gridTemplateColumns = "max-content max-content";
          var cols = getComputedStyle(ul).gridTemplateColumns.split(" ");
          a = Math.max(a, parseFloat(cols[0]) || 0);
          b = Math.max(b, parseFloat(cols[1]) || 0);
        });
        var vao = parseFloat(getComputedStyle(uls[0]).columnGap) || 0;
        cabe = a + b + vao <= uls[0].clientWidth;
        var colunas = cabe && b > 0 ? "minmax(0," + (a / b).toFixed(2) + "fr) minmax(0,1fr)" : "";
        uls.forEach(function (ul) { ul.style.gridTemplateColumns = colunas; });
        // Nem na menor letra coube numa linha: o texto quebra.
        if (!cabe && i === passos.length - 1) { lis.forEach(function (li) { li.style.whiteSpace = "normal"; }); cabe = true; }
      } else {
        uls.forEach(function (ul) {
          ul.style.rowGap = Math.round(px * (justo ? 0.6 : 1)) + "px";
          ul.style.setProperty("--tk", Math.min(34, px + 4) + "px");
        });
      }
      if (cabe && corpo.scrollHeight <= corpo.clientHeight + 1) break;
    }
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(ajustar);

  // ── Palco ─────────────────────────────────────────────────────────────
  var atual = 0, vis = [];
  function recontar() {
    vis = todos.filter(function (s) { return !s.hidden; });
    if (atual >= vis.length) atual = Math.max(0, vis.length - 1);
    mostrar(atual, "recount");
  }
  function fit() {
    if (D.configOnly) return;
    var w = window.innerWidth, h = window.innerHeight;
    var k = Math.min(w / 1920, h / 1080);
    canvas.style.transform = "scale(" + k + ")";
    canvas.style.left = Math.round((w - 1920 * k) / 2) + "px";
    canvas.style.top = Math.round((h - 1080 * k) / 2) + "px";
  }
  function mostrar(i, motivo) {
    if (D.configOnly) i = 0;
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
    if (D.configOnly) return;
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
    // Planos escolhíveis: os do catálogo (deckChoices), com o nome de cada um.
    var escolhas = deckChoices(D.catalog);
    function tiersDa(linha) {
      return escolhas.plataforma.filter(function (x) { return x.linha === linha; })
        .map(function (x) {
          return { v: x.tier, t: x.name + " · " + x.contas + " contas · " + precoDe(x.key) };
        });
    }
    function pintarCfg() {
      [].forEach.call(document.querySelectorAll("[data-cfg]"), function (el) {
        var k = el.getAttribute("data-cfg");
        if (el.type === "checkbox") el.checked = !!cfg[k];
        else if (el.type === "number") el.value = Number(cfg[k]) > 0 ? cfg[k] : "";
        else if (el.tagName !== "SELECT") el.value = cfg[k];
      });
      var linhas = [];
      escolhas.plataforma.forEach(function (x) {
        if (!linhas.some(function (l) { return l.v === x.linha; })) linhas.push({ v: x.linha, t: x.group });
      });
      opts(document.querySelector('[data-cfg="linha"]'), linhas, cfg.linha);
      opts(document.querySelector('[data-cfg="tier"]'), tiersDa(cfg.linha), cfg.tier);
      opts(document.querySelector('[data-cfg="priceTier"]'), escolhas.price.map(function (x) {
        return { v: x.tier, t: x.name + " · " + precoDe(x.key) };
      }), cfg.priceTier);
      opts(document.querySelector('[data-cfg="oemPack"]'), escolhas.oemPacks.map(function (pk) {
        return { v: String(pk.qty), t: pk.qty.toLocaleString("pt-BR") + " anúncios · R$ " + pk.price.toLocaleString("pt-BR") };
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
      if (k === "vistaPct") cfg[k] = Math.min(descTeto, Math.max(0, cfg[k] || 0));
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
    // ── Desconto travado ────────────────────────────────────────────────
    // Até o teto padrão (15%) qualquer closer aplica. O cadeado abre o campo
    // de senha e quem confere é o servidor (senha de um admin), que grava a
    // liberação na proposta. O teto vale no servidor de qualquer jeito: o
    // limite aqui é só pra tela não mostrar um número que não seria salvo.
    var descTeto = D.descTeto, descAberto = D.descTeto > D.descTetoPadrao;
    var descInput = document.querySelector('[data-cfg="vistaPct"]');
    var descLock = document.querySelector("[data-desc-lock]");
    var descForm = document.querySelector("[data-desc-form]");
    var descSenha = document.querySelector("[data-desc-senha]");
    var descMsg = document.querySelector("[data-desc-msg]");
    function pintarTrava(aviso) {
      descInput.max = String(descTeto);
      if (descAberto) descLock.setAttribute("data-open", ""); else descLock.removeAttribute("data-open");
      descLock.querySelector("path").setAttribute("d", descAberto ? "M7 11V7a5 5 0 0 1 9.9-1" : "M7 11V7a5 5 0 0 1 10 0v4");
      descLock.disabled = descAberto || !D.salvavel;
      // A tela costuma estar aberta com o cliente vendo: nada aqui diz que
      // existe teto nem que um admin libera mais. A linha de status só
      // aparece com o retorno de uma tentativa de liberar.
      var rotulo = descAberto ? "Desconto liberado" : D.salvavel ? "Liberar desconto" : "Salve a proposta para liberar";
      descLock.setAttribute("aria-label", rotulo);
      descLock.title = rotulo;
      if (descAberto) descForm.hidden = true;
      descLock.setAttribute("aria-expanded", String(!descForm.hidden));
      descMsg.textContent = aviso || "";
    }
    descLock.addEventListener("click", function () {
      descForm.hidden = !descForm.hidden;
      pintarTrava();
      if (!descForm.hidden) descSenha.focus();
    });
    descForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!descSenha.value) return;
      var botao = descForm.querySelector("button");
      botao.disabled = true;
      fetch("/public/proposals/" + encodeURIComponent(D.id) + "/discount-unlock", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ k: new URLSearchParams(location.search).get("k"), password: descSenha.value })
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, j: j }; });
      }).then(function (res) {
        botao.disabled = false;
        descSenha.value = "";
        if (res.status !== 200) {
          pintarTrava(res.status === 403 ? "Senha não confere com a de nenhum admin."
            : res.status === 429 ? "Muitas tentativas. Espere alguns minutos."
            : "Não liberou, tente de novo.");
          descSenha.focus();
          return;
        }
        descTeto = Number(res.j.teto) || descTeto;
        descAberto = true;
        pintarTrava();
        descInput.focus();
      }).catch(function () { botao.disabled = false; pintarTrava("Não liberou, tente de novo."); });
    });
    pintarTrava();
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
