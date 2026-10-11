import * as React from "react";
import { type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import { toggleVariants } from "./toggle";

/**
 * One choice out of a row, shown as a segmented control. The gap is what makes
 * it read as several buttons rather than one long bar: shadcn ships a tighter
 * spacing option for a joined control, and the two are different shapes.
 */
function ToggleGroup({
  className,
  variant = "default",
  size = "default",
  spacing = 2,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
  VariantProps<typeof toggleVariants> & { spacing?: number }) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      data-orientation={orientation}
      style={{ "--gap": spacing } as React.CSSProperties}
      className={cn(
        "group/toggle-group flex w-fit flex-row items-center rounded-lg",
        "data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch",
        "data-[spacing=0]:gap-0",
        className,
      )}
      {...props}
    />
  );
}

function ToggleGroupItem({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> & VariantProps<typeof toggleVariants>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        // A joined group has no gaps, so its own borders are the separators.
        "group-data-[spacing=0]/toggle-group:rounded-none",
        "group-data-[orientation=horizontal]/toggle-group:data-[spacing=0]:first:rounded-l-lg",
        "group-data-[orientation=horizontal]/toggle-group:data-[spacing=0]:last:rounded-r-lg",
        "group-data-[orientation=horizontal]/toggle-group:data-[spacing=0]:not-first:border-l-0",
        toggleVariants({ variant, size }),
        className,
      )}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
