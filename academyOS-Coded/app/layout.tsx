import type { Metadata } from "next";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import ConvexClientProvider from "./ConvexClientProvider";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:4321";
const TITLE = "AcademyOS — Digital Operations for Tuition Academies";
const DESCRIPTION = "Fee vouchers, attendance, marks, AI progress remarks and a parent portal — one platform that replaces the paper register.";

// §13: OG/meta tags. The preview image itself is rendered by
// app/opengraph-image.tsx, which Next wires into og:image automatically.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "AcademyOS",
  keywords: ["tuition academy software", "fee management", "attendance", "parent portal", "Pakistan", "coaching center"],
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "AcademyOS",
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_PK",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ConvexAuthNextjsServerProvider>
      <html lang="en">
        <head>
          <link
            rel="stylesheet"
            href="https://api.fontshare.com/v2/css?f[]=satoshi@300,400,500,700,900&display=swap"
          />
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link
            rel="preconnect"
            href="https://fonts.gstatic.com"
            crossOrigin=""
          />
          <link
            rel="stylesheet"
            href="https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;600&display=swap"
          />
        </head>
        <body>
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
