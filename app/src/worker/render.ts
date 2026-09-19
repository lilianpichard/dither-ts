import { ditherColor, ditherGray, grayscaleFromRGB } from "../../../src/index.js";

export interface RenderRequest {
  id: number;
  width: number;
  height: number;
  /** RGBA pixels; transferred to the worker. */
  pixels: ArrayBuffer;
  color: boolean;
  method: string;
  threshold: number;
  palette: string;
  pixelSize: number;
}

export interface RenderResponse {
  id: number;
  width: number;
  height: number;
  /** RGBA pixels; transferred back. */
  pixels: ArrayBuffer;
  ms: number;
}

self.onmessage = (e: MessageEvent<RenderRequest>) => {
  const t0 = performance.now();
  const { id, width, height, pixels, color, method, threshold, palette, pixelSize } = e.data;
  const rgba = new Uint8ClampedArray(pixels);
  const count = width * height;
  const rgb = new Uint8ClampedArray(count * 3);
  for (let i = 0; i < count; i++) {
    rgb[i * 3] = rgba[i * 4];
    rgb[i * 3 + 1] = rgba[i * 4 + 1];
    rgb[i * 3 + 2] = rgba[i * 4 + 2];
  }
  const out = new Uint8ClampedArray(count * 4);
  if (color) {
    const o = ditherColor(rgb, width, height, { method, palette, pixelSize });
    for (let i = 0; i < count; i++) {
      out[i * 4] = o[i * 3];
      out[i * 4 + 1] = o[i * 3 + 1];
      out[i * 4 + 2] = o[i * 3 + 2];
      out[i * 4 + 3] = 255;
    }
  } else {
    const g = grayscaleFromRGB(rgb, width, height);
    const o = ditherGray(g, { method, threshold, pixelSize });
    for (let i = 0; i < o.length; i++) {
      out[i * 4] = o[i];
      out[i * 4 + 1] = o[i];
      out[i * 4 + 2] = o[i];
      out[i * 4 + 3] = 255;
    }
  }
  const response: RenderResponse = {
    id,
    width,
    height,
    pixels: out.buffer as ArrayBuffer,
    ms: performance.now() - t0,
  };
  self.postMessage(response, { transfer: [out.buffer as ArrayBuffer] });
};
