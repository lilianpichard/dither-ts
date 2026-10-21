import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslate } from "../i18n";

/** Light/dark switch; the choice persists through the next-themes storage key. */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const t = useTranslate();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  const label = dark ? t("theme.toLight") : t("theme.toDark");
  return (
    <Button
      variant="outline"
      size="icon"
      aria-label={label}
      title={label}
      aria-pressed={dark}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
