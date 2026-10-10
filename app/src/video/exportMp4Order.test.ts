import { describe, expect, it } from "vitest";
import { createChunkReorderer } from "./exportMp4";

interface Stored {
  timestamp: number;
  meta?: { decoderConfig?: unknown };
}

/** A stand-in for the muxer: it records the order chunks are handed to it and
 *  rejects any DTS that goes backwards, which is the real failure. */
function recordingMuxer() {
  const order: number[] = [];
  const metas: (EncodedVideoChunkMetadata | undefined)[] = [];
  let last = -1;
  const violations: string[] = [];
  return {
    order,
    metas,
    violations,
    addVideoChunk: (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => {
      if (chunk.timestamp < last) violations.push(`DTS went from ${last} to ${chunk.timestamp}`);
      last = chunk.timestamp;
      order.push(chunk.timestamp);
      metas.push(meta);
    },
    /** The next file starts from zero again, so the check starts over too. */
    nextFile: () => {
      last = -1;
    },
  };
}

function chunk(timestamp: number): EncodedVideoChunk {
  const stored: Stored = { timestamp };
  return {
    timestamp,
    type: "delta",
    byteLength: 0,
    copyTo: () => {},
    meta: stored,
  } as unknown as EncodedVideoChunk;
}

describe("chunk reorderer", () => {
  it("passes chunks straight through when the encoder is already ordered", () => {
    const muxer = recordingMuxer();
    const reorder = createChunkReorderer(muxer.addVideoChunk, 1000);
    for (let i = 0; i < 5; i++) reorder.push(chunk(i * 1000));
    reorder.settle();
    expect(muxer.violations).toEqual([]);
    expect(muxer.order).toEqual([0, 1000, 2000, 3000, 4000]);
  });

  it("holds a chunk that arrived a frame early until its turn", () => {
    // The exact sequence from the failure: 166667 then 83333, one frame back.
    const muxer = recordingMuxer();
    const reorder = createChunkReorderer(muxer.addVideoChunk, 83333.333333);
    reorder.push(chunk(0));
    reorder.push(chunk(166667)); // frame 2, before frame 1
    reorder.push(chunk(83333)); // frame 1, a frame late
    reorder.push(chunk(250000));
    reorder.settle();
    expect(muxer.violations).toEqual([]);
    expect(muxer.order).toEqual([0, 83333, 166667, 250000]);
  });

  it("buffers a whole scene's reordering without losing a frame", () => {
    const count = 39;
    // How a B-frame encoder decodes three pictures: the middle one is displayed
    // last, so decode order is 0, 2, 1 within every group of three.
    const decoded: number[] = [];
    for (let i = 0; i < count; i += 3) {
      decoded.push(i, i + 2, i + 1);
    }
    const muxer = recordingMuxer();
    const reorder = createChunkReorderer(muxer.addVideoChunk, 1000);
    for (const index of decoded) reorder.push(chunk(index * 1000));
    reorder.settle();
    expect(muxer.violations).toEqual([]);
    expect(muxer.order).toEqual([...decoded].sort((a, b) => a - b).map((i) => i * 1000));
  });

  it("carries the metadata through, since the muxer needs it", () => {
    const seen: (EncodedVideoChunkMetadata | undefined)[] = [];
    const reorder = createChunkReorderer((_chunk, meta) => seen.push(meta), 1000);
    const meta = { decoderConfig: { codec: "avc1.640028" } } as EncodedVideoChunkMetadata;
    // The encoder hands the metadata alongside the chunk, as the second argument.
    reorder.push(chunk(0), meta);
    reorder.push(chunk(1000));
    reorder.settle();
    expect(seen[0]).toBe(meta);
    expect(seen[1]).toBeUndefined();
  });

  it("settles whatever is left, still in order", () => {
    const muxer = recordingMuxer();
    const reorder = createChunkReorderer(muxer.addVideoChunk, 1000);
    // A gap: frame 1 never arrives, so the rest has to flush at the end.
    reorder.push(chunk(0));
    reorder.push(chunk(3000));
    reorder.push(chunk(2000));
    reorder.settle();
    expect(muxer.violations).toEqual([]);
    expect(muxer.order).toEqual([0, 2000, 3000]);
    muxer.nextFile();
  });

  it("starts again after settling, for a second export from one encoder", () => {
    const muxer = recordingMuxer();
    const reorder = createChunkReorderer(muxer.addVideoChunk, 1000);
    reorder.push(chunk(1000));
    reorder.push(chunk(0));
    reorder.settle();
    muxer.nextFile();
    reorder.push(chunk(0));
    reorder.push(chunk(1000));
    reorder.settle();
    expect(muxer.violations).toEqual([]);
    expect(muxer.order).toEqual([0, 1000, 0, 1000]);
  });

  it("refuses a duration that could not place a chunk", () => {
    for (const bad of [0, -1, Number.NaN]) {
      expect(() => createChunkReorderer(() => {}, bad)).toThrow(RangeError);
    }
  });
});
