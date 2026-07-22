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
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        {
          "border-[#d8e9f7] bg-muted text-muted-foreground": variant === "default",
          "border-[#b8eee4] bg-success-weak text-success": variant === "success",
          "border-[#ffe0a8] bg-warning-weak text-warning": variant === "warning",
          "border-[#fecaca] bg-danger-weak text-danger": variant === "danger",
          "border-[#bde6ff] bg-info-weak text-info": variant === "info",
        },
        className
      )}
      {...props}
    />
  );
}

export { Badge };
