"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { ADMIN_BYPASS_CODE, hasAdminBypassSession, setAdminBypassSession } from "@/lib/devAuth";
import { isAdminBypassAllowed } from "@/lib/devAuthShared";
import { auth } from "@/lib/firebase";
import { getAdminProfile, syncAdminProfile } from "@/services/adminService";
import { getFinanceManagerProfile } from "@/services/financeManagerService";

function AdminLoginContent() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next");

  // Same login form for both roles. Falls back to each role's own home page
  // when there's no ?next= to return to — an admin lands on /admin, a
  // Finance Manager (who can't see /admin) lands on /admin/finance instead.
  const resolveRedirect = useCallback(
    (fallback: string) => (nextPath && nextPath !== "/admin/login" ? nextPath : fallback),
    [nextPath],
  );

  // Resolves which role (if any) this uid has, checking Admin first since an
  // Admin should always land on the full dashboard, not the Finance-only one.
  const resolveRoleRedirect = useCallback(
    async (uid: string): Promise<string | null> => {
      const adminProfile = await getAdminProfile(uid);
      if (adminProfile) return resolveRedirect("/admin");

      const managerProfile = await getFinanceManagerProfile(uid);
      if (managerProfile && managerProfile.active !== false) return resolveRedirect("/admin/finance");

      return null;
    },
    [resolveRedirect],
  );

  useEffect(() => {
    if (hasAdminBypassSession()) {
      router.push(resolveRedirect("/admin"));
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        return;
      }

      const destination = await resolveRoleRedirect(user.uid);
      if (!destination) {
        await signOut(auth);
        setError("This account is not registered for admin or Finance access.");
        return;
      }

      router.push(destination);
    });

    return () => unsubscribe();
  }, [router, resolveRedirect, resolveRoleRedirect]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (isAdminBypassAllowed() && (email.trim() === ADMIN_BYPASS_CODE || password.trim() === ADMIN_BYPASS_CODE)) {
        setAdminBypassSession();
        router.push(resolveRedirect("/admin"));
        return;
      }

      const credential = await signInWithEmailAndPassword(auth, email, password);

      // syncAdminProfile also opportunistically refreshes the admin doc's
      // name/email — harmless no-op (returns null) for a non-admin account.
      await syncAdminProfile(credential.user);
      const destination = await resolveRoleRedirect(credential.user.uid);
      if (!destination) {
        await signOut(auth);
        setError("This account is not registered for admin or Finance access.");
        return;
      }

      router.push(destination);
    } catch (loginError: unknown) {
      setError(loginError instanceof Error ? loginError.message : "Failed to login");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <div className="mx-auto flex min-h-[80vh] max-w-md items-center">
        <section className="w-full rounded-[28px] border border-slate-700 bg-slate-900 p-8 shadow-[0_20px_60px_rgba(15,23,42,0.45)]">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-400">Store Login</p>
          <h1 className="mt-3 text-3xl font-black">Store Control Panel</h1>
          <p className="mt-2 text-sm text-slate-300">
            For Admins and Finance Managers. You&apos;ll land on the tools your account has access to.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="admin-email" className="mb-1 block text-sm font-medium text-slate-200">
                Email
              </label>
              <input
                id="admin-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white"
              />
            </div>
            <div>
              <label htmlFor="admin-password" className="mb-1 block text-sm font-medium text-slate-200">
                Password
              </label>
              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white"
              />
            </div>

            {error ? <p className="text-sm font-medium text-rose-400">{error}</p> : null}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-orange-600 px-5 py-4 text-base font-semibold text-white disabled:opacity-50"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>


        </section>
      </div>
    </main>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense>
      <AdminLoginContent />
    </Suspense>
  );
}
