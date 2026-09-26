import { useState } from "react";
import { EFFECT_DEFS } from "../../../src/index.js";
import { useApp } from "../store";
import { Button } from "@/components/ui/button";
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
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { useConsoleMeta } from "../components/consoleMeta";

export default function EffectsPanel() {
  const effects = useApp((s) => s.effects);
  const addEffect = useApp((s) => s.addEffect);
  const removeEffect = useApp((s) => s.removeEffect);
  const moveEffect = useApp((s) => s.moveEffect);
  const toggleEffect = useApp((s) => s.toggleEffect);
  const setEffectParam = useApp((s) => s.setEffectParam);
  const [picked, setPicked] = useState(EFFECT_DEFS[0].type);
  useConsoleMeta("effects", effects.length === 1 ? "1 effect" : `${effects.length} effects`);

  return (
    <div className="overflow-y-auto lg:h-full">
      <div className="flex h-full flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="fx-picker" className="sr-only">
            Effect type
          </Label>
          <Select value={picked} onValueChange={setPicked}>
            <SelectTrigger id="fx-picker" className="w-37.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EFFECT_DEFS.map((d) => (
                <SelectItem key={d.type} value={d.type}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => addEffect(picked)}>Add effect</Button>
          <span className="text-label text-muted-foreground">
            Effect type · {EFFECT_DEFS.find((d) => d.type === picked)?.label ?? picked}
          </span>
        </div>
        {effects.map((e, i) => {
          const def = EFFECT_DEFS.find((d) => d.type === e.type);
          return (
            <div
              key={e.key}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-raised p-2.5"
            >
              <div className="flex items-center gap-2">
                <Switch
                  id={`fx-${e.key}`}
                  checked={e.enabled}
                  onCheckedChange={() => toggleEffect(i)}
                />
                <Label htmlFor={`fx-${e.key}`} className="text-body-lg text-foreground">
                  {def ? def.label : e.type}
                </Label>
              </div>
              {(def ? def.params : []).map((p) => (
                <div key={p.key} className="flex min-w-30 flex-1 flex-col gap-1">
                  <Label id={`fx-${e.key}-${p.key}-label`}>
                    {p.label} {typeof e.params[p.key] === "number" ? e.params[p.key] : p.def}
                  </Label>
                  <Slider
                    aria-labelledby={`fx-${e.key}-${p.key}-label`}
                    min={p.min}
                    max={p.max}
                    step={p.step}
                    value={[typeof e.params[p.key] === "number" ? e.params[p.key] : p.def]}
                    onValueChange={([v]) => setEffectParam(i, p.key, v)}
                  />
                </div>
              ))}
              <div className="ml-auto flex gap-1">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Move ${def ? def.label : e.type} up`}
                  title="Move up"
                  onClick={() => moveEffect(i, -1)}
                >
                  <ChevronUp />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Move ${def ? def.label : e.type} down`}
                  title="Move down"
                  onClick={() => moveEffect(i, 1)}
                >
                  <ChevronDown />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove ${def ? def.label : e.type}`}
                  title="Remove"
                  onClick={() => removeEffect(i)}
                >
                  <X />
                </Button>
              </div>
            </div>
          );
        })}
        {effects.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No effects</EmptyTitle>
              <EmptyDescription>The dither output passes through untouched.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </div>
  );
}
