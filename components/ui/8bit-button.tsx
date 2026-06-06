import * as React from "react";
import { cn } from "@/lib/utils";

export interface BitButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "ghost";
}

const Button = React.forwardRef<HTMLButtonElement, BitButtonProps>(
  ({ className, variant = "default", children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          // Base pixel-art button styles
          "retro relative inline-flex cursor-pointer items-center justify-center px-5 py-2",
          "text-sm font-bold uppercase tracking-widest",
          "border-2 border-foreground",
          "transition-transform active:translate-y-px",
          // Pixel shadow via box-shadow
          "shadow-[4px_4px_0px_0px] shadow-foreground",
          "hover:shadow-[2px_2px_0px_0px] hover:translate-x-[2px] hover:translate-y-[2px]",
          "disabled:pointer-events-none disabled:opacity-50",
          variant === "default" && "bg-primary text-primary-foreground",
          variant === "destructive" && "bg-destructive text-destructive-foreground",
          variant === "outline" && "bg-background text-foreground",
          variant === "ghost" && "border-transparent shadow-none bg-transparent hover:bg-accent hover:text-accent-foreground",
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);
Button.displayName = "BitButton";

export { Button };
