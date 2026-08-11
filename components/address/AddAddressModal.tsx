"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import MapPicker from "@/components/address/MapPicker";
import type { Address, AddressInput } from "@/lib/addresses";

const emptyAddress: AddressInput = {
  label: "Home",
  name: "",
  phone: "",
  addressLine1: "",
  addressLine2: "",
  landmark: "",
  pincode: "",
  latitude: 0,
  longitude: 0,
  isDefault: false,
};

export default function AddAddressModal({
  open,
  initialAddress,
  onClose,
  onSave,
}: {
  open: boolean;
  initialAddress?: Address | null;
  onClose: () => void;
  onSave: (input: AddressInput, id?: string) => Promise<void>;
}) {
  const [form, setForm] = useState<AddressInput>(emptyAddress);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    if (!initialAddress) {
      setForm(emptyAddress);
      return;
    }

    const { id: _id, createdAt: _createdAt, ...rest } = initialAddress;
    setForm(rest);
  }, [initialAddress]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40">
      <div className="flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl md:mx-auto md:max-w-2xl md:rounded-3xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <h2 className="text-2xl font-black text-slate-900">{initialAddress ? "Edit Address" : "Add Address"}</h2>
          <button type="button" onClick={onClose} className="rounded-full border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="relative">
              <select
                value={form.label}
                onChange={(event) => setForm((current) => ({ ...current, label: event.target.value as AddressInput["label"] }))}
                className="appearance-none w-full rounded-2xl border border-slate-300 px-4 py-3 pr-9"
              >
                <option value="Home">Home</option>
                <option value="Work">Work</option>
                <option value="Other">Other</option>
              </select>
              <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" strokeWidth={2.5} />
            </div>
            <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Name" className="rounded-2xl border border-slate-300 px-4 py-3" />
            <input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="Phone" className="rounded-2xl border border-slate-300 px-4 py-3" />
            <input value={form.pincode} onChange={(event) => setForm((current) => ({ ...current, pincode: event.target.value }))} placeholder="Pincode" className="rounded-2xl border border-slate-300 px-4 py-3" />
            <input value={form.addressLine1} onChange={(event) => setForm((current) => ({ ...current, addressLine1: event.target.value }))} placeholder="Address line 1" className="rounded-2xl border border-slate-300 px-4 py-3 sm:col-span-2" />
            <input value={form.addressLine2} onChange={(event) => setForm((current) => ({ ...current, addressLine2: event.target.value }))} placeholder="Address line 2" className="rounded-2xl border border-slate-300 px-4 py-3 sm:col-span-2" />
            <input value={form.landmark} onChange={(event) => setForm((current) => ({ ...current, landmark: event.target.value }))} placeholder="Landmark" className="rounded-2xl border border-slate-300 px-4 py-3 sm:col-span-2" />
            <div className="space-y-3 sm:col-span-2">
              <div>
                <p className="text-sm font-semibold text-slate-700">Select location on map</p>
                <p className="mt-1 text-xs text-slate-500">Search, use your current location, or move the pin to the correct spot.</p>
              </div>
              <MapPicker
                value={form.latitude && form.longitude ? { lat: form.latitude, lng: form.longitude } : null}
                autoLocateOnMount={!initialAddress}
                onChange={(position) =>
                  setForm((current) => ({
                    ...current,
                    latitude: position.lat,
                    longitude: position.lng,
                  }))
                }
                onAddressResolved={(details) =>
                  setForm((current) => ({
                    ...current,
                    addressLine1: details.addressLine1 || current.addressLine1,
                    addressLine2: details.addressLine2 || current.addressLine2,
                    pincode: details.pincode || current.pincode,
                    landmark: details.landmark || current.landmark,
                  }))
                }
              />
            </div>
          </div>

          <label className="mt-4 flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3">
            <input type="checkbox" checked={form.isDefault} onChange={(event) => setForm((current) => ({ ...current, isDefault: event.target.checked }))} />
            <span className="text-sm font-semibold text-slate-700">Set as default address</span>
          </label>

          {error ? <p className="mt-4 text-sm font-medium text-rose-600">{error}</p> : null}
        </div>

        <div className="border-t border-slate-200 p-4">
          <button
            type="button"
            onClick={async () => {
              if (!form.latitude || !form.longitude) {
                setError("Please select location on the map.");
                return;
              }

              setSaving(true);
              setError("");
              try {
                await onSave(form, initialAddress?.id);
                onClose();
              } finally {
                setSaving(false);
              }
            }}
            className="w-full rounded-2xl bg-orange-600 px-5 py-4 text-base font-semibold text-white"
          >
            {saving ? "Saving..." : initialAddress ? "Update Address" : "Save Address"}
          </button>
        </div>
      </div>
    </div>
  );
}
