"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import NameForm from "@/components/auth/NameForm";
import PhoneInput from "@/components/auth/PhoneInput";
import { useCustomerAuth } from "@/components/auth/CustomerAuthProvider";
import { normalizePhoneNumber } from "@/lib/phone";

type Step = "phone" | "waiting" | "profile";

function CustomerLoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { authenticated, customer, setCustomerSession, refreshCustomer } = useCustomerAuth();
  const nextPath = searchParams.get("next");
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [normalizedPhone, setNormalizedPhone] = useState("");
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const redirectPath = useMemo(() => (nextPath && nextPath !== "/login" ? nextPath : "/menu"), [nextPath]);

  // Redirect if already authenticated
  useEffect(() => {
    if (authenticated && (step !== "profile" || Boolean(customer?.name))) {
      router.push(redirectPath);
    }
  }, [authenticated, customer?.name, redirectPath, router, step]);

  // Poll Firestore every 3s while waiting for the user to reply YES on WhatsApp
  useEffect(() => {
    if (step !== "waiting" || !normalizedPhone) return;

    let active = true;

    const poll = async () => {
      try {
        const res = await fetch(`/api/auth/check-whatsapp?phone=${normalizedPhone}`);
        const data = (await res.json()) as {
          success: boolean;
          confirmed: boolean;
          expired?: boolean;
          phone?: string;
          requiresName?: boolean;
        };

        if (!active) return;

        if (data.expired) {
          setError("Verification expired. Please try again.");
          setStep("phone");
          return;
        }

        if (data.confirmed) {
          setCustomerSession(data.phone || normalizedPhone);
          if (data.requiresName) {
            setStep("profile");
            return;
          }
          await refreshCustomer();
          router.push(redirectPath);
        }
      } catch {
        // silent — keep polling
      }
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [step, normalizedPhone, redirectPath, router, setCustomerSession, refreshCustomer]);

  const sendMessage = async () => {
    const nextPhone = normalizePhoneNumber(phone);
    if (!nextPhone) {
      setError("Enter a valid phone number.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: nextPhone }),
      });

      const data = (await response.json()) as { success: boolean; message: string; phone?: string };
      if (!response.ok || !data.success) {
        setError(data.message);
        return;
      }

      setNormalizedPhone(data.phone || nextPhone);
      setStep("waiting");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Failed to send WhatsApp message.");
    } finally {
      setLoading(false);
    }
  };

  const completeProfile = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/complete-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalizedPhone, name, dob }),
      });

      const data = (await response.json()) as { success: boolean; message: string };
      if (!response.ok || !data.success) {
        setError(data.message);
        return;
      }

      await refreshCustomer();
      router.push(redirectPath);
    } catch (profileError) {
      setError(profileError instanceof Error ? profileError.message : "Failed to complete profile.");
    } finally {
      setLoading(false);
    }
  };

  // Format phone for display: +91 98765 43210
  const displayPhone = normalizedPhone
    ? `+${normalizedPhone.slice(0, 2)} ${normalizedPhone.slice(2, 7)} ${normalizedPhone.slice(7)}`
    : "";

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto flex min-h-[80vh] max-w-md items-center">
        <section className="w-full rounded-[28px] border border-orange-200 bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-600">Customer Login</p>
          <h1 className="mt-3 text-3xl font-black">
            {step === "phone" ? "Login with WhatsApp" : step === "waiting" ? "Check WhatsApp" : "Complete your profile"}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            {step === "phone"
              ? "Enter your mobile number. We'll send you a WhatsApp message to confirm."
              : step === "waiting"
                ? `We sent a message to ${displayPhone}.`
                : `Welcome${customer?.name ? ` back, ${customer.name}` : ""}. Tell us your name to continue.`}
          </p>

          <div className="mt-6 space-y-4">
            {step === "phone" ? <PhoneInput value={phone} onChange={setPhone} /> : null}

            {step === "waiting" ? (
              <div className="flex flex-col items-center gap-5 py-4 text-center">
                {/* WhatsApp icon */}
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#25D366] shadow-md shadow-green-200">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" className="h-10 w-10">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                  </svg>
                </div>

                <div className="space-y-1">
                  <p className="font-bold text-slate-900">Reply YES to login</p>
                  <p className="text-sm text-slate-500">
                    Open WhatsApp on <span className="font-semibold text-slate-700">{displayPhone}</span> and tap the{" "}
                    <span className="font-bold text-[#25D366]">YES</span> button in the message from Dajaj.
                  </p>
                </div>

                {/* Animated waiting dots */}
                <div className="flex items-center gap-2 rounded-2xl bg-green-50 px-5 py-3 text-sm font-medium text-green-700">
                  <span className="flex gap-1">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-green-500 [animation-delay:0ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-green-500 [animation-delay:150ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-green-500 [animation-delay:300ms]" />
                  </span>
                  Waiting for your reply…
                </div>

                <button
                  type="button"
                  onClick={() => { setStep("phone"); setError(""); }}
                  className="text-sm font-semibold text-slate-400 underline-offset-2 hover:text-slate-700 hover:underline"
                >
                  Use a different number
                </button>
              </div>
            ) : null}

            {step === "profile" ? <NameForm name={name} dob={dob} onNameChange={setName} onDobChange={setDob} /> : null}

            {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}

            {step === "phone" ? (
              <button
                type="button"
                onClick={sendMessage}
                disabled={loading}
                className="w-full rounded-2xl bg-orange-600 px-5 py-4 text-base font-semibold text-white disabled:opacity-50"
              >
                {loading ? "Sending…" : "Send WhatsApp Message"}
              </button>
            ) : null}

            {step === "profile" ? (
              <button
                type="button"
                onClick={completeProfile}
                disabled={loading}
                className="w-full rounded-2xl bg-orange-600 px-5 py-4 text-base font-semibold text-white disabled:opacity-50"
              >
                {loading ? "Saving…" : "Continue"}
              </button>
            ) : null}
          </div>

          <div className="mt-6 rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-600">
            Restaurant staff?{" "}
            <Link href="/admin/login" className="font-semibold text-orange-600">
              Use admin login
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function CustomerLoginPage() {
  return (
    <Suspense>
      <CustomerLoginContent />
    </Suspense>
  );
}
