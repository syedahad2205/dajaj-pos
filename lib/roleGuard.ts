"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { useCustomerAuth } from "@/components/auth/CustomerAuthProvider";
import { useRiderAuth } from "@/components/auth/RiderAuthProvider";

export function requireAdmin() {
  return useRequireAuth("admin");
}

export function requirePosStaff() {
  return useRequireAuth("pos");
}

export function requireCustomer({ redirect = true }: { redirect?: boolean } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const { authenticated, loading, customerPhone, customer } = useCustomerAuth();

  useEffect(() => {
    if (!redirect || loading || authenticated) {
      return;
    }

    const next = pathname ? `?next=${encodeURIComponent(pathname)}` : "";
    router.push(`/login${next}`);
  }, [authenticated, loading, pathname, router, redirect]);

  return {
    authenticated,
    loading,
    role: authenticated ? "customer" : null,
    customerPhone,
    customer,
  };
}

export function requireRider() {
  const router = useRouter();
  const pathname = usePathname();
  const { authenticated, loading, riderId, rider } = useRiderAuth();

  useEffect(() => {
    if (loading || authenticated) {
      return;
    }

    const next = pathname ? `?next=${encodeURIComponent(pathname)}` : "";
    router.push(`/rider/login${next}`);
  }, [authenticated, loading, pathname, router]);

  return {
    authenticated,
    loading,
    role: authenticated ? "rider" : null,
    riderId,
    rider,
  };
}
