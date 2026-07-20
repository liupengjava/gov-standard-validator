import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "政务服务标准验证智能体",
  description: "标准基础库、评价库、智能验证与专家复核工作台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className={inter.className + " bg-background text-foreground"}>{children}</body>
    </html>
  );
}

