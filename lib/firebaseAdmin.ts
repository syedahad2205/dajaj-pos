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

  console.log('[firebaseAdmin] Initializing Firebase Admin SDK...');
  
  try {
    const projectId = readRequiredEnv("FIREBASE_ADMIN_PROJECT_ID");
    console.log('[firebaseAdmin] ✓ Project ID loaded:', projectId);
    
    const clientEmail = readRequiredEnv("FIREBASE_ADMIN_CLIENT_EMAIL");
    console.log('[firebaseAdmin] ✓ Client email loaded:', clientEmail);
    
    const rawPrivateKey = readRequiredEnv("FIREBASE_ADMIN_PRIVATE_KEY");
    console.log('[firebaseAdmin] ✓ Private key loaded, raw length:', rawPrivateKey.length);
    console.log('[firebaseAdmin] Private key starts with quotes:', rawPrivateKey.startsWith('"'));
    console.log('[firebaseAdmin] Private key ends with quotes:', rawPrivateKey.endsWith('"'));
    console.log('[firebaseAdmin] Private key first 50 chars:', rawPrivateKey.substring(0, 50));
    console.log('[firebaseAdmin] Private key has literal \\n:', rawPrivateKey.includes('\\n'));
    console.log('[firebaseAdmin] Private key has actual newlines:', rawPrivateKey.includes('\n'));
    
    const privateKey = rawPrivateKey.replace(/\\n/g, "\n");
    console.log('[firebaseAdmin] ✓ Private key processed, final length:', privateKey.length);
    console.log('[firebaseAdmin] Final key starts with:', privateKey.substring(0, 30));

    adminApp = initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
    
    console.log('[firebaseAdmin] ✓ Firebase Admin SDK initialized successfully');
  } catch (error) {
    console.error('[firebaseAdmin] ❌ Failed to initialize Firebase Admin SDK:', error);
    console.error('[firebaseAdmin] Error details:', error instanceof Error ? error.message : String(error));
    throw error;
  }

  return adminApp;
}

let adminAuth: Auth | undefined;
let adminFirestore: Firestore | undefined;

/** Returns the (lazily-created) Firebase Admin Auth instance. */
export function getAdminAuth(): Auth {
  console.log('[firebaseAdmin] getAdminAuth() called');
  if (!adminAuth) {
    console.log('[firebaseAdmin] Creating Admin Auth instance...');
    adminAuth = getAuth(getAdminApp());
    console.log('[firebaseAdmin] ✓ Admin Auth instance created');
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

// Note: an earlier pass of this file added a Quick Entry screenshot-upload
// helper here (Admin SDK → Firebase Storage). Removed by explicit request —
// Quick Entry no longer persists the payment screenshot anywhere; it's sent
// to the AI for extraction and then discarded. If screenshot retention is
// wanted again later, re-add a getAdminStorage()/upload helper here (and
// note Firebase Storage isn't provisioned for this project yet — the
// default bucket doesn't exist, so that would need setting up first).
