import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { exportSVG, traceBinaryRuns, traceBlackVector, traceColorRuns } from "../src/vector.js";
import { DEFAULT_CHARSET, exportTXT } from "../src/ascii.js";

function rgbaRow(pixels: Array<[number, number, number]>, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = pixels[i][0];
    out[i * 4 + 1] = pixels[i][1];
    out[i * 4 + 2] = pixels[i][2];
    out[i * 4 + 3] = 255;
  }
  return out;
}

describe("binary run tracing", () => {
  it("merges a uniform field into one rect", () => {
    assert.deepEqual(traceBinaryRuns(new Uint8Array([0, 0, 0, 0]), 2, 2, 0), [
      { x: 0, y: 0, w: 2, h: 1 },
      { x: 0, y: 1, w: 2, h: 1 },
    ]);
  });

  it("splits alternating pixels into unit rects", () => {
    assert.deepEqual(traceBinaryRuns(new Uint8Array([0, 255, 0]), 3, 1, 0), [
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 2, y: 0, w: 1, h: 1 },
    ]);
  });

  it("ignores the background value", () => {
    assert.deepEqual(traceBinaryRuns(new Uint8Array([255, 255]), 2, 1, 0), []);
  });
});

describe("color run tracing", () => {
  it("groups runs by color key", () => {
    const rgba = rgbaRow(
      [
        [255, 0, 0],
        [255, 0, 0],
        [0, 0, 255],
      ],
      3,
      1,
    );
    const groups = traceColorRuns(rgba, 3, 1);
    assert.deepEqual(groups.get("255,0,0"), [{ x: 0, y: 0, w: 2, h: 1 }]);
    assert.deepEqual(groups.get("0,0,255"), [{ x: 2, y: 0, w: 1, h: 1 }]);
  });
});

describe("black vector tracing", () => {
  it("keeps dark pixels, drops bright ones", () => {
    const rgba = rgbaRow(
      [
        [0, 0, 0],
        [255, 255, 255],
      ],
      2,
      1,
    );
    assert.deepEqual(traceBlackVector(rgba, 2, 1), [{ x: 0, y: 0, w: 1, h: 1 }]);
  });
});

describe("SVG output", () => {
  it("emits viewBox and ink rects for B&W", () => {
    const rgba = rgbaRow(
      [
        [0, 0, 0],
        [255, 255, 255],
      ],
      2,
      1,
    );
    const svg = exportSVG(rgba, 2, 1);
    assert.ok(svg.includes('viewBox="0 0 2 1"'));
    assert.ok(svg.includes('<rect x="0" y="0" width="1" height="1"'));
    assert.ok(!svg.includes("#ffffff"));
  });

  it("emits per-color groups for color buffers", () => {
    const rgba = rgbaRow(
      [
        [255, 0, 0],
        [0, 0, 255],
      ],
      2,
      1,
    );
    const svg = exportSVG(rgba, 2, 1);
    assert.ok(svg.includes("#ff0000"));
    assert.ok(svg.includes("#0000ff"));
  });

  it("black mode traces a single ink", () => {
    const rgba = rgbaRow(
      [
        [10, 10, 10],
        [250, 250, 250],
      ],
      2,
      1,
    );
    const svg = exportSVG(rgba, 2, 1, { black: true });
    assert.ok(svg.includes('fill="#000"'));
    assert.ok(!svg.includes("#fafafa"));
  });

  it("validates SVG dimensions and RGBA buffers", () => {
    assert.throws(() => exportSVG(new Uint8ClampedArray(4), 0, 1));
    assert.throws(() => exportSVG(new Uint8ClampedArray(3), 1, 1));
    assert.throws(() => exportSVG(new Uint8Array(4) as unknown as Uint8ClampedArray, 1, 1));
  });

  it("does not emit transparent pixels", () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 0]);
    const svg = exportSVG(rgba, 1, 1);
    assert.ok(!svg.includes("#ff0000"));
    assert.ok(!svg.includes("<rect"));
  });

  it("preserves partial alpha in color and black SVG output", () => {
    const color = exportSVG(new Uint8ClampedArray([255, 0, 0, 128]), 1, 1);
    const colorOpacity = color.match(/fill-opacity="([^"]+)"/);
    assert.ok(colorOpacity);
    assert.ok(Math.abs(Number(colorOpacity[1]) - 128 / 255) < 1e-6);

    const black = exportSVG(new Uint8ClampedArray([0, 0, 0, 64]), 1, 1, { black: true });
    const blackOpacity = black.match(/fill-opacity="([^"]+)"/);
    assert.ok(blackOpacity);
    assert.ok(Math.abs(Number(blackOpacity[1]) - 64 / 255) < 1e-6);

    const white = exportSVG(new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 128]), 2, 1);
    assert.ok(white.includes("#ffffff"));
    assert.match(white, /fill-opacity="0\.5019607843137255"/);
  });

  it("escapes XML attributes and rejects unsafe colors", () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 255]);
    assert.throws(() => exportSVG(rgba, 1, 1, { ink: 'red" onload="alert(1)' }), /color/i);
    assert.throws(
      () => exportSVG(rgba, 1, 1, { background: "url(javascript:alert(1))" }),
      /color/i,
    );
    const escaped = exportSVG(rgba, 1, 1, { black: true, ink: "#000", background: "#fff" });
    assert.ok(escaped.includes('fill="#000"'));
  });
});

describe("TXT output", () => {
  it("maps black and white cells to ramp ends", () => {
    const out = exportTXT(new Uint8Array([0, 255, 255, 0]), 2, 2, { cell: 1 });
    const first = DEFAULT_CHARSET[0];
    const last = DEFAULT_CHARSET[DEFAULT_CHARSET.length - 1];
    assert.equal(out, `${first}${last}\n${last}${first}`);
  });

  it("honors grid dimensions with partial cells", () => {
    const out = exportTXT(new Uint8Array(25).fill(128), 5, 5, { cell: 2 });
    const rows = out.split("\n");
    assert.equal(rows.length, 3);
    assert.ok(rows.every((r) => r.length === 3));
  });

  it("invert flips the ramp", () => {
    const plain = exportTXT(new Uint8Array([0]), 1, 1, { cell: 1 });
    const inv = exportTXT(new Uint8Array([0]), 1, 1, { cell: 1, invert: true });
    assert.equal(plain, DEFAULT_CHARSET[0]);
    assert.equal(inv, DEFAULT_CHARSET[DEFAULT_CHARSET.length - 1]);
  });

  it("accepts custom charsets", () => {
    assert.equal(exportTXT(new Uint8Array([0]), 1, 1, { cell: 1, charset: "ab" }), "a");
    assert.equal(exportTXT(new Uint8Array([255]), 1, 1, { cell: 1, charset: "ab" }), "b");
  });

  it("indexes Unicode charsets by code point", () => {
    const out = exportTXT(new Uint8Array([0, 255]), 1, 2, { cell: 1, charset: "😀a" });
    assert.equal(out, "😀\na");
  });

  it("rejects malformed dimensions, buffers, cells, and charsets", () => {
    assert.throws(() => exportTXT(new Uint8Array(1), 0, 1), /width and height/i);
    assert.throws(() => exportTXT(new Uint8Array(1), 1, 1.5), /width and height/i);
    assert.throws(() => exportTXT(new Uint8Array(2), 1, 1), /buffer/i);
    assert.throws(() => exportTXT(new Uint8Array(4), 2, 2, { cell: 0 }), /cell/i);
    assert.throws(() => exportTXT(new Uint8Array(4), 2, 2, { cell: 1.5 }), /cell/i);
    assert.throws(() => exportTXT(new Uint8Array(4), 2, 2, { cell: Number.NaN }), /cell/i);
    assert.throws(() => exportTXT(new Uint8Array(4), 2, 2, { charset: "" }), /charset/i);
  });
});
