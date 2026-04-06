"use client";

import { ADMIN_BYPASS_CODE, ADMIN_BYPASS_SESSION_KEY } from "@/lib/devAuthShared";

export { ADMIN_BYPASS_CODE, ADMIN_BYPASS_SESSION_KEY };

export function hasAdminBypassSession() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(ADMIN_BYPASS_SESSION_KEY) === ADMIN_BYPASS_CODE;
}

export function setAdminBypassSession() {
  if (typeof window === "undefined") {
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
