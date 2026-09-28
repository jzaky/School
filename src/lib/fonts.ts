import { IBM_Plex_Sans_Arabic, Inter } from "next/font/google";

export const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
export const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-plex-arabic",
  display: "swap",
});
