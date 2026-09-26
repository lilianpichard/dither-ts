import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";

/** 20px pill on an 8px radius, per the charte's "Pill / Switch" radius. */
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-lg border border-transparent px-2 whitespace-nowrap transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        /** The status pill: amber fill, 9px/500 label. */
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/85",
        secondary: "bg-raised text-foreground [a]:hover:bg-accent",
        outline: "border-border text-foreground [a]:hover:bg-accent",
        destructive: "bg-destructive text-white [a]:hover:bg-destructive/85",
        ghost: "text-muted-foreground [a]:hover:bg-accent",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), "text-label", className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
