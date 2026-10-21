import { describe, expect, it, vi } from "vitest";
import { paintExportImage, type ExportCanvas } from "./canvas";

function recordingCanvas(): { canvas: ExportCanvas; calls: string[] } {
  const calls: string[] = [];
  let composite: GlobalCompositeOperation = "source-over";
  let style: string = "#000";
  const canvas: ExportCanvas = {
    get globalCompositeOperation() {
      return composite;
    },
    set globalCompositeOperation(value: GlobalCompositeOperation) {
      composite = value;
      calls.push(`composite:${value}`);
    },
    get fillStyle() {
      return style;
    },
    set fillStyle(value: string | CanvasGradient | CanvasPattern) {
      style = String(value);
      calls.push(`fill:${style}`);
    },
    putImageData: vi.fn(() => calls.push("put")),
    fillRect: vi.fn(() => calls.push("rect")),
  };
  return { canvas, calls };
}

describe("export canvas compositing", () => {
  it("puts the image first, then paints white underneath it", () => {
    // The other order is invisible before encoding but replaced by
    // putImageData: JPEG then composites transparent pixels on black.
    const { canvas, calls } = recordingCanvas();
    paintExportImage(canvas, {} as ImageData, 4, 3, true);
    expect(calls).toEqual(["put", "composite:destination-over", "fill:#fff", "rect"]);
  });

  it("leaves transparency alone when the format keeps alpha", () => {
    const { canvas, calls } = recordingCanvas();
    paintExportImage(canvas, {} as ImageData, 4, 3, false);
    expect(calls).toEqual(["put"]);
  });
});
