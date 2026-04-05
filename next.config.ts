import type { NextConfig } from "next";

const securityHeaders = [
  // Prevent the page from being embedded in an iframe on other origins (clickjacking)
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Stop browsers from MIME-sniffing away from the declared content-type
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Only send the origin as referrer when crossing from HTTPS to HTTPS
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Opt all pages into HTTPS for 1 year (Vercel already forces HTTPS, this adds belt-and-suspenders)
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // Prevent legacy browsers from loading Flash/Java plugins
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  // Disable DNS prefetching to reduce unintentional data leakage
  { key: "X-DNS-Prefetch-Control", value: "off" },
  // Permissions policy — lock down sensitive browser APIs this app doesn't need
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Apply to all routes
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
