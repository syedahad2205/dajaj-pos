"use client";

import { useState } from "react";
import AddAddressModal from "@/components/address/AddAddressModal";
import AddressCard from "@/components/address/AddressCard";
import { useAddresses } from "@/components/address/AddressProvider";
import type { Address } from "@/lib/addresses";

export default function AddressSelector({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { addresses, selectedAddress, loading, selectAddress, createAddress, updateAddress, removeAddress, makeDefault } = useAddresses();
  const [editingAddress, setEditingAddress] = useState<Address | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  if (!open) {
    return null;
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end bg-black/40">
        <div className="flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl md:mx-auto md:max-w-3xl md:rounded-3xl">
          <div className="flex items-center justify-between border-b border-slate-200 p-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Delivery Address</p>
              <h2 className="text-2xl font-black text-slate-900">Choose where we should deliver</h2>
            </div>
            <button type="button" onClick={onClose} className="rounded-full border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
              Close
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <button
              type="button"
              onClick={() => {
                setEditingAddress(null);
                setShowEditor(true);
              }}
              className="mb-4 w-full rounded-2xl border border-dashed border-orange-300 bg-orange-50 px-4 py-4 text-left text-sm font-semibold text-orange-700"
            >
              + Add a new address
            </button>

            <div className="space-y-3">
              {loading ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  Loading addresses...
                </div>
              ) : addresses.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  No addresses saved yet.
                </div>
              ) : (
                addresses.map((address) => (
                  <AddressCard
                    key={address.id}
                    address={address}
                    selected={selectedAddress?.id === address.id}
                    onSelect={() => {
                      selectAddress(address.id);
                      onClose();
                    }}
                    onEdit={() => {
                      setEditingAddress(address);
                      setShowEditor(true);
                    }}
                    onDelete={() => removeAddress(address.id)}
                    onSetDefault={() => makeDefault(address.id)}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <AddAddressModal
        open={showEditor}
        initialAddress={editingAddress}
        onClose={() => setShowEditor(false)}
        onSave={async (input, id) => {
          if (id) {
            await updateAddress(id, input);
          } else {
            await createAddress(input);
          }
        }}
      />
    </>
  );
}
