import * as React from "react";
import { cn } from "cn";

/**
 * A raised panel that holds one group of controls. The app draws these by hand
 * in several places; this is the same shape once, so a panel of settings looks
 * identical wherever it appears. The title is set in the charte's upper-case
 * label style, which is what the console headers already use.
 */
function Card({
  className,
  title,
  meta,
  actions,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  /** Resting label of the group. */
  title?: string;
  /** Right-hand annotation, such as a count or a size. */
  meta?: React.ReactNode;
  /** Trailing control, right of the meta. */
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section
      data-slot="card"
      className={cn(
        "flex min-h-0 flex-col gap-2.5 rounded-lg border border-border bg-raised p-2.5",
        className,
      )}
      {...props}
    >
      {title !== undefined && (
        <header className="flex items-center justify-between gap-2">
          <h3 className="text-label text-muted-foreground uppercase">{title}</h3>
          {(meta !== undefined || actions !== undefined) && (
            <span className="flex shrink-0 items-center gap-2">
              {meta !== undefined && (
                <span className="text-label text-muted-foreground">{meta}</span>
              )}
              {actions}
            </span>
          )}
        </header>
      )}
      {children}
    </section>
  );
}

export { Card };
