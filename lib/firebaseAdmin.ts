import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * Lazily-initialized Firebase Admin SDK app, used exclusively by the
 * server-only mobile API route families (mobile auth login + identity
 * verification for mobile mutation routes). The service account credential
 * is read from environment variables at first use — never hard-coded and
 * never committed to the repo. See `.env.local.example` for the required
 * variable names.
 *
 * The private key env var commonly has literal `\n` sequences when stored
 * as a single-line environment variable (Vercel, most secret managers) —
 * those are converted back to real newlines below.
 */
let adminApp: App | undefined;

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable "${name}" for the Firebase Admin SDK. ` +
        `See .env.local.example for the full list of required variables.`,
    );
  }
  return value;
}

function getAdminApp(): App {
  if (adminApp) {
    return adminApp;
  }

  const existingApps = getApps();
  if (existingApps.length > 0) {
    adminApp = existingApps[0];
    return adminApp;
  }

  const projectId = readRequiredEnv("FIREBASE_ADMIN_PROJECT_ID");
  const clientEmail = readRequiredEnv("FIREBASE_ADMIN_CLIENT_EMAIL");
  const privateKey = readRequiredEnv("FIREBASE_ADMIN_PRIVATE_KEY").replace(/\\n/g, "\n");

  adminApp = initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });

  return adminApp;
}

let adminAuth: Auth | undefined;
let adminFirestore: Firestore | undefined;

/** Returns the (lazily-created) Firebase Admin Auth instance. */
export function getAdminAuth(): Auth {
  if (!adminAuth) {
    adminAuth = getAuth(getAdminApp());
  }
  return adminAuth;
}

/** Returns the (lazily-created) Firebase Admin Firestore instance. */
export function getAdminFirestore(): Firestore {
  if (!adminFirestore) {
    adminFirestore = getFirestore(getAdminApp());
  }
  return adminFirestore;
}
