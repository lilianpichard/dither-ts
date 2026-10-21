import { useState } from "react";
import { useApp } from "../store";
import { useTranslate } from "../i18n";
import {
  MAX_PALETTE_COLORS,
  MIN_PALETTE_COLORS,
  addColor,
  draftColors,
  editColor,
  isActivePalette,
  normalizeHex,
  removeColor,
  rgbToHex,
} from "./editor";
import type { RGB } from "../../../src/index.js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, X } from "lucide-react";

/** Custom palette editor: swatches, hex add/edit/remove, and apply-to-preview. */
export default function PaletteEditor() {
  const t = useTranslate();
  const palette = useApp((s) => s.params.palette);
  const setParams = useApp((s) => s.setParams);
  const paletteKey = JSON.stringify(palette);
  // The draft follows the active palette; edits stay local until applied.
  const [draftState, setDraftState] = useState<{ key: string; colors: RGB[] }>({
    key: paletteKey,
    colors: draftColors(palette),
  });
  if (draftState.key !== paletteKey) {
    setDraftState({ key: paletteKey, colors: draftColors(palette) });
  }
  const draft = draftState.colors;
  const [selected, setSelected] = useState(0);
  const [addText, setAddText] = useState("#000000");
  const [editText, setEditText] = useState("");
  const index = Math.min(selected, draft.length - 1);
  const addHex = normalizeHex(addText);
  const editHex = normalizeHex(editText);
  const inUse = isActivePalette(palette, draft);

  function change(colors: RGB[]) {
    setDraftState({ key: paletteKey, colors });
  }

  return (
    <div className="flex flex-col gap-2 rounded border p-2">
      <div className="flex flex-wrap items-center gap-1">
        {draft.map((color, i) => (
          <button
            key={`${rgbToHex(color)}-${i}`}
            type="button"
            aria-label={t("palette.editColor", { hex: rgbToHex(color) })}
            aria-pressed={i === index}
            title={rgbToHex(color)}
            className={`size-6 rounded border ${i === index ? "border-ring ring-2" : "border-border"}`}
            style={{ backgroundColor: rgbToHex(color) }}
            onClick={() => {
              setSelected(i);
              setEditText(rgbToHex(color));
            }}
          />
        ))}
        <Badge variant="secondary" className="ml-auto">
          {draft.length}/{MAX_PALETTE_COLORS}
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor="palette-edit" className="w-10 shrink-0 text-xs">
          {t("palette.hex")}
        </Label>
        <Input
          id="palette-edit"
          className="w-24"
          value={editText}
          aria-label={t("palette.selectedHex")}
          aria-invalid={editText.length > 0 && editHex === null}
          onChange={(e) => setEditText(e.target.value)}
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={editHex === null || index < 0}
          onClick={() => {
            if (index >= 0) change(editColor(draft, index, editText));
          }}
        >
          {t("palette.set")}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={t("palette.removeSelected")}
          disabled={draft.length <= MIN_PALETTE_COLORS}
          onClick={() => {
            if (index >= 0) change(removeColor(draft, index));
          }}
        >
          <X />
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor="palette-add" className="w-10 shrink-0 text-xs">
          {t("palette.add")}
        </Label>
        <Input
          id="palette-add"
          className="w-24"
          value={addText}
          aria-label={t("palette.newHex")}
          aria-invalid={addHex === null}
          onChange={(e) => setAddText(e.target.value)}
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={addHex === null || draft.length >= MAX_PALETTE_COLORS}
          onClick={() => {
            const next = addColor(draft, addText);
            if (next === draft) return;
            change(next);
            setSelected(next.length - 1);
            setEditText(rgbToHex(next[next.length - 1]));
          }}
        >
          <Plus /> {t("palette.add")}
        </Button>
      </div>
      <Button
        size="sm"
        className="w-full"
        disabled={inUse || draft.length < MIN_PALETTE_COLORS}
        onClick={() => setParams({ color: true, palette: draft })}
      >
        {inUse ? t("palette.inUse") : t("palette.use")}
      </Button>
    </div>
  );
}
