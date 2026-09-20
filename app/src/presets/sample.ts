// Built-in thumbnail sample: procedural 128x128 scene with gradients,
// solid blocks, and fine detail so presets show their character.

export interface SampleImage {
  width: number;
  height: number;
  pixels: ArrayBuffer; // RGBA
}

export function makeSample(): SampleImage {
  const width = 128;
  const height = 128;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // Gradient base.
      out[i] = Math.round((255 * x) / (width - 1));
      out[i + 1] = Math.round((255 * y) / (height - 1));
      out[i + 2] = Math.round((255 * (x + y)) / (width + height - 2));
      // Solid quadrants overlay for palette response.
      if (x >= 88 && y < 40) {
        out[i] = 200;
        out[i + 1] = 30;
        out[i + 2] = 30;
      }
      if (x < 40 && y >= 88) {
        out[i] = 30;
        out[i + 1] = 30;
        out[i + 2] = 200;
      }
      // Checker detail for diffusion texture.
      if ((x + y) % 2 === 0 && x >= 44 && x < 84 && y >= 44 && y < 84) {
        out[i] = 255 - out[i];
        out[i + 1] = 255 - out[i + 1];
        out[i + 2] = 255 - out[i + 2];
      }
      out[i + 3] = 255;
    }
  }
  return { width, height, pixels: out.buffer as ArrayBuffer };
}
