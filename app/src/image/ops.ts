// Pure RGBA image operations applied before dithering. Serializable request
// payloads only: no DOM, no randomness, no mutation of the input buffer.
// Color math runs on premultiplied channels so partial alpha stays artifact
// free; geometry ops move pixels verbatim and are alpha safe by construction.

import { assertRGBBuffer, premultiplyRGBA, unpremultiplyRGBA } from "../../../src/validation.js";
import type { RGBAImage } from "../../../src/index.js";

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type QuarterTurn = 0 | 90 | 180 | 270;

const LUMA = [0.299, 0.587, 0.114] as const;

function invalid(message: string): never {
  throw new TypeError(message);
}

function assertImage(image: RGBAImage): void {
  if (typeof image !== "object" || image === null) invalid("image must be an object");
  assertRGBBuffer(image.data, image.width, image.height, 4);
}

/** Validate a bounded unit-interval parameter. */
function assertUnit(value: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < -1 || value > 1) {
    invalid(`${label} must be a finite number between -1 and 1`);
  }
  return value;
}

function assertInteger(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    invalid(`${label} must be a safe integer`);
  }
}

function copyOf(image: RGBAImage): RGBAImage {
  return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
}

/** Cut out an axis-aligned rectangle. Out-of-bounds rectangles throw. */
export function crop(image: RGBAImage, rect: CropRect): RGBAImage {
  assertImage(image);
  if (typeof rect !== "object" || rect === null || Array.isArray(rect)) {
    invalid("crop rect must be an object");
  }
  const { x, y, width, height } = rect;
  assertInteger(x, "crop x");
  assertInteger(y, "crop y");
  assertInteger(width, "crop width");
  assertInteger(height, "crop height");
  if (x < 0 || y < 0) invalid("crop origin must be non-negative");
  if (width <= 0 || height <= 0) invalid("crop size must be positive");
  if (x + width > image.width || y + height > image.height) {
    invalid("crop rectangle must fit inside the image");
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    const from = ((y + row) * image.width + x) * 4;
    data.set(image.data.subarray(from, from + width * 4), row * width * 4);
  }
  return { width, height, data };
}

/** Rotate clockwise by a quarter turn. Pixels and alpha move verbatim. */
export function rotate(image: RGBAImage, degrees: QuarterTurn): RGBAImage {
  assertImage(image);
  assertInteger(degrees, "rotation");
  if (degrees !== 0 && degrees !== 90 && degrees !== 180 && degrees !== 270) {
    invalid("rotation must be 0, 90, 180 or 270");
  }
  if (degrees === 0) return copyOf(image);
  const w = degrees === 180 ? image.width : image.height;
  const h = degrees === 180 ? image.height : image.width;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const from = (y * image.width + x) * 4;
      let to: number;
      if (degrees === 90) to = (x * w + (image.height - 1 - y)) * 4;
      else if (degrees === 180) to = ((image.height - 1 - y) * w + (image.width - 1 - x)) * 4;
      else to = ((image.width - 1 - x) * w + y) * 4;
      data[to] = image.data[from];
      data[to + 1] = image.data[from + 1];
      data[to + 2] = image.data[from + 2];
      data[to + 3] = image.data[from + 3];
    }
  }
  return { width: w, height: h, data };
}

/** Mirror left to right. */
export function flipHorizontal(image: RGBAImage): RGBAImage {
  assertImage(image);
  const data = new Uint8ClampedArray(image.width * image.height * 4);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const from = (y * image.width + x) * 4;
      const to = (y * image.width + (image.width - 1 - x)) * 4;
      data[to] = image.data[from];
      data[to + 1] = image.data[from + 1];
      data[to + 2] = image.data[from + 2];
      data[to + 3] = image.data[from + 3];
    }
  }
  return { width: image.width, height: image.height, data };
}

/** Mirror top to bottom. */
export function flipVertical(image: RGBAImage): RGBAImage {
  assertImage(image);
  const data = new Uint8ClampedArray(image.width * image.height * 4);
  for (let y = 0; y < image.height; y++) {
    const to = (image.height - 1 - y) * image.width * 4;
    data.set(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4), to);
  }
  return { width: image.width, height: image.height, data };
}

/**
 * Run a per-pixel channel transform on premultiplied RGBA so partial alpha
 * scales instead of leaking. The callback overwrites the three channel slots
 * in place; alpha is restored from the source pixels.
 */
function mapPremultiplied(
  image: RGBAImage,
  transform: (channels: Float64Array) => void,
): RGBAImage {
  const working = premultiplyRGBA(image.data);
  const channels = new Float64Array(3);
  for (let i = 0; i < working.length; i += 4) {
    channels[0] = working[i];
    channels[1] = working[i + 1];
    channels[2] = working[i + 2];
    transform(channels);
    working[i] = channels[0];
    working[i + 1] = channels[1];
    working[i + 2] = channels[2];
  }
  return {
    width: image.width,
    height: image.height,
    data: unpremultiplyRGBA(working, image.data),
  };
}

/** Shift RGB by `amount` of the full 0..255 range. */
export function adjustBrightness(image: RGBAImage, amount: number): RGBAImage {
  assertImage(image);
  assertUnit(amount, "brightness");
  if (amount === 0) return copyOf(image);
  const shift = amount * 255;
  return mapPremultiplied(image, (channels) => {
    for (let c = 0; c < 3; c++) channels[c] += shift;
  });
}

/** Scale RGB around mid grey by `1 + amount`. */
export function adjustContrast(image: RGBAImage, amount: number): RGBAImage {
  assertImage(image);
  assertUnit(amount, "contrast");
  if (amount === 0) return copyOf(image);
  const factor = 1 + amount;
  return mapPremultiplied(image, (channels) => {
    for (let c = 0; c < 3; c++) channels[c] = (channels[c] - 127.5) * factor + 127.5;
  });
}

/** Scale chroma around luminance by `1 + amount`; -1 is greyscale. */
export function adjustSaturation(image: RGBAImage, amount: number): RGBAImage {
  assertImage(image);
  assertUnit(amount, "saturation");
  if (amount === 0) return copyOf(image);
  const factor = 1 + amount;
  return mapPremultiplied(image, (channels) => {
    const luma = LUMA[0] * channels[0] + LUMA[1] * channels[1] + LUMA[2] * channels[2];
    for (let c = 0; c < 3; c++) channels[c] = luma + (channels[c] - luma) * factor;
  });
}

/** Rotate hue by `degrees` without touching lightness or alpha. */
export function rotateHue(image: RGBAImage, degrees: number): RGBAImage {
  assertImage(image);
  if (typeof degrees !== "number" || !Number.isFinite(degrees) || Math.abs(degrees) > 180) {
    invalid("hue must be a finite number between -180 and 180");
  }
  if (degrees === 0) return copyOf(image);
  const turn = degrees / 60;
  return mapPremultiplied(image, (channels) => {
    const [r, g, b] = channels;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;
    if (chroma === 0) return;
    const half = (max + min) / 2;
    const offset = half - chroma / 2;
    const sector =
      max === r
        ? (g - b) / chroma + (g < b ? 6 : 0)
        : max === g
          ? (b - r) / chroma + 2
          : (r - g) / chroma + 4;
    const h = (((sector + turn) % 6) + 6) % 6;
    const second = chroma * (1 - Math.abs((h % 2) - 1));
    const rgb =
      h < 1
        ? [chroma, second, 0]
        : h < 2
          ? [second, chroma, 0]
          : h < 3
            ? [0, chroma, second]
            : h < 4
              ? [0, second, chroma]
              : h < 5
                ? [second, 0, chroma]
                : [chroma, 0, second];
    for (let c = 0; c < 3; c++) channels[c] = rgb[c] + offset;
  });
}

/** Photographic negative of RGB; alpha is untouched. */
export function invert(image: RGBAImage): RGBAImage {
  assertImage(image);
  return mapPremultiplied(image, (channels) => {
    for (let c = 0; c < 3; c++) channels[c] = 255 - channels[c];
  });
}

/** Serializable set of operations applied to a frame before dithering. */
export interface ImageOperations {
  crop?: CropRect;
  rotate?: QuarterTurn;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
  /** -1..1 additive shift of the full 0..255 range. */
  brightness?: number;
  /** -1..1 scale around mid grey. */
  contrast?: number;
  /** -1..1 chroma scale; -1 is greyscale. */
  saturation?: number;
  /** Hue rotation in degrees, -180..180. */
  hue?: number;
  invert?: boolean;
}

function assertFlag(value: unknown, label: string): void {
  if (typeof value !== "boolean") invalid(`${label} must be a boolean`);
}

/**
 * Apply a serializable operation set. Geometry runs before colour so crop
 * coordinates are in source space, and every step is a fresh buffer, so the
 * source image is never touched. Missing fields mean identity.
 */
export function applyOperations(image: RGBAImage, operations: ImageOperations): RGBAImage {
  assertImage(image);
  if (typeof operations !== "object" || operations === null || Array.isArray(operations)) {
    invalid("operations must be an object");
  }
  let out = copyOf(image);
  if (operations.crop !== undefined) out = crop(out, operations.crop);
  if (operations.rotate !== undefined) out = rotate(out, operations.rotate);
  if (operations.flipHorizontal !== undefined) {
    assertFlag(operations.flipHorizontal, "flipHorizontal");
    if (operations.flipHorizontal) out = flipHorizontal(out);
  }
  if (operations.flipVertical !== undefined) {
    assertFlag(operations.flipVertical, "flipVertical");
    if (operations.flipVertical) out = flipVertical(out);
  }
  if (operations.brightness !== undefined) out = adjustBrightness(out, operations.brightness);
  if (operations.contrast !== undefined) out = adjustContrast(out, operations.contrast);
  if (operations.saturation !== undefined) out = adjustSaturation(out, operations.saturation);
  if (operations.hue !== undefined) out = rotateHue(out, operations.hue);
  if (operations.invert !== undefined) {
    assertFlag(operations.invert, "invert");
    if (operations.invert) out = invert(out);
  }
  return out;
}
