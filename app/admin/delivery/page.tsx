"use client";

import { useEffect, useMemo, useState } from "react";
import MapPicker from "@/components/address/MapPicker";
import type { DeliveryZone } from "@/lib/delivery";
import { requireAdmin } from "@/lib/roleGuard";
import {
  getDefaultDeliverySettings,
  getDeliverySettings,
  saveDeliverySettings,
  type DeliverySettings,
} from "@/services/deliveryService";

function validateZones(zones: DeliveryZone[]) {
  if (zones.length === 0) {
    return "Add at least one delivery zone.";
  }

  const radii = zones.map((zone) => zone.radiusKm);
  const unique = new Set(radii);
  if (unique.size !== radii.length) {
    return "Each delivery zone radius must be unique.";
  }

  for (let index = 0; index < zones.length; index += 1) {
    const zone = zones[index];
    if (zone.radiusKm <= 0) {
      return "Each delivery radius must be greater than 0.";
    }

    if (zone.fee < 0) {
      return "Delivery fee cannot be negative.";
    }

    if (index > 0 && zone.radiusKm <= zones[index - 1].radiusKm) {
      return "Delivery zones must be in increasing radius order.";
    }
  }

  return "";
}

export default function AdminDeliveryPage() {
  const { authenticated, loading, role } = requireAdmin();
  const [settings, setSettings] = useState<DeliverySettings>(getDefaultDeliverySettings());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authenticated) {
      return;
    }

    let cancelled = false;
    void getDeliverySettings()
      .then((nextSettings) => {
        if (cancelled) {
          return;
        }

        setSettings(nextSettings);
      })
      .catch((settingsError) => {
        if (cancelled) {
          return;
        }

        setError(settingsError instanceof Error ? settingsError.message : "Failed to load delivery settings.");
      });

    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  const sortedZones = useMemo(
    () => [...settings.deliveryZones].sort((a, b) => a.radiusKm - b.radiusKm),
    [settings.deliveryZones],
  );

  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10">Checking your session...</main>;
  }

  if (!authenticated || role !== "admin") {
    return null;
  }

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-5xl rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
        <h1 className="text-3xl font-black">Delivery Settings</h1>
        <p className="mt-2 text-sm text-slate-600">Set your kitchen location and define delivery pricing by distance.</p>

        <section className="mt-6 space-y-3">
          <div>
            <h2 className="text-xl font-black">Restaurant Location</h2>
            <p className="mt-1 text-sm text-slate-500">Search location or drag the pin to the exact restaurant location.</p>
          </div>
          <MapPicker
            value={settings.restaurantLocation}
            onChange={(position) =>
              setSettings((current) => ({
                ...current,
                restaurantLocation: position,
              }))
            }
            circles={sortedZones.map((zone, index) => ({
              radiusKm: zone.radiusKm,
              color: ["#f97316", "#fb923c", "#fdba74"][index % 3],
            }))}
          />
        </section>

        <section className="mt-8">
          <div className="mb-4">
            <h2 className="text-xl font-black">Delivery Zones</h2>
            <p className="mt-1 text-sm text-slate-500">Set the maximum delivery radius and fee for each distance slab.</p>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 px-1 text-sm font-semibold text-slate-500">
              <span>Radius (km)</span>
              <span>Delivery Fee</span>
              <span />
            </div>

            {settings.deliveryZones.map((zone, index) => (
              <div key={`${zone.radiusKm}-${index}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={zone.radiusKm}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      deliveryZones: current.deliveryZones.map((entry, entryIndex) =>
                        entryIndex === index ? { ...entry, radiusKm: Number(event.target.value) || 0 } : entry,
                      ),
                    }))
                  }
                  className="rounded-2xl border border-slate-300 px-4 py-3"
                />
                <input
                  type="number"
                  min="0"
                  value={zone.fee}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      deliveryZones: current.deliveryZones.map((entry, entryIndex) =>
                        entryIndex === index ? { ...entry, fee: Number(event.target.value) || 0 } : entry,
                      ),
                    }))
                  }
                  className="rounded-2xl border border-slate-300 px-4 py-3"
                />
                <button
                  type="button"
                  onClick={() =>
                    setSettings((current) => ({
                      ...current,
                      deliveryZones: current.deliveryZones.filter((_, entryIndex) => entryIndex !== index),
                    }))
                  }
                  className="rounded-xl border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-700"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() =>
              setSettings((current) => ({
                ...current,
                deliveryZones: [...current.deliveryZones, { radiusKm: (current.deliveryZones.at(-1)?.radiusKm ?? 0) + 1, fee: 0 }],
              }))
            }
            className="mt-4 rounded-xl border border-dashed border-orange-300 px-4 py-3 text-sm font-semibold text-orange-700"
          >
            Add Delivery Zone
          </button>
        </section>

        <section className="mt-8">
          <label className="mb-2 block text-sm font-semibold text-slate-700">Minimum Order</label>
          <input
            type="number"
            min="0"
            value={settings.minimumOrder}
            onChange={(event) => setSettings((current) => ({ ...current, minimumOrder: Number(event.target.value) || 0 }))}
            className="w-full rounded-2xl border border-slate-300 px-4 py-3"
          />
        </section>

        {error ? <p className="mt-4 text-sm font-medium text-rose-600">{error}</p> : null}

        <button
          type="button"
          onClick={async () => {
            if (!settings.restaurantLocation.lat || !settings.restaurantLocation.lng) {
              setError("Please select the restaurant location on the map.");
              return;
            }

            const nextZones = [...settings.deliveryZones].sort((a, b) => a.radiusKm - b.radiusKm);
            const validationError = validateZones(nextZones);
            if (validationError) {
              setError(validationError);
              return;
            }

            setSaving(true);
            setError("");
            try {
              await saveDeliverySettings({
                ...settings,
                deliveryZones: nextZones,
              });
            } finally {
              setSaving(false);
            }
          }}
          className="mt-6 rounded-2xl bg-orange-600 px-5 py-4 text-base font-semibold text-white"
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </main>
  );
}
