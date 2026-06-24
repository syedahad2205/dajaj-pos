"use client";

import Link from "next/link";
import Image from "next/image";
import { CheckCircle } from "lucide-react";

export default function FeedbackThankYouPage() {
  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-10 text-slate-900">
      <div className="mx-auto max-w-lg space-y-5">

        {/* Branded header card — mirrors feedback page */}
        <header className="rounded-[28px] border border-orange-200 bg-white px-6 py-8 shadow-sm text-center">
          <Image
            src="/logo.png"
            alt="Dajaj logo"
            width={64}
            height={64}
            className="mx-auto mb-4 h-auto w-auto"
            priority
          />
          <h1 className="text-3xl font-black tracking-tight text-slate-900">Feedback Received</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-slate-500">
            Thank you for helping DAJAJ serve you better.
          </p>
          <div className="mt-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-orange-100" />
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-orange-400">
              Customer Feedback Form
            </span>
            <span className="h-px flex-1 bg-orange-100" />
          </div>
        </header>
        <section className="rounded-[28px] border border-orange-200 bg-white px-8 py-12 shadow-sm text-center">
          {/* Success icon */}
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-orange-100">
            <CheckCircle className="h-10 w-10 text-orange-600" strokeWidth={2.5} aria-hidden="true" />
          </div>

          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-600">
            All done!
          </p>
          <h2 className="mt-2 text-2xl font-black leading-tight text-slate-900">
            We got your message ❤️
          </h2>
          <p className="mt-3 text-sm leading-7 text-slate-500">
            Our team personally reads every piece of feedback. We appreciate you taking the time to help us improve.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-2xl border border-slate-300 px-6 py-3.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
            >
              Back to Home
            </Link>
            <Link
              href="/feedback"
              className="inline-flex items-center justify-center rounded-2xl bg-orange-600 px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700"
            >
              Send Another Feedback
            </Link>
          </div>
        </section>

        <p className="mt-6 text-center text-xs text-slate-400">
          © Dajaj · Your response is private and only seen by our team.
        </p>
      </div>
    </main>
  );
}
