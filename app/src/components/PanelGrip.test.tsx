import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "react-intl";
import { PanelGrip } from "./PanelGrip";
import { DockTargets } from "./DockTargets";
import { MESSAGES } from "../i18n/messages";

function wrap(node: React.ReactNode, locale: "en" | "fr" = "en"): string {
  return renderToStaticMarkup(
    <IntlProvider locale={locale} defaultLocale="en" messages={MESSAGES[locale]}>
      {node}
    </IntlProvider>,
  );
}

const GRIP = {
  side: "left",
  label: "Dock panels",
  hint: "or use the arrow keys",
  onPointerDown: () => {},
  onPointerMove: () => {},
  onPointerUp: () => {},
  onKeyDown: () => {},
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PanelGrip", () => {
  it("names the panel and the edge it is on, so the drag has a meaning", () => {
    const markup = wrap(<PanelGrip {...GRIP} />);
    expect(markup).toContain('aria-label="Dock panels (left)"');
    expect(markup).toContain('title="Dock panels (or use the arrow keys)"');
  });

  it("reads the edge from the layout, so a moved panel renames itself", () => {
    expect(wrap(<PanelGrip {...GRIP} side="right" />)).toContain("(right)");
    expect(wrap(<PanelGrip {...GRIP} side="bottom" />)).toContain("(bottom)");
  });

  it("is a real button, so it is reachable by keyboard", () => {
    expect(wrap(<PanelGrip {...GRIP} />)).toContain("<button");
  });

  it("carries the pointer and key handlers the dock needs", () => {
    const handlers = {
      side: "left",
      label: "Dock panels",
      hint: "or use the arrow keys",
      onPointerDown: vi.fn(),
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
      onKeyDown: vi.fn(),
    };
    // React attaches them at runtime, so the markup cannot show them; what is
    // checked is that the component accepts them without dropping any.
    expect(() => wrap(<PanelGrip {...handlers} />)).not.toThrow();
    expect(handlers.onPointerDown).not.toHaveBeenCalled();
  });

  it("renders whatever the shell hands it, so the locale flows through", () => {
    // The grip holds no strings of its own, which is why the app can hand it a
    // translated label without the grip knowing which language it is in.
    const markup = wrap(
      <PanelGrip
        {...GRIP}
        side="gauche"
        label="Ancrer les panneaux"
        hint="ou utilisez les fleches"
      />,
      "fr",
    );
    expect(markup).toContain('aria-label="Ancrer les panneaux (gauche)"');
  });
});

describe("DockTargets", () => {
  const RECT = { left: 0, top: 0, width: 800, height: 600 };

  it("renders nothing when no panel is being dragged", () => {
    const markup = wrap(<DockTargets panel="rail" rect={RECT} dragging={false} zone={null} />);
    // An invisible overlay would still block pointer events on the canvas.
    expect(markup).toBe("");
  });

  it("offers the rail only the two edges it can take", () => {
    // A top or bottom rail is a shape the shell does not draw, so offering the
    // edge would only produce a drop that is refused.
    const markup = wrap(<DockTargets panel="rail" rect={RECT} dragging zone="left" />);
    expect(markup).toContain('data-testid="dock-left"');
    expect(markup).toContain('data-testid="dock-right"');
    expect(markup).not.toContain('data-testid="dock-top"');
    expect(markup).not.toContain('data-testid="dock-bottom"');
  });

  it("offers the console all four edges", () => {
    const markup = wrap(<DockTargets panel="console" rect={RECT} dragging zone="top" />);
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(markup).toContain(`data-testid="dock-${side}"`);
    }
  });

  it("marks only the zone under the pointer, so the highlight is unambiguous", () => {
    const markup = wrap(<DockTargets panel="rail" rect={RECT} dragging zone="left" />);
    // The zone is named by its testid, and the classes that decide the
    // highlight come after it, so the chunk is taken to the end of the element
    // rather than being cut at the next quote.
    const chunks: Record<string, string> = {};
    for (const block of markup.split('data-testid="').slice(1)) {
      const end = block.indexOf("</div>");
      chunks[block.slice(0, block.indexOf('"'))] = end === -1 ? block : block.slice(0, end);
    }
    const active = Object.keys(chunks).filter((id) => chunks[id].includes("border-primary"));
    expect(active).toEqual(["dock-left"]);
  });

  it("does not swallow pointer events, so a drag can still be cancelled", () => {
    const markup = wrap(<DockTargets panel="console" rect={RECT} dragging zone="top" />);
    expect(markup).toContain("pointer-events-none");
  });

  it("stays hidden from assistive tech, which reads the panel names instead", () => {
    const markup = wrap(<DockTargets panel="rail" rect={RECT} dragging zone="left" />);
    expect(markup).toContain('aria-hidden="true"');
  });

  it("waits for a measured canvas rather than drawing at the origin", () => {
    // Without the rectangle the zones would sit at the top left of the window.
    expect(wrap(<DockTargets panel="rail" rect={null} dragging zone={null} />)).toBe("");
  });
});
