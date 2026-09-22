import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import Workspace from "./screens/Workspace";
import PresetsPanel from "./presets/PresetsPanel";
import BatchPanel from "./batch/BatchPanel";
import EffectsPanel from "./effects/EffectsPanel";
import Timeline from "./video/Timeline";
import ExportPanel from "./export/ExportPanel";

const SCREENS = [
  { id: "workspace", label: "Workspace" },
  { id: "presets", label: "Presets" },
  { id: "effects", label: "Effects" },
  { id: "batch", label: "Batch" },
  { id: "timeline", label: "Timeline" },
  { id: "export", label: "Export" },
] as const;

type ScreenId = (typeof SCREENS)[number]["id"];

export default function App() {
  const [screen, setScreen] = useState<ScreenId>("workspace");

  return (
    <main className="mx-auto max-w-6xl p-4">
      <h1 className="mb-4 text-2xl font-bold">dither-ts</h1>
      <Tabs value={screen} onValueChange={(v) => setScreen(v as ScreenId)}>
        <TabsList>
          {SCREENS.map((s) => (
            <TabsTrigger key={s.id} value={s.id}>
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="workspace">
          <Workspace />
        </TabsContent>
        <TabsContent value="presets">
          <PresetsPanel />
        </TabsContent>
        <TabsContent value="effects">
          <EffectsPanel />
        </TabsContent>
        <TabsContent value="batch">
          <BatchPanel />
        </TabsContent>
        <TabsContent value="timeline">
          <Timeline />
        </TabsContent>
        <TabsContent value="export">
          <ExportPanel />
        </TabsContent>
      </Tabs>
      <Toaster />
    </main>
  );
}
