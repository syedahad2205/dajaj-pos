'use client';

import { logEvent } from 'firebase/analytics';
import { initFirebaseAnalytics } from '@/lib/firebase';

type EventParams = Record<string, string | number | boolean | null | undefined>;

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign'] as const;

type UtmKey = (typeof UTM_KEYS)[number];
type UtmParams = Partial<Record<UtmKey, string>>;

function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

function readUtmFromUrl(): UtmParams {
  if (!hasWindow()) return {};

  const params = new URLSearchParams(window.location.search);
  const utm: UtmParams = {};

  UTM_KEYS.forEach((key) => {
    const value = params.get(key);
    if (value) utm[key] = value;
  });

  return utm;
}

function readUtmFromSession(): UtmParams {
  if (!hasWindow()) return {};

  const utm: UtmParams = {};
  UTM_KEYS.forEach((key) => {
    const value = window.sessionStorage.getItem(key);
    if (value) utm[key] = value;
  });
  return utm;
}

function persistUtm(utm: UtmParams): void {
  if (!hasWindow()) return;

  UTM_KEYS.forEach((key) => {
    const value = utm[key];
    if (value) window.sessionStorage.setItem(key, value);
  });
}

function getUtmContext(): UtmParams {
  const stored = readUtmFromSession();
  if (Object.keys(stored).length > 0) return stored;

  const fromUrl = readUtmFromUrl();
  if (Object.keys(fromUrl).length > 0) persistUtm(fromUrl);
  return fromUrl;
}

export async function trackEvent(name: string, params: EventParams = {}): Promise<void> {
  if (!hasWindow()) return;

  try {
    const analytics = await initFirebaseAnalytics();
    if (!analytics) return;

    const utm = getUtmContext();
    logEvent(analytics, name, {
      ...params,
      ...utm,
    });
  } catch {
    // Silent fail to avoid impacting UX in production.
  }
}

