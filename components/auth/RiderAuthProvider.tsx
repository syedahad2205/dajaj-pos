"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getRiderProfile, type RiderProfile } from "@/services/riderService";

const STORAGE_KEY = "riderId";

type RiderAuthContextValue = {
  riderId: string | null;
  rider: RiderProfile | null;
  authenticated: boolean;
  loading: boolean;
  setRiderSession: (riderId: string) => void;
  clearRiderSession: () => void;
  refreshRider: () => Promise<void>;
};

const RiderAuthContext = createContext<RiderAuthContextValue | null>(null);

export function RiderAuthProvider({ children }: { children: ReactNode }) {
  const [riderId, setRiderId] = useState<string | null>(null);
  const [rider, setRider] = useState<RiderProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedRiderId = window.localStorage.getItem(STORAGE_KEY);
    if (!savedRiderId) {
      setLoading(false);
      return;
    }

    setRiderId(savedRiderId);
  }, []);

  useEffect(() => {
    if (!riderId) {
      setRider(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    setLoading(true);
    void getRiderProfile(riderId)
      .then((profile) => {
        if (cancelled) {
          return;
        }

        if (!profile || !profile.isActive) {
          window.localStorage.removeItem(STORAGE_KEY);
          setRiderId(null);
          setRider(null);
          setLoading(false);
          return;
        }

        setRider(profile);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setRider(null);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [riderId]);

  const value = useMemo<RiderAuthContextValue>(
    () => ({
      riderId,
      rider,
      authenticated: Boolean(riderId),
      loading,
      setRiderSession: (nextRiderId) => {
        window.localStorage.setItem(STORAGE_KEY, nextRiderId);
        setRiderId(nextRiderId);
      },
      clearRiderSession: () => {
        window.localStorage.removeItem(STORAGE_KEY);
        setRiderId(null);
        setRider(null);
      },
      refreshRider: async () => {
        if (!riderId) {
          setRider(null);
          return;
        }

        setRider(await getRiderProfile(riderId));
      },
    }),
    [loading, rider, riderId],
  );

  return <RiderAuthContext.Provider value={value}>{children}</RiderAuthContext.Provider>;
}

export function useRiderAuth() {
  const context = useContext(RiderAuthContext);
  if (!context) {
    throw new Error("useRiderAuth must be used within RiderAuthProvider");
  }

  return context;
}
