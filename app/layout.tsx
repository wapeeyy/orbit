import type { Metadata, Viewport } from "next";
import "./globals.css";
import Pwa from "./Pwa";
import { Starfield } from "./Cosmos";

export const metadata: Metadata = {
  title: "ORBIT — Solana coin scanner",
  description: "Find Solana coins worth a look: price, liquidity, holders, chart, volume zones & narrative.",
  applicationName: "ORBIT",
  appleWebApp: { capable: true, title: "ORBIT", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon-192.png", apple: "/apple-icon.png" },
  formatDetection: { telephone: false },
  metadataBase: new URL("https://www.orbitonsol.com"),
  openGraph: {
    title: "ORBIT — Solana coin intelligence",
    description: "New pairs · risk score · wallet tracing · demo trading",
    url: "https://www.orbitonsol.com",
    siteName: "ORBIT",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "ORBIT — Solana coin intelligence" }],
    type: "website",
  },
  twitter: { card: "summary_large_image", title: "ORBIT — Solana coin intelligence", description: "New pairs · risk score · wallet tracing · demo trading", images: ["/og.png"] },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Barlow:wght@300;400;500;600&family=Barlow+Condensed:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>
        <Starfield />
        {children}
        <Pwa />
      </body>
    </html>
  );
}
