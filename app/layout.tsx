import type { Metadata } from "next";
import "./globals.css";
import { AddressProvider } from "@/components/address/AddressProvider";
import { CustomerAuthProvider } from "@/components/auth/CustomerAuthProvider";
import { RiderAuthProvider } from "@/components/auth/RiderAuthProvider";
import { CartProvider } from "@/components/cart/CartProvider";
import { StockProvider } from "@/components/stock/StockProvider";
import FirebaseAnalytics from "@/components/FirebaseAnalytics";
import UTMTracker from "@/components/UTMTracker";

export const metadata: Metadata = {
  title: "Dajaj",
  description: "Dajaj Restaurant",
  icons: {
    icon: "/favicon.png?v=2",
    shortcut: "/favicon.png?v=2",
    apple: "/favicon.png?v=2",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="overflow-x-hidden">
      <body className="overflow-x-hidden">
        <RiderAuthProvider>
          <CustomerAuthProvider>
            <AddressProvider>
              <StockProvider>
                <CartProvider>
                  <FirebaseAnalytics />
                  <UTMTracker />
                  {children}
                </CartProvider>
              </StockProvider>
            </AddressProvider>
          </CustomerAuthProvider>
        </RiderAuthProvider>
      </body>
    </html>
  );
}
