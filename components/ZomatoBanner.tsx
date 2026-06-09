"use client";

import ZomatoCTA from "@/components/ZomatoCTA";

export default function ZomatoBanner() {
  return (
    <div className="sticky top-[60px] z-[15] border-b border-orange-100 bg-orange-50 px-4 py-3">
      <div className="mx-auto flex max-w-[600px] flex-col items-center gap-2.5 sm:flex-row sm:justify-between sm:gap-4">
        <p className="text-center text-xs font-medium leading-snug text-slate-700 sm:text-left">
          🚚 Looking for Delivery? Please place delivery orders through Zomato
          for the best delivery experience.
        </p>
        <ZomatoCTA label="Order on Zomato" variant="compact" className="w-full sm:w-auto" />
      </div>
    </div>
  );
}
