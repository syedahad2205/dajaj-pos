import { deleteApp, initializeServerApp } from "firebase/app";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

class FirebaseRouteAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FirebaseRouteAuthError";
  }
}

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

function readBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new FirebaseRouteAuthError("Missing Firebase ID token.");
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    throw new FirebaseRouteAuthError("Missing Firebase ID token.");
  }

  return token;
}

async function waitForServerAuth(auth: ReturnType<typeof getAuth>) {
  // Token-based server apps often hydrate the user synchronously; avoid waiting on a listener.
  await Promise.resolve();
  if (auth.currentUser) {
    return;
  }

  const ready = (auth as { authStateReady?: () => Promise<void> }).authStateReady;
  if (typeof ready === "function") {
    await ready.call(auth);
    if (auth.currentUser) {
      return;
    }
  }

  await new Promise<void>((resolve, reject) => {
    let done = false;
    const timeoutMs = 12_000;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      unsubscribe();
      reject(new FirebaseRouteAuthError("Auth did not become ready in time."));
    }, timeoutMs);

    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        if (!user || done) return;
        done = true;
        clearTimeout(timer);
        unsubscribe();
        resolve();
      },
      (error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        unsubscribe();
        reject(error);
      },
    );
  });
}

export async function getAuthenticatedFirestoreForRequest(request: Request): Promise<{
  cleanup: () => Promise<void>;
  firestore: Firestore;
  userEmail: string | null;
  userId: string;
}> {
  const authIdToken = readBearerToken(request);
  const serverApp = initializeServerApp(firebaseConfig, { authIdToken });

  try {
    const auth = getAuth(serverApp);
    await waitForServerAuth(auth);

    if (!auth.currentUser) {
      throw new FirebaseRouteAuthError("Invalid or expired Firebase session.");
    }

    return {
      // Deliberately not awaited by callers before responding — see the
      // route handlers, which fire this after building the response instead
      // of blocking on it. Tearing down the ephemeral app has no bearing on
      // data that's already been committed.
      cleanup: () => deleteApp(serverApp),
      firestore: getFirestore(serverApp),
      userEmail: auth.currentUser.email ?? null,
      userId: auth.currentUser.uid,
    };
  } catch (error) {
    await deleteApp(serverApp).catch(() => undefined);
    throw error;
  }
}

export function isFirebaseRouteAuthError(error: unknown): error is FirebaseRouteAuthError {
  return error instanceof FirebaseRouteAuthError;
}
