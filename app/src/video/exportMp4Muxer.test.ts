import { describe, expect, it } from "vitest";
import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { createChunkReorderer } from "./exportMp4";

const FRAME = 83_333; // one frame at 12 fps, in the muxer's microseconds

/** A minimal but well-formed chunk body, so the raw path accepts it. */
function body(): Uint8Array {
  return new Uint8Array(8);
}

describe("muxer ordering", () => {
  it("reproduces the reported failure when chunks arrive out of order", () => {
    // Driven through the muxer's own timestamp check, so the wording is the
    // real one and not a paraphrase.
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: "avc", width: 16, height: 16 },
      fastStart: "in-memory",
      firstTimestampBehavior: "offset",
    });
    muxer.addVideoChunkRaw(body(), "key", 2 * FRAME, FRAME);
    expect(() => muxer.addVideoChunkRaw(body(), "delta", 1 * FRAME, FRAME)).toThrow(
      /Timestamps must be monotonically increasing/,
    );
  });

  it("accepts the same chunks once they are reordered", () => {
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: "avc", width: 16, height: 16 },
      fastStart: "in-memory",
      firstTimestampBehavior: "offset",
    });
    // The raw entry point, because node has no EncodedVideoChunk to construct.
    // It reaches the same timestamp check that addVideoChunk does.
    const reorder = createChunkReorderer(
      (chunk) =>
        muxer.addVideoChunkRaw(
          body(),
          chunk.type === "key" ? "key" : "delta",
          chunk.timestamp,
          FRAME,
        ),
      FRAME,
    );
    const asChunk = (timestamp: number, type = "delta") =>
      ({ timestamp, type, byteLength: 0, copyTo: (into: Uint8Array) => into }) as never;
    // Decode order 0, 2, 1: the encoder's, not the timeline's.
    reorder.push(asChunk(0, "key"));
    reorder.push(asChunk(2 * FRAME));
    reorder.push(asChunk(FRAME));
    // Reaching this without a throw is the point: the muxer's own check is what
    // rejected the same sequence when it arrived in decode order.
    expect(() => reorder.settle()).not.toThrow();
  });
});
