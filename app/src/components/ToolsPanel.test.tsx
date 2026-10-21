import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "react-intl";
import ToolsPanel from "./ToolsPanel";
import { MESSAGES } from "../i18n/messages";

// A batch run must survive a tab switch. Radix unmounts an inactive
// TabsContent, which aborts the run, so the batch panel is force-mounted and
// only hidden. These tests read the rendered markup: without forceMount the
// batch input is simply not there while another tab is showing.
//
// The provider is required because the panels pull their labels from it, so a
// panel that renders is one that has a language.
function render(tool: "presets" | "batch"): string {
  return renderToStaticMarkup(
    <IntlProvider locale="en" defaultLocale="en" messages={MESSAGES.en}>
      <ToolsPanel tool={tool} onTool={() => {}} height={300} />
    </IntlProvider>,
  );
}

// The batch input is identified by its translated accessible name, which is
// what the barrel of labelled controls now points at.
const BATCH_INPUT = `aria-label="${MESSAGES.en["batch.pick"]}"`;
const PRESET_NAME = MESSAGES.en["presets.name"];
const EXPORT_EMPTY = MESSAGES.en["export.empty"];

describe("ToolsPanel tab mounting", () => {
  it("keeps the batch panel mounted while another tab is showing", () => {
    expect(render("presets")).toContain(BATCH_INPUT);
  });

  it("still renders it when its own tab is showing", () => {
    expect(render("batch")).toContain(BATCH_INPUT);
  });

  it("hides the inactive batch panel rather than unmounting it", () => {
    const at = render("presets").indexOf(BATCH_INPUT);
    expect(at).toBeGreaterThan(0);
    // The content wrapper before the input carries the state and the hiding rule.
    const before = render("presets").slice(0, at);
    expect(before).toContain('data-state="inactive"');
    expect(before).toContain("data-[state=inactive]:hidden");
  });

  it("keeps an export in flight mounted while another tab is showing", () => {
    // ExportPanel aborts its render on unmount, so a tab switch used to throw
    // the work away without a message.
    expect(render("presets")).toContain(EXPORT_EMPTY);
  });

  it("leaves the panels with no background work free to unmount", () => {
    // Presets are stateless, so the panel goes away with its tab.
    expect(render("batch")).not.toContain(PRESET_NAME);
  });
});
