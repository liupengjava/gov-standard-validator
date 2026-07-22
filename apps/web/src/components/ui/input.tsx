import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "gov-input flex h-9 w-full rounded-lg px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

export { Input };
