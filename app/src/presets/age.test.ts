import { describe, expect, it } from "vitest";
import { createIntl } from "react-intl";
import { describeAge } from "./PresetsPanel";
import { MESSAGES, type Locale } from "../i18n/messages";
import type { Translate } from "../i18n";

/** A real `t`, so ICU plurals run and both languages are exercised. */
function tFor(locale: Locale): Translate {
  const intl = createIntl({ locale, defaultLocale: "en", messages: MESSAGES[locale] });
  return ((id: string, values?: Record<string, string | number>) =>
    String(intl.formatMessage({ id }, values))) as unknown as Translate;
}

const t = tFor("en");
const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("describeAge", () => {
  it("says just now under a minute", () => {
    expect(describeAge(NOW, t, NOW)).toBe("just now");
    expect(describeAge(NOW - MINUTE + 1, t, NOW)).toBe("just now");
  });

  it("counts minutes, hours and days", () => {
    expect(describeAge(NOW - 12 * MINUTE, t, NOW)).toBe("12 minutes ago");
    expect(describeAge(NOW - 3 * HOUR, t, NOW)).toBe("3 hours ago");
    expect(describeAge(NOW - 5 * DAY, t, NOW)).toBe("5 days ago");
    expect(describeAge(NOW - 1 * HOUR, t, NOW)).toBe("1 hour ago");
  });

  it("falls back to the catalogue for an unreadable stamp", () => {
    expect(describeAge(undefined, t)).toBe("Saved");
    expect(describeAge(Number.NaN, t)).toBe("Saved");
  });

  it("uses the plural rules of the language, not of English", () => {
    // French has one form for 0 and 1 and another beyond it.
    const fr = tFor("fr");
    expect(describeAge(NOW - MINUTE, fr, NOW)).toBe("il y a 1 minute");
    expect(describeAge(NOW - 12 * MINUTE, fr, NOW)).toBe("il y a 12 minutes");
    expect(describeAge(undefined, fr)).toBe("Enregistré");
  });

  it("never reports a negative age", () => {
    expect(describeAge(NOW + 5 * DAY, t, NOW)).toBe("just now");
  });
});
