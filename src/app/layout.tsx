import "~/styles/globals.css";

import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, JetBrains_Mono } from "next/font/google";

import { TRPCReactProvider } from "~/trpc/react";

export const metadata: Metadata = {
  title: "Troupe — open-source video studio",
  description: "A personal, self-hosted studio for AI video experiments. Bring your own API keys.",
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

// Dark is the primary theme (« régie avant le direct »); the stored choice
// wins, then prefers-color-scheme, then dark. Runs before paint — no flash.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("troupe-theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme="dark";}})();`;

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
