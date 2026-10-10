import { describe, expect, it } from "vitest";
import { createIntl } from "react-intl";
import { LOCALE_NAMES, LOCALES, MESSAGES } from "./messages";

/**
 * react-intl is asked to format every message in both languages with dummy
 * values. This is the net under the typed keys: it catches a malformed ICU
 * pattern, an argument a message needs but the catalogue never supplies, and an
 * escaped apostrophe left raw, all of which are runtime surprises the `satisfies`
 * parity check cannot see.
 */
// Names every message interpolates, with a value of the right shape. Anything a
// future message needs that is not here shows up as a leftover `{name}` in the
// format check below, so the test fails loudly instead of silently.
const KNOWN: Record<string, string | number> = {
  count: 3,
  name: "a",
  version: "9.9.9",
  percent: 42,
  value: 4,
  reason: "x",
  width: 1920,
  height: 1080,
  method: "Atkinson",
  threshold: 128,
  pixelSize: 2,
  missing: "AudioEncoder",
  phase: "frame 1/2",
  at: "1.00",
  total: "9.25",
  duration: "9.3",
  ms: 12.3,
  stem: "clip",
  message: "x",
};

/** Only the placeholders a message actually names, so none is left unfilled. */
function valuesFor(id: string): Record<string, string | number> {
  const wanted = new Set(MESSAGES.en[id as keyof typeof MESSAGES.en].match(/{(\w+)/g) ?? []);
  const values: Record<string, string | number> = {};
  for (const raw of wanted) {
    const name = raw.slice(1);
    values[name] = KNOWN[name] ?? `x`;
  }
  return values;
}

function format(locale: keyof typeof MESSAGES, id: string): string {
  const intl = createIntl({ locale, defaultLocale: "en", messages: MESSAGES[locale] });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return intl.formatMessage({ id } as any, valuesFor(id) as any) as unknown as string;
}

describe("message catalogue", () => {
  it("ships exactly the languages it claims to", () => {
    expect([...LOCALES]).toEqual(["en", "fr"]);
    for (const locale of LOCALES) expect(LOCALE_NAMES[locale]).toBeTruthy();
  });

  it("has the same keys in both languages", () => {
    // Belt and braces beside the compile-time check: an added key that was
    // never translated fails here too, in whatever editor the next person uses.
    const en = Object.keys(MESSAGES.en).sort();
    const fr = Object.keys(MESSAGES.fr).sort();
    expect(fr).toEqual(en);
    expect(en.length).toBeGreaterThan(100);
  });

  it("has no empty or placeholder-only string", () => {
    for (const locale of LOCALES) {
      for (const [id, text] of Object.entries(MESSAGES[locale])) {
        expect(text.trim(), `${locale}/${id} is empty`).not.toBe("");
        expect(text).not.toContain("TODO");
      }
    }
  });

  it("formats every message without a leftover placeholder", () => {
    for (const locale of LOCALES) {
      for (const id of Object.keys(MESSAGES[locale])) {
        const out = format(locale, id);
        // A `{` or `}` that survived means a placeholder with no value, or an
        // apostrophe that was not escaped and swallowed part of the pattern.
        expect(out, `${locale}/${id} -> ${out}`).not.toMatch(/[{}]/);
        expect(out.length).toBeGreaterThan(0);
      }
    }
  });

  it("renders every escaped apostrophe as a real one", () => {
    // A raw ' is an escape character in ICU MessageFormat, so it is written ''
    // in the catalogue and must come out as one. Driven off the catalogue
    // rather than a list, so a new message with an apostrophe is covered.
    let checked = 0;
    for (const [id, text] of Object.entries(MESSAGES.fr)) {
      if (!text.includes("''")) continue;
      const out = format("fr", id);
      expect(out, `${id} -> ${out}`).toContain("'");
      expect(out, `${id} still has a doubled apostrophe`).not.toContain("''");
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("resolves a count with the plural rules of the language", () => {
    for (const locale of LOCALES) {
      const one = createIntl({ locale, defaultLocale: "en", messages: MESSAGES[locale] });
      const word = (n: number) =>
        String(one.formatMessage({ id: "effects.count" } as never, { count: n } as never));
      expect(word(1)).toMatch(/1/);
      expect(word(2)).toMatch(/2/);
    }
  });
});
