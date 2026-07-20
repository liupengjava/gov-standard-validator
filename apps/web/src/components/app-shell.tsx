"use client";

import { useMemo, useState } from "react";
import { LayoutDashboard, Library, CheckCheck, DatabaseZap, FileText } from "lucide-react";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarMenuButton } from "@/components/ui/sidebar";
import { ViewContext, type AppView } from "@/components/view-context";
import { NAV_ITEMS, type NavIconName } from "@/lib/navigation";

const NAV_ICONS: Record<NavIconName, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard,
  Library,
  CheckCheck,
  DatabaseZap,
  FileText,
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const [activeView, setActiveView] = useState<AppView>("overview");

  const contextValue = useMemo(
    () => ({
      activeView,
      navigate: setActiveView,
    }),
    [activeView]
  );

  return (
    <ViewContext.Provider value={contextValue}>
      <div className="flex h-screen">
        <Sidebar>
          <SidebarHeader>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white font-bold">V</div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold leading-tight">标准验证智能体</div>
              <div className="text-[11px] text-muted-foreground">Gov Standard Validator</div>
            </div>
          </SidebarHeader>
          <SidebarContent>
            {NAV_ITEMS.map((item) => {
              const Icon = NAV_ICONS[item.icon];
              return (
                <SidebarMenuButton key={item.view} active={activeView === item.view} onClick={() => setActiveView(item.view as AppView)}>
                  <Icon className="h-[18px] w-[18px]" />
                  {item.title}
                </SidebarMenuButton>
              );
            })}
          </SidebarContent>
          <SidebarFooter>
            <div className="rounded-lg border border-sidebar-border bg-muted px-3 py-2 text-xs text-muted-foreground">
              VLM + 向量检索核心已接入
            </div>
          </SidebarFooter>
        </Sidebar>
        <main className="min-w-0 flex-1 overflow-auto bg-background p-4 lg:p-5">{children}</main>
      </div>
    </ViewContext.Provider>
  );
}

