import { useState } from "react";
import { useApp } from "../store";
import { useTranslate } from "../i18n";
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

/** Rail section: pre-dither geometry and colour operations, plus a crop editor. */
export default function OperationsPanel() {
  const t = useTranslate();
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
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          title={t("ops.rotate")}
          onClick={() => setOperations({ rotate: nextQuarterTurn(operations.rotate) })}
        >
          <RotateCw /> {t("ops.rotate")}
        </Button>
        <Badge variant="secondary">{operations.rotate ?? 0}°</Badge>
        <Button
          size="icon-sm"
          variant={operations.flipHorizontal ? "accent" : "outline"}
          aria-label={t("ops.flipH")}
          aria-pressed={operations.flipHorizontal === true}
          title={t("ops.flipH")}
          onClick={() => setOperations({ flipHorizontal: !operations.flipHorizontal })}
        >
          <FlipHorizontal />
        </Button>
        <Button
          size="icon-sm"
          variant={operations.flipVertical ? "accent" : "outline"}
          aria-label={t("ops.flipV")}
          aria-pressed={operations.flipVertical === true}
          title={t("ops.flipV")}
          onClick={() => setOperations({ flipVertical: !operations.flipVertical })}
        >
          <FlipVertical />
        </Button>
        <Button
          size="sm"
          variant={operations.invert ? "accent" : "outline"}
          aria-pressed={operations.invert === true}
          onClick={() => setOperations({ invert: !operations.invert })}
        >
          {t("ops.invert")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          disabled={isIdentity(operations)}
          onClick={resetOperations}
        >
          {t("ops.reset")}
        </Button>
      </div>
      {ADJUSTMENTS.map((def) => {
        const value = adjustmentValue(operations, def.key);
        return (
          <div key={def.key} className="flex flex-col gap-1.5">
            <Label id={`op-${def.key}-label`}>
              {t(`ops.${def.key}`)} {show(value)}
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
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-raised p-2">
        <div className="flex items-center gap-1.5">
          <Crop className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          <span className="text-label text-foreground">{t("ops.crop")}</span>
          <Badge variant={operations.crop ? "default" : "secondary"} className="ml-auto">
            {operations.crop
              ? `${operations.crop.width}×${operations.crop.height}`
              : t("rail.colorOff")}
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {CROP_FIELDS.map((field) => {
            const id = `op-crop-${field.key}`;
            return (
              <div key={field.key} className="flex items-center gap-1">
                <Label htmlFor={id} className="text-caption">
                  {field.label}
                </Label>
                <Input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  className="w-full"
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
            variant="secondary"
            disabled={!source || noop}
            onClick={() => setOperations({ crop: draft })}
          >
            {t("ops.apply")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            disabled={!operations.crop}
            onClick={() => setOperations({ crop: undefined })}
          >
            {t("ops.clear")}
          </Button>
        </div>
        {!source && <p className="text-caption text-muted-foreground">{t("ops.needsSource")}</p>}
      </div>
    </div>
  );
}
