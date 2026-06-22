import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quantalyze — AI Research Platform for Indian Equity Investors",
  description:
    "Track management credibility, spot narrative shifts, and build conviction faster. Covers 200+ Indian equities with guidance scoring, evasiveness detection, and promoter pledge monitoring.",
  metadataBase: new URL("https://quantalyze.me"),
  openGraph: {
    title: "Quantalyze — AI Research Platform for Indian Equity Investors",
    description:
      "Track management credibility, spot narrative shifts, and build conviction faster across 200+ Indian equities.",
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
