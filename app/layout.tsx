import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Frontier Pulse",
  description: "Compare Claude, GPT-5.4, and Gemini side by side on what actually matters",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body style={{ fontFamily: "'DM Sans', sans-serif" }}>{children}</body>
    </html>
  );
}