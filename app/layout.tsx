import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quantalyze — AI Research Platform for Indian Equity Investors",
  description:
    "Track management credibility, spot narrative shifts, and build conviction faster. Covers 200+ Indian equities with guidance scoring, evasiveness detection, and promoter pledge monitoring.",
  metadataBase: new URL("https://quantalyze.me"),
  authors: [{ name: "Demandion", url: "https://demandion.ai" }],
  creator: "Demandion",
  publisher: "Demandion",
  openGraph: {
    title: "Quantalyze — AI Research Platform for Indian Equity Investors",
    description:
      "Track management credibility, spot narrative shifts, and build conviction faster across 200+ Indian equities.",
    url: "https://quantalyze.me",
    siteName: "Quantalyze",
    type: "article",
    locale: "en_IN",
    publishedTime: "2026-06-21T00:00:00.000Z",
    authors: ["Demandion"],
    images: [
      {
        url: "/api/og",
        width: 1200,
        height: 630,
        alt: "Quantalyze — AI Research Platform for Indian Equity Investors",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Quantalyze — AI Research Platform for Indian Equity Investors",
    description: "Track management credibility, spot narrative shifts, and build conviction faster across 200+ Indian equities.",
    images: ["/api/og"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta property="article:author" content="Demandion" />
        <meta property="article:publisher" content="https://demandion.ai" />
      </head>
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
