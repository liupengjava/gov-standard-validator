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
        "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:pointer-events-none disabled:opacity-50",
        {
          "bg-linear-to-r from-[#168df3] to-[#0f73dc] text-primary-foreground shadow-[0_10px_22px_rgba(22,141,243,0.22)] hover:translate-y-[-1px] hover:shadow-[0_14px_28px_rgba(22,141,243,0.26)]": variant === "primary",
          "border border-[#cfe4f5] bg-white/85 text-[#075ec9] shadow-sm hover:bg-[#eef8ff]": variant === "outline",
          "text-[#49657e] hover:bg-[#e8f5ff] hover:text-[#075ec9]": variant === "ghost",
          "text-primary underline-offset-4 hover:underline": variant === "link",
          "bg-[#edf8ff] text-[#14304f] hover:bg-[#e1f2ff]": variant === "default",
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
