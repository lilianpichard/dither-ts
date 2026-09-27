import { Suspense, lazy, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConsoleShell } from "./ConsoleShell";
import { ConsoleMetaContext } from "./consoleMeta";
import PresetsPanel from "../presets/PresetsPanel";
import BatchPanel from "../batch/BatchPanel";
import EffectsPanel from "../effects/EffectsPanel";
import ExportPanel from "../export/ExportPanel";

// Split: video encoders (mp4-muxer, gifenc) load only on first open.
const Timeline = lazy(() => import("../video/Timeline"));

/** The five dock tools, in board order. Alt+1..5 jumps between them. */
const TOOLS = [
  { id: "presets", label: "Presets", title: "Presets" },
  { id: "effects", label: "Effects", title: "Effects" },
  { id: "batch", label: "Batch", title: "Batch" },
  { id: "timeline", label: "Video", title: "Video Timeline" },
  { id: "export", label: "Export", title: "Export" },
] as const;

export type ToolId = (typeof TOOLS)[number]["id"];

export const TOOL_IDS: ToolId[] = TOOLS.map((t) => t.id);
export const TOOL_COUNT = TOOLS.length;

/**
 * Console plus the dock beneath it
 */
export default function ToolsPanel({
  tool,
  onTool,
  height,
}: {
  tool: ToolId;
  onTool: (t: ToolId) => void;
  /** Owned by the shell so the console can be dragged and collapsed. */
  height: number;
}) {
  // Each panel publishes its own count into the console header.
  const [meta, setMeta] = useState("");
  const active = TOOLS.find((t) => t.id === tool) ?? TOOLS[0];
  return (
    <Tabs
      value={tool}
      onValueChange={(v) => onTool(v as ToolId)}
      style={{ height }}
      // flex-initial (flex: 0 1 auto) is load-bearing twice over: the Tabs
      // primitive ships flex-1, and a flex item's flex-basis beats `height`, so
      // without it the shell's height is ignored. Shrink is left on so a short
      // or narrow window compresses the console instead of pushing the dock off
      // screen; min-h-14 keeps the dock itself whole.
      className="flex min-h-14 flex-initial flex-col"
    >
      <ConsoleShell title={active.title} meta={meta || undefined}>
        <ConsoleMetaContext.Provider value={{ tool, publish: (_owner, value) => setMeta(value) }}>
          <TabsContent value="presets" className="h-full">
            <PresetsPanel />
          </TabsContent>
          <TabsContent value="effects" className="h-full">
            <EffectsPanel />
          </TabsContent>
          <TabsContent
            value="batch"
            // A batch run outlives a tab switch, so this panel stays mounted and
            // is only hidden; unmounting it would abort the run in flight.
            forceMount
            className="h-full data-[state=inactive]:hidden"
          >
            <BatchPanel />
          </TabsContent>
          <TabsContent value="timeline" className="h-full">
            {/* The encoder chunk loads on first open; a blank panel would read
                as an empty tool rather than a pending one. */}
            <Suspense fallback={<Skeleton className="h-24 w-full" />}>
              <Timeline />
            </Suspense>
          </TabsContent>
          <TabsContent value="export" className="h-full">
            <ExportPanel />
          </TabsContent>
        </ConsoleMetaContext.Provider>
      </ConsoleShell>
      <div className="flex h-14 shrink-0 items-center justify-center border-t border-border bg-background px-3">
        <TabsList className="flex-wrap justify-center">
          {TOOLS.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
    </Tabs>
  );
}
