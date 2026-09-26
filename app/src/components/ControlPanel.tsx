import { useEffect, useRef } from "react";
import { cn } from "cn";
import { METHOD_NAMES, PALETTES, type DitherMethod } from "../../../src/index.js";
import { useApp } from "../store";
import { describeRenderStatus } from "../status";
import PaletteEditor from "../palette/PaletteEditor";
import { ImageDropzone } from "./ImageDropzone";
import OperationsPanel from "./OperationsPanel";
import { Badge } from "@/components/ui/badge";
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

/** Micro-label above a control; "SOURCE" is the one amber label in the rail. */
function Field({
  label,
  accent,
  children,
}: {
  label: string;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className={cn("uppercase", accent && "text-accent-label")}>{label}</Label>
      {children}
    </div>
  );
}

/** Miniature of the loaded pixels, as board C06 shows in the source chip. */
function SourceThumb({ source }: { source: NonNullable<ReturnType<typeof useSource>> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const w = 44;
    const h = 30;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const full = document.createElement("canvas");
    full.width = source.width;
    full.height = source.height;
    full
      .getContext("2d")!
      .putImageData(
        new ImageData(new Uint8ClampedArray(source.pixels), source.width, source.height),
        0,
        0,
      );
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);
    const scale = Math.min(w / source.width, h / source.height);
    const dw = source.width * scale;
    const dh = source.height * scale;
    ctx.drawImage(full, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }, [source]);
  return (
    <canvas
      ref={ref}
      aria-hidden
      className="h-7.5 w-11 shrink-0 rounded-sm border border-border object-cover"
    />
  );
}

function useSource() {
  return useApp((s) => s.source);
}

/**
 * Source control. Stays a live dropzone once a file is loaded — it shows the
 * miniature, the file name and the dimensions, and still opens the picker or
 * accepts a drop, so another image can always be loaded without a reload.
 */
function SourceChip({ onFile }: { onFile: (f: File | undefined) => void }) {
  const source = useSource();
  return (
    <ImageDropzone
      onFile={(f) => onFile(f)}
      className="w-full"
      fileName={source?.name}
      leading={source ? <SourceThumb source={source} /> : undefined}
    />
  );
}

/**
 * Left rail, 172px: the source chip, every dither control, the render status
 * pill, and the pre-dither adjustments. Board C01 fixes the order.
 */
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
  const methodIndex = METHOD_NAMES.indexOf(params.method) + 1;

  return (
    <aside className="flex w-full flex-col gap-3 overflow-x-hidden border-r border-border bg-background scrollbar-slim p-3 lg:h-full lg:w-56 lg:min-h-0 lg:shrink-0 lg:overflow-y-auto xl:w-64">
      <Field label="Source" accent>
        <SourceChip onFile={onFile} />
      </Field>
      <Field label="Method">
        <Select
          value={params.method}
          onValueChange={(value) => setParams({ method: value as DitherMethod })}
        >
          <SelectTrigger id="ctl-method" aria-label="Method">
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
      </Field>
      <Field label="Color">
        <div className="flex items-center gap-2">
          <Switch
            id="ctl-color"
            checked={params.color}
            onCheckedChange={(v) => setParams({ color: v })}
          />
          <Label htmlFor="ctl-color" className="text-caption text-foreground">
            {params.color ? "On" : "Off"}
          </Label>
        </div>
      </Field>
      {params.color && (
        <Field label="Palette">
          <Select
            value={typeof params.palette === "string" ? params.palette : "custom"}
            onValueChange={(v) => {
              if (v !== "custom") setParams({ palette: v });
            }}
          >
            <SelectTrigger id="ctl-palette" aria-label="Palette">
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
        </Field>
      )}
      {!params.color && (
        <Field label={`Threshold ${params.threshold}`}>
          <Slider
            aria-label="Threshold"
            min={1}
            max={254}
            value={[params.threshold]}
            onValueChange={([v]) => setParams({ threshold: v })}
          />
        </Field>
      )}
      <Field label={`Pixel size ${params.pixelSize}`}>
        <Slider
          aria-label="Pixel size"
          min={1}
          max={8}
          step={1}
          value={[params.pixelSize]}
          onValueChange={([v]) => setParams({ pixelSize: v })}
        />
      </Field>
      {/* The live region in App announces this text; hide the duplicate. */}
      <Badge aria-hidden variant={rendering ? "secondary" : "default"} className="w-fit">
        {status}
      </Badge>
      <p className="text-label text-muted-foreground">Method {methodIndex}/24</p>
      <p className="text-label text-muted-foreground">Color {params.color ? "on" : "off"}</p>
      <div className="mt-1 border-t border-border pt-3">
        <Label className="mb-2">Adjust</Label>
        <OperationsPanel />
      </div>
    </aside>
  );
}
