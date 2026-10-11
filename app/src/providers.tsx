import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { I18nProvider } from "./i18n";

/** Client-only shell: the theme class lands on <html> before first paint. */
export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      enableColorScheme
      storageKey="dither-ts.theme"
    >
      <I18nProvider>{children}</I18nProvider>
    </ThemeProvider>
  );
}
