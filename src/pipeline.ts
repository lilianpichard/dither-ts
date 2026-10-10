// Single pipeline entry point: method routing, threshold, palette,
// downscale-dither-upscale (pixel size) and preview scaling.

import { PALETTES, type RGB } from "./palettes.js";
import {
  quantizeBW,
  type DitherOptions,
  type DitherRGBAOptions,
  type GrayImage,
  type PixelMask,
  type RGBAImage,
  type RowProgress,
} from "./types.js";
import { SPECIAL_DIFFUSION, diffuseBW, diffuseOriginal, diffusePalette } from "./diffusion.js";
import { orderedBW, orderedOriginal, orderedPalette } from "./ordered.js";
import { isDiffusionTableMethod, isOrderedMethod, isSpecialDiffusionMethod } from "./methods.js";
import { grayscaleFromRGB } from "./kernels.js";
import {
  assertDitherOptions,
  assertByteBuffer,
  assertDimensions,
  assertDitherRGBAOptions,
  assertGrayImage,
  assertMethod,
  assertPalette,
  assertPixelMask,
  assertPixelSize,
  assertRGBAImage,
  assertRGBBuffer,
  assertThreshold,
  resolveRowOrMask,
} from "./validation.js";

function immutablePalette(palette: RGB[]): RGB[] {
  return Object.freeze(
    palette.map((color) => Object.freeze([color[0], color[1], color[2]]) as RGB),
  ) as RGB[];
}

export function isBWPalette(palette: RGB[]): boolean {
  assertPalette(palette);
  return (
    palette.length === 2 &&
    palette[0].every((channel) => channel === 0) &&
    palette[1].every((channel) => channel === 255)
  );
}

export function resolvePalette(ref: NonNullable<DitherOptions["palette"]>): RGB[] {
  let palette: RGB[];
  if (typeof ref === "string") {
    if (!Object.hasOwn(PALETTES, ref)) throw new TypeError(`unknown palette: ${ref}`);
    palette = PALETTES[ref];
  } else {
    palette = ref;
  }
  assertPalette(palette);
  return immutablePalette(palette);
}

export const DEFAULT_PALETTE: RGB[] = immutablePalette(PALETTES["B&W"]);

/** Effective pixel factor: pixelSize, doubled in preview mode. */
export function effectivePixelSize(pixelSize = 1, preview = false): number {
  assertPixelSize(pixelSize);
  if (typeof preview !== "boolean") throw new TypeError("preview must be a boolean");
  const factor = pixelSize * (preview ? 2 : 1);
  assertPixelSize(factor);
  return factor;
}

/**
 * Pixel size for a frame rendered smaller than the source.
 *
 * A pixel size counts source pixels per block, so it only means what the user
 * typed at the source's own resolution. The preview is capped well below that
 * (video at 1080/720, stills at 720 for the heavy scans) while the export is
 * not, and applying the same number to both gives blocks of the same pixel
 * count on frames of very different sizes: the export comes back visibly finer
 * than the preview. Scaling by the long edge, which `fitSize` caps, keeps the
 * block's share of the frame the same on both.
 *
 * Clamped at one, since a block smaller than a pixel is not a block, and the
 * share can only be approximated because the factor has to be a whole number.
 */
export function proportionalPixelSize(
  pixelSize: number,
  workLongEdge: number,
  sourceLongEdge: number,
): number {
  assertPixelSize(pixelSize);
  if (!Number.isSafeInteger(workLongEdge) || workLongEdge <= 0) {
    throw new TypeError("working long edge must be a positive safe integer");
  }
  if (!Number.isSafeInteger(sourceLongEdge) || sourceLongEdge <= 0) {
    throw new TypeError("source long edge must be a positive safe integer");
  }
  return Math.max(1, Math.round((pixelSize * workLongEdge) / sourceLongEdge));
}

function sampleIndex(
  width: number,
  height: number,
  factor: number,
  x: number,
  y: number,
  mask?: PixelMask,
): number {
  const startX = x * factor;
  const startY = y * factor;
  const first = Math.min(height - 1, startY) * width + Math.min(width - 1, startX);
  if (!mask) return first;
  const endX = Math.min(width, startX + factor);
  const endY = Math.min(height, startY + factor);
  for (let sy = startY; sy < endY; sy++) {
    for (let sx = startX; sx < endX; sx++) {
      const i = sy * width + sx;
      if (mask[i] !== 0) return i;
    }
  }
  return first;
}

function downscaleMask(mask: PixelMask, width: number, height: number, factor: number): Uint8Array {
  assertPixelMask(mask, width, height);
  const smallWidth = Math.max(1, Math.ceil(width / factor));
  const smallHeight = Math.max(1, Math.ceil(height / factor));
  const out = new Uint8Array(smallWidth * smallHeight);
  for (let y = 0; y < smallHeight; y++) {
    for (let x = 0; x < smallWidth; x++) {
      const i = sampleIndex(width, height, factor, x, y, mask);
      out[y * smallWidth + x] = mask[i] === 0 ? 0 : 1;
    }
  }
  return out;
}

/** Nearest downscale by integer factor (top-left sample per block). */
export function downscaleGray(img: GrayImage, factor: number, mask?: PixelMask): GrayImage {
  assertGrayImage(img);
  assertPixelSize(factor);
  if (mask !== undefined) assertPixelMask(mask, img.width, img.height);
  if (factor <= 1) return img;
  const w = Math.max(1, Math.ceil(img.width / factor));
  const h = Math.max(1, Math.ceil(img.height / factor));
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = sampleIndex(img.width, img.height, factor, x, y, mask);
      data[y * w + x] = img.data[i];
    }
  }
  return { width: w, height: h, data };
}

/** Nearest upscale back to w x h (pixel repeat). */
export function upscaleBW(
  small: Uint8Array,
  sw: number,
  sh: number,
  w: number,
  h: number,
  factor?: number,
): Uint8Array {
  assertDimensions(sw, sh);
  assertDimensions(w, h);
  assertByteBuffer(small, sw * sh, "source buffer");
  if (factor !== undefined) assertPixelSize(factor);
  if (sw === w && sh === h) return small;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sourceY =
        factor === undefined
          ? Math.min(sh - 1, Math.floor((y * sh) / h))
          : Math.min(sh - 1, Math.floor(y / factor));
      const sourceX =
        factor === undefined
          ? Math.min(sw - 1, Math.floor((x * sw) / w))
          : Math.min(sw - 1, Math.floor(x / factor));
      out[y * w + x] = small[sourceY * sw + sourceX];
    }
  }
  return out;
}

/** Plain threshold without diffusion. */
export function thresholdBW(
  img: GrayImage,
  threshold: number,
  onRowOrMask?: RowProgress | PixelMask,
  mask?: PixelMask,
): Uint8Array {
  assertGrayImage(img);
  assertThreshold(threshold);
  const progress = resolveRowOrMask(onRowOrMask, mask, img.width, img.height);
  const activeMask = progress.mask;
  const out = new Uint8Array(img.width * img.height);
  for (let i = 0; i < out.length; i++) {
    if (activeMask && activeMask[i] === 0) continue;
    out[i] = quantizeBW(img.data[i], threshold);
  }
  progress.onRow?.(img.height, img.height, out, img.width, img.height);
  return out;
}

/**
 * Dither a grayscale image. Routes to passthrough, ordered, or
 * error-diffusion by method name. Applies pixel-size scaling around the core.
 */
export function ditherGray(img: GrayImage, options: DitherOptions = {}): Uint8Array {
  assertDitherOptions(options);
  assertGrayImage(img);
  if (options.mask !== undefined) assertPixelMask(options.mask, img.width, img.height);
  if (options.palette !== undefined) resolvePalette(options.palette);
  const method = options.method ?? "Floyd-Steinberg";
  assertMethod(method, "bw");
  const threshold = options.threshold ?? 128;
  const seed = options.seed ?? 0;
  const onProgress = options.onProgress;
  if (method === "None") {
    const out = new Uint8Array(img.data.length);
    for (let i = 0; i < out.length; i++) out[i] = Math.round(img.data[i]);
    onProgress?.(img.height, img.height, out, img.width, img.height);
    return out;
  }
  const factor = effectivePixelSize(options.pixelSize, options.preview);
  const small = downscaleGray(img, factor, options.mask);
  const smallMask =
    options.mask === undefined
      ? undefined
      : downscaleMask(options.mask, img.width, img.height, factor);
  let out: Uint8Array;
  if (isOrderedMethod(method)) {
    out = orderedBW(small, method, threshold, seed, onProgress, smallMask);
  } else if (isDiffusionTableMethod(method)) {
    out = diffuseBW(small, method, threshold, onProgress, smallMask);
  } else if (isSpecialDiffusionMethod(method)) {
    out = SPECIAL_DIFFUSION[method](small, threshold, onProgress, smallMask);
  } else {
    throw new TypeError(`unsupported method: ${method}`);
  }
  return upscaleBW(out, small.width, small.height, img.width, img.height, factor);
}

function downscaleRGB(
  rgb: Uint8ClampedArray,
  w: number,
  h: number,
  factor: number,
  mask?: PixelMask,
): { data: Uint8ClampedArray; w: number; h: number } {
  if (mask !== undefined) assertPixelMask(mask, w, h);
  if (factor <= 1) return { data: rgb, w, h };
  const sw = Math.max(1, Math.ceil(w / factor));
  const sh = Math.max(1, Math.ceil(h / factor));
  const data = new Uint8ClampedArray(sw * sh * 3);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const source = sampleIndex(w, h, factor, x, y, mask);
      const s = source * 3;
      const d = (y * sw + x) * 3;
      data[d] = rgb[s];
      data[d + 1] = rgb[s + 1];
      data[d + 2] = rgb[s + 2];
    }
  }
  return { data, w: sw, h: sh };
}

function upscaleRGB(
  small: Uint8ClampedArray,
  sw: number,
  sh: number,
  w: number,
  h: number,
  factor?: number,
): Uint8ClampedArray {
  if (factor !== undefined) assertPixelSize(factor);
  if (sw === w && sh === h) return small;
  const out = new Uint8ClampedArray(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sourceY =
        factor === undefined
          ? Math.min(sh - 1, Math.floor((y * sh) / h))
          : Math.min(sh - 1, Math.floor(y / factor));
      const sourceX =
        factor === undefined
          ? Math.min(sw - 1, Math.floor((x * sw) / w))
          : Math.min(sw - 1, Math.floor(x / factor));
      const s = (sourceY * sw + sourceX) * 3;
      const d = (y * w + x) * 3;
      out[d] = small[s];
      out[d + 1] = small[s + 1];
      out[d + 2] = small[s + 2];
    }
  }
  return out;
}

function workingSource(
  image: RGBAImage,
  factor: number,
  mask: PixelMask,
): {
  data: Uint8ClampedArray;
  w: number;
  h: number;
} {
  const w = Math.max(1, Math.ceil(image.width / factor));
  const h = Math.max(1, Math.ceil(image.height / factor));
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const source = sampleIndex(image.width, image.height, factor, x, y, mask);
      const s = source * 4;
      const d = (y * w + x) * 4;
      data[d] = image.data[s];
      data[d + 1] = image.data[s + 1];
      data[d + 2] = image.data[s + 2];
      data[d + 3] = image.data[s + 3];
    }
  }
  return { data, w, h };
}

function sourceAlpha(image: RGBAImage): Uint8ClampedArray {
  const alpha = new Uint8ClampedArray(image.width * image.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = image.data[i * 4 + 3];
  return alpha;
}

function packRGBA(
  out: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  color: boolean,
  alpha: Uint8ClampedArray,
  mask?: PixelMask,
  source?: Uint8ClampedArray,
): Uint8ClampedArray {
  const channels = color ? 3 : 1;
  const packed = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const sourceIndex = i * channels;
    const target = i * 4;
    if (mask && mask[i] === 0 && source) {
      packed[target] = source[i * 4];
      packed[target + 1] = source[i * 4 + 1];
      packed[target + 2] = source[i * 4 + 2];
    } else if (color) {
      packed[target] = out[sourceIndex];
      packed[target + 1] = out[sourceIndex + 1];
      packed[target + 2] = out[sourceIndex + 2];
    } else {
      packed[target] = out[sourceIndex];
      packed[target + 1] = out[sourceIndex];
      packed[target + 2] = out[sourceIndex];
    }
    packed[target + 3] = alpha[i];
  }
  return packed;
}

/** Dither RGB pixels against a validated palette. */
export function ditherColor(
  rgb: Uint8ClampedArray,
  width: number,
  height: number,
  options: DitherOptions = {},
): Uint8ClampedArray {
  assertDitherOptions(options);
  assertRGBBuffer(rgb, width, height);
  if (options.mask !== undefined) assertPixelMask(options.mask, width, height);
  const method = options.method ?? "Floyd-Steinberg";
  assertMethod(method, "color");
  const palette = resolvePalette(options.palette ?? DEFAULT_PALETTE);
  const seed = options.seed ?? 0;
  const onProgress = options.onProgress;
  if (method === "None") {
    const out = rgb.slice();
    onProgress?.(height, height, out, width, height);
    return out;
  }
  const factor = effectivePixelSize(options.pixelSize, options.preview);
  const small = downscaleRGB(rgb, width, height, factor, options.mask);
  const smallMask =
    options.mask === undefined ? undefined : downscaleMask(options.mask, width, height, factor);
  let out: Uint8ClampedArray;
  if (isOrderedMethod(method)) {
    out = orderedPalette(
      small.data,
      small.w,
      small.h,
      palette,
      method,
      seed,
      onProgress,
      smallMask,
    );
  } else if (isDiffusionTableMethod(method)) {
    out = diffusePalette(small.data, small.w, small.h, palette, method, onProgress, smallMask);
  } else {
    throw new TypeError(`unsupported color method: ${method}`);
  }
  return upscaleRGB(out, small.w, small.h, width, height, factor);
}

/**
 * Dither the source colours instead of a palette. Ordered kernels nudge each
 * channel by the same amount before posterising, so the move is a lightness
 * shift and hue survives; diffusion kernels carry each channel's own error.
 * `colorMode` is what selects this over `ditherColor`.
 */
export function ditherOriginal(
  rgb: Uint8ClampedArray,
  width: number,
  height: number,
  options: DitherOptions = {},
): Uint8ClampedArray {
  assertRGBBuffer(rgb, width, height);
  assertDimensions(width, height);
  const method = options.method ?? "Floyd-Steinberg";
  assertMethod(method, "color");
  const seed = options.seed ?? 0;
  const onProgress = options.onProgress;
  if (options.mask !== undefined) assertPixelMask(options.mask, width, height);
  if (method === "None") {
    const out = rgb.slice();
    onProgress?.(height, height, out, width, height);
    return out;
  }
  const factor = effectivePixelSize(options.pixelSize, options.preview);
  const small = downscaleRGB(rgb, width, height, factor, options.mask);
  const smallMask =
    options.mask === undefined ? undefined : downscaleMask(options.mask, width, height, factor);
  let out: Uint8ClampedArray;
  if (isOrderedMethod(method)) {
    out = orderedOriginal(small.data, small.w, small.h, method, seed, onProgress, smallMask);
  } else if (isDiffusionTableMethod(method)) {
    out = diffuseOriginal(small.data, small.w, small.h, method, onProgress, smallMask);
  } else {
    throw new TypeError(`unsupported original-colour method: ${method}`);
  }
  return upscaleRGB(out, small.w, small.h, width, height, factor);
}

export function ditherRGBA(image: RGBAImage, options: DitherRGBAOptions): Uint8ClampedArray {
  assertDitherRGBAOptions(options);
  assertRGBAImage(image);
  const { color, onProgress, mask: requestedMask, ...ditherOptions } = options;
  if (requestedMask !== undefined) assertPixelMask(requestedMask, image.width, image.height);
  const method = ditherOptions.method ?? "Floyd-Steinberg";
  assertMethod(method, color ? "color" : "bw");
  const palette = resolvePalette(ditherOptions.palette ?? DEFAULT_PALETTE);
  if (method === "None") {
    const out = image.data.slice();
    onProgress?.(image.height, image.height, out, image.width, image.height);
    return out;
  }
  const factor = effectivePixelSize(ditherOptions.pixelSize, ditherOptions.preview);
  const activeMask = new Uint8Array(image.width * image.height);
  for (let i = 0; i < activeMask.length; i++) {
    const sourceAlphaValue = image.data[i * 4 + 3];
    if (sourceAlphaValue > 0 && (!requestedMask || requestedMask[i] !== 0)) activeMask[i] = 1;
  }
  const small = workingSource(image, factor, activeMask);
  const working = new Uint8ClampedArray(small.w * small.h);
  for (let i = 0; i < working.length; i++) working[i] = small.data[i * 4 + 3];
  const smallMask = downscaleMask(activeMask, image.width, image.height, factor);
  const progress: RowProgress | undefined = onProgress
    ? (done, total, out, width, height) => {
        onProgress(
          done,
          total,
          packRGBA(out, width, height, color, working, smallMask, small.data),
          width,
          height,
        );
      }
    : undefined;
  const rgb = new Uint8ClampedArray(image.width * image.height * 3);
  for (let i = 0; i < image.width * image.height; i++) {
    rgb[i * 3] = image.data[i * 4];
    rgb[i * 3 + 1] = image.data[i * 4 + 1];
    rgb[i * 3 + 2] = image.data[i * 4 + 2];
  }
  const coreOptions = { ...ditherOptions, palette, mask: activeMask, onProgress: progress };
  // An absent colorMode means "palette", which is what every preset written
  // before the field existed already did.
  const colorMode = ditherOptions.colorMode ?? "palette";
  const out = !color
    ? ditherGray(grayscaleFromRGB(rgb, image.width, image.height), coreOptions)
    : colorMode === "original"
      ? ditherOriginal(rgb, image.width, image.height, coreOptions)
      : ditherColor(rgb, image.width, image.height, coreOptions);
  return packRGBA(
    out,
    image.width,
    image.height,
    color,
    sourceAlpha(image),
    activeMask,
    image.data,
  );
}
