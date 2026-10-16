export interface View {
  scale: number;
  ox: number;
  oy: number;
}

/** Room kept below the image for the meta line that sits along the bottom. */
export const META_INSET = 28;

/** Scale and offset that centre `imgW`x`imgH` inside the `boxW`x`boxH` viewport. */
export function fitView(
  boxW: number,
  boxH: number,
  imgW: number,
  imgH: number,
  inset: number = META_INSET,
): View {
  const scale = Math.min(boxW / imgW, (boxH - inset) / imgH);
  return {
    scale,
    ox: (boxW - imgW * scale) / 2,
    oy: (boxH - imgH * scale) / 2,
  };
}

/**
 * True when a bitmap of this shape covers exactly the viewport it would be
 * painted into. The surface always draws its bitmaps into the geometry rect, so
 * a bitmap that does not share the geometry would be rescaled into the wrong
 * aspect — the shape it is refused for.
 */
export function matchesGeometry(
  bitmap: { width: number; height: number } | null,
  width: number,
  height: number,
): boolean {
  return (
    bitmap !== null && width > 0 && height > 0 && bitmap.width === width && bitmap.height === height
  );
}
