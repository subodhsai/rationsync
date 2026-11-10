import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next, Noto_Sans_Kannada } from "next/font/google";
import { cn } from "@/lib/utils";
import "./globals.css";

const atkinson = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  variable: "--font-atkinson",
  adjustFontFallback: false,
  fallback: ["system-ui", "sans-serif"],
});
const atkinsonMono = Atkinson_Hyperlegible_Mono({
  subsets: ["latin"],
  variable: "--font-atkinson-mono",
  adjustFontFallback: false,
  fallback: ["ui-monospace", "monospace"],
});
const kannada = Noto_Sans_Kannada({ subsets: ["kannada"], variable: "--font-kannada" });

export const metadata: Metadata = {
  title: { default: "RationSync", template: "%s · RationSync" },
  description:
    "Educational prototype for tracking ration stock, shop approvals and collection appointments across Karnataka's Fair Price Shops.",
};

export const viewport: Viewport = { themeColor: "#215b45" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={cn(atkinson.variable, atkinsonMono.variable, kannada.variable)}>
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-card px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
