import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "참십 | 국민대학교 AI 대학생활 비서",
  description: "장학금, 채용, 취업 준비와 과제 마감을 한 곳에서 관리하세요.",
};

export const viewport: Viewport = {
  themeColor: "#004F9F",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
