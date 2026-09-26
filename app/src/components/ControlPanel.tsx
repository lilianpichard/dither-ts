import { METHOD_NAMES, PALETTES, type DitherMethod } from "../../../src/index.js";
import { useApp } from "../store";
import { describeRenderStatus } from "../status";
import PaletteEditor from "../palette/PaletteEditor";
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
  const previewScaled = useApp((s) => s.previewScaled);
  const setParams = useApp((s) => s.setParams);
  const status = describeRenderStatus({
    hasSource: source !== null,
    rendering,
    ms: result?.ms ?? null,
    previewScaled,
  });

  return (
    <Card className="flex w-full flex-col overflow-hidden lg:h-full lg:w-72">
      <CardHeader>
        <CardTitle>Controls</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        <ImageDropzone onFile={(f) => void onFile(f)} fileName={source?.name} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="ctl-method">Method</Label>
          <Select
            value={params.method}
            onValueChange={(value) => setParams({ method: value as DitherMethod })}
          >
            <SelectTrigger id="ctl-method">
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
            <Label htmlFor="ctl-palette">Palette</Label>
            <Select
              value={typeof params.palette === "string" ? params.palette : "custom"}
              onValueChange={(v) => {
                if (v !== "custom") setParams({ palette: v });
              }}
            >
              <SelectTrigger id="ctl-palette">
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
            <PaletteEditor />
          </div>
        )}
        {!params.color && (
          <div className="flex flex-col gap-2">
            <Label id="ctl-threshold-label">Threshold {params.threshold}</Label>
            <Slider
              aria-labelledby="ctl-threshold-label"
              min={1}
              max={254}
              value={[params.threshold]}
              onValueChange={([v]) => setParams({ threshold: v })}
            />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Label id="ctl-pixel-size-label">Pixel size {params.pixelSize}</Label>
          <Slider
            aria-labelledby="ctl-pixel-size-label"
            min={1}
            max={8}
            step={1}
            value={[params.pixelSize]}
            onValueChange={([v]) => setParams({ pixelSize: v })}
          />
        </div>
        {/* The live region in App announces this text; hide the duplicate. */}
        <Badge aria-hidden variant={rendering ? "secondary" : "default"} className="w-fit">
          {status}
        </Badge>
      </CardContent>
    </Card>
  );
}
