import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "비플페이 식당 지도",
  description: "구획 이름을 입력하면 식당을 지도에 표시하고, 비플페이 가능 여부를 함께 기록합니다.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
