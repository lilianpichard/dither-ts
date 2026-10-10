import { Suspense, lazy, useState } from "react";
import { useTranslate } from "../i18n";
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

/**
 * The five dock tools, in board order. Alt+1..5 jumps between them. Only the
 * ids live here; the labels and titles come from the catalogue, so the dock is
 * not the one part of the interface that stays English.
 */
const TOOLS = [
  { id: "presets", label: "tool.presets", title: "tool.presets" },
  { id: "effects", label: "tool.effects", title: "tool.effects" },
  { id: "batch", label: "tool.batch", title: "tool.batch" },
  { id: "timeline", label: "tool.video", title: "tool.videoTitle" },
  { id: "export", label: "tool.export", title: "tool.export" },
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
  width,
  grip,
}: {
  tool: ToolId;
  onTool: (t: ToolId) => void;
  /** Owned by the shell so the console can be dragged and collapsed. */
  height: number | "100%";
  /** Only set when the console hangs off the side rather than the bottom. */
  width?: number;
  /** Drag handle the shell hands in, so the panel can be docked elsewhere. */
  grip?: React.ReactNode;
}) {
  // Each panel publishes its own count into the console header.
  const [meta, setMeta] = useState("");
  const t = useTranslate();
  const active = TOOLS.find((item) => item.id === tool) ?? TOOLS[0];
  return (
    <Tabs
      value={tool}
      onValueChange={(v) => onTool(v as ToolId)}
      style={width === undefined ? { height, width: "100%" } : { height, width }}
      // flex-initial (flex: 0 1 auto) is load-bearing twice over: the Tabs
      // primitive ships flex-1, and a flex item's flex-basis beats `height`, so
      // without it the shell's height is ignored. Shrink is left on so a short
      // or narrow window compresses the console instead of pushing the dock off
      // screen; min-h-14 keeps the dock itself whole.
      className="flex min-h-14 flex-initial flex-col"
    >
      <ConsoleShell title={t(active.title)} meta={meta || undefined} actions={grip}>
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
          <TabsContent
            value="timeline"
            // Same reasoning as batch: a loaded clip and any export in flight
            // outlive a tab switch, and unmounting revoked the object URL, so
            // leaving the tab threw the clip away. Hidden rather than removed.
            forceMount
            className="h-full data-[state=inactive]:hidden"
          >
            {/* The encoder chunk loads on first open; a blank panel would read
                as an empty tool rather than a pending one. */}
            <Suspense fallback={<Skeleton className="h-24 w-full" />}>
              <Timeline active={tool === "timeline"} />
            </Suspense>
          </TabsContent>
          <TabsContent value="export" className="h-full">
            <ExportPanel />
          </TabsContent>
        </ConsoleMetaContext.Provider>
      </ConsoleShell>
      <div className="flex h-14 shrink-0 items-center justify-center border-t border-border bg-background px-3">
        <TabsList className="flex-wrap justify-center">
          {TOOLS.map((item) => (
            <TabsTrigger key={item.id} value={item.id}>
              {t(item.label)}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
    </Tabs>
  );
}
