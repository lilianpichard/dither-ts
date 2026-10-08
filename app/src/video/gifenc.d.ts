declare module "gifenc" {
  export type GifPalette = Array<[number, number, number]>;
  export interface GifFrameOptions {
    palette?: GifPalette | null;
    delay?: number;
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
    dispose?: number;
    first?: boolean;
  }
  export interface GifEncoderInstance {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: GifFrameOptions): void;
    finish(): void;
    bytes(): Uint8Array;
    reset(): void;
  }
  export function GIFEncoder(opts?: {
    initialCapacity?: number;
    auto?: boolean;
  }): GifEncoderInstance;
  /**
   * A palette of at most `maxColors` colours taken from an RGBA buffer, by
   * median cut. `format` defaults to rgb565, which is what a GIF wants.
   */
  export function quantize(
    data: Uint8ClampedArray,
    maxColors: number,
    opts?: { format?: "rgb565" | "rgb444" | "rgba4444" },
  ): GifPalette;
}
