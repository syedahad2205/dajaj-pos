"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { requireCustomer } from "@/lib/roleGuard";
import CustomerNavBar from "@/components/CustomerNavBar";

function OrderSuccessContent() {
  const { authenticated, loading, role } = requireCustomer();
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId") || "----";

  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10">Checking your session...</main>;
  }

  if (!authenticated || role !== "customer") {
    return null;
  }

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 pb-24 pt-12 text-slate-900 md:pb-10 md:pt-[88px]">
      <div className="mx-auto max-w-2xl rounded-[28px] border border-orange-200 bg-white p-8 text-center shadow-sm">
        <p className="text-5xl">🎉</p>
        <h1 className="mt-4 text-3xl font-black">Order placed successfully</h1>
        <p className="mt-4 text-xl font-semibold text-orange-600">Order #{orderId}</p>
        <p className="mt-3 text-sm text-slate-600">We will notify you once it is confirmed.</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/orders" className="rounded-2xl bg-orange-600 px-5 py-3 text-sm font-semibold text-white">
            Track Your Order
          </Link>
          <Link href="/menu" className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700">
            Order More
          </Link>
        </div>
      </div>
      <CustomerNavBar />
    </main>
  );
}

export default function OrderSuccessPage() {
  return (
    <Suspense>
      <OrderSuccessContent />
    </Suspense>
  );
}
