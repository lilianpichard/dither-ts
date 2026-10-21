import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "react-intl";
import { PanelResizer, dragExtent, type PanelSide } from "./PanelResizer";
import { MESSAGES } from "../i18n/messages";

/**
 * The drag delta and the collapse handle are the two things that tell the user
 * which way a panel grows, and neither is visible in the props. These read the
 * rendered markup, because that is the only place the direction is real.
 */
function markup(side: PanelSide, size: number): string {
  return renderToStaticMarkup(
    <IntlProvider locale="en" defaultLocale="en" messages={MESSAGES.en}>
      <PanelResizer
        side={side}
        size={size}
        onResize={() => {}}
        onToggle={() => {}}
        min={120}
        max={800}
        label="test panel"
      />
    </IntlProvider>,
  );
}

/** Which icons the handle drew, as the svg classes name them. */
function handleIcons(side: PanelSide, size: number): string[] {
  return [...markup(side, size).matchAll(/lucide-([a-z-]+)/g)].map((match) => match[1]);
}

describe("drag direction", () => {
  it("grows whichever side the panel is docked to", () => {
    // The bar sits between the panel and the canvas. Moving toward the panel
    // grows it; the old sign made a left rail shrink when dragged right.
    expect(dragExtent("left", 300, 40)).toBe(340);
    expect(dragExtent("right", 300, -40)).toBe(340);
    expect(dragExtent("top", 300, 40)).toBe(340);
    expect(dragExtent("bottom", 300, -40)).toBe(340);
  });

  it("shrinks on the opposite move", () => {
    expect(dragExtent("left", 300, -40)).toBe(260);
    expect(dragExtent("right", 300, 40)).toBe(260);
    expect(dragExtent("top", 300, -40)).toBe(260);
    expect(dragExtent("bottom", 300, 40)).toBe(260);
  });
});

describe("PanelResizer axis", () => {
  it("maps a rail to the horizontal axis and a console to the vertical", () => {
    // A rail is dragged along x and the console along y. Reading the wrong one
    // makes the drag jump the other way on the first move.
    expect(markup("left", 300)).toContain('aria-orientation="horizontal"');
    expect(markup("right", 300)).toContain('aria-orientation="horizontal"');
    expect(markup("top", 300)).toContain('aria-orientation="vertical"');
    expect(markup("bottom", 300)).toContain('aria-orientation="vertical"');
  });
});

describe("collapse handle direction", () => {
  it("flips the rail handle when the rail changes sides", () => {
    // A rail on the left closes toward the left edge and opens back out of it.
    // The same icon in both states is what made the handle read as inverted.
    expect(handleIcons("left", 300)).toContain("panel-left-close");
    expect(handleIcons("left", 0)).toContain("panel-left-open");
  });

  it("flips the rail handle for a rail on the right too", () => {
    expect(handleIcons("right", 300)).toContain("panel-left-open");
    expect(handleIcons("right", 0)).toContain("panel-left-close");
  });

  it("points the console handle at the edge it collapsed toward", () => {
    // A console that sank is offered back with a down chevron; one pulled up is
    // closed with an up chevron.
    expect(handleIcons("top", 0)).toContain("chevron-down");
    expect(handleIcons("top", 300)).toContain("chevron-up");
    expect(handleIcons("bottom", 0)).toContain("chevron-down");
    expect(handleIcons("bottom", 300)).toContain("chevron-up");
  });
});

describe("collapsed panel reporting", () => {
  it("reports a collapsed panel as its minimum rather than as zero", () => {
    // aria-valuenow below aria-valuemin is an invalid state that assistive tech
    // flags, so the collapsed case must not leak the raw size.
    expect(markup("top", 0)).toContain('aria-valuenow="120"');
    expect(markup("top", 300)).toContain('aria-valuenow="300"');
  });

  it("keeps the collapse button out of the tab order, behind the separator", () => {
    // The separator itself is the keyboard control; a second focus stop on the
    // handle would read as a duplicate control.
    expect(markup("left", 300)).toContain('tabindex="-1"');
  });

  it("names the separator for assistive tech", () => {
    expect(markup("left", 300)).toContain('aria-label="test panel"');
  });
});
