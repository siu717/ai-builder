import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "참십 Campus | 대학생활 일정 비서",
  description: "장학금, 채용, 취업 준비와 과제 마감을 한 곳에서 관리하세요.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
