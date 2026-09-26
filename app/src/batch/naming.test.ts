import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { OUTPUT_SUFFIX, outputName, uniqueOutputName } from "./naming";

// The desktop shell is the other half of this contract: it refuses names a
// filesystem would not take, and it only needs node:path, so the policy can be
// loaded here and checked against everything this module produces.
const { safeFileName } = createRequire(import.meta.url)("../../../electron/lib/paths.js") as {
  safeFileName(name: string): string;
};

describe("outputName", () => {
  it("swaps the extension for the dither suffix", () => {
    expect(outputName("photo.png")).toBe("photo.dither.png");
    expect(outputName("photo.JPG")).toBe("photo.dither.png");
    expect(outputName("a.b.c.png")).toBe("a.b.c.dither.png");
  });

  it("appends when there is no extension", () => {
    expect(outputName("photo")).toBe("photo.dither.png");
    expect(outputName("scan.tiff")).toBe("scan.dither.png");
  });

  it("treats a leading dot as part of the name, not an extension", () => {
    expect(outputName(".gitignore")).toBe(".gitignore.dither.png");
  });

  it("trims a trailing dot and trailing spaces", () => {
    expect(outputName("photo.")).toBe("photo.dither.png");
    expect(outputName("  photo.png  ")).toBe("photo.dither.png");
  });

  it("replaces characters a filesystem would reject", () => {
    expect(outputName('a<b>c:d"e/f\\g|h?i*j.png')).toBe("a_b_c_d_e_f_g_h_i_j.dither.png");
  });

  it("replaces control bytes, which the desktop shell refuses", () => {
    expect(outputName("a\u0000b.png")).toBe("a_b.dither.png");
    expect(outputName("a\u001fb\u007fc.png")).toBe("a_b_c.dither.png");
    expect(outputName("a\nb.png")).toBe("a_b.dither.png");
  });

  it("keeps a device name out of the way of the shell's reserved list", () => {
    // The shell refuses these outright, whatever follows the first dot.
    expect(outputName("con.png")).toBe("_con.dither.png");
    expect(outputName("CON.PNG")).toBe("_CON.dither.png");
    expect(outputName("con.tar.gz")).toBe("_con.tar.dither.png");
    expect(outputName("com9.log")).toBe("_com9.dither.png");
    expect(outputName("lpt1")).toBe("_lpt1.dither.png");
  });

  it("leaves names that merely start like a device name alone", () => {
    expect(outputName("console.png")).toBe("console.dither.png");
    expect(outputName("com10.png")).toBe("com10.dither.png");
    expect(outputName("com.png")).toBe("com.dither.png");
  });

  it("falls back to a usable name when nothing survives", () => {
    expect(outputName("")).toBe(`image${OUTPUT_SUFFIX}`);
    expect(outputName("...")).toBe(`image${OUTPUT_SUFFIX}`);
    expect(outputName("///.png")).toBe("___.dither.png");
  });
});

describe("uniqueOutputName", () => {
  it("passes the first use through untouched", () => {
    expect(uniqueOutputName("a.dither.png", new Set())).toBe("a.dither.png");
  });

  it("suffixes a collision and keeps the dither suffix last", () => {
    const used = new Set(["a.dither.png"]);
    expect(uniqueOutputName("a.dither.png", used)).toBe("a-2.dither.png");
    used.add("a-2.dither.png");
    expect(uniqueOutputName("a.dither.png", used)).toBe("a-3.dither.png");
  });

  it("keeps distinct sources apart when they share a stem", () => {
    // a.png, a.jpg and a.webp all want a.dither.png; none may overwrite another.
    const used = new Set<string>();
    const names = ["a.png", "a.jpg", "a.webp"].map((source) => {
      const name = uniqueOutputName(outputName(source), used);
      used.add(name);
      return name;
    });
    expect(names).toEqual(["a.dither.png", "a-2.dither.png", "a-3.dither.png"]);
  });

  it("escapes a device name it is handed directly, fallbacks included", () => {
    expect(uniqueOutputName("con.dither.png", new Set())).toBe("_con.dither.png");
    const used = new Set(["_con.dither.png"]);
    expect(uniqueOutputName("con.dither.png", used)).toBe("_con-2.dither.png");
  });

  it("keeps a very long stem inside what any filesystem accepts", () => {
    const name = outputName(`${"a".repeat(300)}.png`);
    expect(name.length).toBeLessThanOrEqual(255);
    expect(name.endsWith(OUTPUT_SUFFIX)).toBe(true);
  });
});

describe("names the desktop shell will accept", () => {
  /** Every shape a source name can arrive in, and a few deliberate oddities. */
  const SOURCES = [
    "photo.png",
    "photo",
    " photo.png ",
    "photo.",
    "...",
    "",
    ".",
    "..",
    ".con.png",
    "..con.png",
    "a/b.png",
    "a\\b.png",
    "a:b.png",
    "a*b.png",
    'a"b.png',
    "a<b>c.png",
    "a|b.png",
    "a?.png",
    "a\u0000b.png",
    "a\u001fb.png",
    "\u007f.png",
    "con.png",
    "CON.PNG",
    "con.tar.gz",
    "con.png.txt",
    "com9.log",
    "lpt1",
    "nul",
    "prn.png",
    "aux.jpeg",
    "auxiliary.png",
    "console.png",
    "com10.png",
    "com.png",
    "nullable.png",
    `${"a".repeat(300)}.png`,
    "emoji \u{1f3a8}.png",
  ];

  it("never hands the shell a name it refuses", () => {
    for (const source of SOURCES) {
      const name = outputName(source);
      expect(() => safeFileName(name), `shell refused ${JSON.stringify(name)}`).not.toThrow();
    }
  });

  it("keeps the collision fallbacks acceptable too", () => {
    const used = new Set<string>();
    for (const source of ["con.png", "photo.png", `${"b".repeat(300)}.png`]) {
      let name = outputName(source);
      for (let round = 0; round < 4; round++) {
        expect(() => safeFileName(name), `shell refused ${JSON.stringify(name)}`).not.toThrow();
        used.add(name);
        name = uniqueOutputName(outputName(source), used);
      }
    }
  });
});
