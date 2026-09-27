import { describe, expect, it } from "vitest";
import { PALETTES } from "../../../src/palettes.js";
import { buildExportRenderRequest } from "../export/request";
import { runRender } from "../worker/render";
import type { RenderRequest, RenderResponse } from "../worker/render";
import type { DitherParams, ImageSource } from "../store";

// End-to-end for the reported bug: the preview showed "original" colours but the
// exported PNG came out in the palette. buildExportRenderRequest dropped
// colorMode, so the worker fell back to "palette" for every export.
function source(): ImageSource {
  const width = 16;
  const height = 16;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    // Four tones along a warm ramp, plus one outlier green.
    const q = (i % 4) * 70;
    data[i * 4] = 30 + q;
    data[i * 4 + 1] = 90 + Math.round(q / 2);
    data[i * 4 + 2] = 210 - q;
    data[i * 4 + 3] = 255;
  }
  return { width, height, pixels: data.buffer as ArrayBuffer, name: "in.png" };
}

function collect(res: Omit<RenderRequest, "id">): RenderResponse {
  let out: RenderResponse | undefined;
  runRender({ ...res, id: 1 }, (message) => {
    if (message.kind === "result") out = message;
  });
  if (!out) throw new Error("worker produced no result");
  return out;
}

function uniqueColours(pixels: ArrayBuffer): string[] {
  const d = new Uint8ClampedArray(pixels);
  const seen = new Set<string>();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
  }
  return [...seen];
}

const base: DitherParams = {
  method: "Bayer 4x4",
  threshold: 128,
  palette: "Gruvbox",
  color: true,
  pixelSize: 1,
};

describe("export honours the selected colour mode", () => {
  const gruvbox = new Set(PALETTES.Gruvbox.map(([r, g, b]) => `${r},${g},${b}`));

  it("exports original colours when the mode is original", () => {
    const res = buildExportRenderRequest(source(), { ...base, colorMode: "original" }, []);
    expect(res.colorMode).toBe("original");

    const colours = uniqueColours(collect(res).pixels);
    // The real property: output is not restricted to the palette. A colour
    // outside Gruvbox surviving proves no palette mapping was applied.
    expect(colours.filter((c) => !gruvbox.has(c)).length).toBeGreaterThan(0);
  });

  it("exports palette colours when the mode is palette", () => {
    const res = buildExportRenderRequest(source(), { ...base, colorMode: "palette" }, []);
    const colours = uniqueColours(collect(res).pixels);
    expect(colours.every((c) => gruvbox.has(c))).toBe(true);
  });

  it("treats a preset with no stored mode as palette", () => {
    const res = buildExportRenderRequest(source(), base, []);
    expect(res.colorMode).toBe("palette");
    expect(uniqueColours(collect(res).pixels).every((c) => gruvbox.has(c))).toBe(true);
  });

  it("produces different bytes for the two modes on identical input", () => {
    const a = collect(buildExportRenderRequest(source(), { ...base, colorMode: "palette" }, []));
    const b = collect(buildExportRenderRequest(source(), { ...base, colorMode: "original" }, []));
    expect(new Uint8ClampedArray(a.pixels)).not.toEqual(new Uint8ClampedArray(b.pixels));
  });
});
