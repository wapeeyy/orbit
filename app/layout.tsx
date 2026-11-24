import type { Metadata, Viewport } from "next";
import "./globals.css";
import Pwa from "./Pwa";

export const metadata: Metadata = {
  title: "ORBIT — Solana coin scanner",
  description: "Cari coin Solana yang okey: harga, liquidity, holder, chart, zon volume & naratif.",
  applicationName: "ORBIT",
  appleWebApp: { capable: true, title: "ORBIT", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon-192.png", apple: "/apple-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#07080d",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ms">
      <body>
        {children}
        <Pwa />
      </body>
    </html>
  );
}
