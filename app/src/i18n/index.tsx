// Locale choice, kept the same way the theme is: read once, synchronously, so
// the first paint already has the right language and nothing needs an inline
// script the content security policy would have to allow by hash.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { IntlProvider, useIntl } from "react-intl";
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_NAMES,
  MESSAGES,
  type Locale,
  type MessageId,
} from "./messages";

const STORAGE_KEY = "dither-ts.locale";

/**
 * Argument contracts, so a message that takes no values rejects one and one
 * that needs `reason` insists on it.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace FormatjsIntl {
    interface MessageArguments extends Record<MessageId, Record<string, string | number>> {}
  }
}

function readStored(): Locale | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return LOCALES.includes(raw as Locale) ? (raw as Locale) : null;
  } catch {
    // Private mode or a full quota: fall back to the browser's language.
    return null;
  }
}

/**
 * The language the app opens in: the last one chosen, otherwise English.
 *
 * The browser's own language is deliberately not consulted. Guessing the
 * language from a request header is a guess, and a user who wanted French had to
 * undo the guess every fresh install; English is the one language every visitor
 * to this project reads. A saved choice always wins, so this only ever decides a
 * first launch.
 */
function initialLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  return readStored() ?? DEFAULT_LOCALE;
}

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<I18nValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
});

/** Keep the document language in step with the chosen locale. */
export function applyDocumentLocale(doc: Pick<Document, "documentElement">, locale: Locale): void {
  doc.documentElement.lang = locale;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  // Read during the first render, not in an effect: a language chosen earlier
  // has to be on screen from the first paint, or the app flickers.
  const [locale, setLocale] = useState<Locale>(initialLocale);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // The choice lasts for this session only, which beats throwing.
    }
    if (typeof document !== "undefined") applyDocumentLocale(document, locale);
  }, [locale]);

  const value = useMemo<I18nValue>(() => ({ locale, setLocale }), [locale]);

  return (
    <LocaleContext.Provider value={value}>
      <IntlProvider locale={locale} defaultLocale={DEFAULT_LOCALE} messages={MESSAGES[locale]}>
        {children}
      </IntlProvider>
    </LocaleContext.Provider>
  );
}

/** The current language and a way to change it. */
export function useLocale(): I18nValue {
  return useContext(LocaleContext);
}

/** The languages this build ships, each named in its own language. */
export function availableLocales(): Array<{ locale: Locale; name: string }> {
  return LOCALES.map((locale) => ({ locale, name: LOCALE_NAMES[locale] }));
}

/** `t` as a translation function: the id is a known key, values are primitives. */
export interface Translate {
  (id: MessageId): string;
  (id: MessageId, values: Record<string, string | number>): string;
}

export function useTranslate(): Translate {
  const intl = useIntl();
  return useCallback(
    // Values are the second positional argument, not a field of the descriptor:
    // `formatMessage({ id, values })` accepts it and then quietly ignores it,
    // so every {placeholder} renders verbatim.
    (id: MessageId, values?: Record<string, string | number>) =>
      String(values ? intl.formatMessage({ id }, values) : intl.formatMessage({ id })),
    [intl],
  ) as Translate;
}

/** Locale-aware number, date and relative time formatting. */
export function useFormat() {
  const intl = useIntl();
  return useMemo(
    () => ({
      number: (value: number, options?: Intl.NumberFormatOptions) =>
        intl.formatNumber(value, options),
      percent: (value: number) => intl.formatNumber(value / 100, { style: "percent" }),
      date: (value: Date | number, options?: Intl.DateTimeFormatOptions) =>
        intl.formatDate(value, options),
      time: (value: Date | number, options?: Intl.DateTimeFormatOptions) =>
        intl.formatTime(value, options),
      /** "3 minutes ago", in the chosen language. */
      ago: (seconds: number) => intl.formatRelativeTime(Math.round(seconds), "second"),
    }),
    [intl],
  );
}

export { useIntl };
export type { Locale, MessageId };
