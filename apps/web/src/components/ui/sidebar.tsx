"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const SIDEBAR_COOKIE_NAME = "sidebar:state";
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SIDEBAR_WIDTH = "16rem";
const SIDEBAR_WIDTH_MOBILE = "18rem";
const SIDEBAR_KEYBOARD_SHORTCUT = "b";

type SidebarContext = {
  state: "expanded" | "collapsed";
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContext | null>(null);

export function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) throw new Error("useSidebar must be used within a SidebarProvider");
  return context;
}

export function SidebarProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, _setOpen] = React.useState(true);
  const [openMobile, setOpenMobile] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const setOpen = React.useCallback(
    (value: boolean | ((v: boolean) => boolean)) => {
      _setOpen(value);
      document.cookie = `${SIDEBAR_COOKIE_NAME}=${_setOpen}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
    },
    []
  );

  const toggleSidebar = React.useCallback(() => {
    return isMobile ? setOpenMobile((o) => !o) : setOpen((o) => !o);
  }, [isMobile, setOpen, setOpenMobile]);

  const state = open ? "expanded" : "collapsed";

  return (
    <SidebarContext.Provider
      value={{ state, open, setOpen, openMobile, setOpenMobile, isMobile, toggleSidebar }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

export function Sidebar({
  className,
  children,
  ...props
}: React.ComponentProps<"aside">) {
  const { isMobile, openMobile, setOpenMobile, open } = useSidebar();

  if (isMobile) {
    return (
      <>
        {openMobile && (
          <div
            className="fixed inset-0 z-50 bg-black/60"
            onClick={() => setOpenMobile(false)}
          />
        )}
        <aside
          data-sidebar="sidebar"
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex w-[244px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-200",
            !openMobile && "-translate-x-full",
            className
          )}
          {...props}
        >
          {children}
        </aside>
      </>
    );
  }

  return (
    <aside
      data-sidebar="sidebar"
      className={cn(
        "flex w-[244px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar",
        className
      )}
      {...props}
    >
      {children}
    </aside>
  );
}

export function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex h-16 items-center gap-2.5 border-b border-sidebar-border px-5", className)}
      {...props}
    />
  );
}

export function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex-1 space-y-1 overflow-y-auto px-2.5 py-3 text-sm", className)} {...props} />
  );
}

export function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("border-t border-sidebar-border px-2.5 py-3 text-sm", className)} {...props} />
  );
}

export function SidebarMenuButton({
  className,
  active,
  children,
  ...props
}: React.ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 font-semibold text-sidebar-foreground hover:bg-muted",
        active && "bg-accent text-accent-foreground",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}