import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DAJAJ POS System",
  description: "Point of Sale System for DAJAJ Restaurant",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

