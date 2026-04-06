declare global {
  var __dajajFirestoreReadCount: number | undefined;
}

function isReadDebugEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_FIRESTORE_DEBUG_READS === "true";
}

function serializeDetails(details?: Record<string, unknown>) {
  if (!details) {
    return "";
  }

  return Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : "";
}

export function trackFirestoreRead(label: string, details?: Record<string, unknown>) {
  if (!isReadDebugEnabled()) {
    return;
  }

  globalThis.__dajajFirestoreReadCount = (globalThis.__dajajFirestoreReadCount ?? 0) + 1;
  console.log(
    `🔥 Firestore Read #${globalThis.__dajajFirestoreReadCount} → ${label}${serializeDetails(details)} @ ${new Date().toISOString()}`,
  );
}

export function logFirestoreDebug(label: string, details?: Record<string, unknown>) {
  if (!isReadDebugEnabled()) {
    return;
  }

  console.log(`🧭 ${label}${serializeDetails(details)} @ ${new Date().toISOString()}`);
}
