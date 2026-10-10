import { cn } from "cn";

export function ConsoleShell({
  title,
  meta,
  children,
  actions,
  className,
  bodyClassName,
}: {
  title: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
  /** Drag handle or any trailing control, right of the title. */
  actions?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-3 px-3 pt-2.5 pb-2">
        <h2 className="text-title text-card-foreground uppercase">{title}</h2>
        {/* The slot is omitted rather than left empty, so a header with neither
            meta nor actions carries no stray span at all. */}
        {meta !== undefined || actions !== undefined ? (
          <span className="flex shrink-0 items-center gap-2">
            {meta !== undefined && (
              <span className="shrink-0 text-label text-muted-foreground">{meta}</span>
            )}
            {actions}
          </span>
        ) : null}
      </header>
      <div aria-hidden className="mx-3 h-px shrink-0 bg-border" />
      <div className={cn("min-h-0 flex-1 overflow-y-auto px-3 py-2.5", bodyClassName)}>
        {children}
      </div>
    </section>
  );
}
