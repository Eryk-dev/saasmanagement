/* @ds-bundle: {"format":4,"namespace":"LeverPremiumDesignSystem_b0a067","components":[{"name":"Button","sourcePath":"components/actions/Button/Button.jsx"},{"name":"Chip","sourcePath":"components/actions/Chip/Chip.jsx"},{"name":"FilterTab","sourcePath":"components/actions/FilterTab/FilterTab.jsx"},{"name":"Avatar","sourcePath":"components/display/Avatar/Avatar.jsx"},{"name":"Badge","sourcePath":"components/display/Badge/Badge.jsx"},{"name":"Card","sourcePath":"components/display/Card/Card.jsx"},{"name":"KpiCard","sourcePath":"components/display/KpiCard/KpiCard.jsx"},{"name":"SectionLabel","sourcePath":"components/display/SectionLabel/SectionLabel.jsx"},{"name":"StatusDot","sourcePath":"components/display/StatusDot/StatusDot.jsx"},{"name":"StepHeader","sourcePath":"components/display/StepHeader/StepHeader.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox/Checkbox.jsx"},{"name":"Input","sourcePath":"components/forms/Input/Input.jsx"},{"name":"SegmentedControl","sourcePath":"components/forms/SegmentedControl/SegmentedControl.jsx"},{"name":"Textarea","sourcePath":"components/forms/Textarea/Textarea.jsx"},{"name":"Toggle","sourcePath":"components/forms/Toggle/Toggle.jsx"},{"name":"PageHeader","sourcePath":"components/navigation/PageHeader/PageHeader.jsx"},{"name":"Topbar","sourcePath":"components/navigation/Topbar/Topbar.jsx"}],"sourceHashes":{"components/actions/Button/Button.jsx":"d56b335f5d96","components/actions/Chip/Chip.jsx":"1d2c0b21f905","components/actions/FilterTab/FilterTab.jsx":"85b2fe6617bd","components/display/Avatar/Avatar.jsx":"0489580b1e7d","components/display/Badge/Badge.jsx":"ab6112af957e","components/display/Card/Card.jsx":"09123142c17e","components/display/KpiCard/KpiCard.jsx":"7dc8502376cf","components/display/SectionLabel/SectionLabel.jsx":"7ad674194ce0","components/display/StatusDot/StatusDot.jsx":"1c047ddcb42c","components/display/StepHeader/StepHeader.jsx":"7a9fd84d68a6","components/forms/Checkbox/Checkbox.jsx":"f60b32b99145","components/forms/Input/Input.jsx":"d9787fa45549","components/forms/SegmentedControl/SegmentedControl.jsx":"1c76ffa7505c","components/forms/Textarea/Textarea.jsx":"60bb102cb30e","components/forms/Toggle/Toggle.jsx":"023ba578a70a","components/navigation/PageHeader/PageHeader.jsx":"c3dcd699fecb","components/navigation/Topbar/Topbar.jsx":"6217797efb78","ui_kits/leverads/App.jsx":"e0ea227c8651","ui_kits/leverads/App.standalone.jsx":"2fc3c13d3168"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.LeverPremiumDesignSystem_b0a067 = window.LeverPremiumDesignSystem_b0a067 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/actions/Button/Button.jsx
try { (() => {
const sizes = {
  md: {
    padding: "11px 20px",
    fontSize: 14
  },
  sm: {
    padding: "8px 15px",
    fontSize: 13
  }
};
function Button({
  variant = "primary",
  size = "md",
  disabled,
  children,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const base = {
    fontFamily: "var(--font-sans)",
    fontWeight: 600,
    border: "1px solid transparent",
    borderRadius: "var(--radius-control, 8px)",
    cursor: disabled ? "default" : "pointer",
    transition: "var(--transition-ui)",
    whiteSpace: "nowrap",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    ...sizes[size]
  };
  let s;
  if (disabled) {
    s = {
      background: "var(--control-disabled-bg)",
      borderColor: "var(--control-disabled-bg)",
      color: "var(--control-disabled-text)"
    };
  } else if (variant === "primary") {
    s = {
      background: hover ? "var(--btn-primary-bg-hover)" : "var(--btn-primary-bg)",
      borderColor: hover ? "var(--btn-primary-bg-hover)" : "var(--btn-primary-bg)",
      color: "var(--btn-primary-text)",
      boxShadow: "var(--shadow-btn)"
    };
  } else if (variant === "outline") {
    s = {
      background: "var(--paper-card)",
      borderColor: hover ? "var(--line-strong)" : "var(--line)",
      color: hover ? "var(--ink)" : "var(--ink-soft)",
      fontWeight: 500
    };
  } else if (variant === "danger") {
    s = {
      background: hover ? "var(--danger-soft)" : "var(--paper-card)",
      borderColor: hover ? "var(--danger)" : "var(--line)",
      color: "var(--danger)",
      fontWeight: 500
    };
  } else {
    s = {
      background: "transparent",
      border: "none",
      padding: 0,
      color: "var(--brand)",
      fontSize: 13,
      fontWeight: 600
    };
  }
  return React.createElement("button", {
    ...rest,
    disabled,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      ...base,
      ...s,
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/actions/Button/Button.jsx", error: String((e && e.message) || e) }); }

// components/actions/Chip/Chip.jsx
try { (() => {
const DOT_COLORS = {
  ml: "var(--ml-yellow)",
  shopee: "var(--shopee-orange)"
};
function Chip({
  selected,
  dot,
  count,
  children,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const dotColor = dot ? DOT_COLORS[dot] || dot : null;
  const s = selected ? {
    border: "1px solid var(--brand)",
    boxShadow: "inset 0 0 0 1px var(--brand)",
    background: "var(--brand-soft)",
    color: "var(--ink)",
    fontWeight: 600
  } : {
    border: `1px solid ${hover ? "var(--line-strong)" : "var(--line)"}`,
    background: "var(--paper-card)",
    color: hover ? "var(--ink)" : "var(--ink-soft)",
    fontWeight: 500
  };
  return React.createElement("button", {
    ...rest,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 9,
      padding: "9px 16px",
      borderRadius: "var(--radius-pill, 999px)",
      fontSize: 13,
      fontFamily: "var(--font-sans)",
      cursor: "pointer",
      transition: "var(--transition-ui)",
      ...s,
      ...style
    }
  }, selected && React.createElement("svg", {
    width: "13",
    height: "13",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--brand)",
    strokeWidth: "3",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, React.createElement("path", {
    d: "M20 6L9 17l-5-5"
  })), dotColor && React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: "50%",
      background: dotColor,
      display: "inline-block"
    }
  }), children, count != null && React.createElement("span", {
    style: {
      fontWeight: 500,
      color: selected ? "var(--ink-muted)" : "var(--ink-faint)"
    }
  }, count));
}
Object.assign(__ds_scope, { Chip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/actions/Chip/Chip.jsx", error: String((e && e.message) || e) }); }

// components/actions/FilterTab/FilterTab.jsx
try { (() => {
const COUNT_COLORS = {
  danger: "var(--danger)",
  warning: "var(--warning)",
  neutral: "var(--ink-faint)"
};
function FilterTab({
  active,
  count,
  countTone = "neutral",
  children,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const s = active ? {
    background: "var(--btn-primary-bg)",
    color: "var(--btn-primary-text)",
    fontWeight: 600
  } : {
    background: hover ? "var(--paper-tinted)" : "transparent",
    color: hover ? "var(--ink)" : "var(--ink-muted)",
    fontWeight: 500
  };
  return React.createElement("button", {
    ...rest,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 7,
      padding: "7px 13px",
      borderRadius: "var(--radius-control, 8px)",
      border: "none",
      fontSize: 13,
      fontFamily: "var(--font-sans)",
      cursor: "pointer",
      transition: "var(--transition-ui)",
      ...s,
      ...style
    }
  }, children, count != null && React.createElement("span", {
    style: {
      fontVariantNumeric: "tabular-nums",
      fontSize: 12,
      color: active ? "rgba(255,255,255,0.7)" : COUNT_COLORS[countTone]
    }
  }, count));
}
Object.assign(__ds_scope, { FilterTab });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/actions/FilterTab/FilterTab.jsx", error: String((e && e.message) || e) }); }

// components/display/Avatar/Avatar.jsx
try { (() => {
function Avatar({
  initials,
  size = 30,
  variant = "navy",
  style,
  ...rest
}) {
  const v = variant === "navy" ? {
    background: "var(--ink)",
    color: "var(--paper-card)"
  } : {
    background: "var(--paper-tinted)",
    color: "var(--ink-soft)"
  };
  return React.createElement("span", {
    ...rest,
    style: {
      width: size,
      height: size,
      borderRadius: "50%",
      display: "inline-grid",
      placeItems: "center",
      fontSize: Math.round(size * 0.38),
      fontWeight: 600,
      fontFamily: "var(--font-sans)",
      flexShrink: 0,
      ...v,
      ...style
    }
  }, initials);
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Avatar/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/display/Badge/Badge.jsx
try { (() => {
const TONES = {
  info: {
    color: "var(--info)",
    background: "var(--info-soft)"
  },
  warning: {
    color: "var(--warning)",
    background: "var(--warning-soft)"
  },
  brand: {
    color: "var(--brand)",
    background: "var(--brand-soft)"
  },
  neutral: {
    color: "var(--ink-soft)",
    background: "var(--paper-tinted)"
  }
};
function Badge({
  tone = "info",
  caps,
  children,
  style,
  ...rest
}) {
  return React.createElement("span", {
    ...rest,
    style: {
      display: "inline-block",
      padding: caps ? "2px 6px" : "2px 8px",
      borderRadius: caps ? 4 : "var(--radius-badge, 5px)",
      fontSize: caps ? 10 : 11,
      fontWeight: 600,
      letterSpacing: caps ? "0.05em" : undefined,
      fontFamily: "var(--font-sans)",
      ...TONES[tone],
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Badge/Badge.jsx", error: String((e && e.message) || e) }); }

// components/display/Card/Card.jsx
try { (() => {
function Card({
  padding = 28,
  flush,
  children,
  style,
  ...rest
}) {
  return React.createElement("section", {
    ...rest,
    style: {
      background: "var(--paper-card)",
      border: "1px solid var(--line)",
      borderRadius: "var(--radius-card, 12px)",
      boxShadow: "var(--shadow-card)",
      padding: flush ? 0 : padding,
      overflow: flush ? "hidden" : undefined,
      boxSizing: "border-box",
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Card/Card.jsx", error: String((e && e.message) || e) }); }

// components/display/KpiCard/KpiCard.jsx
try { (() => {
function KpiCard({
  label,
  value,
  hint,
  style
}) {
  return React.createElement("section", {
    style: {
      background: "var(--paper-card)",
      border: "1px solid var(--line)",
      borderRadius: "var(--radius-card, 12px)",
      boxShadow: "var(--shadow-card)",
      padding: "20px 24px",
      fontFamily: "var(--font-sans)",
      ...style
    }
  }, React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--ink-muted)",
      fontWeight: 500,
      marginBottom: 6
    }
  }, label), React.createElement("div", {
    style: {
      fontSize: 30,
      fontWeight: 700,
      letterSpacing: "-0.025em",
      fontVariantNumeric: "tabular-nums",
      color: "var(--ink)"
    }
  }, value), hint && React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--ink-faint)",
      marginTop: 4
    }
  }, hint));
}
Object.assign(__ds_scope, { KpiCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/KpiCard/KpiCard.jsx", error: String((e && e.message) || e) }); }

// components/display/SectionLabel/SectionLabel.jsx
try { (() => {
function SectionLabel({
  children,
  style,
  ...rest
}) {
  return React.createElement("h2", {
    ...rest,
    style: {
      fontSize: 13,
      fontWeight: 600,
      color: "var(--ink-faint)",
      letterSpacing: "0.02em",
      textTransform: "uppercase",
      margin: "0 0 12px",
      fontFamily: "var(--font-sans)",
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { SectionLabel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/SectionLabel/SectionLabel.jsx", error: String((e && e.message) || e) }); }

// components/display/StatusDot/StatusDot.jsx
try { (() => {
const TONES = {
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  neutral: "var(--ink-faint)"
};
function StatusDot({
  tone = "success",
  size = 6,
  children,
  style,
  ...rest
}) {
  const c = TONES[tone] || tone;
  return React.createElement("span", {
    ...rest,
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      fontSize: 12,
      fontWeight: 600,
      color: c,
      fontFamily: "var(--font-sans)",
      ...style
    }
  }, React.createElement("span", {
    style: {
      width: size,
      height: size,
      borderRadius: "50%",
      background: c,
      flexShrink: 0
    }
  }), children);
}
Object.assign(__ds_scope, { StatusDot });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/StatusDot/StatusDot.jsx", error: String((e && e.message) || e) }); }

// components/display/StepHeader/StepHeader.jsx
try { (() => {
function StepHeader({
  number,
  title,
  aside,
  style
}) {
  return React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: 16,
      marginBottom: 18,
      ...style
    }
  }, React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12
    }
  }, React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 12,
      fontWeight: 600,
      color: "var(--brand)"
    }
  }, number), React.createElement("strong", {
    style: {
      fontSize: 15.5,
      fontWeight: 600,
      letterSpacing: "-0.01em",
      color: "var(--ink)",
      fontFamily: "var(--font-sans)"
    }
  }, title)), aside && React.createElement("span", {
    style: {
      fontSize: 13,
      color: "var(--ink-faint)",
      fontFamily: "var(--font-sans)"
    }
  }, aside));
}
Object.assign(__ds_scope, { StepHeader });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/StepHeader/StepHeader.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox/Checkbox.jsx
try { (() => {
function Checkbox({
  style,
  ...rest
}) {
  return React.createElement("input", {
    type: "checkbox",
    ...rest,
    style: {
      width: 16,
      height: 16,
      accentColor: "var(--brand)",
      margin: 0,
      cursor: "pointer",
      ...style
    }
  });
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input/Input.jsx
try { (() => {
function Input({
  mono,
  style,
  ...rest
}) {
  return React.createElement("input", {
    ...rest,
    style: {
      padding: "8px 13px",
      border: "1px solid var(--line)",
      borderRadius: "var(--radius-control, 8px)",
      background: "var(--paper-card)",
      fontSize: 13,
      color: "var(--ink)",
      fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
      boxSizing: "border-box",
      ...style
    }
  });
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/SegmentedControl/SegmentedControl.jsx
try { (() => {
function SegmentedControl({
  options = [],
  value,
  onChange,
  style
}) {
  return React.createElement("div", {
    style: {
      display: "inline-flex",
      background: "var(--paper-tinted)",
      borderRadius: "var(--radius-segment, 9px)",
      padding: 3,
      gap: 2,
      ...style
    }
  }, options.map(opt => {
    const o = typeof opt === "string" ? {
      value: opt,
      label: opt
    } : opt;
    const active = o.value === value;
    return React.createElement("button", {
      key: o.value,
      onClick: () => onChange && onChange(o.value),
      style: {
        padding: "7px 14px",
        border: "none",
        borderRadius: 7,
        background: active ? "var(--paper-card)" : "transparent",
        boxShadow: active ? "var(--shadow-segment)" : "none",
        color: active ? "var(--ink)" : "var(--ink-muted)",
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        fontFamily: "var(--font-sans)",
        cursor: "pointer",
        transition: "var(--transition-ui)",
        display: "inline-flex",
        alignItems: "center",
        gap: 7
      }
    }, o.dot && React.createElement("span", {
      style: {
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: o.dot === "ml" ? "var(--ml-yellow)" : o.dot === "shopee" ? "var(--shopee-orange)" : o.dot,
        display: "inline-block"
      }
    }), o.label);
  }));
}
Object.assign(__ds_scope, { SegmentedControl });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/SegmentedControl/SegmentedControl.jsx", error: String((e && e.message) || e) }); }

// components/forms/Textarea/Textarea.jsx
try { (() => {
function Textarea({
  mono = true,
  style,
  ...rest
}) {
  return React.createElement("textarea", {
    ...rest,
    style: {
      display: "block",
      width: "100%",
      border: "1px solid var(--line)",
      borderRadius: "var(--radius-inner, 10px)",
      background: "var(--paper-subtle)",
      padding: "16px 18px",
      minHeight: 72,
      fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
      fontSize: mono ? 13.5 : 14,
      color: "var(--ink)",
      resize: "vertical",
      boxSizing: "border-box",
      lineHeight: 1.6,
      ...style
    }
  });
}
Object.assign(__ds_scope, { Textarea });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Textarea/Textarea.jsx", error: String((e && e.message) || e) }); }

// components/forms/Toggle/Toggle.jsx
try { (() => {
function Toggle({
  checked,
  onChange,
  style,
  ...rest
}) {
  return React.createElement("span", {
    ...rest,
    role: "switch",
    "aria-checked": !!checked,
    tabIndex: 0,
    onClick: () => onChange && onChange(!checked),
    onKeyDown: e => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        onChange && onChange(!checked);
      }
    },
    style: {
      width: 38,
      height: 22,
      borderRadius: "var(--radius-pill, 999px)",
      background: checked ? "var(--brand)" : "var(--toggle-off)",
      position: "relative",
      display: "inline-block",
      cursor: "pointer",
      flexShrink: 0,
      transition: "var(--transition-ui)",
      ...style
    }
  }, React.createElement("span", {
    style: {
      position: "absolute",
      top: 2,
      left: checked ? 18 : 2,
      width: 18,
      height: 18,
      borderRadius: "50%",
      background: "#FFFFFF",
      boxShadow: "var(--shadow-knob)",
      transition: "left 0.12s"
    }
  }));
}
Object.assign(__ds_scope, { Toggle });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Toggle/Toggle.jsx", error: String((e && e.message) || e) }); }

// components/navigation/PageHeader/PageHeader.jsx
try { (() => {
function PageHeader({
  title,
  subtitle,
  children,
  style
}) {
  return React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 24,
      marginBottom: 36,
      fontFamily: "var(--font-sans)",
      ...style
    }
  }, React.createElement("div", null, React.createElement("h1", {
    style: {
      fontSize: 26,
      fontWeight: 700,
      letterSpacing: "-0.02em",
      margin: "0 0 6px",
      color: "var(--ink)"
    }
  }, title), subtitle && React.createElement("p", {
    style: {
      fontSize: 14.5,
      color: "var(--ink-muted)",
      margin: 0,
      maxWidth: 560,
      lineHeight: 1.55,
      textWrap: "pretty"
    }
  }, subtitle)), children && React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      flexShrink: 0
    }
  }, children));
}
Object.assign(__ds_scope, { PageHeader });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/PageHeader/PageHeader.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Topbar/Topbar.jsx
try { (() => {
function NavTab({
  active,
  badge,
  children
}) {
  const [hover, setHover] = React.useState(false);
  return React.createElement("button", {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      position: "relative",
      padding: "0 13px",
      border: "none",
      background: "transparent",
      color: active || hover ? "var(--ink)" : "var(--ink-muted)",
      fontSize: 13.5,
      fontWeight: active ? 600 : 500,
      fontFamily: "var(--font-sans)",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      gap: 7,
      transition: "var(--transition-ui)"
    }
  }, children, badge != null && React.createElement("span", {
    style: {
      minWidth: 18,
      height: 18,
      padding: "0 5px",
      borderRadius: 999,
      background: active ? "var(--btn-primary-bg)" : "var(--paper-tinted)",
      color: active ? "var(--btn-primary-text)" : "var(--ink-soft)",
      fontSize: 11,
      fontWeight: 600,
      display: "inline-grid",
      placeItems: "center",
      fontVariantNumeric: "tabular-nums",
      boxSizing: "border-box"
    }
  }, badge), active && React.createElement("span", {
    style: {
      position: "absolute",
      left: 13,
      right: 13,
      bottom: 0,
      height: 2,
      background: "var(--ink)",
      borderRadius: "2px 2px 0 0"
    }
  }));
}
function Topbar({
  logoSrc,
  brand = "LeverAds",
  tabs = [],
  active,
  metrics = [],
  initials = "E"
}) {
  return React.createElement("header", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 24,
      padding: "0 var(--topbar-pad-x, 28px)",
      height: "var(--topbar-height, 58px)",
      background: "var(--paper-card)",
      borderBottom: "1px solid var(--line)",
      position: "sticky",
      top: 0,
      zIndex: 50,
      fontFamily: "var(--font-sans)",
      boxSizing: "border-box"
    }
  }, React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 9,
      fontWeight: 700,
      fontSize: 15,
      letterSpacing: "-0.01em",
      color: "var(--ink)"
    }
  }, logoSrc && React.createElement("img", {
    src: logoSrc,
    alt: "",
    style: {
      width: 22,
      height: 22,
      display: "block"
    }
  }), brand), React.createElement("nav", {
    style: {
      display: "flex",
      gap: 4,
      alignSelf: "stretch",
      alignItems: "stretch"
    }
  }, tabs.map(t => {
    const tab = typeof t === "string" ? {
      label: t
    } : t;
    return React.createElement(NavTab, {
      key: tab.label,
      active: tab.label === active,
      badge: tab.badge
    }, tab.label);
  })), React.createElement("div", {
    style: {
      flex: 1
    }
  }), React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 18
    }
  }, metrics.map((m, i) => React.createElement(React.Fragment, {
    key: i
  }, React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: 7,
      fontSize: 13
    }
  }, React.createElement("span", {
    style: {
      color: "var(--ink-muted)"
    }
  }, m.label), React.createElement("strong", {
    style: {
      fontWeight: m.accent ? 600 : 700,
      fontVariantNumeric: "tabular-nums",
      color: m.accent ? "var(--brand)" : "var(--ink)"
    }
  }, m.value)), React.createElement("span", {
    style: {
      width: 1,
      height: 20,
      background: "var(--line)"
    }
  }))), React.createElement("button", {
    title: "Minha conta",
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: 4,
      border: "none",
      background: "transparent",
      fontFamily: "inherit",
      cursor: "pointer",
      borderRadius: 999
    }
  }, React.createElement("span", {
    style: {
      width: 30,
      height: 30,
      borderRadius: "50%",
      background: "var(--ink)",
      color: "var(--paper-card)",
      display: "inline-grid",
      placeItems: "center",
      fontSize: 11.5,
      fontWeight: 600
    }
  }, initials), React.createElement("svg", {
    width: "11",
    height: "11",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--ink-muted)",
    strokeWidth: "2.5",
    strokeLinecap: "round"
  }, React.createElement("path", {
    d: "M6 9l6 6 6-6"
  })))));
}
Object.assign(__ds_scope, { Topbar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Topbar/Topbar.jsx", error: String((e && e.message) || e) }); }

// ui_kits/leverads/App.jsx
try { (() => {
// LeverAds — recriação interativa da tela "Copiar anúncios".
// Compõe os primitivos de window.LeverPremiumDesignSystem_b0a067. Estado é fake/local.
const NS = window.LeverPremiumDesignSystem_b0a067;
const {
  Topbar,
  PageHeader,
  Card,
  StepHeader,
  Button,
  Chip,
  Textarea,
  StatusDot,
  SectionLabel,
  FilterTab,
  Input,
  Badge
} = NS;
const ACCOUNTS = ["141Air", "Net Air", "Arthur", "Autoby", "Autofy", "Bellator", "Easy CWB", "Easy WS", "Maira", "Netparts SP", "Unique CT1", "Unique CT2"];
const INITIAL_HISTORY = [{
  id: 1,
  label: "1 anúncio — concluído",
  tone: "success",
  pct: "100%",
  meta: "1/1 · há 2 h",
  cat: "sucesso"
}, {
  id: 2,
  label: "3 anúncios — concluído",
  tone: "success",
  pct: "100%",
  meta: "3/3 · há 3 h",
  cat: "sucesso"
}, {
  id: 3,
  label: "2 anúncios — 1 erro",
  tone: "danger",
  pct: "50%",
  meta: "1/2 · há 4 h",
  cat: "erros"
}, {
  id: 4,
  label: "5 anúncios — correções aplicadas",
  tone: "warning",
  pct: "100%",
  meta: "5/5 · há 5 h",
  cat: "correções"
}, {
  id: 5,
  label: "1 anúncio — concluído",
  tone: "success",
  pct: "100%",
  meta: "1/1 · há 6 h",
  cat: "sucesso"
}];
function Caret({
  rotate
}) {
  return /*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "12",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--ink-faint)",
    strokeWidth: "2.5",
    strokeLinecap: "round",
    style: {
      transform: `rotate(${rotate}deg)`,
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M6 9l6 6 6-6"
  }));
}
function Check({
  color,
  size = 14,
  w = 2.5
}) {
  return /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: w,
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M20 6L9 17l-5-5"
  }));
}
function OptionCard({
  title,
  beta,
  desc,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      border: "1px solid var(--line)",
      borderRadius: "var(--radius-inner)",
      padding: "18px 20px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      fontWeight: 600
    }
  }, title), beta && /*#__PURE__*/React.createElement(Badge, {
    tone: "info",
    caps: true
  }, "BETA")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--ink-faint)",
      lineHeight: 1.5,
      marginBottom: 14
    }
  }, desc), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap"
    }
  }, children));
}
function CopiarScreen() {
  const [text, setText] = React.useState("MLB4845847325");
  const [selected, setSelected] = React.useState(["141Air", "Net Air"]);
  const [filter, setFilter] = React.useState("todos");
  const [sku, setSku] = React.useState("");
  const [history, setHistory] = React.useState(INITIAL_HISTORY);
  const detected = text.trim().length > 0;
  const count = detected ? text.trim().split(/\s+/).filter(Boolean).length : 0;
  const toggle = a => setSelected(s => s.includes(a) ? s.filter(x => x !== a) : [...s, a]);
  const allSelected = selected.length === ACCOUNTS.length;
  const counts = {
    todos: history.length,
    "em andamento": 0,
    sucesso: history.filter(h => h.cat === "sucesso").length,
    erros: history.filter(h => h.cat === "erros").length,
    correções: history.filter(h => h.cat === "correções").length
  };
  const rows = history.filter(h => (filter === "todos" || h.cat === filter) && h.label.toLowerCase().includes(sku.toLowerCase()));
  const doCopy = () => {
    if (!detected || selected.length === 0) return;
    setHistory(h => [{
      id: Date.now(),
      label: `${count} anúncio${count > 1 ? "s" : ""} → ${selected.length} conta${selected.length > 1 ? "s" : ""} — concluído`,
      tone: "success",
      pct: "100%",
      meta: `${count}/${count} · agora`,
      cat: "sucesso"
    }, ...h]);
  };
  return /*#__PURE__*/React.createElement("main", {
    style: {
      padding: "40px 32px 64px",
      maxWidth: "var(--page-max)",
      width: "100%",
      margin: "0 auto",
      boxSizing: "border-box"
    }
  }, /*#__PURE__*/React.createElement(PageHeader, {
    title: "Copiar an\xFAncios",
    subtitle: "Cole os an\xFAncios, detectamos a origem automaticamente e voc\xEA escolhe os destinos."
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "outline",
    size: "sm"
  }, "Ambiente de teste")), /*#__PURE__*/React.createElement(Card, {
    style: {
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement(StepHeader, {
    number: "01",
    title: "Cole os an\xFAncios",
    aside: "a conta de origem \xE9 detectada automaticamente"
  }), /*#__PURE__*/React.createElement(Textarea, {
    value: text,
    onChange: e => setText(e.target.value),
    placeholder: "MLB0000000000"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 16,
      gap: 16,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(Chip, {
    dot: "ml",
    count: `${count} anúncio${count > 1 ? "s" : ""}`,
    selected: detected
  }, "Easy SP"), detected ? /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 7,
      fontSize: 13,
      color: "var(--success)",
      fontWeight: 500
    }
  }, /*#__PURE__*/React.createElement(Check, {
    color: "var(--success)"
  }), count, " an\xFAncio", count > 1 ? "s" : "", " detectado", count > 1 ? "s" : "") : /*#__PURE__*/React.createElement(StatusDot, {
    tone: "neutral"
  }, "aguardando an\xFAncios"))), /*#__PURE__*/React.createElement(Card, {
    style: {
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement(StepHeader, {
    number: "02",
    title: "Para quais contas copiar?",
    aside: `${selected.length} selecionada${selected.length !== 1 ? "s" : ""}`
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "flex-end",
      marginTop: -8,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "link",
    onClick: () => setSelected(allSelected ? [] : [...ACCOUNTS])
  }, allSelected ? "Limpar seleção" : "Selecionar todas")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 10
    }
  }, ACCOUNTS.map(a => /*#__PURE__*/React.createElement(Chip, {
    key: a,
    selected: selected.includes(a),
    onClick: () => toggle(a)
  }, a))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 14,
      marginTop: 22
    }
  }, /*#__PURE__*/React.createElement(OptionCard, {
    title: "Duplicar na pr\xF3pria conta",
    desc: "Cria um 2\xBA an\xFAncio do mesmo produto na conta de origem."
  }, /*#__PURE__*/React.createElement(Chip, {
    dot: "ml"
  }, "Easy SP \xB7 1 an\xFAncio")), /*#__PURE__*/React.createElement(OptionCard, {
    title: "Copiar para a Shopee",
    beta: true,
    desc: "T\xEDtulo, fotos, pre\xE7o e atributos v\xE3o automaticamente. At\xE9 30 c\xF3pias/dia."
  }, /*#__PURE__*/React.createElement(Chip, {
    dot: "shopee"
  }, "Easy Peasy Utilidades"), /*#__PURE__*/React.createElement(Chip, {
    dot: "shopee"
  }, "Netair / Netparts")))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 20,
      padding: "6px 4px 26px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13.5,
      color: "var(--ink-muted)"
    }
  }, count, " an\xFAncio", count !== 1 ? "s" : "", " \u2192 ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: "var(--ink)",
      fontWeight: 600
    }
  }, selected.length, " conta", selected.length !== 1 ? "s" : "", " de destino")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "outline"
  }, "Pr\xE9-visualizar"), /*#__PURE__*/React.createElement(Button, {
    onClick: doCopy,
    disabled: !detected || selected.length === 0
  }, "Copiar agora"))), /*#__PURE__*/React.createElement("section", {
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      justifyContent: "space-between",
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement(SectionLabel, {
    style: {
      margin: 0
    }
  }, "Hist\xF3rico"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: "var(--ink-faint)",
      fontVariantNumeric: "tabular-nums"
    }
  }, history.length, " registros \xB7 atualizado agora")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 16,
      marginBottom: 14,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 4,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(FilterTab, {
    active: filter === "todos",
    onClick: () => setFilter("todos")
  }, "Todos"), /*#__PURE__*/React.createElement(FilterTab, {
    active: filter === "em andamento",
    onClick: () => setFilter("em andamento")
  }, "Em andamento"), /*#__PURE__*/React.createElement(FilterTab, {
    active: filter === "sucesso",
    onClick: () => setFilter("sucesso"),
    count: counts.sucesso
  }, "Sucesso"), /*#__PURE__*/React.createElement(FilterTab, {
    active: filter === "erros",
    onClick: () => setFilter("erros"),
    count: counts.erros,
    countTone: "danger"
  }, "Erros"), /*#__PURE__*/React.createElement(FilterTab, {
    active: filter === "correções",
    onClick: () => setFilter("correções"),
    count: counts.correções,
    countTone: "warning"
  }, "Corre\xE7\xF5es")), /*#__PURE__*/React.createElement(Input, {
    placeholder: "Filtrar por SKU",
    value: sku,
    onChange: e => setSku(e.target.value),
    style: {
      width: 170
    }
  })), /*#__PURE__*/React.createElement(Card, {
    flush: true
  }, rows.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "22px",
      fontSize: 13,
      color: "var(--ink-faint)"
    }
  }, "Nenhum registro para este filtro."), rows.map((r, i) => /*#__PURE__*/React.createElement("div", {
    key: r.id,
    style: {
      padding: "16px 22px",
      borderBottom: i < rows.length - 1 ? "1px solid var(--line-faint)" : "none",
      display: "flex",
      alignItems: "center",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(Caret, {
    rotate: -90
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13.5,
      fontWeight: 600,
      flex: 1
    }
  }, r.label), /*#__PURE__*/React.createElement(StatusDot, {
    tone: r.tone
  }, r.pct), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12.5,
      color: "var(--ink-faint)",
      fontVariantNumeric: "tabular-nums"
    }
  }, r.meta))))));
}
function EmptyScreen({
  name
}) {
  return /*#__PURE__*/React.createElement("main", {
    style: {
      padding: "80px 32px",
      maxWidth: "var(--page-max)",
      margin: "0 auto",
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 48
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15.5,
      fontWeight: 600,
      marginBottom: 6
    }
  }, name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      color: "var(--ink-muted)"
    }
  }, "Tela n\xE3o inclu\xEDda neste kit de recria\xE7\xE3o.")));
}
function App() {
  const [tab, setTab] = React.useState("Copiar");
  const tabs = [{
    label: "Copiar"
  }, {
    label: "Editar"
  }, {
    label: "Perguntas",
    badge: 69
  }, {
    label: "Compatibilidades"
  }, {
    label: "Regras"
  }, {
    label: "Contas"
  }, {
    label: "Plataforma"
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--paper)",
      minHeight: "100vh",
      fontFamily: "var(--font-sans)",
      color: "var(--ink)"
    }
  }, /*#__PURE__*/React.createElement(TopbarNav, {
    tabs: tabs,
    active: tab,
    onSelect: setTab
  }), tab === "Copiar" ? /*#__PURE__*/React.createElement(CopiarScreen, null) : /*#__PURE__*/React.createElement(EmptyScreen, {
    name: tab
  }));
}

// Topbar wired for tab switching (the base Topbar is display-only).
function TopbarNav({
  tabs,
  active,
  onSelect
}) {
  return /*#__PURE__*/React.createElement("div", {
    onClickCapture: e => {
      const btn = e.target.closest && e.target.closest("nav button");
      if (btn) {
        const label = btn.textContent.replace(/\d+$/, "").trim();
        const t = tabs.find(x => label.startsWith(x.label));
        if (t) onSelect(t.label);
      }
    }
  }, /*#__PURE__*/React.createElement(Topbar, {
    logoSrc: "../../assets/logo-lever-light.svg",
    brand: "LeverAds",
    tabs: tabs,
    active: active,
    metrics: [{
      label: "Vendas geradas",
      value: "R$ 40.567"
    }, {
      label: "Cota",
      value: "Ilimitada",
      accent: true
    }],
    initials: "E"
  }));
}
window.LeverAdsApp = App;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/leverads/App.jsx", error: String((e && e.message) || e) }); }

// ui_kits/leverads/App.standalone.jsx
try { (() => {
// LeverAds — recriação interativa da tela "Copiar anúncios".
// Compõe os primitivos de window.LeverPremiumDesignSystem_b0a067. Estado é fake/local.
const NS = window.LeverPremiumDesignSystem_b0a067;
const {
  Topbar,
  PageHeader,
  Card,
  StepHeader,
  Button,
  Chip,
  Textarea,
  StatusDot,
  SectionLabel,
  FilterTab,
  Input,
  Badge
} = NS;
const ACCOUNTS = ["141Air", "Net Air", "Arthur", "Autoby", "Autofy", "Bellator", "Easy CWB", "Easy WS", "Maira", "Netparts SP", "Unique CT1", "Unique CT2"];
const INITIAL_HISTORY = [{
  id: 1,
  label: "1 anúncio — concluído",
  tone: "success",
  pct: "100%",
  meta: "1/1 · há 2 h",
  cat: "sucesso"
}, {
  id: 2,
  label: "3 anúncios — concluído",
  tone: "success",
  pct: "100%",
  meta: "3/3 · há 3 h",
  cat: "sucesso"
}, {
  id: 3,
  label: "2 anúncios — 1 erro",
  tone: "danger",
  pct: "50%",
  meta: "1/2 · há 4 h",
  cat: "erros"
}, {
  id: 4,
  label: "5 anúncios — correções aplicadas",
  tone: "warning",
  pct: "100%",
  meta: "5/5 · há 5 h",
  cat: "correções"
}, {
  id: 5,
  label: "1 anúncio — concluído",
  tone: "success",
  pct: "100%",
  meta: "1/1 · há 6 h",
  cat: "sucesso"
}];
function Caret({
  rotate
}) {
  return /*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "12",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--ink-faint)",
    strokeWidth: "2.5",
    strokeLinecap: "round",
    style: {
      transform: `rotate(${rotate}deg)`,
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M6 9l6 6 6-6"
  }));
}
function Check({
  color,
  size = 14,
  w = 2.5
}) {
  return /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: w,
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M20 6L9 17l-5-5"
  }));
}
function OptionCard({
  title,
  beta,
  desc,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      border: "1px solid var(--line)",
      borderRadius: "var(--radius-inner)",
      padding: "18px 20px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      fontWeight: 600
    }
  }, title), beta && /*#__PURE__*/React.createElement(Badge, {
    tone: "info",
    caps: true
  }, "BETA")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--ink-faint)",
      lineHeight: 1.5,
      marginBottom: 14
    }
  }, desc), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap"
    }
  }, children));
}
function CopiarScreen() {
  const [text, setText] = React.useState("MLB4845847325");
  const [selected, setSelected] = React.useState(["141Air", "Net Air"]);
  const [filter, setFilter] = React.useState("todos");
  const [sku, setSku] = React.useState("");
  const [history, setHistory] = React.useState(INITIAL_HISTORY);
  const detected = text.trim().length > 0;
  const count = detected ? text.trim().split(/\s+/).filter(Boolean).length : 0;
  const toggle = a => setSelected(s => s.includes(a) ? s.filter(x => x !== a) : [...s, a]);
  const allSelected = selected.length === ACCOUNTS.length;
  const counts = {
    todos: history.length,
    "em andamento": 0,
    sucesso: history.filter(h => h.cat === "sucesso").length,
    erros: history.filter(h => h.cat === "erros").length,
    correções: history.filter(h => h.cat === "correções").length
  };
  const rows = history.filter(h => (filter === "todos" || h.cat === filter) && h.label.toLowerCase().includes(sku.toLowerCase()));
  const doCopy = () => {
    if (!detected || selected.length === 0) return;
    setHistory(h => [{
      id: Date.now(),
      label: `${count} anúncio${count > 1 ? "s" : ""} → ${selected.length} conta${selected.length > 1 ? "s" : ""} — concluído`,
      tone: "success",
      pct: "100%",
      meta: `${count}/${count} · agora`,
      cat: "sucesso"
    }, ...h]);
  };
  return /*#__PURE__*/React.createElement("main", {
    style: {
      padding: "40px 32px 64px",
      maxWidth: "var(--page-max)",
      width: "100%",
      margin: "0 auto",
      boxSizing: "border-box"
    }
  }, /*#__PURE__*/React.createElement(PageHeader, {
    title: "Copiar an\xFAncios",
    subtitle: "Cole os an\xFAncios, detectamos a origem automaticamente e voc\xEA escolhe os destinos."
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "outline",
    size: "sm"
  }, "Ambiente de teste")), /*#__PURE__*/React.createElement(Card, {
    style: {
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement(StepHeader, {
    number: "01",
    title: "Cole os an\xFAncios",
    aside: "a conta de origem \xE9 detectada automaticamente"
  }), /*#__PURE__*/React.createElement(Textarea, {
    value: text,
    onChange: e => setText(e.target.value),
    placeholder: "MLB0000000000"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 16,
      gap: 16,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(Chip, {
    dot: "ml",
    count: `${count} anúncio${count > 1 ? "s" : ""}`,
    selected: detected
  }, "Easy SP"), detected ? /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 7,
      fontSize: 13,
      color: "var(--success)",
      fontWeight: 500
    }
  }, /*#__PURE__*/React.createElement(Check, {
    color: "var(--success)"
  }), count, " an\xFAncio", count > 1 ? "s" : "", " detectado", count > 1 ? "s" : "") : /*#__PURE__*/React.createElement(StatusDot, {
    tone: "neutral"
  }, "aguardando an\xFAncios"))), /*#__PURE__*/React.createElement(Card, {
    style: {
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement(StepHeader, {
    number: "02",
    title: "Para quais contas copiar?",
    aside: `${selected.length} selecionada${selected.length !== 1 ? "s" : ""}`
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "flex-end",
      marginTop: -8,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "link",
    onClick: () => setSelected(allSelected ? [] : [...ACCOUNTS])
  }, allSelected ? "Limpar seleção" : "Selecionar todas")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 10
    }
  }, ACCOUNTS.map(a => /*#__PURE__*/React.createElement(Chip, {
    key: a,
    selected: selected.includes(a),
    onClick: () => toggle(a)
  }, a))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 14,
      marginTop: 22
    }
  }, /*#__PURE__*/React.createElement(OptionCard, {
    title: "Duplicar na pr\xF3pria conta",
    desc: "Cria um 2\xBA an\xFAncio do mesmo produto na conta de origem."
  }, /*#__PURE__*/React.createElement(Chip, {
    dot: "ml"
  }, "Easy SP \xB7 1 an\xFAncio")), /*#__PURE__*/React.createElement(OptionCard, {
    title: "Copiar para a Shopee",
    beta: true,
    desc: "T\xEDtulo, fotos, pre\xE7o e atributos v\xE3o automaticamente. At\xE9 30 c\xF3pias/dia."
  }, /*#__PURE__*/React.createElement(Chip, {
    dot: "shopee"
  }, "Easy Peasy Utilidades"), /*#__PURE__*/React.createElement(Chip, {
    dot: "shopee"
  }, "Netair / Netparts")))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 20,
      padding: "6px 4px 26px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13.5,
      color: "var(--ink-muted)"
    }
  }, count, " an\xFAncio", count !== 1 ? "s" : "", " \u2192 ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: "var(--ink)",
      fontWeight: 600
    }
  }, selected.length, " conta", selected.length !== 1 ? "s" : "", " de destino")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "outline"
  }, "Pr\xE9-visualizar"), /*#__PURE__*/React.createElement(Button, {
    onClick: doCopy,
    disabled: !detected || selected.length === 0
  }, "Copiar agora"))), /*#__PURE__*/React.createElement("section", {
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      justifyContent: "space-between",
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement(SectionLabel, {
    style: {
      margin: 0
    }
  }, "Hist\xF3rico"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: "var(--ink-faint)",
      fontVariantNumeric: "tabular-nums"
    }
  }, history.length, " registros \xB7 atualizado agora")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 16,
      marginBottom: 14,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 4,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(FilterTab, {
    active: filter === "todos",
    onClick: () => setFilter("todos")
  }, "Todos"), /*#__PURE__*/React.createElement(FilterTab, {
    active: filter === "em andamento",
    onClick: () => setFilter("em andamento")
  }, "Em andamento"), /*#__PURE__*/React.createElement(FilterTab, {
    active: filter === "sucesso",
    onClick: () => setFilter("sucesso"),
    count: counts.sucesso
  }, "Sucesso"), /*#__PURE__*/React.createElement(FilterTab, {
    active: filter === "erros",
    onClick: () => setFilter("erros"),
    count: counts.erros,
    countTone: "danger"
  }, "Erros"), /*#__PURE__*/React.createElement(FilterTab, {
    active: filter === "correções",
    onClick: () => setFilter("correções"),
    count: counts.correções,
    countTone: "warning"
  }, "Corre\xE7\xF5es")), /*#__PURE__*/React.createElement(Input, {
    placeholder: "Filtrar por SKU",
    value: sku,
    onChange: e => setSku(e.target.value),
    style: {
      width: 170
    }
  })), /*#__PURE__*/React.createElement(Card, {
    flush: true
  }, rows.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "22px",
      fontSize: 13,
      color: "var(--ink-faint)"
    }
  }, "Nenhum registro para este filtro."), rows.map((r, i) => /*#__PURE__*/React.createElement("div", {
    key: r.id,
    style: {
      padding: "16px 22px",
      borderBottom: i < rows.length - 1 ? "1px solid var(--line-faint)" : "none",
      display: "flex",
      alignItems: "center",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(Caret, {
    rotate: -90
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13.5,
      fontWeight: 600,
      flex: 1
    }
  }, r.label), /*#__PURE__*/React.createElement(StatusDot, {
    tone: r.tone
  }, r.pct), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12.5,
      color: "var(--ink-faint)",
      fontVariantNumeric: "tabular-nums"
    }
  }, r.meta))))));
}
function EmptyScreen({
  name
}) {
  return /*#__PURE__*/React.createElement("main", {
    style: {
      padding: "80px 32px",
      maxWidth: "var(--page-max)",
      margin: "0 auto",
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 48
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15.5,
      fontWeight: 600,
      marginBottom: 6
    }
  }, name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      color: "var(--ink-muted)"
    }
  }, "Tela n\xE3o inclu\xEDda neste kit de recria\xE7\xE3o.")));
}
function App() {
  const [tab, setTab] = React.useState("Copiar");
  const tabs = [{
    label: "Copiar"
  }, {
    label: "Editar"
  }, {
    label: "Perguntas",
    badge: 69
  }, {
    label: "Compatibilidades"
  }, {
    label: "Regras"
  }, {
    label: "Contas"
  }, {
    label: "Plataforma"
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--paper)",
      minHeight: "100vh",
      fontFamily: "var(--font-sans)",
      color: "var(--ink)"
    }
  }, /*#__PURE__*/React.createElement(TopbarNav, {
    tabs: tabs,
    active: tab,
    onSelect: setTab
  }), tab === "Copiar" ? /*#__PURE__*/React.createElement(CopiarScreen, null) : /*#__PURE__*/React.createElement(EmptyScreen, {
    name: tab
  }));
}

// Topbar wired for tab switching (the base Topbar is display-only).
function TopbarNav({
  tabs,
  active,
  onSelect
}) {
  return /*#__PURE__*/React.createElement("div", {
    onClickCapture: e => {
      const btn = e.target.closest && e.target.closest("nav button");
      if (btn) {
        const label = btn.textContent.replace(/\d+$/, "").trim();
        const t = tabs.find(x => label.startsWith(x.label));
        if (t) onSelect(t.label);
      }
    }
  }, /*#__PURE__*/React.createElement(Topbar, {
    logoSrc: window.__resources.leverLogo,
    brand: "LeverAds",
    tabs: tabs,
    active: active,
    metrics: [{
      label: "Vendas geradas",
      value: "R$ 40.567"
    }, {
      label: "Cota",
      value: "Ilimitada",
      accent: true
    }],
    initials: "E"
  }));
}
window.LeverAdsApp = App;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/leverads/App.standalone.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Chip = __ds_scope.Chip;

__ds_ns.FilterTab = __ds_scope.FilterTab;

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.KpiCard = __ds_scope.KpiCard;

__ds_ns.SectionLabel = __ds_scope.SectionLabel;

__ds_ns.StatusDot = __ds_scope.StatusDot;

__ds_ns.StepHeader = __ds_scope.StepHeader;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.SegmentedControl = __ds_scope.SegmentedControl;

__ds_ns.Textarea = __ds_scope.Textarea;

__ds_ns.Toggle = __ds_scope.Toggle;

__ds_ns.PageHeader = __ds_scope.PageHeader;

__ds_ns.Topbar = __ds_scope.Topbar;

})();
