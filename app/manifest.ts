import type { MetadataRoute } from "next";

// handle_links / launch_handler: on Android, links to orbitonsol.com (e.g. "Open in ORBIT" in Telegram) open the installed app
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "ORBIT — Solana coin scanner",
    short_name: "ORBIT",
    description: "Find Solana coins worth a look: holders, chart, volume zones & narrative.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    handle_links: "preferred",
    launch_handler: { client_mode: ["navigate-existing", "auto"] },
  } as MetadataRoute.Manifest;
}
