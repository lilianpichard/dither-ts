import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ToolsPanel from "./ToolsPanel";

// A batch run must survive a tab switch. Radix unmounts an inactive
// TabsContent, which aborts the run, so the batch panel is force-mounted and
// only hidden. These tests read the rendered markup: without forceMount the
// batch input is simply not there while another tab is showing.
function render(tool: "presets" | "batch"): string {
  return renderToStaticMarkup(<ToolsPanel tool={tool} onTool={() => {}} />);
}

const BATCH_INPUT = 'aria-label="Batch images"';

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

  it("leaves the other panels free to unmount", () => {
    // Only batch is force-mounted, so the preset panel still goes away.
    expect(render("batch")).not.toContain("Preset name");
  });
});
