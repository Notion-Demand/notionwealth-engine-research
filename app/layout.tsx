import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quantalyze — Earnings Intelligence for Analysts",
  description:
    "AI-powered quarterly earnings transcript analysis for every Nifty 50 company. Compare management language shift, detect signals, and surface risks — in 60 seconds.",
  metadataBase: new URL("https://quantalyze.me"),
  openGraph: {
    title: "Quantalyze — Earnings Intelligence for Analysts",
    description:
      "AI-powered earnings transcript analysis for Nifty 50. Quarter-over-quarter language shift, evasiveness scoring, and Slack alerts.",
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
