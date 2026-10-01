import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center hover:cursor-pointer rounded-lg border border-transparent bg-clip-padding whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-40 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3",
  {
    variants: {
      variant: {
        /** Amber fill: the one committed action in a row. */
        default: "bg-primary text-primary-foreground hover:bg-primary/85",
        /** Raised surface with a hairline border: every other control. */
        outline: "border-border bg-raised text-foreground hover:bg-accent",
        /** Raised surface, no border: dense rows that already sit on a card. */
        secondary: "bg-raised text-foreground hover:bg-accent",
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
        /** The active state of a segmented group or the dock. */
        accent: "bg-primary text-primary-foreground hover:bg-primary/85",
        destructive: "bg-destructive text-white hover:bg-destructive/85",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        /** 30px: the console action row. */
        default: "h-7.5 gap-1.5 px-2.5 text-button",
        xs: "h-6 gap-1 px-1.5 text-caption",
        /** 32px: icon buttons in card action rows. */
        sm: "h-8 gap-1.5 px-2.5 text-button",
        /** 34px: the dock tabs. */
        lg: "h-8.5 gap-1.5 px-3 text-button",
        /** 42px: the canvas call to action. */
        xl: "h-10.5 gap-2 px-5 text-body-lg font-bold tracking-[0.04em]",
        icon: "size-8",
        "icon-xs": "size-6",
        "icon-sm": "size-7",
        /** 36x32: the preset card action buttons. */
        "icon-action": "size-8 rounded-lg",
        "icon-lg": "size-10.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
