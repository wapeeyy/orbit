import type { Metadata, Viewport } from "next";
import "./globals.css";
import Pwa from "./Pwa";

export const metadata: Metadata = {
  title: "ORBIT — Solana coin scanner",
  description: "Find Solana coins worth a look: price, liquidity, holders, chart, volume zones & narrative.",
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
    <html lang="en">
      <body>
        {children}
        <Pwa />
      </body>
    </html>
  );
}
