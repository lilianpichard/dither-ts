import { Suspense, lazy } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import PresetsPanel from "../presets/PresetsPanel";
import BatchPanel from "../batch/BatchPanel";
import EffectsPanel from "../effects/EffectsPanel";
import ExportPanel from "../export/ExportPanel";
import OperationsPanel from "./OperationsPanel";

// Split: video encoders (mp4-muxer, gifenc) load only on first open.
const Timeline = lazy(() => import("../video/Timeline"));

const TOOLS = [
  { id: "presets", label: "Presets" },
  { id: "adjust", label: "Adjust" },
  { id: "effects", label: "Effects" },
  { id: "batch", label: "Batch" },
  { id: "timeline", label: "Video" },
  { id: "export", label: "Export" },
] as const;

export type ToolId = (typeof TOOLS)[number]["id"];

export const TOOL_IDS: ToolId[] = TOOLS.map((t) => t.id);

/** Right rail: every tool next to the canvas, switched as tabs. */
export default function ToolsPanel({
  tool,
  onTool,
}: {
  tool: ToolId;
  onTool: (t: ToolId) => void;
}) {
  return (
    <div className="flex w-full flex-col overflow-hidden lg:h-full lg:w-96">
      <Tabs
        value={tool}
        onValueChange={(v) => onTool(v as ToolId)}
        className="flex flex-col lg:min-h-0 lg:flex-1"
      >
        <TabsList className="w-full overflow-x-auto">
          {TOOLS.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="presets" className="overflow-hidden lg:min-h-0 lg:flex-1">
          <PresetsPanel />
        </TabsContent>
        <TabsContent value="adjust" className="overflow-hidden lg:min-h-0 lg:flex-1">
          <OperationsPanel />
        </TabsContent>
        <TabsContent value="effects" className="overflow-hidden lg:min-h-0 lg:flex-1">
          <EffectsPanel />
        </TabsContent>
        <TabsContent
          value="batch"
          // A batch run outlives a tab switch, so this panel stays mounted and
          // is only hidden; unmounting it would abort the run in flight.
          forceMount
          className="overflow-hidden data-[state=inactive]:hidden lg:min-h-0 lg:flex-1"
        >
          <BatchPanel />
        </TabsContent>
        <TabsContent value="timeline" className="overflow-hidden lg:min-h-0 lg:flex-1">
          <Suspense fallback={<Skeleton className="h-48 w-full" />}>
            <Timeline />
          </Suspense>
        </TabsContent>
        <TabsContent value="export" className="overflow-hidden lg:min-h-0 lg:flex-1">
          <ExportPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
