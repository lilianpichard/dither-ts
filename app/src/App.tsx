import { useState } from "react";
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
    <main>
      <h1>dither-ts</h1>
      <nav className="row">
        {SCREENS.map((s) => (
          <button key={s.id} disabled={s.id === screen} onClick={() => setScreen(s.id)}>
            {s.label}
          </button>
        ))}
      </nav>
      {screen === "workspace" && <Workspace />}
      {screen === "presets" && <PresetsPanel />}
      {screen === "effects" && <EffectsPanel />}
      {screen === "batch" && <BatchPanel />}
      {screen === "timeline" && <Timeline />}
      {screen === "export" && <ExportPanel />}
    </main>
  );
}
