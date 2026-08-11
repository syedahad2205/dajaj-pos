"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { hasAdminBypassSession } from "@/lib/devAuth";
import { auth } from "@/lib/firebase";
import { getAdminProfile } from "@/services/adminService";
import { getFinanceManagerProfile } from "@/services/financeManagerService";
import { getPosStaffProfile, getPosStaffProfileByEmail } from "@/lib/firestore";
import type { UserRole } from "@/lib/firebase";

// Every finance/admin/pos page calls useRequireAuth independently, and none
// of them share a layout — so navigating between, say, Daily Closing and
// Transactions remounts this hook and, without a cache, re-runs a fresh
// Firestore read (admins/{uid}, then finance_managers/{uid}, ...) on every
// single tab switch. That round trip is what "Checking your session…" was
// waiting on, every time. This is a UI-perf cache only: the actual security
// boundary is still Firestore Rules on every real read/write, so serving a
// stale role for the rest of this tab's session (until a hard refresh)
// cannot grant access to anything the rules wouldn't already allow.
const roleResolutionCache = new Map<string, UserRole | null>();

export function useRequireAuth(requiredRole?: UserRole) {
  const router = useRouter();
  const pathname = usePathname();
  const [authenticated, setAuthenticated] = useState(false);
  const [role, setRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if ((requiredRole === "admin" || requiredRole === "pos") && hasAdminBypassSession()) {
      setAuthenticated(true);
      setRole("admin");
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setAuthenticated(false);
        setRole(null);
        const next = pathname ? `?next=${encodeURIComponent(pathname)}` : "";
        if (requiredRole === "admin" || requiredRole === "financeManager") router.push(`/admin/login${next}`);
        else if (requiredRole === "pos") router.push(`/pos/login`);
        else router.push(`/login${next}`);
        setLoading(false);
        return;
      }

      const cacheKey = `${user.uid}:${requiredRole ?? ""}`;
      const cachedRole = roleResolutionCache.get(cacheKey);

      if (requiredRole === "financeManager") {
        // Only a granted role is ever cached (see roleResolutionCache above),
        // never a denial, so a cache hit here is always safe to trust.
        if (cachedRole) {
          setAuthenticated(true);
          setRole(cachedRole);
          setLoading(false);
          return;
        }

        // Admins can always access Finance too — Finance Manager is a
        // narrower role layered on top of the same login, not a replacement.
        const adminProfile = await getAdminProfile(user.uid);
        if (adminProfile) {
          roleResolutionCache.set(cacheKey, "admin");
          setAuthenticated(true);
          setRole("admin");
          setLoading(false);
          return;
        }
        const managerProfile = await getFinanceManagerProfile(user.uid);
        if (!managerProfile || managerProfile.active === false) {
          setAuthenticated(false);
          setRole(null);
          await signOut(auth);
          const next = pathname ? `?next=${encodeURIComponent(pathname)}` : "";
          router.push(`/admin/login${next}`);
          setLoading(false);
          return;
        }
        roleResolutionCache.set(cacheKey, "financeManager");
        setAuthenticated(true);
        setRole("financeManager");
        setLoading(false);
        return;
      }

      if (requiredRole === "pos") {
        if (cachedRole) {
          setAuthenticated(true);
          setRole(cachedRole);
          setLoading(false);
          return;
        }

        // Admins can also access POS
        const adminProfile = await getAdminProfile(user.uid);
        if (adminProfile) {
          roleResolutionCache.set(cacheKey, "admin");
          setAuthenticated(true);
          setRole("admin");
          setLoading(false);
          return;
        }
        if (!user.email) {
          await signOut(auth);
          router.push("/pos/login");
          setLoading(false);
          return;
        }
        const posProfile = await getPosStaffProfileByEmail(user.email)
                           ?? await getPosStaffProfile(user.uid);
        if (!posProfile || posProfile.status !== "active") {
          setAuthenticated(false);
          setRole(null);
          await signOut(auth);
          router.push("/pos/login");
          setLoading(false);
          return;
        }
        roleResolutionCache.set(cacheKey, "pos");
        setAuthenticated(true);
        setRole("pos");
        setLoading(false);
        return;
      }

      if (cachedRole) {
        setAuthenticated(true);
        setRole(cachedRole);
        if (requiredRole && cachedRole !== requiredRole) {
          router.push(cachedRole === "admin" ? "/admin" : "/menu");
        }
        setLoading(false);
        return;
      }

      const isAdminRequest = requiredRole === "admin";
      const adminProfile = isAdminRequest ? await getAdminProfile(user.uid) : null;
      const nextRole = isAdminRequest ? (adminProfile ? "admin" : null) : null;

      if (!nextRole) {
        setAuthenticated(false);
        setRole(null);
        await signOut(auth);
        router.push(isAdminRequest ? "/admin/login" : "/login");
        setLoading(false);
        return;
      }

      roleResolutionCache.set(cacheKey, nextRole);
      setAuthenticated(true);
      setRole(nextRole);

      if (requiredRole && nextRole !== requiredRole) {
        router.push(nextRole === "admin" ? "/admin" : "/menu");
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, [pathname, requiredRole, router]);

  return { authenticated, loading, role };
}
