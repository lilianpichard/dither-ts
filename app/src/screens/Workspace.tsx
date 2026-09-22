import { useEffect, useRef } from "react";
import { METHOD_NAMES, PALETTES } from "../../../src/index.js";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { renderImage } from "../worker/client";
import { stripKeys } from "../presets/store";
import { useApp } from "../store";

let jobSeq = 0;

export default function Workspace() {
  const source = useApp((s) => s.source);
  const params = useApp((s) => s.params);
  const effects = useApp((s) => s.effects);
  const result = useApp((s) => s.result);
  const rendering = useApp((s) => s.rendering);
  const setSource = useApp((s) => s.setSource);
  const setParams = useApp((s) => s.setParams);
  const setResult = useApp((s) => s.setResult);
  const setRendering = useApp((s) => s.setRendering);
  const origRef = useRef<HTMLCanvasElement>(null);
  const outRef = useRef<HTMLCanvasElement>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    const bmp = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bmp, 0, 0);
    const data = ctx.getImageData(0, 0, bmp.width, bmp.height);
    const copy = new Uint8ClampedArray(data.data);
    setSource({ width: bmp.width, height: bmp.height, pixels: copy.buffer as ArrayBuffer });
  }

  useEffect(() => {
    if (!source || !origRef.current) return;
    const c = origRef.current;
    c.width = source.width;
    c.height = source.height;
    const ctx = c.getContext("2d")!;
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(source.pixels), source.width, source.height),
      0,
      0,
    );
  }, [source]);

  useEffect(() => {
    if (!source) return;
    setRendering(true);
    const timer = setTimeout(async () => {
      const jobId = ++jobSeq;
      const copy = source.pixels.slice(0);
      const res = await renderImage(
        {
          width: source.width,
          height: source.height,
          pixels: copy,
          color: params.color,
          method: params.method,
          threshold: params.threshold,
          palette: params.palette,
          pixelSize: params.pixelSize,
          effects: stripKeys(effects),
          seed: 0,
        },
        [copy],
      );
      if (jobId !== jobSeq) return; // stale: a newer job superseded this one
      setResult({ width: res.width, height: res.height, pixels: res.pixels, ms: res.ms, jobId });
    }, 250);
    return () => clearTimeout(timer);
  }, [source, params, effects, setRendering, setResult]);

  useEffect(() => {
    if (!result || !outRef.current) return;
    const c = outRef.current;
    c.width = result.width;
    c.height = result.height;
    const ctx = c.getContext("2d")!;
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(result.pixels), result.width, result.height),
      0,
      0,
    );
  }, [result]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            type="file"
            accept="image/*"
            className="w-56"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <Select value={params.method} onValueChange={(v) => setParams({ method: v })}>
            <SelectTrigger className="w-52">
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
          <div className="flex items-center gap-2">
            <Switch
              id="color"
              checked={params.color}
              onCheckedChange={(v) => setParams({ color: v })}
            />
            <Label htmlFor="color">Color</Label>
          </div>
          {params.color && (
            <Select
              value={typeof params.palette === "string" ? params.palette : "custom"}
              onValueChange={(v) => {
                if (v !== "custom") setParams({ palette: v });
              }}
            >
              <SelectTrigger className="w-44">
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
          )}
          {!params.color && (
            <div className="flex items-center gap-2">
              <Label>Threshold {params.threshold}</Label>
              <Slider
                className="w-36"
                min={1}
                max={254}
                value={[params.threshold]}
                onValueChange={([v]) => setParams({ threshold: v })}
              />
            </div>
          )}
          <div className="flex items-center gap-2">
            <Label>Pixel size {params.pixelSize}</Label>
            <Slider
              className="w-28"
              min={1}
              max={8}
              step={1}
              value={[params.pixelSize]}
              onValueChange={([v]) => setParams({ pixelSize: v })}
            />
          </div>
        </div>
        {!source ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No image loaded</EmptyTitle>
              <EmptyDescription>Choose an image file to start dithering.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Input
                type="file"
                accept="image/*"
                className="w-56"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
            </EmptyContent>
          </Empty>
        ) : (
          <>
            <div className="flex flex-wrap gap-3">
              <canvas ref={origRef} className="max-w-1/2 rounded border" />
              {rendering && !result ? (
                <Skeleton className="aspect-square w-1/2" />
              ) : (
                <canvas ref={outRef} className="max-w-1/2 rounded border" />
              )}
            </div>
            <Badge variant={rendering ? "secondary" : "default"} className="w-fit">
              {rendering ? "Rendering…" : result ? `Done in ${result.ms.toFixed(1)} ms` : "Ready"}
            </Badge>
          </>
        )}
      </CardContent>
    </Card>
  );
}
