import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "veradis PCS / Appraise Co-Pilot",
  description:
    "The fulfilment engine behind verify.veradis.ai — order in, provisional report, curator confirmation, definitive out.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Dark brand bar — Obsidian, matching the marketing site's dark nav. */}
        <header style={{ background: "#1A1714", padding: "14px 24px" }}>
          <a href="/" style={{ display: "inline-flex", alignItems: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/veradis-wordmark.svg" alt="veradis" height={32} style={{ height: 32, width: "auto" }} />
          </a>
        </header>
        {children}
      </body>
    </html>
  );
}
