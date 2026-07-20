import * as React from "react";
import { cn } from "@/lib/utils";

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<"button"> & {
  variant?: "default" | "primary" | "outline" | "ghost" | "link";
  size?: "default" | "sm" | "icon";
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:pointer-events-none disabled:opacity-50",
        {
          "bg-primary text-primary-foreground hover:bg-primary/90": variant === "primary",
          "border border-border bg-card hover:bg-muted": variant === "outline",
          "hover:bg-muted": variant === "ghost",
          "text-primary underline-offset-4 hover:underline": variant === "link",
          "bg-muted text-foreground hover:bg-muted/80": variant === "default",
        },
        {
          "h-9 px-4 py-2 text-sm": size === "default",
          "h-8 px-3 text-xs": size === "sm",
          "h-9 w-9": size === "icon",
        },
        className
      )}
      {...props}
    />
  );
}

export { Button };