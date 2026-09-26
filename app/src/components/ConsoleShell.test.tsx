import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConsoleShell } from "./ConsoleShell";

// The console header is the only place a panel's count appears, so the title
// and the right-hand slot both have to survive the shell. The boards set the
// title in caps, which is a class rather than transformed text.
describe("ConsoleShell", () => {
  it("sets the title in caps and renders the meta slot", () => {
    const markup = renderToStaticMarkup(
      <ConsoleShell title="Presets" meta="3 saved">
        <p>body</p>
      </ConsoleShell>,
    );
    expect(markup).toContain(">Presets</h2>");
    expect(markup).toContain("uppercase");
    expect(markup).toContain("3 saved");
    expect(markup).toContain("<p>body</p>");
  });

  it("omits the meta element entirely when no panel published one", () => {
    const markup = renderToStaticMarkup(
      <ConsoleShell title="Export">
        <p>body</p>
      </ConsoleShell>,
    );
    expect(markup).toContain(">Export</h2>");
    expect(markup).not.toContain("<span");
  });

  it("draws the hairline rule that separates header from body", () => {
    const markup = renderToStaticMarkup(
      <ConsoleShell title="Batch">
        <p>body</p>
      </ConsoleShell>,
    );
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("bg-border");
  });
});
