"use client";

import { createContext, useContext } from "react";

export type AppView = "overview" | "knowledge" | "check" | "signals" | "matching" | "report";

export type ViewContextType = {
  activeView: AppView;
  navigate: (view: AppView) => void;
};

export const ViewContext = createContext<ViewContextType>({
  activeView: "overview",
  navigate: () => {},
});

export function useView() {
  return useContext(ViewContext);
}

