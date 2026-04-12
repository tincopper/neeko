import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../utils/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-md font-medium cursor-pointer transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        primary:   "bg-accent-blue text-white hover:bg-[#4d9fd6]",
        secondary: "bg-bg-tertiary border border-border text-text-primary hover:bg-bg-hover",
        ghost:     "text-text-primary hover:bg-bg-hover",
        danger:    "bg-accent-red text-white hover:bg-[#be4f58]",
      },
      size: {
        sm:      "px-3 py-1.5 text-[13px]",
        default: "px-4 py-2 text-[var(--font-size)]",
        icon:    "w-7 h-7 p-0",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "default",
    },
  }
);

interface ButtonProps
  extends React.ComponentProps<"button">,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
