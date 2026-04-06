"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getCustomerProfile, type CustomerProfile } from "@/services/customerService";

const STORAGE_KEY = "customerPhone";

type CustomerAuthContextValue = {
  customerPhone: string | null;
  customer: CustomerProfile | null;
  authenticated: boolean;
  loading: boolean;
  setCustomerSession: (phone: string) => void;
  clearCustomerSession: () => void;
  refreshCustomer: () => Promise<void>;
};

const CustomerAuthContext = createContext<CustomerAuthContextValue | null>(null);

export function CustomerAuthProvider({ children }: { children: ReactNode }) {
  const [customerPhone, setCustomerPhone] = useState<string | null>(null);
  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedPhone = window.localStorage.getItem(STORAGE_KEY);
    if (!savedPhone) {
      setLoading(false);
      return;
    }

    setCustomerPhone(savedPhone);
  }, []);

  useEffect(() => {
    if (!customerPhone) {
      setCustomer(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    setLoading(true);
    void getCustomerProfile(customerPhone)
      .then((profile) => {
        if (cancelled) {
          return;
        }

        if (!profile) {
          window.localStorage.removeItem(STORAGE_KEY);
          setCustomerPhone(null);
          setCustomer(null);
          setLoading(false);
          return;
        }

        setCustomer(profile);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setCustomer(null);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [customerPhone]);

  const value = useMemo<CustomerAuthContextValue>(
    () => ({
      customerPhone,
      customer,
      authenticated: Boolean(customerPhone),
      loading,
      setCustomerSession: (phone) => {
        window.localStorage.setItem(STORAGE_KEY, phone);
        setCustomerPhone(phone);
      },
      clearCustomerSession: () => {
        window.localStorage.removeItem(STORAGE_KEY);
        setCustomerPhone(null);
        setCustomer(null);
      },
      refreshCustomer: async () => {
        if (!customerPhone) {
          setCustomer(null);
          return;
        }

        setCustomer(await getCustomerProfile(customerPhone));
      },
    }),
    [customer, customerPhone, loading],
  );

  return <CustomerAuthContext.Provider value={value}>{children}</CustomerAuthContext.Provider>;
}

export function useCustomerAuth() {
  const context = useContext(CustomerAuthContext);
  if (!context) {
    throw new Error("useCustomerAuth must be used within CustomerAuthProvider");
  }

  return context;
}
