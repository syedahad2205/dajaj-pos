"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { MessageCircle } from "lucide-react";
import { useFeedbackAuth } from "@/components/auth/FeedbackAuthProvider";
import { createFeedback } from "@/services/feedbackService";
import { trackEvent } from "@/lib/analytics";

const WHATSAPP_LINK = "https://wa.me/918971563534";

function validateIndianMobile(value: string): boolean {
  return /^[6-9]\d{9}$/.test(value.trim());
}

export default function FeedbackPage() {
  const router = useRouter();
  const { user, loading, signInWithGoogle } = useFeedbackAuth();

  const [customerName, setCustomerName] = useState("");
  const [feedback, setFeedback] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [globalError, setGlobalError] = useState("");

  const trackedRef = useRef(false);

  useEffect(() => {
    if (!trackedRef.current) {
      trackedRef.current = true;
      void trackEvent("feedback_page_view");
    }
  }, []);

  useEffect(() => {
    if (user && !customerName && user.displayName) {
      setCustomerName(user.displayName.split(" ")[0] ?? "");
    }
  }, [user, customerName]);

  const handleGoogleSignIn = async () => {
    setAuthLoading(true);
    setGlobalError("");
    try {
      await signInWithGoogle();
    } catch {
      setGlobalError("Sign-in failed. Please try again.");
    } finally {
      setAuthLoading(false);
    }
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (customerName.trim().length < 2) next.customerName = "Name must be at least 2 characters.";
    if (feedback.trim().length < 10) next.feedback = "Feedback must be at least 10 characters.";
    if (mobileNumber.trim() && !validateIndianMobile(mobileNumber))
      next.mobileNumber = "Enter a valid 10-digit Indian mobile number.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !validate()) return;

    setSubmitting(true);
    setGlobalError("");
    try {
      await createFeedback({
        uid: user.uid,
        userEmail: user.email ?? "",
        userName: user.displayName ?? "",
        customerName: customerName.trim(),
        mobileNumber: mobileNumber.trim() || null,
        feedback: feedback.trim(),
      });
      void trackEvent("feedback_submitted", { uid: user.uid, has_mobile: Boolean(mobileNumber.trim()) });
      setSubmitted(true);
      setTimeout(() => router.push("/feedback/thank-you"), 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[feedback] submit error:", err);
      setGlobalError(message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-[#fff8ed] px-4 py-10 text-slate-900">
        <div className="mx-auto max-w-lg">
          <p className="text-sm text-slate-500">Loading…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-10 text-slate-900">
      <div className="mx-auto max-w-lg space-y-5">

        {/* ── Branded header card ─────────────────────────────────────────── */}
        <header className="rounded-[28px] border border-orange-200 bg-white px-6 py-8 shadow-sm text-center">
          <Image
            src="/logo.png"
            alt="Dajaj logo"
            width={64}
            height={64}
            className="mx-auto mb-4 h-auto w-auto"
            priority
          />
          <h1 className="text-3xl font-black tracking-tight text-slate-900">Help Us Improve</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-slate-500">
            We value your feedback and read every response personally.
          </p>
          <div className="mt-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-orange-100" />
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-orange-400">
              Customer Feedback Form
            </span>
            <span className="h-px flex-1 bg-orange-100" />
          </div>
        </header>

        {/* WhatsApp direct option */}
        <section className="rounded-[28px] border border-slate-200 bg-white px-6 py-6 shadow-sm text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-orange-600">
            Prefer to tell us directly?
          </p>
          <p className="mt-1 text-base font-bold text-slate-900">
            We&apos;d love to hear from you personally.
          </p>
          <a
            href={WHATSAPP_LINK}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => void trackEvent("feedback_whatsapp_clicked")}
            className="mt-4 inline-flex w-full items-center justify-center gap-2.5 rounded-2xl bg-[#25D366] px-5 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1ebe5d]"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 shrink-0" aria-hidden="true">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
            Send Feedback on WhatsApp
          </a>
        </section>

        {/* Sign-in gate */}
        {!user ? (
          <section className="rounded-[28px] border border-slate-200 bg-white px-6 py-8 shadow-sm text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
              <MessageCircle className="h-7 w-7 text-slate-400" aria-hidden="true" />
            </div>
            <h2 className="text-xl font-black text-slate-900">Sign in to submit feedback</h2>
            <p className="mt-2 text-sm text-slate-500">
              We use your Google account to keep things simple and prevent spam.
            </p>
            {globalError ? (
              <p className="mt-3 text-sm font-medium text-rose-600">{globalError}</p>
            ) : null}
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={authLoading}
              className="mt-6 inline-flex w-full items-center justify-center gap-3 rounded-2xl border border-slate-300 bg-white px-5 py-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="h-5 w-5 shrink-0" aria-hidden="true">
                <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
                <path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
                <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
                <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
              </svg>
              {authLoading ? "Signing in…" : "Continue with Google"}
            </button>
          </section>
        ) : (
          /* Feedback form */
          <section className="rounded-[28px] border border-slate-200 bg-white px-6 py-7 shadow-sm">
            {/* Signed-in pill */}
            <div className="mb-5 flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              {user.photoURL ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.photoURL}
                  alt=""
                  className="h-7 w-7 rounded-full"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-orange-100 text-xs font-bold text-orange-700">
                  {(user.displayName ?? "U").charAt(0).toUpperCase()}
                </div>
              )}
              <span className="truncate text-sm font-medium text-slate-700">{user.email}</span>
            </div>

            {submitted ? (
              <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-5 text-center">
                <p className="text-sm font-semibold text-orange-800">
                  Thank you for helping us improve ❤️
                </p>
                <p className="mt-1 text-xs text-orange-700">
                  Your feedback has been received and will be reviewed by our team.
                </p>
                <p className="mt-2 text-xs text-slate-500">Redirecting…</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate className="space-y-5">
                {/* Name */}
                <div>
                  <label htmlFor="customerName" className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Your Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="customerName"
                    type="text"
                    value={customerName}
                    onChange={(e) => {
                      setCustomerName(e.target.value);
                      if (errors.customerName) setErrors((p) => ({ ...p, customerName: "" }));
                    }}
                    placeholder="e.g. Arjun"
                    autoComplete="given-name"
                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3.5 text-sm text-slate-900 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                  />
                  {errors.customerName ? (
                    <p className="mt-1 text-xs font-medium text-rose-600">{errors.customerName}</p>
                  ) : null}
                </div>

                {/* Feedback */}
                <div>
                  <label htmlFor="feedback" className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Your Feedback <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    id="feedback"
                    rows={5}
                    value={feedback}
                    onChange={(e) => {
                      setFeedback(e.target.value);
                      if (errors.feedback) setErrors((p) => ({ ...p, feedback: "" }));
                    }}
                    placeholder="Tell us what you loved, what we can do better, or anything on your mind…"
                    className="w-full resize-none rounded-2xl border border-slate-300 bg-white px-4 py-3.5 text-sm text-slate-900 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                  />
                  {errors.feedback ? (
                    <p className="mt-1 text-xs font-medium text-rose-600">{errors.feedback}</p>
                  ) : null}
                </div>

                {/* Mobile (optional) */}
                <div>
                  <label htmlFor="mobileNumber" className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Mobile Number <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="flex h-[50px] items-center rounded-2xl border border-slate-300 bg-slate-50 px-3 text-sm font-medium text-slate-600">
                      +91
                    </span>
                    <input
                      id="mobileNumber"
                      type="tel"
                      inputMode="numeric"
                      maxLength={10}
                      value={mobileNumber}
                      onChange={(e) => {
                        setMobileNumber(e.target.value.replace(/\D/g, "").slice(0, 10));
                        if (errors.mobileNumber) setErrors((p) => ({ ...p, mobileNumber: "" }));
                      }}
                      placeholder="98765 43210"
                      autoComplete="tel-national"
                      className="flex-1 rounded-2xl border border-slate-300 bg-white px-4 py-3.5 text-sm text-slate-900 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                    />
                  </div>
                  {errors.mobileNumber ? (
                    <p className="mt-1 text-xs font-medium text-rose-600">{errors.mobileNumber}</p>
                  ) : null}
                </div>

                {globalError ? (
                  <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                    {globalError}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-2xl bg-orange-600 px-5 py-4 text-base font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:opacity-50"
                >
                  {submitting ? "Submitting…" : "Submit Feedback"}
                </button>
              </form>
            )}
          </section>
        )}

        {/* Footer trust line */}
        <p className="pb-4 text-center text-xs text-slate-400">
          © Dajaj · Your response is private and only seen by our team.
        </p>
      </div>
    </main>  );
}
