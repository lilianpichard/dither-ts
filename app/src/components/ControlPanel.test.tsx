import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "react-intl";
import ControlPanel, { PIXEL_SIZE_MAX, PIXEL_SIZE_MIN } from "./ControlPanel";
import ToolsPanel from "./ToolsPanel";
import { MESSAGES } from "../i18n/messages";

function rail(): string {
  return renderToStaticMarkup(
    <IntlProvider locale="fr" defaultLocale="en" messages={MESSAGES.fr}>
      <ControlPanel onFile={() => {}} width={256} collapsed={false} />
    </IntlProvider>,
  );
}

function dock(): string {
  return renderToStaticMarkup(
    <IntlProvider locale="fr" defaultLocale="en" messages={MESSAGES.fr}>
      <ToolsPanel tool="presets" onTool={() => {}} height={300} />
    </IntlProvider>,
  );
}

describe("pixel size control", () => {
  it("offers the full range with the label filled in, not left as a placeholder", () => {
    // A placeholder that never reaches the formatter leaves the braces behind,
    // which is how this regression showed up.
    const markup = rail();
    expect(markup).toContain(`max="${PIXEL_SIZE_MAX}"`);
    expect(markup).toContain("Taille de pixel");
    expect(markup).not.toContain("{value}");
  });

  it("keeps a range the kernel renders structure for", () => {
    // 128 blocks across a 1920 wide frame is about fifteen per row. 256 would
    // collapse the frame to one block per row, which the bound refuses.
    expect(1920 / PIXEL_SIZE_MAX).toBeGreaterThan(10);
    expect(1920 / 256).toBeLessThan(10);
    expect(PIXEL_SIZE_MIN).toBe(1);
  });
});

describe("dock tab width", () => {
  it("sizes the tab to its content, so the french label is not clipped", () => {
    // The tab carried a fixed 92 px, and the french label needs about 79 px of
    // text inside the 76 px left by the padding. Sizing to content is also what
    // makes the dock survive the next language.
    expect(dock()).toContain("Préréglages");
  });

  it("does not ship the fixed width that clipped it", () => {
    // A regression here would restore w-23 and silently clip the label again.
    expect(dock()).not.toMatch(/class="[^"]*\bw-23\b/);
  });
});
