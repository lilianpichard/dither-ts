import * as React from "react";
import { cn } from "cn";

/** 30px field on the raised surface, 8px corners, hairline border. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-7.5 w-full min-w-0 rounded-lg border border-border bg-raised px-2.5 py-1 text-body text-foreground transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-body file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
