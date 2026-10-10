import { useTranslate } from "../i18n";
import { useLayout, type ConsoleSide, type RailSide } from "../layout";

const RAIL_SIDES: Array<{ id: RailSide; label: "layout.railLeft" | "layout.railRight" }> = [
  { id: "left", label: "layout.railLeft" },
  { id: "right", label: "layout.railRight" },
];

const CONSOLE_SIDES: Array<{
  id: ConsoleSide;
  label: "layout.consoleBottom" | "layout.consoleRight";
}> = [
  { id: "bottom", label: "layout.consoleBottom" },
  { id: "right", label: "layout.consoleRight" },
];

/**
 * Where each panel sits. A select per panel, because they move independently:
 * the rail on its own side and the console on its own, and a layout someone
 * likes should survive a reload.
 */
export function LayoutControls() {
  const { layout, update } = useLayout();
  const t = useTranslate();

  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-1 text-caption text-muted-foreground">
        <span className="sr-only">{t("layout.rail")}</span>
        <select
          className="h-7 rounded-lg border border-border bg-card px-1 text-caption"
          aria-label={t("layout.rail")}
          value={layout.railSide}
          onChange={(e) => update({ railSide: e.target.value as RailSide })}
        >
          {RAIL_SIDES.map((option) => (
            <option key={option.id} value={option.id}>
              {t(option.label)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1 text-caption text-muted-foreground">
        <span className="sr-only">{t("layout.console")}</span>
        <select
          className="h-7 rounded-lg border border-border bg-card px-1 text-caption"
          aria-label={t("layout.console")}
          value={layout.consoleSide}
          onChange={(e) => update({ consoleSide: e.target.value as ConsoleSide })}
        >
          {CONSOLE_SIDES.map((option) => (
            <option key={option.id} value={option.id}>
              {t(option.label)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
