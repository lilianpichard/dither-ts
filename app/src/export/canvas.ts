/** The few canvas operations the still exporter needs. */
export interface ExportCanvas {
  putImageData(image: ImageData, dx: number, dy: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  globalCompositeOperation: GlobalCompositeOperation;
  fillStyle: string | CanvasGradient | CanvasPattern;
}

/**
 * Paint the rendered frame, then put an opaque background underneath it.
 *
 * Order matters: `putImageData` ignores compositing and replaces every pixel,
 * including alpha, so filling first would be erased. Painting the white last
 * with `destination-over` only fills where the image is transparent.
 */
export function paintExportImage(
  canvas: ExportCanvas,
  image: ImageData,
  width: number,
  height: number,
  opaque: boolean,
): void {
  canvas.putImageData(image, 0, 0);
  if (!opaque) return;
  canvas.globalCompositeOperation = "destination-over";
  canvas.fillStyle = "#fff";
  canvas.fillRect(0, 0, width, height);
}
