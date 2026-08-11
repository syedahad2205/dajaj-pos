// Lightweight network-level loading tracker.
//
// Patches `window.fetch` once and counts in-flight requests to this app's
// own `/api/*` routes (Finance, Zomato, Inventory, POS, etc). This is
// intentionally scoped to same-origin `/api/*` calls so it never fires for
// Next.js route prefetching, Firebase's own websocket/gRPC traffic, Google
// Maps, or other third-party network activity.
//
// Consumers read the current state via `subscribe`/`getSnapshot`
// (designed for React's `useSyncExternalStore`) instead of a Context
// provider, so this adds zero extra re-renders anywhere except the single
// overlay component that displays it.

type Listener = () => void;

let activeCount = 0;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((listener) => listener());
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function isTrackedApiRequest(url: string): boolean {
  try {
    const resolved = new URL(url, window.location.origin);
    return resolved.origin === window.location.origin && resolved.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

export function installGlobalFetchLoader() {
  if (typeof window === "undefined") return;
  // Guard on `window` (not a module-level flag) so this survives Next.js
  // Fast Refresh / HMR re-evaluating this module during development.
  if ((window as any).__dajajFetchLoaderInstalled) return;
  (window as any).__dajajFetchLoaderInstalled = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = (async (...args: Parameters<typeof fetch>) => {
    const track = isTrackedApiRequest(resolveUrl(args[0]));

    if (track) {
      activeCount += 1;
      emit();
    }

    try {
      return await originalFetch(...args);
    } finally {
      if (track) {
        activeCount = Math.max(0, activeCount - 1);
        emit();
      }
    }
  }) as typeof fetch;
}

export function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot() {
  return activeCount > 0;
}

export function getServerSnapshot() {
  return false;
}
