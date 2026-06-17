"use client";

import { useEffect, useState, useCallback } from "react";
import { requireAdmin } from "@/lib/roleGuard";
import {
  subscribeToDevices,
  designatePrimaryPrinter,
  formatTimeSinceHeartbeat,
  type DeviceRecord,
} from "@/services/deviceService";

const RESTAURANT_ID = "dajaj_main";

export default function DeviceManagementPage() {
  const { authenticated, loading, role } = requireAdmin();
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [designating, setDesignating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Refresh heartbeat display every 30 seconds
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!authenticated || role !== "admin") return;

    const unsubscribe = subscribeToDevices(RESTAURANT_ID, setDevices);
    return () => unsubscribe();
  }, [authenticated, role]);

  const handleDesignate = useCallback(async (device: DeviceRecord) => {
    if (device.status === "offline") {
      setError("Cannot designate an offline device as primary printer. Only online devices can be designated.");
      setSuccess(null);
      return;
    }

    setDesignating(device.id);
    setError(null);
    setSuccess(null);

    try {
      await designatePrimaryPrinter(device.id, RESTAURANT_ID);
      setSuccess(`"${device.deviceName}" is now the primary printer.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to designate primary printer.");
    } finally {
      setDesignating(null);
    }
  }, []);

  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10">Checking your session...</main>;
  }

  if (!authenticated || role !== "admin") {
    return null;
  }

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-4xl space-y-4">
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <h1 className="text-3xl font-black">Device Management</h1>
          <p className="mt-2 text-sm text-slate-600">
            Monitor connected Android POS devices and designate the primary print node.
          </p>
        </header>

        {error && (
          <div
            className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700"
            role="alert"
          >
            {error}
          </div>
        )}

        {success && (
          <div
            className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700"
            role="status"
          >
            {success}
          </div>
        )}

        {devices.length === 0 ? (
          <section className="rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-sm">
            <p className="text-lg font-semibold text-slate-500">No devices registered</p>
            <p className="mt-1 text-sm text-slate-400">
              Devices will appear here once an Android POS app registers with this restaurant.
            </p>
          </section>
        ) : (
          <section className="space-y-3">
            {devices.map((device) => (
              <DeviceCard
                key={device.id}
                device={device}
                isDesignating={designating === device.id}
                onDesignate={handleDesignate}
              />
            ))}
          </section>
        )}
      </div>
    </main>
  );
}

interface DeviceCardProps {
  device: DeviceRecord;
  isDesignating: boolean;
  onDesignate: (device: DeviceRecord) => void;
}

function DeviceCard({ device, isDesignating, onDesignate }: DeviceCardProps) {
  const isOnline = device.status === "online";

  return (
    <div className="flex flex-col gap-4 rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-slate-900">{device.deviceName}</h2>
          {device.isPrimaryPrinter && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
              <StarIcon />
              Primary
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-1.5 text-sm font-medium ${
              isOnline ? "text-emerald-600" : "text-rose-600"
            }`}
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                isOnline ? "bg-emerald-500" : "bg-rose-500"
              }`}
              aria-hidden="true"
            />
            {isOnline ? "Online" : "Offline"}
          </span>

          <span className="text-sm text-slate-400">
            Last heartbeat: {formatTimeSinceHeartbeat(device.lastHeartbeat)}
          </span>
        </div>
      </div>

      <div className="flex-shrink-0">
        {device.isPrimaryPrinter ? (
          <span className="text-sm font-medium text-slate-400">Current primary</span>
        ) : (
          <button
            type="button"
            disabled={isDesignating || !isOnline}
            onClick={() => onDesignate(device)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
              isOnline
                ? "bg-orange-600 text-white hover:bg-orange-700"
                : "border border-slate-300 text-slate-400 cursor-not-allowed"
            }`}
            aria-label={`Set ${device.deviceName} as primary printer`}
          >
            {isDesignating ? "Setting…" : "Set as Primary"}
          </button>
        )}
      </div>
    </div>
  );
}

function StarIcon() {
  return (
    <svg
      className="h-3 w-3"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
    </svg>
  );
}
