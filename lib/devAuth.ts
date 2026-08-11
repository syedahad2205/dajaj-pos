"use client";

import { ADMIN_BYPASS_CODE, ADMIN_BYPASS_SESSION_KEY, isAdminBypassAllowed } from "@/lib/devAuthShared";

export { ADMIN_BYPASS_CODE, ADMIN_BYPASS_SESSION_KEY };

// Both functions below are hard-gated on isAdminBypassAllowed() (NODE_ENV !==
// "production") so the bypass code can never grant access in a deployed
// environment, regardless of what's sitting in a browser's localStorage.
export function hasAdminBypassSession() {
  if (!isAdminBypassAllowed() || typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(ADMIN_BYPASS_SESSION_KEY) === ADMIN_BYPASS_CODE;
}

export function setAdminBypassSession() {
  if (!isAdminBypassAllowed() || typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(ADMIN_BYPASS_SESSION_KEY, ADMIN_BYPASS_CODE);
}

export function clearAdminBypassSession() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(ADMIN_BYPASS_SESSION_KEY);
}
