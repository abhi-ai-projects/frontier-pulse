import type { Metadata } from "next";

// Block search engines — the page is key-protected but noindex is belt-and-suspenders.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
