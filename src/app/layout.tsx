import type { Metadata } from "next";
import { Cormorant_Garamond, Great_Vibes, Nunito_Sans } from "next/font/google";
import "./globals.css";

const display = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700"],
});

const script = Great_Vibes({
  subsets: ["latin"],
  variable: "--font-script",
  weight: ["400"],
});

const body = Nunito_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "United in Joy Christmas 2026",
  description:
    "CCF Thailand — register for your QR ticket, join competitions, and vote for King & Queen of the Night. December 13, 2026.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${script.variable} ${body.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
