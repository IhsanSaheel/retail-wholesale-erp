import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PWARegister } from "./pwa-register";

export const metadata: Metadata = {
  title: "Etihad Prime Supplies | General Trading & Wholesale",
  description: "Etihad Prime Supplies general trading and wholesale management system.",
  applicationName: "Etihad Prime Supplies",
  icons: { icon: "/icon.svg", shortcut: "/icon.svg", apple: "/icon.svg" },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Etihad Prime" },
};
export const viewport: Viewport = { themeColor: "#101d35", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><PWARegister />{children}</body></html>;
}
