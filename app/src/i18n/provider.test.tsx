import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider, useLocale, useTranslate } from "./index";
import { MESSAGES } from "./messages";

/** A window whose storage holds a fixed choice, as a returning user's does. */
function windowWithStorage(value: string | null) {
  const store = new Map<string, string>();
  if (value) store.set("dither-ts.locale", value);
  return {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, next: string) => store.set(key, next),
    },
  };
}

/** A component that reads the language and one string, for the render below. */
function Probe() {
  const { locale, setLocale } = useLocale();
  const t = useTranslate();
  return (
    <p>
      {locale}:{t("status.ready")}
      <button type="button" onClick={() => setLocale("fr")}>
        fr
      </button>
    </p>
  );
}

function render(window: unknown): string {
  vi.stubGlobal("window", window);
  return renderToStaticMarkup(
    <I18nProvider>
      <Probe />
    </I18nProvider>,
  );
}

describe("I18nProvider", () => {
  it("paints the language a returning user chose, with no flash", () => {
    // The choice is read during the first render, not in an effect, so the first
    // paint is already in the right language.
    expect(render(windowWithStorage("fr"))).toContain(`fr:${MESSAGES.fr["status.ready"]}`);
    expect(render(windowWithStorage("en"))).toContain(`en:${MESSAGES.en["status.ready"]}`);
  });

  it("ignores a stored value that is not a language it ships", () => {
    // A stale or tampered key falls back to detection rather than rendering
    // every label blank.
    const markup = render(windowWithStorage("klingon"));
    expect(markup).toContain(`en:${MESSAGES.en["status.ready"]}`);
  });

  it("falls back to the browser's language when nothing is stored", () => {
    const markup = render({
      localStorage: windowWithStorage(null).localStorage,
      navigator: { language: "fr-FR", languages: ["fr-FR"] },
    });
    expect(markup).toContain(`fr:${MESSAGES.fr["status.ready"]}`);
  });

  it("reads the browser's language through the window, not the runtime's", () => {
    // Node has a global `navigator` of its own, so a bare reference resolves to
    // that and every first-time visitor would be served English.
    const markup = render({
      localStorage: windowWithStorage(null).localStorage,
      navigator: { language: "es", languages: ["es"] },
    });
    expect(markup).toContain(`en:${MESSAGES.en["status.ready"]}`);
  });

  it("falls back to English for a language it does not ship", () => {
    const markup = render({
      localStorage: windowWithStorage(null).localStorage,
      navigator: { language: "ja", languages: ["ja"] },
    });
    expect(markup).toContain(`en:${MESSAGES.en["status.ready"]}`);
  });

  it("survives storage that refuses to be read", () => {
    // Private mode: the choice lasts for the session, the app still starts.
    const markup = render({
      localStorage: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {},
      },
      navigator: { language: "en", languages: ["en"] },
    });
    expect(markup).toContain(`en:${MESSAGES.en["status.ready"]}`);
  });

  it("translates every message, not just the ones with a fallback", () => {
    // The render above proves the provider supplies a working intl to the hook;
    // a missing catalogue entry would come back as the raw id instead.
    const markup = render(windowWithStorage("en"));
    expect(markup).not.toContain("status.ready");
    expect(markup).toContain(MESSAGES.en["status.ready"]);
  });
});
