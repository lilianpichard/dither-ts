import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
});
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider, useTranslate } from "./index";
import { MESSAGES, type Locale, type MessageId } from "./messages";

/**
 * This test renders a component that calls useTranslate, the app's own hook. An
 * earlier suite re-implemented the formatter and proved nothing: it passed while
 * every placeholder in the app rendered verbatim, because it called the library
 * correctly and the app did not.
 */
function Probe({ id, values }: { id: MessageId; values?: Record<string, string | number> }) {
  const t = useTranslate();
  return <span>{t(id, values as Record<string, string | number>)}</span>;
}

function render(locale: Locale, id: MessageId, values?: Record<string, string | number>): string {
  // The provider picks its language from storage or the browser, so the locale
  // under test is put in storage rather than assumed.
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => (key === "dither-ts.locale" ? locale : null),
      setItem: () => {},
    },
  });
  return renderToStaticMarkup(
    <I18nProvider>
      <Probe id={id} values={values} />
    </I18nProvider>,
  ).replace(/^<span>|\s*<\/span>$/g, "");
}

/**
 * Placeholder names a message names, ignoring the ICU syntax itself. `{name}`
 * is an interpolation, `{n, plural, one {..} other {..}}` selects on `n` and
 * its inner `#` is the number again, and a quoted `''` is a literal apostrophe.
 */
function placeholdersIn(pattern: string): string[] {
  const names = new Set<string>();
  // An argument reference is `{`, an optional `, number, ...` skeleton, then a
  // space and the rest up to the matching brace at depth zero.
  const stack: string[] = [];
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] !== "{") continue;
    let depth = 1;
    let j = i + 1;
    while (j < pattern.length && depth > 0) {
      if (pattern[j] === "{") depth++;
      else if (pattern[j] === "}") depth--;
      if (depth === 0) break;
      j++;
    }
    const body = pattern.slice(i + 1, j).trim();
    const head = body.split(",")[0].trim();
    if (/^\w+$/.test(head) || body.startsWith("#")) names.add(head === "#" ? "" : head);
    else if (body.startsWith("#") || head === "") names.add(head);
    else names.add(head);
    i = j;
    stack.length = 0;
  }
  return [...names].filter(Boolean);
}

/** Values for every placeholder a message names, derived from the message. */
const KNOWN: Record<string, string | number> = {
  count: 3,
  name: "Vaporwave CRT",
  version: "9.9.9",
  percent: 42,
  value: 7,
  reason: "boiler",
  width: 3840,
  height: 2160,
  method: "Atkinson",
  threshold: 128,
  pixelSize: 4,
  missing: "AudioEncoder",
  phase: "frame 1/2",
  at: 1.5,
  total: 9.25,
  duration: 9.3,
  ms: 12.34,
  target: "Downloads",
  stem: "clip",
  message: "offline",
  file: "dither.png",
  start: "1.5",
  end: "8.0",
};

function valuesFor(id: MessageId): Record<string, string | number> {
  const values: Record<string, string | number> = {};
  for (const key of placeholdersIn(MESSAGES.en[id])) {
    if (!(key in KNOWN)) throw new Error(`no known value for placeholder {${key}} of ${id}`);
    values[key] = KNOWN[key];
  }
  return values;
}

const LOCALES: Locale[] = ["en", "fr"];

describe("useTranslate renders every message", () => {
  it("fills in every placeholder in both languages", () => {
    for (const locale of LOCALES) {
      for (const id of Object.keys(MESSAGES[locale]) as MessageId[]) {
        const out = render(locale, id, valuesFor(id));
        // The bug this locks shut: a placeholder left raw, or a number that never
        // reached the formatter, both leave braces or a skeleton in the output.
        expect(out, `${locale}/${id}`).not.toMatch(/[{}]/);
        expect(out.length).toBeGreaterThan(0);
      }
    }
  });

  it("interpolates the value, not just the surrounding words", () => {
    // A regression here would render "Taille de pixel " with the number gone.
    expect(render("en", "rail.pixelSize", { value: 7 })).toBe("Pixel size 7");
    expect(render("fr", "rail.pixelSize", { value: 7 })).toBe("Taille de pixel 7");
    expect(render("en", "topbar.source", { count: 1, width: 3840, height: 2160 })).toBe(
      "1 SOURCE / 3840×2160",
    );
  });

  it("formats a number with the language's own digits", () => {
    // French uses a comma; this is the whole reason for ICU number skeletons.
    expect(render("fr", "status.done", { ms: 12.34 })).toContain("12,3");
    expect(render("en", "status.done", { ms: 12.34 })).toContain("12.3");
  });

  it("keeps a pixel count free of grouping separators in both languages", () => {
    expect(render("fr", "status.caption", valuesFor("status.caption"))).toContain("3840×2160");
    expect(render("fr", "status.caption", valuesFor("status.caption"))).not.toContain("3 840");
  });

  it("uses each language's plural rules", () => {
    // French has one form for 0 and 1 and another beyond it.
    expect(render("fr", "presets.agoDays", { count: 1 })).toBe("il y a 1 jour");
    expect(render("fr", "presets.agoDays", { count: 5 })).toBe("il y a 5 jours");
    expect(render("en", "presets.agoDays", { count: 1 })).toBe("1 day ago");
    expect(render("en", "presets.agoDays", { count: 5 })).toBe("5 days ago");
  });

  it("reads the French labels a user reported as English", () => {
    expect(render("fr", "tool.effects")).toBe("Effets");
    expect(render("fr", "tool.video")).toBe("Vidéo");
    expect(render("fr", "presets.saveCurrent")).toBe("Enregistrer les réglages");
    expect(render("fr", "palette.use")).toBe("Utiliser la palette");
  });

  it("has a value for every placeholder it declares", () => {
    for (const locale of LOCALES) {
      for (const id of Object.keys(MESSAGES[locale]) as MessageId[]) {
        expect(() => valuesFor(id), `${locale}/${id}`).not.toThrow();
      }
    }
  });
});
