import * as React from "react";
import { cn } from "@/lib/utils";

function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  variant?: "default" | "success" | "warning" | "danger" | "info";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        {
          "bg-muted text-muted-foreground": variant === "default",
          "bg-success-weak text-success": variant === "success",
          "bg-warning-weak text-warning": variant === "warning",
          "bg-danger-weak text-danger": variant === "danger",
          "bg-info-weak text-info": variant === "info",
        },
        className
      )}
      {...props}
    />
  );
}

export { Badge };