import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { availableLocales, useLocale, useTranslate } from "@/i18n";

/**
 * Language choice. A real select rather than a toggle, because it names the
 * language in the language itself: someone who cannot read the current one can
 * still find their own.
 */
export function LanguageSwitch() {
  const t = useTranslate();
  const { locale, setLocale } = useLocale();
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor="app-locale" className="sr-only">
        {t("language.pick")}
      </Label>
      <Select value={locale} onValueChange={(next) => setLocale(next as typeof locale)}>
        <SelectTrigger
          id="app-locale"
          aria-label={t("language.pick")}
          className="h-7 w-24 text-caption"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {availableLocales().map(({ locale: value, name }) => (
            <SelectItem key={value} value={value}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
