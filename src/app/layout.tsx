import type { Metadata } from "next";
import { DM_Sans, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SEO_DESCRIPTION, SEO_KEYWORDS, SITE_URL } from "@/lib/seo";

const appSans = DM_Sans({ variable: "--font-app-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "InvoiceHub — Invoice & Billing Software", template: "%s · InvoiceHub" },
  description: SEO_DESCRIPTION,
  applicationName: "InvoiceHub",
  keywords: SEO_KEYWORDS,
  // App pages are private; only the public pages opt in to indexing (see page metadata + robots.ts)
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${appSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-canvas text-slate-900">{children}</body>
    </html>
  );
}
