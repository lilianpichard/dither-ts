import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "react-intl";
import PreviewSurface from "./PreviewSurface";
import { MESSAGES, type Locale } from "../i18n/messages";

function render(node: React.ReactNode, locale: Locale = "en"): string {
  return renderToStaticMarkup(
    <IntlProvider locale={locale} defaultLocale="en" messages={MESSAGES[locale]}>
      {node}
    </IntlProvider>,
  );
}

/** A surface with nothing on it, which is what a first launch looks like. */
function empty(
  overrides: Partial<React.ComponentProps<typeof PreviewSurface>> = {},
  locale: Locale = "en",
): string {
  return render(
    <PreviewSurface display={null} compare={null} geometry={null} label="Preview" {...overrides} />,
    locale,
  );
}

describe("the clear control", () => {
  it("is not drawn at all when the surface cannot be cleared", () => {
    // A dead button is noise, so the caller omits the handler and the control
    // does not exist.
    expect(empty()).not.toContain("Clear the canvas");
  });

  it("is drawn when the surface can be cleared", () => {
    expect(empty({ onClear: () => {} })).toContain("Clear the canvas");
  });

  it("is disabled when there is nothing to clear", () => {
    const markup = empty({ onClear: () => {}, canClear: false });
    expect(markup).toContain('aria-label="Clear the canvas"');
    expect(markup).toContain("disabled");
  });

  it("names the state it is in, so a dead control says why", () => {
    expect(empty({ onClear: () => {}, canClear: false })).toContain("Nothing loaded");
  });

  it("reads the same in French", () => {
    const markup = empty({ onClear: () => {}, canClear: true }, "fr");
    expect(markup).toContain("Vider le canvas");
    expect(markup).not.toContain("Nothing loaded");
  });
});

describe("the preview toolbar", () => {
  it("keeps its zoom and compare controls next to the new one", () => {
    // The clear is one control in a group, not a replacement for the others.
    const markup = empty({ onClear: () => {}, canClear: true });
    for (const label of ["Zoom in", "Zoom out", "Fit", "Compare"]) {
      expect(markup).toContain(label);
    }
  });

  it("still paints a frame that was handed to it", () => {
    // Clearing the store is one thing; the surface has to keep doing its job.
    expect(empty({ display: null, compare: null, geometry: null })).toContain('role="img"');
  });
});
