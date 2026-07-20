export type NavIconName = "LayoutDashboard" | "Library" | "CheckCheck" | "DatabaseZap" | "FileText";

export const NAV_ITEMS = [
  { view: "overview", title: "总览驾驶舱", icon: "LayoutDashboard" },
  { view: "knowledge", title: "标准知识库", icon: "Library" },
  { view: "signals", title: "舆情与调研", icon: "DatabaseZap" },
  { view: "check", title: "文本验证", icon: "CheckCheck" },
  { view: "report", title: "报告输出", icon: "FileText" },
] as const satisfies readonly { view: string; title: string; icon: NavIconName }[];
