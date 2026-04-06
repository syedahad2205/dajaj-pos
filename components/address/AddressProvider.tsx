"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useCustomerAuth } from "@/components/auth/CustomerAuthProvider";
import {
  deleteAddress,
  getAddresses,
  saveAddress,
  setDefaultAddress,
  type Address,
  type AddressInput,
} from "@/lib/addresses";

type AddressContextValue = {
  addresses: Address[];
  selectedAddress: Address | null;
  loading: boolean;
  selectAddress: (addressId: string) => void;
  createAddress: (input: AddressInput) => Promise<void>;
  updateAddress: (id: string, input: AddressInput) => Promise<void>;
  removeAddress: (id: string) => Promise<void>;
  makeDefault: (id: string) => Promise<void>;
};

const AddressContext = createContext<AddressContextValue | null>(null);

export function AddressProvider({ children }: { children: ReactNode }) {
  const { customerPhone } = useCustomerAuth();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshAddresses = useCallback(async () => {
    if (!customerPhone) {
      setAddresses([]);
      setSelectedAddressId(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const nextAddresses = await getAddresses(customerPhone);
      setAddresses(nextAddresses);
      setSelectedAddressId((current) => {
        const preferred = nextAddresses.find((address) => address.id === current);
        if (preferred) {
          return preferred.id;
        }

        const fallback = nextAddresses.find((address) => address.isDefault) ?? nextAddresses[0] ?? null;
        return fallback?.id ?? null;
      });
    } catch (error) {
      console.error("Failed to load addresses:", error);
      setAddresses([]);
      setSelectedAddressId(null);
    } finally {
      setLoading(false);
    }
  }, [customerPhone]);

  useEffect(() => {
    if (!customerPhone) {
      setAddresses([]);
      setSelectedAddressId(null);
      setLoading(false);
      return;
    }

    void refreshAddresses();
  }, [customerPhone, refreshAddresses]);

  const value = useMemo<AddressContextValue>(() => {
    const selectedAddress = addresses.find((address) => address.id === selectedAddressId) ?? null;

    const requireUserId = () => {
      if (!customerPhone) {
        throw new Error("You need to be logged in to manage addresses.");
      }
      return customerPhone;
    };

    return {
      addresses,
      selectedAddress,
      loading,
      selectAddress: (addressId) => setSelectedAddressId(addressId),
      createAddress: async (input) => {
        const uid = requireUserId();
        await saveAddress(uid, input);
        await refreshAddresses();
      },
      updateAddress: async (id, input) => {
        const uid = requireUserId();
        await saveAddress(uid, input, id);
        await refreshAddresses();
      },
      removeAddress: async (id) => {
        const uid = requireUserId();
        await deleteAddress(uid, id);
        await refreshAddresses();
      },
      makeDefault: async (id) => {
        const uid = requireUserId();
        await setDefaultAddress(uid, id);
        await refreshAddresses();
      },
    };
  }, [addresses, customerPhone, loading, refreshAddresses, selectedAddressId]);

  return <AddressContext.Provider value={value}>{children}</AddressContext.Provider>;
}

export function useAddresses() {
  const context = useContext(AddressContext);
  if (!context) {
    throw new Error("useAddresses must be used within AddressProvider");
  }

  return context;
}
