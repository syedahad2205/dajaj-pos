'use client';

import { useEffect } from 'react';
import { trackEvent } from '@/lib/analytics';

export default function MenuPageTracker() {
  useEffect(() => {
    const startedAt = Date.now();
    void trackEvent('menu_open');

    return () => {
      const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      void trackEvent('menu_time_spent', { seconds });
    };
  }, []);

  return null;
}

