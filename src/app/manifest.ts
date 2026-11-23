import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "AgriSense – A Land That Can Talk",
    short_name: "AgriSense",
    description: "Farm monitoring, IoT sensors, weather & soil intelligence and crop-yield prediction for farmers.",
    start_url: "/dashboard?source=pwa",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "any",
    background_color: "#1f5130",
    theme_color: "#1f5130",
    categories: ["productivity", "utilities", "weather"],
    lang: "en",
    icons: [
      { src: "/icons/agrisense.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/agrisense.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Dashboard", url: "/dashboard", icons: [{ src: "/icons/agrisense.svg", sizes: "any" }] },
      { name: "New prediction", url: "/predictions", icons: [{ src: "/icons/agrisense.svg", sizes: "any" }] },
      { name: "Sensor monitoring", url: "/monitoring", icons: [{ src: "/icons/agrisense.svg", sizes: "any" }] },
    ],
  };
}
