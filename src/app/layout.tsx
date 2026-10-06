import "~/styles/globals.css";

import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, JetBrains_Mono } from "next/font/google";

import { TRPCReactProvider } from "~/trpc/react";
import { THEME_SCRIPT } from "./theme-script";

// The same name and description as the browser edition's (site/app/index.html).
export const metadata: Metadata = {
  title: { default: "Troupe", template: "%s · Troupe" },
  description: "Troupe, your own video studio: write a short script, cast an actor and render an MP4 with your own models. Open source, no account.",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jbmono",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${geist.variable} ${bricolage.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant script that applies the saved theme before paint */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <TRPCReactProvider>{children}</TRPCReactProvider>
      </body>
    </html>
  );
}
