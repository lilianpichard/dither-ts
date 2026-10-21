import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "react-intl";
import { DimensionGrid, TimelineRibbon } from "./Timeline";
import type { LoadedClip } from "./decode";
import { MESSAGES, type Locale } from "../i18n/messages";

function render(node: React.ReactNode, locale: Locale = "en"): string {
  return renderToStaticMarkup(
    <IntlProvider locale={locale} defaultLocale="en" messages={MESSAGES[locale]}>
      {node}
    </IntlProvider>,
  );
}

/**
 * A clip is a video element with metadata, and the ribbon only ever reads the
 * metadata, so a real element is not needed to draw it.
 */
function clip(duration: number): LoadedClip {
  return {
    url: "blob:clip",
    element: {} as HTMLVideoElement,
    info: { width: 1920, height: 1080, duration },
    revoke: () => {},
  };
}

const RANGE = { start: 2.5, end: 7.5 };

describe("TimelineRibbon", () => {
  function ribbon(overrides: Partial<React.ComponentProps<typeof TimelineRibbon>> = {}): string {
    return render(
      <TimelineRibbon range={RANGE} duration={10} time={4} onScrub={() => {}} {...overrides} />,
    );
  }

  it("places the band over the part of the clip that is selected", () => {
    // Half the clip from a quarter of the way in, which is what the range says.
    const markup = ribbon();
    expect(markup).toContain("left:25%");
    expect(markup).toContain("width:50%");
  });

  it("marks the playhead where the frame is", () => {
    expect(ribbon({ time: 4 })).toContain("left:40%");
  });

  it("reads the selected span in seconds, not in fractions", () => {
    // The mark-up carries percentages; the user reads seconds.
    const markup = ribbon();
    expect(markup).toContain("2.5 s to 7.5 s");
  });

  it("keeps the marker inside the band at both ends of the clip", () => {
    // A playhead at the very end must not sit one pixel past the band.
    expect(ribbon({ time: 0 })).toContain("left:0%");
    expect(ribbon({ time: 10 })).toContain("left:100%");
  });

  it("draws no band at all for a clip with no duration", () => {
    // A zero-length clip would otherwise divide by zero and paint the whole
    // ribbon as selected.
    const markup = ribbon({ duration: 0, range: { start: 0, end: 0 } });
    expect(markup).toContain("width:0%");
  });

  it("disables the scrub slider while an export owns the element", () => {
    // A scrub seeks the same video element the exporter is reading, which
    // captures the wrong frames or resolves the other caller's seek.
    const markup = ribbon({ disabled: true });
    expect(markup).toContain('data-disabled=""');
  });

  it("offers a scrub slider over the whole clip", () => {
    // The ribbon is the picture and the slider is the control: without one the
    // band could be looked at but not moved.
    const markup = ribbon();
    expect(markup).toContain('aria-label="Scrub"');
    expect(markup).toContain('max="10"');
  });

  it("reads the same in French", () => {
    const markup = render(
      <TimelineRibbon range={RANGE} duration={10} time={4} onScrub={() => {}} />,
      "fr",
    );
    expect(markup).toContain("2.5 s à 7.5 s");
    expect(markup).toContain("Plage sélectionnée");
  });
});

describe("DimensionGrid", () => {
  it("shows the three sizes as three cases, not one sentence", () => {
    // Each one is a number the user compares against the others, and the
    // comparison is lost when they are written out in a row.
    const markup = render(<DimensionGrid clip={clip(12.4)} method="Atkinson" fullRes />);
    expect(markup).toContain("1920×1080");
    // The working size comes from the preview path, the export size from the
    // cap the method allows, so neither is hardcoded here.
    expect(markup).toContain("Working");
    expect(markup).toContain("Export");
  });

  it("labels each case with what it is", () => {
    const markup = render(<DimensionGrid clip={clip(12.4)} method="Bayer 4x4" fullRes />);
    expect(markup).toContain("Source");
    expect(markup).toContain("Working");
    expect(markup).toContain("Export");
  });

  it("reads the same in French", () => {
    const markup = render(<DimensionGrid clip={clip(12.4)} method="Atkinson" fullRes />, "fr");
    expect(markup).toContain("Source");
    expect(markup).toContain("Travail");
  });
});
