import type { Metadata } from "next";
import "./globals.css";
import FirebaseAnalytics from "@/components/FirebaseAnalytics";
import UTMTracker from "@/components/UTMTracker";

export const metadata: Metadata = {
  title: "Dajaj",
  description: "Dajaj Restaurant",
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
    apple: "/favicon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <FirebaseAnalytics />
        <UTMTracker />
        {children}
      </body>
    </html>
  );
}
