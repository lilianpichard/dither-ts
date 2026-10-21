import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Toggle as TogglePrimitive } from "radix-ui";

// Sized to the app's control heights rather than shadcn's defaults: a toggle
// next to a button has to match it, or the row reads as two different rows.
const toggleVariants = cva(
  "group/toggle inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-transparent whitespace-nowrap outline-none select-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3",
  {
    variants: {
      variant: {
        /** Raised surface, the resting state of a segmented item. */
        default: "bg-raised text-foreground hover:bg-accent",
        /** No surface: a bar of buttons that already sits on a card. */
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
        outline: "border-border bg-transparent text-foreground hover:bg-accent",
      },
      size: {
        default: "h-7.5 px-2.5 text-button",
        sm: "h-6 px-2 text-button",
        lg: "h-8.5 px-3 text-button",
        icon: "size-7.5",
        "icon-sm": "size-6",
        "icon-lg": "size-8.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

/**
 * A press that stays pressed, unlike a button that fires and returns. The on
 * state is the amber the whole interface reserves for "this one is live", which
 * is the same reason the dock's active tab uses it.
 */
function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(
        toggleVariants({ variant, size }),
        "aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/85",
        className,
      )}
      {...props}
    />
  );
}

export { Toggle, toggleVariants };
