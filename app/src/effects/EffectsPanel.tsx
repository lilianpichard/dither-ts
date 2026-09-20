import { useState } from "react";
import { EFFECT_DEFS } from "../../../src/index.js";
import { useApp } from "../store";

export default function EffectsPanel() {
  const effects = useApp((s) => s.effects);
  const addEffect = useApp((s) => s.addEffect);
  const removeEffect = useApp((s) => s.removeEffect);
  const moveEffect = useApp((s) => s.moveEffect);
  const toggleEffect = useApp((s) => s.toggleEffect);
  const setEffectParam = useApp((s) => s.setEffectParam);
  const [picked, setPicked] = useState(EFFECT_DEFS[0].type);

  return (
    <section>
      <h2>Effects</h2>
      <div className="row">
        <select value={picked} onChange={(e) => setPicked(e.target.value)}>
          {EFFECT_DEFS.map((d) => (
            <option key={d.type} value={d.type}>
              {d.label}
            </option>
          ))}
        </select>
        <button onClick={() => addEffect(picked)}>Add effect</button>
      </div>
      {effects.map((e, i) => {
        const def = EFFECT_DEFS.find((d) => d.type === e.type);
        return (
          <div className="row" key={e.key}>
            <label>
              <input type="checkbox" checked={e.enabled} onChange={() => toggleEffect(i)} />{" "}
              {def ? def.label : e.type}
            </label>
            {(def ? def.params : []).map((p) => (
              <label key={p.key}>
                {p.label}{" "}
                <input
                  type="range"
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  value={typeof e.params[p.key] === "number" ? e.params[p.key] : p.def}
                  onChange={(ev) => setEffectParam(i, p.key, Number(ev.target.value))}
                />{" "}
                {typeof e.params[p.key] === "number" ? e.params[p.key] : p.def}
              </label>
            ))}
            <button title="Move up" onClick={() => moveEffect(i, -1)}>
              ↑
            </button>
            <button title="Move down" onClick={() => moveEffect(i, 1)}>
              ↓
            </button>
            <button title="Remove" onClick={() => removeEffect(i)}>
              ✕
            </button>
          </div>
        );
      })}
      {effects.length === 0 && <p id="status">No effects — the dither output passes through.</p>}
    </section>
  );
}
