"use client";

import { useMemo, useState } from "react";
import { LayoutDashboard, Library, CheckCheck, DatabaseZap, GitCompareArrows, FileText } from "lucide-react";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarMenuButton } from "@/components/ui/sidebar";
import { ViewContext, type AppView } from "@/components/view-context";

const NAV_ITEMS: { view: AppView; title: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { view: "overview", title: "总览驾驶舱", icon: LayoutDashboard },
  { view: "knowledge", title: "标准知识库", icon: Library },
  { view: "check", title: "文本校验", icon: CheckCheck },
  { view: "signals", title: "舆情与调研", icon: DatabaseZap },
  { view: "matching", title: "比对验证", icon: GitCompareArrows },
  { view: "report", title: "报告输出", icon: FileText },
];

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
              const Icon = item.icon;
              return (
                <SidebarMenuButton key={item.view} active={activeView === item.view} onClick={() => setActiveView(item.view)}>
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

