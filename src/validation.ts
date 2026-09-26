import {
  getMethod,
  type DitherOutput,
  type MethodDefinition,
  type MethodFamily,
} from "./methods.js";
import type { Lab } from "./color.js";
import type { RGB } from "./palettes.js";
import type {
  DitherOptions,
  DitherRGBAOptions,
  GrayImage,
  PixelMask,
  RGBAImage,
  RowProgress,
} from "./types.js";

function invalid(message: string): never {
  throw new TypeError(message);
}

export function assertDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    invalid("width and height must be positive safe integers");
  }
  if (!Number.isSafeInteger(width * height)) invalid("dimensions exceed the safe integer range");
}

export function assertGrayImage(image: GrayImage): void {
  if (typeof image !== "object" || image === null) invalid("image must be an object");
  assertDimensions(image.width, image.height);
  if (!(image.data instanceof Float32Array)) invalid("grayscale data must be a Float32Array");
  const expected = image.width * image.height;
  if (!Number.isSafeInteger(expected) || image.data.length !== expected) {
    invalid("grayscale buffer length must equal width * height");
  }
  for (const value of image.data) {
    if (!Number.isFinite(value) || value < 0 || value > 255) {
      invalid("grayscale values must be finite and between 0 and 255");
    }
  }
}

export function assertRGBBuffer(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  channels = 3,
): void {
  if (!(data instanceof Uint8ClampedArray)) invalid("RGB data must be a Uint8ClampedArray");
  assertDimensions(width, height);
  if (!Number.isSafeInteger(channels) || channels <= 0) {
    invalid("channel count must be a positive safe integer");
  }
  const expected = width * height * channels;
  if (!Number.isSafeInteger(expected) || data.length !== expected) {
    invalid("RGB buffer length must equal width * height * channels");
  }
}

export function assertByteBuffer(data: Uint8Array, expected: number, label: string): void {
  if (!(data instanceof Uint8Array)) invalid(`${label} must be a Uint8Array`);
  if (!Number.isSafeInteger(expected) || expected < 0 || data.length !== expected) {
    invalid(`${label} length must equal the expected size`);
  }
}

export function assertPixelMask(
  mask: unknown,
  width?: number,
  height?: number,
): asserts mask is PixelMask {
  if (!(mask instanceof Uint8Array || mask instanceof Uint8ClampedArray)) {
    invalid("mask must be a Uint8Array or Uint8ClampedArray");
  }
  if (width === undefined && height === undefined) return;
  if (width === undefined || height === undefined)
    invalid("mask dimensions must be provided together");
  assertDimensions(width, height);
  if (mask.length !== width * height) invalid("mask length must equal width * height");
}

export function resolveRowOrMask(
  onRowOrMask: RowProgress | PixelMask | undefined,
  mask: PixelMask | undefined,
  width: number,
  height: number,
): { onRow?: RowProgress; mask?: PixelMask } {
  if (typeof onRowOrMask === "function") {
    if (mask !== undefined) assertPixelMask(mask, width, height);
    return { onRow: onRowOrMask, mask };
  }
  if (onRowOrMask !== undefined) {
    if (mask !== undefined) invalid("mask may only be provided once");
    assertPixelMask(onRowOrMask, width, height);
    return { mask: onRowOrMask };
  }
  if (mask !== undefined) {
    assertPixelMask(mask, width, height);
    return { mask };
  }
  return {};
}

export function assertPalette(palette: RGB[]): void {
  if (!Array.isArray(palette) || palette.length === 0) {
    invalid("palette must not be empty");
  }
  if (palette.length < 2) invalid("palette must contain at least two colors");
  for (let i = 0; i < palette.length; i++) {
    if (!Object.hasOwn(palette, i) || !Array.isArray(palette[i]) || palette[i].length !== 3) {
      invalid("palette colors must be RGB triples");
    }
    for (let j = 0; j < 3; j++) {
      const channel = palette[i][j];
      if (
        !Object.hasOwn(palette[i], j) ||
        !Number.isInteger(channel) ||
        channel < 0 ||
        channel > 255
      ) {
        invalid("palette channels must be integers between 0 and 255");
      }
    }
  }
}

export function assertLab(lab: unknown, label = "lab"): asserts lab is Lab {
  if (!Array.isArray(lab) || lab.length !== 3) invalid(`${label} must be a Lab triple`);
  for (let i = 0; i < 3; i++) {
    if (!Object.hasOwn(lab, i) || typeof lab[i] !== "number" || !Number.isFinite(lab[i])) {
      invalid(`${label} channels must be finite numbers`);
    }
  }
}

export function assertLabPalette(palette: unknown): asserts palette is Lab[] {
  if (!Array.isArray(palette) || palette.length === 0) {
    invalid("Lab palette must not be empty");
  }
  for (let i = 0; i < palette.length; i++) {
    assertLab(palette[i], `Lab palette color ${i}`);
  }
}

export function assertRGBAImage(image: RGBAImage): void {
  if (typeof image !== "object" || image === null) invalid("image must be an object");
  assertRGBBuffer(image.data, image.width, image.height, 4);
}

export function nearestVisibleRGBA(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba);
  const nearest = new Int32Array(width * height);
  nearest.fill(-1);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < width * height; i++) {
    if (rgba[i * 4 + 3] > 0) {
      nearest[i] = i;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const source = queue[head++];
    const x = source % width;
    const y = Math.floor(source / width);
    if (x > 0 && nearest[source - 1] === -1) nearest[source - 1] = source;
    if (x + 1 < width && nearest[source + 1] === -1) nearest[source + 1] = source;
    if (y > 0 && nearest[source - width] === -1) nearest[source - width] = source;
    if (y + 1 < height && nearest[source + width] === -1) nearest[source + width] = source;
    const left = source - 1;
    const right = source + 1;
    const up = source - width;
    const down = source + width;
    if (x > 0 && nearest[left] === source) queue[tail++] = left;
    if (x + 1 < width && nearest[right] === source) queue[tail++] = right;
    if (y > 0 && nearest[up] === source) queue[tail++] = up;
    if (y + 1 < height && nearest[down] === source) queue[tail++] = down;
  }
  for (let i = 0; i < width * height; i++) {
    if (out[i * 4 + 3] !== 0) continue;
    const source = nearest[i];
    if (source < 0) continue;
    out[i * 4] = out[source * 4];
    out[i * 4 + 1] = out[source * 4 + 1];
    out[i * 4 + 2] = out[source * 4 + 2];
  }
  return out;
}

export function premultiplyRGBA(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba);
  for (let i = 0; i < out.length; i += 4) {
    const alpha = out[i + 3];
    for (let c = 0; c < 3; c++) out[i + c] = (out[i + c] * alpha) / 255;
  }
  return out;
}

export function unpremultiplyRGBA(
  rgba: Uint8ClampedArray,
  source: Uint8ClampedArray,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba);
  for (let i = 0; i < out.length; i += 4) {
    const alpha = source[i + 3];
    out[i + 3] = alpha;
    if (alpha === 0) {
      out[i] = source[i];
      out[i + 1] = source[i + 1];
      out[i + 2] = source[i + 2];
      continue;
    }
    for (let c = 0; c < 3; c++) out[i + c] = (out[i + c] * 255) / alpha;
  }
  return out;
}

export function assertThreshold(threshold: number): void {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 255) {
    invalid("threshold must be finite and between 0 and 255");
  }
}

export function assertPixelSize(pixelSize: number): void {
  if (!Number.isSafeInteger(pixelSize) || pixelSize <= 0) {
    invalid("pixelSize must be a positive safe integer");
  }
}

export function assertSeed(seed: number): void {
  if (!Number.isFinite(seed) || !Number.isInteger(seed)) invalid("seed must be a finite integer");
}

export function assertMethod(name: string, output: DitherOutput): MethodDefinition {
  const method = getMethod(name);
  if (!method) invalid(`unknown method: ${name}`);
  if (!method.supports[output]) invalid(`method does not support ${output}: ${name}`);
  return method;
}

export function assertMethodFamily(name: string, family: MethodFamily): void {
  const method = getMethod(name);
  if (!method) invalid(`unknown method: ${name}`);
  if (method.family !== family) invalid(`method is not ${family}: ${name}`);
}

export function assertDitherOptions(options: unknown): asserts options is DitherOptions {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    invalid("options must be an object");
  }
  const value = options as DitherOptions;
  if (value.method !== undefined) {
    if (typeof value.method !== "string") invalid("method must be a string");
    if (!getMethod(value.method)) invalid(`unknown method: ${value.method}`);
  }
  if (
    value.palette !== undefined &&
    typeof value.palette !== "string" &&
    !Array.isArray(value.palette)
  ) {
    invalid("palette must be a registered name or RGB array");
  }
  if (value.threshold !== undefined) assertThreshold(value.threshold);
  if (value.pixelSize !== undefined) assertPixelSize(value.pixelSize);
  if (value.seed !== undefined) assertSeed(value.seed);
  if (value.mask !== undefined) assertPixelMask(value.mask);
  if (value.preview !== undefined && typeof value.preview !== "boolean") {
    invalid("preview must be a boolean");
  }
  if (value.onProgress !== undefined && typeof value.onProgress !== "function") {
    invalid("onProgress must be a function");
  }
}

export function assertDitherRGBAOptions(options: unknown): asserts options is DitherRGBAOptions {
  const value = options as DitherRGBAOptions;
  assertDitherOptions(value);
  if (typeof value.color !== "boolean") invalid("color must be a boolean");
}
