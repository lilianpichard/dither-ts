import { useState } from "react";
import { useApp } from "../store";
import {
  ADJUSTMENTS,
  adjustmentValue,
  cropDraft,
  cropDraftKey,
  fitOperations,
  frameRect,
  isIdentity,
  nextQuarterTurn,
  type AdjustmentKey,
} from "../image/settings";
import type { CropRect, ImageOperations } from "../image/ops";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Crop, FlipHorizontal, FlipVertical, RotateCw } from "lucide-react";

type CropField = keyof CropRect;

const CROP_FIELDS: {
  key: CropField;
  label: string;
  min: number;
  max: (full: CropRect) => number;
}[] = [
  { key: "x", label: "X", min: 0, max: (full) => full.width - 1 },
  { key: "y", label: "Y", min: 0, max: (full) => full.height - 1 },
  { key: "width", label: "W", min: 1, max: (full) => full.width },
  { key: "height", label: "H", min: 1, max: (full) => full.height },
];

function sameRect(a: CropRect | undefined, b: CropRect): boolean {
  return (
    a !== undefined && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  );
}

function show(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Adjust tab: pre-dither geometry and colour operations, plus a crop editor. */
export default function OperationsPanel() {
  const operations = useApp((s) => s.operations);
  const source = useApp((s) => s.source);
  const setOperations = useApp((s) => s.setOperations);
  const resetOperations = useApp((s) => s.resetOperations);
  const width = source?.width ?? 0;
  const height = source?.height ?? 0;
  const full = frameRect(width, height);
  const draftKey = cropDraftKey(width, height, operations.crop);
  // The draft follows the frame and the applied crop, never the other way round.
  const [draftState, setDraftState] = useState<{ key: string; rect: CropRect }>({
    key: draftKey,
    rect: cropDraft(operations.crop, width, height),
  });
  if (draftState.key !== draftKey) {
    setDraftState({ key: draftKey, rect: cropDraft(operations.crop, width, height) });
  }
  const draft = draftState.rect;
  const applied = sameRect(operations.crop, draft);
  // Applying a crop that covers the whole frame would only add payload.
  const noop = applied || (operations.crop === undefined && sameRect(draft, full));

  function editField(field: CropField, raw: string) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) return;
    const next = fitOperations(
      { crop: { ...draftState.rect, [field]: parsed } },
      width,
      height,
    ).crop;
    if (next) setDraftState({ key: draftKey, rect: next });
  }

  function setAdjustment(key: AdjustmentKey, value: number) {
    const patch: Partial<ImageOperations> = {};
    patch[key] = value;
    setOperations(patch);
  }

  return (
    <Card className="overflow-y-auto lg:h-full">
      <CardHeader>
        <CardTitle>Adjust</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            title="Rotate 90 degrees clockwise"
            onClick={() => setOperations({ rotate: nextQuarterTurn(operations.rotate) })}
          >
            <RotateCw /> Rotate
          </Button>
          <Badge variant="secondary">{operations.rotate ?? 0}°</Badge>
          <Button
            size="icon"
            variant={operations.flipHorizontal ? "default" : "outline"}
            aria-label="Flip horizontal"
            aria-pressed={operations.flipHorizontal === true}
            title="Flip horizontal"
            onClick={() => setOperations({ flipHorizontal: !operations.flipHorizontal })}
          >
            <FlipHorizontal />
          </Button>
          <Button
            size="icon"
            variant={operations.flipVertical ? "default" : "outline"}
            aria-label="Flip vertical"
            aria-pressed={operations.flipVertical === true}
            title="Flip vertical"
            onClick={() => setOperations({ flipVertical: !operations.flipVertical })}
          >
            <FlipVertical />
          </Button>
          <Button
            size="sm"
            variant={operations.invert ? "default" : "outline"}
            aria-pressed={operations.invert === true}
            onClick={() => setOperations({ invert: !operations.invert })}
          >
            Invert
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            disabled={isIdentity(operations)}
            onClick={resetOperations}
          >
            Reset
          </Button>
        </div>
        {ADJUSTMENTS.map((def) => {
          const value = adjustmentValue(operations, def.key);
          return (
            <div key={def.key} className="flex items-center gap-2">
              <Label id={`op-${def.key}-label`} className="w-24 shrink-0 text-xs">
                {def.label} {show(value)}
              </Label>
              <Slider
                aria-labelledby={`op-${def.key}-label`}
                min={def.min}
                max={def.max}
                step={def.step}
                value={[value]}
                onValueChange={([v]) => setAdjustment(def.key, v)}
              />
            </div>
          );
        })}
        <div className="flex flex-col gap-2 rounded border p-2">
          <div className="flex items-center gap-2">
            <Crop className="size-4 shrink-0" aria-hidden />
            <span className="text-xs font-medium">Crop</span>
            <Badge variant={operations.crop ? "default" : "secondary"} className="ml-auto">
              {operations.crop ? `${operations.crop.width}×${operations.crop.height}` : "off"}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {CROP_FIELDS.map((field) => {
              const id = `op-crop-${field.key}`;
              return (
                <div key={field.key} className="flex items-center gap-1">
                  <Label htmlFor={id} className="text-xs">
                    {field.label}
                  </Label>
                  <Input
                    id={id}
                    type="number"
                    inputMode="numeric"
                    className="w-16"
                    disabled={!source}
                    min={field.min}
                    max={field.max(full)}
                    step={1}
                    value={draft[field.key]}
                    onChange={(e) => editField(field.key, e.target.value)}
                  />
                </div>
              );
            })}
            <Button
              size="sm"
              className="ml-auto"
              disabled={!source || noop}
              onClick={() => setOperations({ crop: draft })}
            >
              Apply
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!operations.crop}
              onClick={() => setOperations({ crop: undefined })}
            >
              Clear
            </Button>
          </div>
          {!source && <p className="text-xs text-muted-foreground">Load an image to crop.</p>}
        </div>
      </CardContent>
    </Card>
  );
}
