import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quantalyze — Earnings Concall Analysis",
  description:
    "AI-powered earnings concall analysis for every Nifty 200 company. Track what management says quarter-over-quarter — language shifts, evasiveness, narrative changes — not the numbers.",
  metadataBase: new URL("https://quantalyze.me"),
  openGraph: {
    title: "Quantalyze — Earnings Concall Analysis",
    description:
      "AI-powered earnings concall analysis for Nifty 200. Quarter-over-quarter narrative shifts, evasiveness scoring, and management language intelligence.",
    url: "https://quantalyze.me",
    siteName: "Quantalyze",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
