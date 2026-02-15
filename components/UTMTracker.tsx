'use client';

import { useEffect } from 'react';

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign'] as const;

export default function UTMTracker() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const hasStoredUtm = UTM_KEYS.some((key) => window.sessionStorage.getItem(key));
    if (hasStoredUtm) return;

    const search = new URLSearchParams(window.location.search);
    UTM_KEYS.forEach((key) => {
      const value = search.get(key);
      if (value) window.sessionStorage.setItem(key, value);
    });
  }, []);

  return null;
}

