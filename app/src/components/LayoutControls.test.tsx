import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "react-intl";
import { LayoutControls } from "./LayoutControls";
import { MESSAGES } from "../i18n/messages";

/** The two selects, each offering a side for its own panel. */
function render(): string {
  return renderToStaticMarkup(
    <IntlProvider locale="en" defaultLocale="en" messages={MESSAGES.en}>
      <LayoutControls />
    </IntlProvider>,
  );
}

describe("LayoutControls", () => {
  it("offers both sides for the rail and for the console", () => {
    const markup = render();
    // Each panel moves independently, so each needs its own pair of options.
    const options = [...markup.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1]);
    expect(options).toEqual(["Left", "Right", "Bottom", "Right"]);
  });

  it("names each select, so the two are distinguishable without seeing them", () => {
    const markup = render();
    expect(markup).toContain('aria-label="Controls side"');
    expect(markup).toContain('aria-label="Console side"');
  });

  it("carries the current choice in the value, so it reads as chosen", () => {
    // Without a value the select renders as its first option whatever was saved.
    expect(render()).toContain('value="left"');
    expect(render()).toContain('value="bottom"');
  });

  it("reads the same in French", () => {
    const markup = renderToStaticMarkup(
      <IntlProvider locale="fr" defaultLocale="en" messages={MESSAGES.fr}>
        <LayoutControls />
      </IntlProvider>,
    );
    expect(markup).toContain("Gauche");
    expect(markup).toContain("Bas");
    expect(markup).not.toContain(">Left<");
  });
});
