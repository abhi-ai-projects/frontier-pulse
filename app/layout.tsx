import type { Metadata } from "next";
import "./globals.css";
import { PostHogProvider } from "./lib/posthog";

export const metadata: Metadata = {
  title: "Frontier Pulse",
  description: "Compare frontier AI models side by side",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Ensure page loads at 100% zoom on mobile — no horizontal overflow on initial load.
            maximum-scale=5 still allows the user to pinch-zoom in if they choose. */}
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&family=Figtree:wght@300;400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body>
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
