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
            "fixed inset-y-0 left-0 z-50 flex w-[252px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar/95 backdrop-blur transition-transform duration-200",
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
        "my-6 ml-6 flex h-[calc(100vh-48px)] w-[228px] shrink-0 flex-col rounded-lg border border-sidebar-border bg-white/92 backdrop-blur shadow-[0_24px_70px_rgba(30,114,188,0.12)]",
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
      className={cn("flex h-[76px] items-center gap-3 border-b border-sidebar-border px-5", className)}
      {...props}
    />
  );
}

export function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex-1 space-y-1.5 overflow-y-auto px-3 py-4 text-sm", className)} {...props} />
  );
}

export function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("border-t border-sidebar-border px-3 py-4 text-sm", className)} {...props} />
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
        "flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left font-semibold text-sidebar-foreground transition-all hover:bg-[#eaf6ff] hover:text-[#075ec9]",
        active && "bg-linear-to-r from-[#e2f3ff] to-white text-accent-foreground shadow-[inset_3px_0_0_#168df3,0_8px_20px_rgba(22,141,243,0.08)]",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
