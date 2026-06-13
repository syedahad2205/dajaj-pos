"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * POS functionality has moved to the Android application.
 * This page redirects to the admin dashboard.
 */
export default function AdminPosRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin");
  }, [router]);

  return (
    <main className="min-h-screen bg-[#fff8ed] flex items-center justify-center px-4">
      <div className="text-center max-w-sm">
        <p className="text-lg font-bold text-neutral-800 mb-2">
          POS has moved
        </p>
        <p className="text-sm text-neutral-500 mb-4">
          Point of Sale functionality is now available on the Android application.
        </p>
        <p className="text-xs text-neutral-400">Redirecting to admin dashboard…</p>
      </div>
    </main>
  );
}
