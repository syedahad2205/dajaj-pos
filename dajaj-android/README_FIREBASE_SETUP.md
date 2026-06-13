# Firebase Setup Guide

This guide explains how to set up Firebase for the Dajaj POS Android application.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+) for Firebase CLI
- [Firebase CLI](https://firebase.google.com/docs/cli) installed globally: `npm install -g firebase-tools`
- A Google account with access to Firebase Console
- Android Studio with the project open

## Option 1: Local Development with Firebase Emulators (Recommended)

The Firebase Emulator Suite lets you run the full backend locally without a real Firebase project.

### 1. Install Firebase CLI

```bash
npm install -g firebase-tools
```

### 2. Start Emulators

From the `dajaj-android/` directory:

```bash
firebase emulators:start
```

This starts:
- **Auth Emulator** on port `9099`
- **Firestore Emulator** on port `8080`
- **Emulator UI** on port `4000` (open http://localhost:4000 in your browser)

### 3. Configure Android App for Emulators

In your app's initialization code (e.g., `DajajApplication.kt`), connect to emulators in debug builds:

```kotlin
if (BuildConfig.DEBUG) {
    Firebase.firestore.useEmulator("10.0.2.2", 8080)
    Firebase.auth.useEmulator("10.0.2.2", 9099)
}
```

> **Note:** Use `10.0.2.2` for Android Emulator (maps to host `localhost`).
> For a physical device on the same network, use your machine's local IP address.

### 4. Seed Test Data (Optional)

Open the Emulator UI at http://localhost:4000 and manually add documents, or create a seed script.

---

## Option 2: Real Firebase Project Setup

### 1. Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project"
3. Name it `dajaj-pos-dev` (or your preferred name)
4. Enable Google Analytics (optional)
5. Wait for project creation

### 2. Register the Android App

1. In Firebase Console, click "Add app" → Android
2. Enter package name: `com.dajaj.pos`
3. (Optional) Enter app nickname: "Dajaj POS"
4. (Optional) Enter debug signing certificate SHA-1:
   ```bash
   cd dajaj-android
   ./gradlew signingReport
   ```
5. Download `google-services.json`
6. Place it in `dajaj-android/app/google-services.json` (replacing the placeholder)

### 3. Enable Firebase Services

In Firebase Console:

**Authentication:**
1. Go to Authentication → Sign-in method
2. Enable "Email/Password" provider

**Firestore:**
1. Go to Firestore Database → Create database
2. Select "Start in production mode"
3. Choose a region close to your users (e.g., `asia-south1` for India)

### 4. Deploy Security Rules

```bash
cd dajaj-android
firebase login
firebase use --add  # Select your project
firebase deploy --only firestore:rules
```

### 5. Deploy Indexes

```bash
firebase deploy --only firestore:indexes
```

---

## Configuration Files

| File | Purpose | Git Tracked |
|------|---------|-------------|
| `app/google-services.json` | Firebase SDK config (your project credentials) | No (`.gitignore`) |
| `app/google-services.json.example` | Template showing required structure | Yes |
| `firebase.json` | Firebase CLI configuration and emulator ports | Yes |
| `firestore.rules` | Firestore security rules | Yes |
| `firestore.indexes.json` | Composite index definitions | Yes |

## google-services.json

The `google-services.json` file is **not tracked in git** for security reasons. Each developer must:

1. Copy `app/google-services.json.example` to `app/google-services.json`
2. Replace placeholder values with real credentials from their Firebase project
3. Or use the emulator setup (Option 1) which works with the placeholder file

**Required fields to replace:**
- `project_number` — Your Firebase project number
- `project_id` — Your Firebase project ID
- `storage_bucket` — Your project's storage bucket
- `mobilesdk_app_id` — The app ID from Firebase Console
- `current_key` — Your Android API key

---

## Firestore Security Rules

The security rules (`firestore.rules`) enforce role-based access control:

| Collection | Read | Write |
|-----------|------|-------|
| `menus` | Public | Manager, Admin |
| `orders` | Authenticated | Staff (Cashier, Manager, Admin) |
| `pending_orders` | Authenticated | Create: Public, Update: Staff |
| `print_jobs` | Staff | Staff |
| `devices` | Staff | Staff |
| `users` | Self + Manager/Admin | Self + Admin |
| `bills` | Public | Staff |
| `counters` | Staff | Staff |
| `reports` | Manager/Admin | Manager/Admin |

---

## Firestore Indexes

Composite indexes are defined in `firestore.indexes.json`. These are required for queries that filter/sort on multiple fields. Deploy them before the app queries will work correctly.

---

## Troubleshooting

### Build fails with "File google-services.json is missing"
Copy the example file: `cp app/google-services.json.example app/google-services.json`

### Emulator won't start
- Ensure ports 4000, 8080, and 9099 are not in use
- Try: `firebase emulators:start --only firestore,auth`

### App can't connect to emulator on physical device
- Use your computer's local IP instead of `10.0.2.2`
- Ensure your device and computer are on the same network
- Check firewall settings

### Permission denied errors in production
- Verify the user document exists in the `users` collection with the correct `role` field
- Check that security rules are deployed: `firebase deploy --only firestore:rules`
