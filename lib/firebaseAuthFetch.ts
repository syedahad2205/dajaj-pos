"use client";

import { auth } from "@/lib/firebase";
import { hasAdminBypassSession } from "@/lib/devAuth";

function getMissingSessionMessage() {
  if (hasAdminBypassSession()) {
    return "This inventory action requires a real Firebase login. The local admin bypass session does not include a Firestore auth token.";
  }

  return "Your Firebase session is missing or expired. Please sign in again.";
}

export async function firebaseAuthedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const user = auth.currentUser;
  if (!user) {
    throw new Error(getMissingSessionMessage());
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${await user.getIdToken()}`);

  return fetch(input, {
    ...init,
    headers,
  });
}
