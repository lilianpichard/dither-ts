import { METHOD_NAMES, PALETTES } from "../../../src/index.js";
import { useApp } from "../store";
import { ImageDropzone } from "./ImageDropzone";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

/** Left rail: source file plus every dither control. Always visible. */
export default function ControlPanel({ onFile }: { onFile: (f: File | undefined) => void }) {
  const params = useApp((s) => s.params);
  const source = useApp((s) => s.source);
  const result = useApp((s) => s.result);
  const rendering = useApp((s) => s.rendering);
  const setParams = useApp((s) => s.setParams);

  return (
    <Card className="flex h-full w-72 shrink-0 flex-col overflow-hidden">
      <CardHeader>
        <CardTitle>Controls</CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <ImageDropzone
          onFile={(f) => void onFile(f)}
          fileName={source?.name}
          busy={rendering}
          busyLabel="Rendering…"
        />
        <div className="flex flex-col gap-2">
          <Label>Method</Label>
          <Select value={params.method} onValueChange={(v) => setParams({ method: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METHOD_NAMES.map((n) => (
                <SelectItem key={n} value={n}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="ctl-color"
            checked={params.color}
            onCheckedChange={(v) => setParams({ color: v })}
          />
          <Label htmlFor="ctl-color">Color</Label>
        </div>
        {params.color && (
          <div className="flex flex-col gap-2">
            <Label>Palette</Label>
            <Select
              value={typeof params.palette === "string" ? params.palette : "custom"}
              onValueChange={(v) => {
                if (v !== "custom") setParams({ palette: v });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(PALETTES).map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
                {typeof params.palette !== "string" && (
                  <SelectItem value="custom" disabled>
                    Custom
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        )}
        {!params.color && (
          <div className="flex flex-col gap-2">
            <Label>Threshold {params.threshold}</Label>
            <Slider
              min={1}
              max={254}
              value={[params.threshold]}
              onValueChange={([v]) => setParams({ threshold: v })}
            />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Label>Pixel size {params.pixelSize}</Label>
          <Slider
            min={1}
            max={8}
            step={1}
            value={[params.pixelSize]}
            onValueChange={([v]) => setParams({ pixelSize: v })}
          />
        </div>
        <Badge variant={rendering ? "secondary" : "default"} className="w-fit">
          {!source
            ? "No image"
            : rendering
              ? "Rendering…"
              : result
                ? `Done in ${result.ms.toFixed(1)} ms`
                : "Ready"}
        </Badge>
      </CardContent>
    </Card>
  );
}
