import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { proportionalPixelSize } from "../src/pipeline.js";

describe("proportionalPixelSize", () => {
  it("is the identity at the source's own size", () => {
    // Nothing to correct: the frame is the one the number was typed against.
    for (const pixelSize of [1, 2, 3, 8]) {
      assert.equal(proportionalPixelSize(pixelSize, 2048, 2048), pixelSize);
    }
  });

  it("shrinks the block as the frame shrinks", () => {
    // The reported case: a 2048x1080 clip previewed at 1080x570. Without the
    // scaling both take a block of 2, so the export's blocks cover half the
    // share of the frame the preview showed.
    assert.equal(proportionalPixelSize(2, 1080, 2048), 1);
    assert.equal(proportionalPixelSize(4, 1080, 2048), 2);
    assert.equal(proportionalPixelSize(2, 720, 2048), 1);
  });

  it("keeps the block's share of the frame within a pixel", () => {
    // The factor must be whole, so the share can only be approximated. What is
    // checked is that the approximation is close at every size it is used at.
    for (const source of [1920, 2048, 3840]) {
      for (const work of [720, 1080, 1920, 3840]) {
        for (const pixelSize of [1, 2, 3, 5, 8, 16]) {
          const scaled = proportionalPixelSize(pixelSize, work, source);
          const intended = source / pixelSize;
          const rendered = work / scaled;
          const drift = Math.abs(rendered - intended) / intended;
          // One pixel of rounding on a block of `scaled` pixels.
          assert.ok(
            drift <= 1 / scaled + 0.5 / intended,
            `source=${source} work=${work} pixelSize=${pixelSize} drift=${drift}`,
          );
        }
      }
    }
  });

  it("never returns less than one block", () => {
    // A 4K source previewed at 720 with a small block would round to zero,
    // which is not a size at all.
    assert.equal(proportionalPixelSize(1, 720, 3840), 1);
    assert.equal(proportionalPixelSize(2, 720, 3840), 1);
  });

  it("grows the block when the frame is larger than the source", () => {
    // The export path is not capped, but a caller that upsamples still needs
    // the block to keep its share.
    assert.equal(proportionalPixelSize(2, 4096, 2048), 4);
  });

  it("refuses what is not a size or an edge", () => {
    for (const bad of [0, -2, 1.5, Number.NaN]) {
      assert.throws(() => proportionalPixelSize(bad, 1080, 2048), TypeError);
      assert.throws(() => proportionalPixelSize(2, bad, 2048), TypeError);
      assert.throws(() => proportionalPixelSize(2, 1080, bad), TypeError);
    }
  });
});
