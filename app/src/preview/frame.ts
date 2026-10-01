/**
 * A single RGBA bitmap, and the adapters the preview surface needs to paint it.
 *
 * The store's `ImageSource` and `RenderResult`, and the video frame the timeline
 * decodes, are all structurally `Frame`, so the image path needs no conversion.
 */
export interface Frame {
  width: number;
  height: number;
  pixels: ArrayBuffer;
}

/**
 * The shape of an `ImageData`, accepted structurally so this module needs no DOM
 * to be imported or unit tested.
 */
export interface FramePixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function frameFromImageData(data: FramePixels): Frame {
  return {
    width: data.width,
    height: data.height,
    // Copy: the caller keeps ownership of `data`, and a later `putImageData` on
    // the same canvas would otherwise write through this buffer.
    pixels: data.data.slice().buffer,
  };
}

export function frameToCanvas(frame: Frame): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext("2d");
  // A canvas past the browser's size or area limit returns null here rather
  // than throwing, so the null has to be turned into something the boundary
  // above can show the user.
  if (!context) {
    throw new RangeError(`this browser cannot display a ${frame.width}×${frame.height} canvas`);
  }
  context.putImageData(
    new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height),
    0,
    0,
  );
  return canvas;
}

/** True when two frames describe the same bitmap, for cheap change detection. */
export function sameFrame(a: Frame | null, b: Frame | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.width === b.width && a.height === b.height && a.pixels === b.pixels;
}
