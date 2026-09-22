import { useState } from "react";
import { EFFECT_DEFS } from "../../../src/index.js";
import { useApp } from "../store";
import { Button } from "@/components/ui/button";
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
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

export default function EffectsPanel() {
  const effects = useApp((s) => s.effects);
  const addEffect = useApp((s) => s.addEffect);
  const removeEffect = useApp((s) => s.removeEffect);
  const moveEffect = useApp((s) => s.moveEffect);
  const toggleEffect = useApp((s) => s.toggleEffect);
  const setEffectParam = useApp((s) => s.setEffectParam);
  const [picked, setPicked] = useState(EFFECT_DEFS[0].type);

  return (
    <Card className="h-full overflow-y-auto">
      <CardHeader>
        <CardTitle>Effects</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={picked} onValueChange={setPicked}>
            <SelectTrigger className="w-52">
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
        </div>
        {effects.map((e, i) => {
          const def = EFFECT_DEFS.find((d) => d.type === e.type);
          return (
            <div key={e.key} className="flex flex-wrap items-center gap-3 rounded border p-2">
              <div className="flex items-center gap-2">
                <Switch
                  id={`fx-${e.key}`}
                  checked={e.enabled}
                  onCheckedChange={() => toggleEffect(i)}
                />
                <Label htmlFor={`fx-${e.key}`}>{def ? def.label : e.type}</Label>
              </div>
              {(def ? def.params : []).map((p) => (
                <div key={p.key} className="flex items-center gap-2">
                  <Label>
                    {p.label} {typeof e.params[p.key] === "number" ? e.params[p.key] : p.def}
                  </Label>
                  <Slider
                    className="w-28"
                    min={p.min}
                    max={p.max}
                    step={p.step}
                    value={[typeof e.params[p.key] === "number" ? e.params[p.key] : p.def]}
                    onValueChange={([v]) => setEffectParam(i, p.key, v)}
                  />
                </div>
              ))}
              <div className="flex gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  title="Move up"
                  onClick={() => moveEffect(i, -1)}
                >
                  <ChevronUp />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  title="Move down"
                  onClick={() => moveEffect(i, 1)}
                >
                  <ChevronDown />
                </Button>
                <Button size="icon" variant="ghost" title="Remove" onClick={() => removeEffect(i)}>
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
      </CardContent>
    </Card>
  );
}
