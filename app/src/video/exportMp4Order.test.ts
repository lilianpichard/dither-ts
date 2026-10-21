import { describe, expect, it } from "vitest";
import { createChunkWriter } from "./exportMp4";

interface Written {
  timestamp: number;
  compositionOffset: number;
  meta?: EncodedVideoChunkMetadata;
}

function chunk(timestamp: number): EncodedVideoChunk {
  return {
    timestamp,
    type: "delta",
    byteLength: 0,
    copyTo: () => {},
  } as unknown as EncodedVideoChunk;
}

function recorder(): {
  writes: Written[];
  write: (
    chunk: EncodedVideoChunk,
    meta: EncodedVideoChunkMetadata | undefined,
    compositionOffset: number,
  ) => void;
} {
  const writes: Written[] = [];
  return {
    writes,
    write: (source, meta, compositionOffset) =>
      writes.push({ timestamp: source.timestamp, compositionOffset, meta }),
  };
}

describe("chunk writer", () => {
  it("keeps decode order and derives the composition offsets", () => {
    const sink = recorder();
    const writer = createChunkWriter(sink.write, 1000);
    // A B-frame encoder can emit presentation 0, 2, 1 while decoding 0, 1, 2.
    writer.push(chunk(0));
    writer.push(chunk(2000));
    writer.push(chunk(1000));
    writer.settle();

    expect(sink.writes.map((entry) => entry.timestamp)).toEqual([0, 2000, 1000]);
    expect(sink.writes.map((entry) => entry.compositionOffset)).toEqual([0, 1000, -1000]);
  });

  it("writes zero offsets when the encoder is already in presentation order", () => {
    const sink = recorder();
    const writer = createChunkWriter(sink.write, 1000);
    writer.push(chunk(0));
    writer.push(chunk(1000));
    writer.push(chunk(2000));
    writer.settle();
    expect(sink.writes.map((entry) => entry.compositionOffset)).toEqual([0, 0, 0]);
  });

  it("carries the metadata through, since the muxer needs it", () => {
    const sink = recorder();
    const writer = createChunkWriter(sink.write, 1000);
    const meta = { decoderConfig: { codec: "avc1.640028" } } as EncodedVideoChunkMetadata;
    writer.push(chunk(0), meta);
    writer.push(chunk(1000));
    writer.settle();
    expect(sink.writes[0].meta).toBe(meta);
    expect(sink.writes[1].meta).toBeUndefined();
  });

  it("starts the decode clock again for a second export", () => {
    const sink = recorder();
    const writer = createChunkWriter(sink.write, 1000);
    writer.push(chunk(0));
    writer.push(chunk(2000));
    writer.push(chunk(1000));
    writer.settle();
    writer.push(chunk(0));
    writer.push(chunk(1000));
    writer.settle();
    expect(sink.writes.map((entry) => entry.compositionOffset)).toEqual([0, 1000, -1000, 0, 0]);
  });

  it("refuses a duration that could not place a chunk", () => {
    for (const bad of [0, -1, Number.NaN]) {
      expect(() => createChunkWriter(() => {}, bad)).toThrow(RangeError);
    }
  });
});
