import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PWARegister } from "./pwa-register";

export const metadata: Metadata = {
  title: "Etihad Traders | Business Management",
  description: "Etihad Traders retail and wholesale business management system.",
  applicationName: "Etihad Traders",
  icons: { icon: "/icon.svg", shortcut: "/icon.svg", apple: "/icon.svg" },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Etihad" },
};
export const viewport: Viewport = { themeColor: "#101d35", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><PWARegister />{children}</body></html>;
}
