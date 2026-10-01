import { Redo2, Undo2 } from "lucide-react";
import { useApp } from "../store";
import { ThemeToggle } from "./ThemeToggle";
import { UpdateCheck } from "./UpdateCheck";
import { Kbd } from "@/components/ui/kbd";
import { TOOL_COUNT } from "./ToolsPanel";
import logoDark from "dither-ts/assets/dither_logo_dark.webp";
import logoLight from "dither-ts/assets/dither_logo_light.webp";

/** "1 SOURCE / 640×480" once loaded, "NO SOURCE / 0 PX" before. */
function sourceState(name: string | null, width: number, height: number): string {
  if (!name) return "NO SOURCE / 0 PX";
  return `1 SOURCE / ${width}×${height}`;
}

/** 44px bar: wordmark left, source state centred, tools and history right. */
export function TopBar() {
  const source = useApp((s) => s.source);
  const undo = useApp((s) => s.undo);
  const redo = useApp((s) => s.redo);
  const canUndo = useApp((s) => s.past.length > 0);
  const canRedo = useApp((s) => s.future.length > 0);

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-card pr-3 pl-4">
      <img src={logoLight} alt="DitherTS_light" className="w-24 shrink-0 dark:hidden" />
      <img
        src={logoDark}
        alt="DitherTS_dark"
        aria-hidden
        className="hidden w-24 shrink-0 dark:block"
      />
      <p className="absolute left-1/2 -translate-x-1/2 text-caption whitespace-nowrap text-muted-foreground">
        {sourceState(source?.name ?? null, source?.width ?? 0, source?.height ?? 0)}
      </p>
      <div className="ml-auto flex items-center gap-2">
        <span className="hidden items-center gap-1 text-caption text-muted-foreground sm:flex">
          <Kbd>Alt</Kbd>
          <Kbd>1</Kbd>-<Kbd>{TOOL_COUNT}</Kbd> tools
        </span>
        <HistoryButton label="Undo" hint="Ctrl+Z" disabled={!canUndo} onClick={undo}>
          <Undo2 />
        </HistoryButton>
        <HistoryButton label="Redo" hint="Ctrl+Shift+Z" disabled={!canRedo} onClick={redo}>
          <Redo2 />
        </HistoryButton>
        <UpdateCheck />
        <ThemeToggle />
      </div>
    </header>
  );
}

function HistoryButton({
  label,
  hint,
  disabled,
  onClick,
  children,
}: {
  label: string;
  hint: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={`${label} (${hint})`}
      disabled={disabled}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3"
    >
      {children}
    </button>
  );
}
