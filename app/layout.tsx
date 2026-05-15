import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
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
  title: {
    default: "Sticker Punch",
    template: "%s · Sticker Punch",
  },
  description:
    "Punch subjects out of notebook photos with jelly-soft selection. Drop, punch, leave.",
  applicationName: "Sticker Punch",
  openGraph: {
    title: "Sticker Punch",
    description:
      "Punch subjects out of notebook photos with jelly-soft selection.",
    type: "website",
  },
  robots: { index: true, follow: true },
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
      <body className="min-h-full flex flex-col bg-neutral-50 text-neutral-900">
        <header className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 bg-white">
          <Link
            href="/"
            className="flex items-center gap-2 font-semibold tracking-tight"
          >
            <span
              aria-hidden
              className="inline-block h-6 w-6 rounded-full bg-gradient-to-br from-pink-400 to-amber-300 ring-2 ring-white shadow-sm"
            />
            Sticker Punch
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link
              href="/"
              className="hover:text-neutral-600 transition-colors"
            >
              Home
            </Link>
            <Link
              href="/punch"
              className="rounded-full bg-neutral-900 px-3 py-1.5 text-white hover:bg-neutral-700 transition-colors"
            >
              Punch
            </Link>
          </nav>
        </header>
        <main className="flex-1 flex flex-col">{children}</main>
      </body>
    </html>
  );
}
