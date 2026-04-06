"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useRiderAuth } from "@/components/auth/RiderAuthProvider";
import { authenticateRider } from "@/services/riderService";

export default function RiderLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { authenticated, rider, setRiderSession } = useRiderAuth();
  const [phone, setPhone] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const nextPath = searchParams.get("next");
  const redirectPath = nextPath && nextPath !== "/rider/login" ? nextPath : "/rider";

  useEffect(() => {
    if (authenticated) {
      router.push(redirectPath);
    }
  }, [authenticated, redirectPath, router]);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <div className="mx-auto flex min-h-[80vh] max-w-md items-center">
        <section className="w-full rounded-[28px] border border-slate-700 bg-slate-900 p-8 shadow-[0_20px_60px_rgba(15,23,42,0.45)]">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-400">Rider Login</p>
          <h1 className="mt-3 text-3xl font-black">Delivery Partner Console</h1>
          <p className="mt-2 text-sm text-slate-300">Sign in with your phone number and access code to manage pickups and live deliveries.</p>
          {rider ? <p className="mt-2 text-xs text-slate-400">Signed in as {rider.name}</p> : null}

          <form
            className="mt-6 space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              setError("");
              setLoading(true);
              try {
                const nextRider = await authenticateRider(phone, accessCode);
                if (!nextRider) {
                  setError("Invalid rider phone number or access code.");
                  return;
                }

                setRiderSession(nextRider.id);
                router.push(redirectPath);
              } catch (loginError) {
                setError(loginError instanceof Error ? loginError.message : "Failed to sign in.");
              } finally {
                setLoading(false);
              }
            }}
          >
            <div>
              <label htmlFor="rider-phone" className="mb-1 block text-sm font-medium text-slate-200">
                Phone Number
              </label>
              <input
                id="rider-phone"
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="9876543210"
                required
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white"
              />
            </div>

            <div>
              <label htmlFor="rider-code" className="mb-1 block text-sm font-medium text-slate-200">
                Access Code
              </label>
              <input
                id="rider-code"
                type="password"
                value={accessCode}
                onChange={(event) => setAccessCode(event.target.value)}
                required
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white"
              />
            </div>

            {error ? <p className="text-sm font-medium text-rose-400">{error}</p> : null}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-emerald-500 px-5 py-4 text-base font-semibold text-slate-950 disabled:opacity-50"
            >
              {loading ? "Signing in..." : "Continue as Rider"}
            </button>
          </form>


        </section>
      </div>
    </main>
  );
}

