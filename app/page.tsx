"use client";

import { useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import styles from "./menu/menu.module.css";
import LocationLink from "@/components/LocationLink";
import { trackEvent } from "@/lib/analytics";

const ZOMATO_URL = "http://zoma.to/r/22768463";

const MAPS_URL = "https://maps.app.goo.gl/NGaUPwQMD8P2UDbk9?g_st=ic";

export default function Home() {
  useEffect(() => {
    void trackEvent("landing_page_view");
  }, []);

  return (
    <main className={`relative min-h-screen overflow-hidden ${styles.menuRoot}`} style={{ backgroundColor: "#faf6f1" }}>
      {/* Decorative background shapes */}
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-[#c6533f]/[0.06]" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-[30rem] w-[30rem] rounded-full bg-[#c6533f]/[0.04]" />
      <div className="pointer-events-none absolute right-10 top-1/4 h-48 w-48 rounded-full bg-amber-400/[0.05]" />

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-5 py-12">
        <div className="mb-6">
          <Image
            src="/logo.png"
            alt="Dajaj logo"
            width={100}
            height={100}
            className="h-auto w-auto drop-shadow-lg"
            priority
          />
        </div>

        <p className="mt-3 text-center text-lg tracking-widest text-[#2f2a25]/50" style={{ fontVariant: "small-caps" }}>
          the spice of spices
        </p>

        <div className="mt-8 flex items-center gap-4">
          <span className="h-px w-12 bg-[#c6533f]/25" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#c6533f]/40" />
          <span className="h-px w-12 bg-[#c6533f]/25" />
        </div>

        {/* Order cards — symmetrical 2-column grid */}
        <div className="mt-10 grid w-full max-w-md grid-cols-2 gap-4">
          <Link
            href="/menu"
            onClick={() => void trackEvent("cta_pickup")}
            className="group relative flex flex-col items-center justify-between overflow-hidden rounded-2xl bg-[#c6533f] px-5 py-8 text-center text-white shadow-[0_8px_32px_rgba(198,83,63,0.35)] transition-all hover:shadow-[0_12px_40px_rgba(198,83,63,0.45)] active:scale-[0.98]"
          >
            <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />
            <div className="pointer-events-none absolute -bottom-4 -left-4 h-16 w-16 rounded-full bg-white/[0.07]" />
            <div className="relative">
              <p className={`text-2xl tracking-wide ${styles.sectionTitle}`}>PICKUP</p>
              <p className="mt-2 text-sm leading-snug text-white/70">Order online and pick up fresh from our store</p>
            </div>
            <span className="relative mt-5 inline-flex items-center justify-center whitespace-nowrap rounded-full bg-white/20 px-4 py-2 text-xs font-semibold text-white backdrop-blur-sm transition hover:bg-white/30">
              Order Pickup
            </span>
          </Link>

          <a
            href={ZOMATO_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => void trackEvent("cta_delivery_zomato")}
            className="group relative flex flex-col items-center justify-between overflow-hidden rounded-2xl px-5 py-8 text-center text-white shadow-[0_8px_32px_rgba(226,55,68,0.35)] transition-all hover:shadow-[0_12px_40px_rgba(226,55,68,0.45)] active:scale-[0.98]"
            style={{ backgroundColor: "#E23744" }}
          >
            <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />
            <div className="pointer-events-none absolute -bottom-4 -left-4 h-16 w-16 rounded-full bg-white/[0.07]" />
            <div className="relative">
              <p className={`text-2xl tracking-wide ${styles.sectionTitle}`}>DELIVERY</p>
              <p className="mt-2 text-sm leading-snug text-white/70">Home delivery available through Zomato</p>
            </div>
            <span className="relative mt-5 inline-flex items-center justify-center whitespace-nowrap rounded-full bg-white/20 px-4 py-2 text-xs font-semibold text-white backdrop-blur-sm transition hover:bg-white/30">
              Order on Zomato ↗
            </span>
          </a>
        </div>

        {/* Find Us — full width, aligned with grid */}
        <div className="mt-4 w-full max-w-md">
          <LocationLink
            href={MAPS_URL}
            className="group flex w-full items-center gap-4 rounded-2xl border-2 border-[#c6533f]/15 bg-white/80 px-6 py-5 text-left shadow-sm backdrop-blur transition-all hover:border-[#c6533f]/30 hover:shadow-md active:scale-[0.98]"
            style={{}}
            onClick={() => void trackEvent("cta_find_us")}
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#c6533f]/10 text-[#c6533f]">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            </span>
            <span>
              <span className={`block text-lg font-bold text-[#2f2a25] ${styles.sectionTitle}`}>Find Us</span>
              <span className="block text-sm text-[#2f2a25]/50">Open in Google Maps</span>
            </span>
          </LocationLink>
        </div>
      </div>
    </main>
  );
}
