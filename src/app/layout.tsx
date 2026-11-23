import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ServiceWorkerRegister } from "@/components/pwa";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AgriSense – A Land That Can Talk", template: "%s · AgriSense" },
  description: "Agricultural intelligence PWA: farm management, IoT soil & climate monitoring, weather and soil data, crop-yield prediction and risk alerts.",
  applicationName: "AgriSense",
  appleWebApp: { capable: true, title: "AgriSense", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/agrisense.svg", apple: "/icons/agrisense.svg" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#1f5130",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-stone-50 text-stone-900 antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow">
          Skip to content
        </a>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
