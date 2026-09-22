import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PresetsPanel from "../presets/PresetsPanel";
import BatchPanel from "../batch/BatchPanel";
import EffectsPanel from "../effects/EffectsPanel";
import Timeline from "../video/Timeline";
import ExportPanel from "../export/ExportPanel";

const TOOLS = [
  { id: "presets", label: "Presets" },
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
    <div className="flex h-full w-96 shrink-0 flex-col overflow-hidden">
      <Tabs
        value={tool}
        onValueChange={(v) => onTool(v as ToolId)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="w-full">
          {TOOLS.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="presets" className="min-h-0 flex-1 overflow-hidden">
          <PresetsPanel />
        </TabsContent>
        <TabsContent value="effects" className="min-h-0 flex-1 overflow-hidden">
          <EffectsPanel />
        </TabsContent>
        <TabsContent value="batch" className="min-h-0 flex-1 overflow-hidden">
          <BatchPanel />
        </TabsContent>
        <TabsContent value="timeline" className="min-h-0 flex-1 overflow-hidden">
          <Timeline />
        </TabsContent>
        <TabsContent value="export" className="min-h-0 flex-1 overflow-hidden">
          <ExportPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
