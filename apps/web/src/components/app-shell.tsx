"use client";

import { useMemo, useState } from "react";
import { CheckCheck, DatabaseZap, FileText, LayoutDashboard, Library, ShieldCheck } from "lucide-react";
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
  const [activeView, setActiveView] = useState<AppView>("check");

  const contextValue = useMemo(
    () => ({
      activeView,
      navigate: setActiveView,
    }),
    [activeView]
  );

  return (
    <ViewContext.Provider value={contextValue}>
      <div className="gov-app-bg flex h-screen gap-5 overflow-hidden">
        <Sidebar>
          <SidebarHeader>
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-linear-to-br from-[#1ca7ff] to-[#075ec9] text-base font-bold text-white shadow-[0_14px_28px_rgba(22,141,243,0.3)]">
              标
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold leading-tight text-[#14304f]">标准验证智能体</div>
              <div className="text-[11px] text-muted-foreground">Gov Standard Validator</div>
            </div>
          </SidebarHeader>
          <SidebarContent>
            {NAV_ITEMS.map((item) => {
              const Icon = NAV_ICONS[item.icon];
              return (
                <SidebarMenuButton key={item.view} active={activeView === item.view} onClick={() => setActiveView(item.view as AppView)}>
                  <Icon className="h-[18px] w-[18px]" />
                  <span className="truncate">{item.title}</span>
                </SidebarMenuButton>
              );
            })}
          </SidebarContent>
          <SidebarFooter>
            <div className="rounded-lg border border-sidebar-border bg-[#f6fcff] px-4 py-4 text-xs leading-6 text-muted-foreground">
              <div className="mb-1 text-[15px] font-semibold text-[#14304f]">今日验证任务</div>
              <div>标准切片、文本体检、证据匹配和报告生成合并成一个连续工作流。</div>
            </div>
          </SidebarFooter>
        </Sidebar>
        <main className="gov-scrollbar min-w-0 flex-1 overflow-auto py-6 pr-6">{children}</main>
      </div>
    </ViewContext.Provider>
  );
}
