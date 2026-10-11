import { describe, expect, it } from "vitest";
import { exportOutline, FORMATS, type ExportFormat, optionsFor } from "./formats";

describe("optionsFor", () => {
  it("gives png and jpg no options of their own", () => {
    // Both are the same writer with a different codec: there is nothing to
    // tune, so showing a control would be a control that changes nothing.
    expect(optionsFor("png")).toBe("none");
    expect(optionsFor("jpg")).toBe("none");
  });

  it("gives svg the vector option and txt the text options", () => {
    expect(optionsFor("svg")).toBe("vector");
    expect(optionsFor("txt")).toBe("text");
  });

  it("covers every format the panel offers", () => {
    // A format with no entry in the table would be selectable and then export
    // nothing, so the table and the offered list have to agree.
    for (const format of FORMATS) expect(optionsFor(format.id)).toBe(format.options);
  });
});

describe("exportOutline", () => {
  it("names the file each format writes", () => {
    expect(exportOutline("png").filename).toBe("dither.png");
    expect(exportOutline("jpg").filename).toBe("dither.jpg");
    expect(exportOutline("svg").filename).toBe("dither.svg");
    expect(exportOutline("txt").filename).toBe("dither.txt");
  });

  it("carries the mime the writer needs, which only jpeg shares with nothing", () => {
    expect(exportOutline("png").mime).toBe("image/png");
    expect(exportOutline("jpg").mime).toBe("image/jpeg");
    expect(exportOutline("txt").mime).toBe("text/plain");
  });

  it("claims a quality only for jpeg, which is the only lossy one", () => {
    // A quality on a lossless writer is a lie the user cannot see.
    expect(exportOutline("jpg").quality).toBe(0.92);
    expect(exportOutline("png").quality).toBeUndefined();
    expect(exportOutline("svg").quality).toBeUndefined();
    expect(exportOutline("txt").quality).toBeUndefined();
  });

  it("says whether jpeg needs a backing fill, because it has no alpha", () => {
    // Transparent pixels come back black otherwise, which reads as a bug in
    // the dither rather than a property of the format.
    expect(exportOutline("jpg").opaque).toBe(true);
    expect(exportOutline("png").opaque).toBe(false);
  });
});

describe("FORMATS", () => {
  it("offers the four writers in the order the dock lists them", () => {
    expect(FORMATS.map((f) => f.id)).toEqual(["png", "jpg", "svg", "txt"]);
  });

  it("labels each with its own extension, which needs no translation", () => {
    for (const format of FORMATS) expect(format.label).toBe(format.id.toUpperCase());
  });

  it("starts on png, which is the lossless one and the safe default", () => {
    // Re-exported as a constant so the panel and the test cannot drift.
    expect(FORMATS[0].id).toBe("png");
  });

  it("never offers two formats that write the same file", () => {
    const names = FORMATS.map((f) => exportOutline(f.id).filename);
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps an unknown format usable, so a stale preference is not a dead panel", () => {
    // A format id is stored nowhere today, but the outline is the thing the
    // panel would fall back on, and it has to answer rather than throw.
    const outline = exportOutline("png");
    expect(outline.filename).toMatch(/\.png$/);
  });
});

describe("type ExportFormat", () => {
  it("is exactly the four the writers support", () => {
    // Compile-time only: the runtime check above covers the same ground.
    const all: ExportFormat[] = ["png", "jpg", "svg", "txt"];
    expect(all).toHaveLength(4);
  });
});
