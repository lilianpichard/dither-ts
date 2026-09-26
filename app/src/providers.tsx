import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";

/** Client-only shell: the theme class lands on <html> before first paint. */
export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      enableColorScheme
      storageKey="dither-ts.theme"
    >
      {children}
    </ThemeProvider>
  );
}
