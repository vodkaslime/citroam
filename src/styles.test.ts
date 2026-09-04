/// <reference types="vite/client" />

import styles from "./styles.css?raw";

function ruleFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`Missing CSS rule for ${selector}`);
  return match[1];
}

function token(rule: string, name: string): string {
  const match = rule.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`Missing color token --${name}`);
  return match[1];
}

function fontSizePx(rule: string): number {
  const match = rule.match(/font-size:\s*([\d.]+)px/);
  if (!match) throw new Error("Missing pixel font-size");
  return Number(match[1]);
}

function luminance(hex: string): number {
  const channels = hex.match(/[0-9a-fA-F]{2}/g)!.map((part) => Number.parseInt(part, 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(first: string, second: string): number {
  const lighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("citroam Juicy Utility visual contracts", () => {
  it("uses the documented soda palette in both themes", () => {
    const light = ruleFor(":root");
    const dark = ruleFor('.canvas-app[data-theme="dark"]');

    expect(token(light, "canvas")).toBe("#F4F6EA");
    expect(token(light, "surface")).toBe("#FFFDF7");
    expect(token(light, "ink")).toBe("#24271F");
    expect(token(light, "accent")).toBe("#F06A3B");
    expect(token(light, "lemon-foam")).toBe("#FFE8A6");
    expect(token(light, "lime-fizz")).toBe("#DDEBB5");
    expect(token(light, "soda-mint")).toBe("#D8ECE7");

    expect(token(dark, "canvas")).toBe("#1B1E18");
    expect(token(dark, "surface")).toBe("#282C23");
    expect(token(dark, "ink")).toBe("#F3F4E9");
    expect(token(dark, "accent")).toBe("#FF8259");
    expect(token(dark, "lemon-foam")).toBe("#443A20");
    expect(token(dark, "lime-fizz")).toBe("#2F3B26");
    expect(token(dark, "soda-mint")).toBe("#253936");
  });

  it("uses Outfit for the brand while preserving a readable Chinese UI stack", () => {
    expect(ruleFor(":root")).toMatch(/font-family:\s*"Outfit Variable"[\s\S]*"PingFang SC"/);
    expect(ruleFor(".canvas-brand")).toMatch(/font-family:\s*"Outfit Variable"/);
  });

  it("keeps recovery and search available at the minimum window width", () => {
    const narrowRules = styles.slice(
      styles.indexOf("@media (max-width: 760px)"),
      styles.indexOf("@media (prefers-reduced-motion: reduce)"),
    );

    expect(styles).toContain(".canvas-save-error {");
    expect(narrowRules).not.toMatch(/\.canvas-search-button[\s\S]*?display:\s*none/);
  });

  it("keeps controls inside the custom titlebar clickable instead of draggable", () => {
    const noDragRule = ruleFor(
      "[data-tauri-drag-region] button,\n[data-tauri-drag-region] input,\n[data-tauri-drag-region] textarea,\n[data-tauri-drag-region] select,\n[data-tauri-drag-region] a",
    );

    expect(noDragRule).toMatch(/-webkit-app-region:\s*no-drag/);
  });

  it("keeps the direct today action at the minimum window width", () => {
    const narrowDateRules = styles.slice(styles.lastIndexOf("@media (max-width: 760px)"));

    expect(narrowDateRules).not.toMatch(/\.canvas-page-today[\s\S]*?display:\s*none/);
  });

  it("keeps interactive controls at least 32 pixels tall", () => {
    const selectors = [
      ".canvas-view-switch button",
      ".canvas-icon-button",
      ".canvas-controls button",
      ".canvas-area-move",
      ".canvas-area-resize",
      ".canvas-page-nav button",
      ".canvas-page-picker > header button",
      ".canvas-capture-token",
      ".canvas-undo",
      ".canvas-overview-restore",
      ".canvas-search-panel header button",
      ".canvas-property-list input,\n.canvas-property-list select",
    ];

    selectors.forEach((selector) => {
      expect(ruleFor(selector), selector).toMatch(/(?:min-)?height:\s*(?:3[2-9]|[4-9]\d)px/);
    });
  });

  it("keeps decision-bearing secondary text above its readability floor", () => {
    expect(fontSizePx(ruleFor(".canvas-page-date-copy > strong"))).toBeGreaterThanOrEqual(12);
    expect(fontSizePx(ruleFor(".canvas-property-list input,\n.canvas-property-list select"))).toBeGreaterThanOrEqual(10);
    expect(fontSizePx(ruleFor(".canvas-period-control button,\n.canvas-add-exact-time,\n.canvas-clear-time"))).toBeGreaterThanOrEqual(10);
    expect(fontSizePx(ruleFor(".canvas-overview-meta"))).toBeGreaterThanOrEqual(10);
    expect(fontSizePx(ruleFor(".canvas-overview-locate,\n.canvas-overview-restore"))).toBeGreaterThanOrEqual(10);
  });

  it("keeps task-relevant supporting copy readable without enlarging utility hints", () => {
    const supportingSelectors = [
      ".canvas-controls button",
      ".canvas-quick-menu small",
      ".canvas-field > span",
      ".canvas-exact-time-fields label > span",
      ".canvas-exact-time-fields input",
      ".canvas-overview-status button strong",
      ".canvas-search-results small",
      ".canvas-page-picker > label",
      ".canvas-page-picker input",
      ".canvas-previous-bookmark",
      ".canvas-card-drop-preview span",
      ".canvas-capture-notice",
    ];

    supportingSelectors.forEach((selector) => {
      expect(fontSizePx(ruleFor(selector)), selector).toBeGreaterThanOrEqual(10);
    });
    expect(fontSizePx(ruleFor(".canvas-search-button kbd"))).toBe(8);
    expect(fontSizePx(ruleFor(".canvas-controls > span"))).toBe(8);
    expect(fontSizePx(ruleFor(".canvas-page-date-copy > span"))).toBe(8);
  });

  it("renders cards as soft soda labels instead of flat architectural rows", () => {
    const card = ruleFor(".canvas-card");

    expect(card).toMatch(/width:\s*248px/);
    expect(card).toMatch(/min-height:\s*76px/);
    expect(card).toMatch(/grid-template-columns:\s*42px minmax\(0, 1fr\)/);
    expect(card).toMatch(/border-radius:\s*18px 18px 18px 10px/);
    expect(card).toMatch(/box-shadow:\s*var\(--card-shadow\)/);
    expect(ruleFor(".canvas-card-complete")).toMatch(/background:\s*var\(--lemon-foam\)/);
    expect(ruleFor(".canvas-card.is-dragging")).toMatch(/scale:\s*1\.025/);
  });

  it("keeps direct-manipulation cursors honest after movement begins", () => {
    expect(ruleFor(".canvas-card.is-dragging .canvas-card-open")).toMatch(/cursor:\s*grabbing/);
    expect(ruleFor(".canvas-area.is-transforming .canvas-area-move")).toMatch(/cursor:\s*grabbing/);
  });

  it("accents time metadata without making the first unrelated property look urgent", () => {
    expect(styles).not.toContain(".canvas-card-meta > span:first-child");
    expect(ruleFor(".canvas-card-meta > .is-time")).toMatch(/color:\s*var\(--accent-ink\)/);
  });

  it("renders areas as quiet lime trays", () => {
    const area = ruleFor(".canvas-area");

    expect(area).toMatch(/border-radius:\s*22px/);
    expect(area).toMatch(/background:\s*color-mix\(in srgb, var\(--lime-fizz\) 72%, transparent\)/);
    expect(ruleFor(".canvas-area:hover,\n.canvas-area.is-selected,\n.canvas-area:focus-within")).toMatch(/border-color:\s*color-mix\(in srgb, var\(--accent\)/);
  });

  it("reveals quiet area controls when keyboard focus enters the tray", () => {
    expect(ruleFor(".canvas-area:hover,\n.canvas-area.is-selected,\n.canvas-area:focus-within"))
      .toMatch(/border-color:\s*color-mix\(in srgb, var\(--accent\)/);
    expect(ruleFor(".canvas-area:hover .canvas-area-resize,\n.canvas-area.is-selected .canvas-area-resize,\n.canvas-area:focus-within .canvas-area-resize"))
      .toMatch(/opacity:\s*1/);
  });

  it("makes area handles appear and press without abrupt jumps", () => {
    expect(ruleFor(".canvas-area-move"))
      .toMatch(/transition:[\s\S]*background-color 140ms ease[\s\S]*transform 90ms ease/);
    expect(ruleFor(".canvas-area-move:active")).toMatch(/transform:\s*scale\(0\.98\)/);
    expect(ruleFor(".canvas-area-resize"))
      .toMatch(/transition:[\s\S]*opacity 140ms ease[\s\S]*transform 90ms ease/);
    expect(ruleFor(".canvas-area-resize:hover"))
      .toMatch(/background:\s*var\(--surface\)[\s\S]*color:\s*var\(--ink\)/);
    expect(ruleFor(".canvas-area-resize:active")).toMatch(/transform:\s*scale\(0\.94\)/);
  });

  it("renders each date as a light canvas field with asymmetric soft periods", () => {
    const page = ruleFor(".canvas-day-page");
    const period = ruleFor(".canvas-day-period");

    expect(page).toMatch(/position:\s*absolute/);
    expect(page).toMatch(/background:\s*transparent/);
    expect(page).not.toMatch(/border:/);
    expect(page).not.toMatch(/border-radius:/);
    expect(page).not.toMatch(/box-shadow:/);
    expect(period).toMatch(/position:\s*absolute/);
    expect(period).toMatch(/border:\s*1px solid color-mix\(in srgb, var\(--line-strong\)/);
    expect(period).toMatch(/border-radius:\s*22px 22px 22px 14px/);
    expect(ruleFor(".canvas-day-period.is-morning")).toMatch(/left:\s*6%/);
    expect(ruleFor(".canvas-day-period.is-evening")).toMatch(/right:\s*12%/);
  });

  it("gives page turns and date navigation short, interruptible feedback", () => {
    expect(ruleFor(".canvas-page-scene")).toMatch(/animation:\s*canvas-page-in 180ms/);
    expect(ruleFor(".canvas-page-picker")).toMatch(/animation:\s*canvas-page-picker-in 180ms/);
    expect(ruleFor(".canvas-previous-bookmark")).toMatch(/animation:\s*canvas-bookmark-in 180ms/);
    expect(styles).toMatch(/@keyframes canvas-page-in[\s\S]*translateX\(var\(--page-enter-x\)\)[\s\S]*translateX\(0\)/);
  });

  it("combines the date copy and calendar affordance in one control", () => {
    expect(ruleFor(".canvas-page-nav .canvas-page-date"))
      .toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) auto/);
    expect(ruleFor(".canvas-page-date-copy")).toMatch(/flex-direction:\s*column/);
    expect(ruleFor(".canvas-page-date-icon")).toMatch(/color:\s*var\(--muted\)/);
  });

  it("keeps the current date page visible after focus moves inside the picker", () => {
    const current = ruleFor('.canvas-page-picker > div button[aria-current="date"]');

    expect(current).toMatch(/border-color:\s*color-mix\(in srgb, var\(--accent\)/);
    expect(current).toMatch(/background:\s*var\(--lemon-foam\)/);
    expect(current).toMatch(/color:\s*var\(--ink\)/);
  });

  it("keeps date pages fixed and free of container manipulation controls", () => {
    expect(styles).toContain(".canvas-day-page {");
    expect(styles).not.toContain(".canvas-day-page-move");
    expect(styles).not.toContain(".canvas-day-page-resize");
    expect(styles).not.toContain(".canvas-day-page-empty");
  });

  it("makes the capture bar the primary branded object", () => {
    const capture = ruleFor(".canvas-capture");

    expect(capture).toMatch(/min-height:\s*62px/);
    expect(capture).toMatch(/grid-template-columns:\s*auto minmax\(0, 1fr\) auto auto auto/);
    expect(capture).toMatch(/border-radius:\s*20px/);
    expect(capture).toMatch(/box-shadow:\s*var\(--dock-shadow\)/);
    expect(ruleFor(".canvas-capture:focus-within")).toMatch(/background:\s*color-mix\(in srgb, var\(--lemon-foam\)/);
    expect(ruleFor('.canvas-capture > button[type="submit"]')).toMatch(/width:\s*40px[\s\S]*height:\s*40px[\s\S]*border-radius:\s*12px/);
  });

  it("lays conversation out as a floating canvas tool workspace", () => {
    const workspace = ruleFor(".canvas-agent-workspace");

    expect(workspace).toMatch(/position:\s*absolute/);
    expect(workspace).toMatch(/inset:\s*auto 24px 96px auto/);
    expect(workspace).toMatch(/display:\s*flex/);
    expect(workspace).toMatch(/width:\s*min\(370px, calc\(100% - 48px\)\)/);
    expect(workspace).toMatch(/height:\s*min\(560px, calc\(100% - 150px\)\)/);
    expect(workspace).toMatch(/flex-direction:\s*column/);
    expect(workspace).toMatch(/animation:\s*canvas-agent-in 220ms/);
    expect(styles).toMatch(/@keyframes canvas-agent-in[\s\S]*translateY\(8px\)[\s\S]*translateY\(0\)/);
    expect(styles).not.toContain(".canvas-agent-panel");
    expect(styles).not.toContain(".canvas-agent-backdrop");
    expect(ruleFor(".canvas-agent-trigger[aria-expanded=\"true\"]")).toMatch(/background:/);
  });

  it("keeps agent messages scrollable while the compose bar stays available", () => {
    expect(ruleFor(".canvas-agent-turns"))
      .toMatch(/min-height:\s*0[\s\S]*flex:\s*1 1 auto[\s\S]*overflow-y:\s*auto/);
    expect(ruleFor(".canvas-agent-compose"))
      .toMatch(/flex:\s*0 0 auto[\s\S]*background:/);
  });

  it("keeps pending agent batch outlines temporary and non-interactive", () => {
    const preview = ruleFor(".canvas-agent-preview");

    expect(preview).toMatch(/width:\s*248px/);
    expect(preview).toMatch(/height:\s*112px/);
    expect(preview).toMatch(/border:\s*1px dashed/);
    expect(preview).toMatch(/pointer-events:\s*none/);
    expect(preview).toMatch(/animation:\s*canvas-agent-preview-in 150ms/);
    expect(styles).toMatch(/@keyframes canvas-agent-preview-in[\s\S]*opacity:\s*0[\s\S]*opacity:\s*0\.7/);
  });

  it("keeps agent turns directional and light instead of heavy chat bubbles", () => {
    expect(ruleFor(".canvas-agent-turn")).toMatch(/animation:\s*canvas-agent-turn-in 120ms/);
    expect(ruleFor(".canvas-agent-turn.is-user")).toMatch(/align-items:\s*flex-end/);
    expect(ruleFor(".canvas-agent-turn.is-agent")).toMatch(/align-items:\s*flex-start/);
    expect(ruleFor(".canvas-agent-turn.is-user > p")).toMatch(/background:\s*var\(--soda-mint\)/);
    expect(ruleFor(".canvas-agent-turn.is-agent > p")).toMatch(/background:\s*transparent/);
    expect(styles).toMatch(/@keyframes canvas-agent-turn-in[\s\S]*translateY\(4px\)[\s\S]*translateY\(0\)/);
  });

  it("gives every agent choice and action a short tactile cycle", () => {
    expect(ruleFor(".canvas-agent-candidates > button,\n.canvas-agent-results button")).toMatch(/min-height:\s*48px[\s\S]*transition:[\s\S]*transform 90ms ease/);
    expect(ruleFor(".canvas-agent-candidates > button:active,\n.canvas-agent-results button:active")).toMatch(/transform:\s*scale\(0\.98\)/);
    expect(ruleFor(".canvas-agent-receipt-actions button,\n.canvas-agent-turn-actions button"))
      .toMatch(/min-height:\s*32px[\s\S]*transition:[\s\S]*transform 90ms ease/);
    expect(ruleFor(".canvas-agent-compose input")).toMatch(/height:\s*40px/);
    expect(ruleFor(".canvas-agent-compose > button")).toMatch(/width:\s*40px[\s\S]*height:\s*40px/);
  });

  it("keeps the agent workspace inside the minimum-window safe area", () => {
    const narrowRules = styles.slice(styles.lastIndexOf("@media (max-width: 760px)"));

    expect(narrowRules).toMatch(/\.canvas-agent-workspace\s*\{[^}]*inset:\s*auto 10px 88px auto/);
    expect(narrowRules).toMatch(/\.canvas-agent-workspace\s*\{[^}]*width:\s*min\(390px, calc\(100% - 20px\)\)/);
    expect(narrowRules).toMatch(/\.canvas-agent-workspace\s*\{[^}]*padding:/);
    expect(narrowRules).toMatch(/\.canvas-capture\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto auto/);
  });

  it("does not leave a stale three-column capture rule in narrow-window CSS", () => {
    const captureRules = [...styles.matchAll(/\.canvas-capture\s*\{([^}]*)\}/g)]
      .map((match) => match[1])
      .filter((rule) => rule.includes("grid-template-columns"));

    expect(captureRules.length).toBeGreaterThan(0);
    expect(captureRules.join("\n")).not.toMatch(
      /grid-template-columns:\s*auto minmax\(0, 1fr\) auto\s*;/,
    );
    expect(captureRules.join("\n")).toMatch(
      /grid-template-columns:\s*auto minmax\(0, 1fr\) auto auto\s*;/,
    );
  });

  it("lays transient feedback and undo out in one calm rail", () => {
    const rail = ruleFor(".canvas-feedback-rail");

    expect(rail).toMatch(/display:\s*flex/);
    expect(rail).toMatch(/gap:\s*6px/);
    expect(rail).toMatch(/left:\s*50%/);
    expect(rail).toMatch(/transform:\s*translateX\(-50%\)/);
    expect(ruleFor(".canvas-undo")).not.toMatch(/position:\s*absolute/);
    expect(ruleFor(".canvas-capture-notice")).not.toMatch(/position:\s*absolute/);
    expect(ruleFor(".canvas-feedback-rail.is-agent-view"))
      .toMatch(/bottom:\s*92px/);
  });

  it("lets the shared feedback rail wrap instead of clipping at the minimum window width", () => {
    const narrowRules = styles.slice(
      styles.indexOf("@media (max-width: 760px)"),
      styles.indexOf("@media (prefers-reduced-motion: reduce)"),
    );

    expect(narrowRules).toMatch(/\.canvas-feedback-rail\s*\{[^}]*width:\s*calc\(100% - 24px\)/);
    expect(narrowRules).toMatch(/\.canvas-feedback-rail\s*\{[^}]*max-width:\s*none/);
    expect(narrowRules).toMatch(/\.canvas-feedback-rail\s*\{[^}]*flex-wrap:\s*wrap/);
  });

  it("keeps save recovery inside the shared feedback rail", () => {
    const saveError = ruleFor(".canvas-save-error");

    expect(saveError).not.toMatch(/position:\s*absolute/);
    expect(saveError).not.toMatch(/top:\s*14px/);
    expect(saveError).not.toMatch(/left:\s*50%/);
    expect(saveError).not.toMatch(/translateX\(-50%\)/);
  });

  it("renders overview as a calm single-column index instead of a dashboard", () => {
    const overview = ruleFor(".canvas-overview");
    const sections = ruleFor(".canvas-overview-header,\n.canvas-overview-sections,\n.canvas-overview > .canvas-overview-section,\n.canvas-overview-empty");
    const row = ruleFor(".canvas-overview-row");

    expect(overview).toMatch(/overflow-y:\s*auto/);
    expect(overview).toMatch(/animation:\s*canvas-overview-in 220ms/);
    expect(sections).toMatch(/max-width:\s*960px/);
    expect(row).toMatch(/min-height:\s*60px/);
    expect(row).toMatch(/grid-template-columns:\s*32px minmax\(180px, 1fr\) minmax\(160px, auto\) auto/);
    expect(row).toMatch(/border-bottom:\s*1px solid var\(--line\)/);
    expect(row).not.toMatch(/box-shadow/);
    expect(ruleFor(".canvas-overview-status button[aria-pressed=\"true\"]"))
      .toMatch(/background:\s*var\(--lemon-foam\)/);
  });

  it("keeps progressive overview continuation quiet and tactile", () => {
    const continuation = ruleFor(".canvas-overview-more");

    expect(continuation).toMatch(/max-width:\s*960px/);
    expect(continuation).toMatch(/min-height:\s*38px/);
    expect(continuation).toMatch(/background:\s*color-mix\(in srgb, var\(--surface\) 72%, transparent\)/);
    expect(continuation).toMatch(/transition:[^;]*transform 90ms ease/);
    expect(ruleFor(".canvas-overview-more:hover")).toMatch(/translateY\(-1px\)/);
    expect(ruleFor(".canvas-overview-more:active")).toMatch(/scale\(0\.98\)/);
  });

  it("does not reserve layout for removed explanatory copy", () => {
    expect(styles).not.toContain(".canvas-empty");
    expect(styles).not.toContain(".canvas-overview-kicker");
    expect(styles).not.toContain(".canvas-overview-header p");
    expect(styles).not.toContain(".canvas-day-period small");
    expect(styles).not.toContain(".canvas-loose-empty");
  });

  it("implements the documented motion timings and tactile states", () => {
    expect(ruleFor(".canvas-card.is-entering")).toMatch(/animation:\s*canvas-card-in 220ms/);
    expect(ruleFor(".canvas-card.is-dropping")).toMatch(/animation:\s*canvas-card-drop 200ms/);
    expect(ruleFor(".canvas-card.is-completing")).toMatch(/animation:\s*canvas-card-complete 260ms/);
    expect(ruleFor(".canvas-quick-menu")).toMatch(/animation:\s*canvas-menu-in 180ms/);
    expect(ruleFor(".canvas-inspector")).toMatch(/animation:\s*canvas-inspector-in 260ms/);
    expect(ruleFor(".canvas-search-panel")).toMatch(/animation:\s*canvas-dialog-in 220ms/);
    expect(ruleFor(".canvas-undo")).toMatch(/animation:\s*canvas-undo-in 180ms/);
    expect(ruleFor(".canvas-world.is-locating")).toMatch(/transition:\s*transform 260ms/);
    expect(ruleFor(".canvas-overview-row")).toMatch(/animation:\s*canvas-overview-row-in 220ms/);
    expect(ruleFor(".canvas-app")).toMatch(/transition:\s*background-color 160ms/);
    expect(styles).toMatch(/@keyframes canvas-card-in[\s\S]*scale\(0\.94\)[\s\S]*scale\(1\.03\)[\s\S]*scale\(1\)/);
  });

  it("gives existing high-frequency actions consistent tactile feedback", () => {
    expect(ruleFor('.canvas-capture > button[type="submit"]:hover:not(:disabled)'))
      .toMatch(/transform:\s*translateY\(-1px\)/);
    expect(ruleFor(".canvas-period-control button:hover,\n.canvas-add-exact-time:hover"))
      .toMatch(/background:\s*var\(--surface-hover\)[\s\S]*color:\s*var\(--ink\)/);
    expect(ruleFor(".canvas-page-picker > header button:hover,\n.canvas-search-panel header button:hover"))
      .toMatch(/background:\s*var\(--surface-hover\)[\s\S]*color:\s*var\(--ink\)/);
    expect(ruleFor(".canvas-page-picker > header button:active,\n.canvas-search-panel header button:active"))
      .toMatch(/transform:\s*scale\(0\.95\)/);
    expect(ruleFor(".canvas-page-picker > header button"))
      .toMatch(/transition:\s*background-color 140ms ease, color 140ms ease, transform 90ms ease/);
    expect(ruleFor(".canvas-search-panel header button"))
      .toMatch(/transition:\s*background-color 140ms ease, color 140ms ease, transform 90ms ease/);
    expect(ruleFor(".canvas-previous-bookmark:hover"))
      .toMatch(/transform:\s*translateY\(-1px\)/);
    expect(ruleFor(".canvas-previous-bookmark:active"))
      .toMatch(/transform:\s*scale\(0\.97\)/);
  });

  it("gives destructive and confirmation actions complete tactile cycles", () => {
    expect(ruleFor(".canvas-delete-button"))
      .toMatch(/transition:[\s\S]*background-color 140ms ease[\s\S]*transform 90ms ease/);
    expect(ruleFor(".canvas-delete-button:hover"))
      .toMatch(/background:\s*var\(--danger-soft\)[\s\S]*transform:\s*translateY\(-1px\)/);
    expect(ruleFor(".canvas-delete-button:active")).toMatch(/transform:\s*scale\(0\.97\)/);
    expect(ruleFor(".canvas-confirm-dialog > div button"))
      .toMatch(/transition:[\s\S]*box-shadow 90ms ease[\s\S]*transform 90ms ease/);
    expect(ruleFor(".canvas-confirm-dialog > div button:hover"))
      .toMatch(/box-shadow:[\s\S]*transform:\s*translateY\(-1px\)/);
  });

  it("lets overview titles respond smoothly without adding row decoration", () => {
    expect(ruleFor(".canvas-overview-open")).toMatch(/transition:\s*transform 90ms ease/);
    expect(ruleFor(".canvas-overview-open strong")).toMatch(/transition:\s*color 140ms ease/);
    expect(ruleFor(".canvas-overview-open:active")).toMatch(/transform:\s*scale\(0\.99\)/);
  });

  it("keeps the previous-day entrance from overriding its tactile transform", () => {
    expect(styles).toMatch(/@keyframes canvas-bookmark-in[\s\S]*translate:\s*-5px 0[\s\S]*translate:\s*0 0/);
    expect(styles).not.toMatch(/@keyframes canvas-bookmark-in\s*\{[^}]*transform:/);
  });

  it("keeps quick-token entrance from overriding its remove press", () => {
    expect(ruleFor(".canvas-capture-token:active")).toMatch(/transform:\s*scale\(0\.96\)/);
    expect(styles).toMatch(/@keyframes canvas-token-in[\s\S]*scale:\s*0\.94[\s\S]*scale:\s*1/);
    expect(styles).not.toMatch(/@keyframes canvas-token-in\s*\{[^}]*transform:/);
  });

  it("gives temporary choice rows the same short pressed feedback", () => {
    const choiceRows = ruleFor(".canvas-backup-menu button,\n.canvas-quick-menu > button,\n.canvas-search-results > button,\n.canvas-page-picker > div button");
    const pressedRows = ruleFor(".canvas-backup-menu button:active,\n.canvas-quick-menu > button:active,\n.canvas-search-results > button:active,\n.canvas-page-picker > div button:active");

    expect(choiceRows).toMatch(/transition:[\s\S]*background-color 140ms ease[\s\S]*transform 90ms ease/);
    expect(pressedRows).toMatch(/transform:\s*scale\(0\.98\)/);
  });

  it("keeps undo tactile after its entrance animation settles", () => {
    expect(ruleFor(".canvas-undo"))
      .toMatch(/transition:[\s\S]*background-color 140ms ease[\s\S]*box-shadow 90ms ease[\s\S]*transform 90ms ease/);
    expect(ruleFor(".canvas-undo:hover"))
      .toMatch(/background:\s*var\(--surface-hover\)[\s\S]*transform:\s*translateY\(-1px\)/);
    expect(ruleFor(".canvas-undo:active"))
      .toMatch(/transform:\s*scale\(0\.97\)/);
    expect(styles).toMatch(/@keyframes canvas-undo-in[\s\S]*translate:\s*0 8px[\s\S]*translate:\s*0 0/);
    expect(styles).not.toMatch(/@keyframes canvas-undo-in\s*\{[^}]*transform:/);
  });

  it("does not keep styling for the removed drag hint", () => {
    expect(styles).not.toContain(".canvas-drag-hint");
  });

  it("lets successful save feedback recede without moving the title bar", () => {
    expect(ruleFor(".canvas-save-state.is-saved > span"))
      .toMatch(/animation:\s*canvas-save-state-in 160ms ease both,\s*canvas-save-state-settle 220ms ease 1400ms forwards/);
    expect(styles).toMatch(/@keyframes canvas-save-state-settle[\s\S]*from\s*\{\s*opacity:\s*1[\s\S]*to\s*\{\s*opacity:\s*0/);
    expect(ruleFor(".canvas-save-state")).toMatch(/min-width:\s*102px/);
  });

  it("keeps critical recovery actions tactile without a stale header retry style", () => {
    expect(styles).not.toContain(".canvas-save-state button");
    expect(ruleFor(".canvas-load-error button"))
      .toMatch(/transition:\s*background-color 140ms ease, border-color 140ms ease, transform 90ms ease/);
    expect(ruleFor(".canvas-save-error button"))
      .toMatch(/transition:\s*background-color 140ms ease, color 140ms ease, transform 90ms ease/);
    expect(ruleFor(".canvas-load-error button:hover"))
      .toMatch(/background:\s*var\(--surface-hover\)[\s\S]*transform:\s*translateY\(-1px\)/);
    expect(ruleFor(".canvas-save-error button:hover"))
      .toMatch(/transform:\s*translateY\(-1px\)/);
    expect(ruleFor(".canvas-load-error button:active,\n.canvas-save-error button:active"))
      .toMatch(/transform:\s*scale\(0\.97\)/);
  });

  it("keeps secondary text and destructive actions readable in both themes", () => {
    const themes = [ruleFor(":root"), ruleFor('.canvas-app[data-theme="dark"]')];

    themes.forEach((theme) => {
      expect(contrast(token(theme, "muted"), token(theme, "canvas")), "muted on canvas").toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(theme, "muted"), token(theme, "surface")), "muted on surface").toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(theme, "danger"), token(theme, "danger-button-ink")), "danger button").toBeGreaterThanOrEqual(4.5);
    });
  });

  it("uses the shared high-contrast token for every keyboard focus ring", () => {
    const focusRule = ruleFor("button:focus-visible,\ninput:focus-visible,\ntextarea:focus-visible,\nselect:focus-visible,\n[tabindex]:focus-visible");
    const themes = [ruleFor(":root"), ruleFor('.canvas-app[data-theme="dark"]')];

    expect(focusRule).toMatch(/outline:\s*2px solid var\(--focus\)/);
    expect(styles.lastIndexOf("button:focus-visible,")).toBeGreaterThan(styles.lastIndexOf("outline: 0"));
    themes.forEach((theme) => {
      expect(contrast(token(theme, "focus"), token(theme, "canvas")), "focus on canvas").toBeGreaterThanOrEqual(3);
      expect(contrast(token(theme, "focus"), token(theme, "surface")), "focus on surface").toBeGreaterThanOrEqual(3);
    });
  });

  it("defines a visible focus color for keyboard-located overview rows", () => {
    expect(ruleFor(":root")).toMatch(/--focus:\s*#[0-9a-fA-F]{6}/);
    expect(ruleFor('.canvas-app[data-theme="dark"]')).toMatch(/--focus:\s*#[0-9a-fA-F]{6}/);
    expect(ruleFor(".canvas-overview-row:focus-visible")).toMatch(/outline:\s*2px solid var\(--focus\)/);
  });

  it("provides full reduced-motion fallbacks and avoids perpetual decoration", () => {
    const reducedIndex = styles.lastIndexOf("@media (prefers-reduced-motion: reduce)");
    const reduced = styles.slice(reducedIndex);

    expect(reducedIndex).toBeGreaterThan(styles.lastIndexOf(".canvas-agent-workspace"));
    expect(reducedIndex).toBeGreaterThan(styles.lastIndexOf(".canvas-page-scene"));
    expect(reducedIndex).toBeGreaterThan(styles.lastIndexOf("button:focus-visible,"));
    expect(reduced).toContain("animation-duration: 0.01ms !important");
    expect(reduced).toContain("animation-iteration-count: 1 !important");
    expect(styles).not.toContain(".canvas-stage::before");
    expect(styles.match(/\binfinite\b/g)).toHaveLength(1);
  });

  it("keeps native controls themed and avoids absolute black and white", () => {
    expect(ruleFor(":root")).toMatch(/color-scheme:\s*light/);
    expect(ruleFor('.canvas-app[data-theme="dark"]')).toMatch(/color-scheme:\s*dark/);
    expect(styles).not.toMatch(/#(?:000000|ffffff)\b/i);
  });

  it("presents app settings as one focused two-column utility surface", () => {
    expect(ruleFor(".canvas-settings-backdrop"))
      .toMatch(/position:\s*fixed[\s\S]*inset:\s*0[\s\S]*backdrop-filter:\s*blur\(8px\)/);
    expect(ruleFor(".canvas-settings-panel"))
      .toMatch(/grid-template-columns:\s*176px minmax\(0, 1fr\)[\s\S]*max-width:\s*860px[\s\S]*animation:\s*canvas-settings-in 180ms/);
    expect(ruleFor(".canvas-settings-header")).toMatch(/grid-column:\s*1 \/ -1/);
  });

  it("keeps settings form controls comfortably clickable and visibly tactile", () => {
    expect(ruleFor(".canvas-settings-field input")).toMatch(/min-height:\s*42px/);
    expect(ruleFor(".canvas-settings-actions button")).toMatch(/min-height:\s*38px/);
    expect(ruleFor(`.canvas-settings-actions button:active,
.canvas-settings-data-actions button:active,
.canvas-theme-choice button:active`))
      .toMatch(/transform:\s*scale\(0\.98\)/);
  });

  it("collapses settings to one column at compact desktop widths", () => {
    const narrowRules = styles.slice(styles.lastIndexOf("@media (max-width: 760px)"));
    expect(narrowRules).toMatch(/\.canvas-settings-panel\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
    expect(narrowRules).toMatch(/\.canvas-settings-nav\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3, 1fr\)/);
  });
});
