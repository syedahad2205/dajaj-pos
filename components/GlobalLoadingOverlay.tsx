"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getServerSnapshot, getSnapshot, installGlobalFetchLoader, subscribe } from "@/lib/globalApiLoader";

// Avoids flicker on very fast calls (<150ms) and avoids flashing on/off
// when several calls fire back-to-back.
const SHOW_DELAY_MS = 150;
const MIN_VISIBLE_MS = 300;

export default function GlobalLoadingOverlay() {
  const isActive = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [visible, setVisible] = useState(false);
  const shownAtRef = useRef<number | null>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    installGlobalFetchLoader();
  }, []);

  useEffect(() => {
    clearTimeout(showTimerRef.current);
    clearTimeout(hideTimerRef.current);

    if (isActive) {
      showTimerRef.current = setTimeout(() => {
        shownAtRef.current = Date.now();
        setVisible(true);
      }, SHOW_DELAY_MS);
    } else if (shownAtRef.current !== null) {
      const elapsed = Date.now() - shownAtRef.current;
      const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed);
      hideTimerRef.current = setTimeout(() => {
        setVisible(false);
        shownAtRef.current = null;
      }, remaining);
    } else {
      setVisible(false);
    }

    return () => {
      clearTimeout(showTimerRef.current);
      clearTimeout(hideTimerRef.current);
    };
  }, [isActive]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40"
      role="status"
      aria-live="polite"
      aria-label="Loading"
    >
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-white/30 border-t-orange-500" />
    </div>
  );
}
