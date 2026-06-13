# Developer Onboarding

## Overview

This guide walks you through setting up the Dajaj Ecosystem for local development. The system has two main codebases:

1. **Web Application** (Next.js) — Menu Builder, Inventory, Customer Website, Reports, Admin
2. **Android POS** (Kotlin) — Cashier operations, Bluetooth printing, KOT workflow

Both communicate exclusively through Firebase Firestore.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 18+ (see `.nvmrc`) | Next.js web application |
| npm or yarn | Latest | Package management |
| Android Studio | Latest (Hedgehog+) | Android POS development |
| JDK | 17 | Android Gradle builds |
| Firebase CLI | Latest | Emulator suite, deployment |
| Git | Latest | Version control |

---

## Step 1: Run the Next.js Web Application Locally

### Clone and Install

```bash
git clone <repository-url>
cd dajaj-pos
nvm use              # Uses version from .nvmrc
npm install          # Install dependencies
```

### Environment Setup

Create a `.env.local` file in the project root (or copy from the provided template):

```bash
# Firebase configuration
NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
NEXT_PUBLIC_FIREBASE_APP_ID=your-app-id

# WhatsApp configuration
NEXT_PUBLIC_WHATSAPP_NUMBER=+91XXXXXXXXXX
```

### Run Development Server

```bash
npm run dev
```

The web app runs at `http://localhost:3000`.

### Key Routes

| Route | Purpose |
|-------|---------|
| `/menu` | Customer-facing online menu |
| `/checkout` | Customer checkout flow |
| `/admin` | Admin dashboard |
| `/admin/menu-builder` | Menu Builder (CRUD operations) |
| `/admin/inventory` | Inventory management |
| `/admin/orders` | Delivery order tracking |
| `/admin/sales` | Sales reports |

### Build Verification

```bash
npm run build        # Verify production build works
npm run lint         # Check for lint errors
```

---

## Step 2: Run the Android Project

### Open in Android Studio

1. Open Android Studio
2. File → Open → Select `dajaj-pos/dajaj-android/` directory
3. Wait for Gradle sync to complete (may take several minutes on first run)

### Configure Firebase for Android

1. Download `google-services.json` from Firebase Console
2. Place it in `dajaj-android/app/` directory
3. Verify the package name matches: `com.dajaj.pos`

### Build and Run

```bash
cd dajaj-android

# Build debug APK
./gradlew assembleDebug

# Run on connected device or emulator
./gradlew installDebug

# Run all unit tests
./gradlew testDebugUnitTest

# Run lint checks
./gradlew lintDebug
```

### Android Studio Setup

1. **SDK:** Install Android SDK 34 (API level 34)
2. **Emulator:** Create a tablet emulator (10" landscape recommended for POS testing)
3. **Bluetooth:** Physical device required for Bluetooth printer testing
4. **Min SDK:** API 26 (Android 8.0)

### Module Structure

The project uses a multi-module Gradle setup. Key modules:

```
dajaj-android/
├── app/                    # Main application module
├── feature-pos/            # POS screen
├── feature-pending-orders/ # Pending orders
├── feature-kitchen/        # Kitchen queue
├── feature-reports/        # Reports
├── feature-settings/       # Settings
├── core-domain/            # Business logic (pure Kotlin)
├── core-data/              # Data sources (Firestore, Room)
├── core-bluetooth/         # Bluetooth printer module
├── core-print-agent/       # Print Agent service
├── core-ui/                # Shared UI components
└── core-common/            # Utilities
```

---

## Step 3: Firebase Emulator Setup

The Firebase Emulator Suite lets you develop locally without affecting production data.

### Install Firebase CLI

```bash
npm install -g firebase-tools
firebase login
```

### Initialize Emulators

```bash
cd dajaj-pos
firebase init emulators
```

Select the following emulators:
- **Firestore** (port 8080)
- **Authentication** (port 9099)
- **UI** (port 4000)

### Start Emulators

```bash
firebase emulators:start
```

The Emulator UI runs at `http://localhost:4000`.

### Connect Web App to Emulators

In your Next.js code, the Firebase SDK auto-connects to emulators when configured:

```typescript
import { connectFirestoreEmulator } from 'firebase/firestore';
import { connectAuthEmulator } from 'firebase/auth';

if (process.env.NODE_ENV === 'development') {
  connectFirestoreEmulator(db, 'localhost', 8080);
  connectAuthEmulator(auth, 'http://localhost:9099');
}
```

### Connect Android App to Emulators

In your Android app (debug build):

```kotlin
// In your Application class or DI module (debug only)
Firebase.firestore.useEmulator("10.0.2.2", 8080)  // 10.0.2.2 = host from emulator
Firebase.auth.useEmulator("10.0.2.2", 9099)
```

Note: Use `10.0.2.2` for Android emulator (maps to host localhost). For physical devices, use your computer's local IP.

### Seed Test Data

```bash
# Import sample data into emulator
firebase emulators:start --import=./firebase-seed-data

# Export current emulator state for sharing
firebase emulators:export ./firebase-seed-data
```

### Firestore Rules Testing

```bash
# Run security rules tests
firebase emulators:exec --only firestore "npm run test:rules"
```

---

## Step 4: Pair a Bluetooth Printer

Bluetooth printer testing requires a physical Android device and a compatible ESC/POS thermal printer.

### Compatible Printers

Any Bluetooth thermal printer supporting:
- Bluetooth SPP (Serial Port Profile)
- ESC/POS command set
- 58mm or 80mm paper width

Common models: generic 58mm BT printers, Epson TM series, Star TSP series.

### Pairing Steps

1. **Power on** the Bluetooth printer
2. **Enable Bluetooth** on your Android device
3. **Open the Dajaj POS app** → Settings → Printer Management
4. **Tap "Scan for Printers"** — discovery runs for 15 seconds
5. **Select** the discovered printer from the list
6. **Accept** the pairing request on both devices (PIN usually 1234 or 0000)
7. **Tap "Test Print"** to verify the connection
8. **Assign role** — set as KOT printer or Bill printer

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Printer not found | Ensure printer is in pairing mode, try power cycling |
| Pairing failed | Forget device in Android Bluetooth settings, re-pair |
| Test print failed | Check printer has paper, verify Bluetooth is connected |
| Garbled output | Verify printer supports ESC/POS, check character encoding |
| Connection drops | Ensure printer is within Bluetooth range (~10m) |

### Development Without Printer

For UI development without a physical printer:
- Print jobs are still created in Firestore (you can verify via emulator UI)
- The Print Agent will show "printer disconnected" status
- Use Firestore emulator UI to manually update job statuses for testing

---

## Step 5: Architecture References

Before contributing, familiarize yourself with these architecture documents:

| Document | What You'll Learn |
|----------|-------------------|
| [SYSTEM_ARCHITECTURE.md](./SYSTEM_ARCHITECTURE.md) | High-level system overview, component boundaries, data flows, user flows |
| [FIRESTORE_SCHEMA.md](./FIRESTORE_SCHEMA.md) | All collections, document structures, field types, indexes, security rules |
| [PRINTING_ARCHITECTURE.md](./PRINTING_ARCHITECTURE.md) | Print queue system, Bluetooth protocol, retry mechanisms, failure recovery |
| [ANDROID_ARCHITECTURE.md](./ANDROID_ARCHITECTURE.md) | MVVM layers, module structure, repositories, DI, Room database |

### Key Design Principles

1. **Firestore is the single source of truth** — no direct client-to-client communication
2. **Offline-first Android** — Room Database caches data for offline operation
3. **Print queue pattern** — never print directly from UI; always through Firestore queue
4. **Clean Architecture** — domain layer has zero framework dependencies
5. **Isolated modules** — Bluetooth is in its own module, no POS business logic coupling

---

## Step 6: Deployment

### Web Application (Next.js)

#### Build for Production

```bash
npm run build
```

#### Deploy to Vercel (Recommended)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

#### Environment Variables (Production)

Set these in your hosting platform's environment configuration:
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_WHATSAPP_NUMBER`

### Firebase (Firestore Rules & Indexes)

```bash
# Deploy security rules
firebase deploy --only firestore:rules

# Deploy indexes
firebase deploy --only firestore:indexes

# Deploy everything
firebase deploy
```

### Android Application

#### Build Release APK

```bash
cd dajaj-android

# Build release APK (requires signing config)
./gradlew assembleRelease
```

#### Signing Configuration

Create `dajaj-android/keystore.properties`:

```properties
storeFile=path/to/release.keystore
storePassword=your-store-password
keyAlias=your-key-alias
keyPassword=your-key-password
```

#### Distribution

- **Internal testing:** Firebase App Distribution
- **Production:** Google Play Store (Internal Track → Closed Beta → Production)

```bash
# Upload to Firebase App Distribution
firebase appdistribution:distribute app/build/outputs/apk/release/app-release.apk \
  --app YOUR_FIREBASE_APP_ID \
  --groups "testers"
```

---

## Common Development Tasks

### Add a New Menu Item (Web)

1. Navigate to `/admin/menu-builder`
2. Select parent category
3. Add item with name, price, availability
4. Changes sync to Android POS within 5 seconds

### Test Order Flow (End-to-End)

1. Start Firebase emulators
2. Run web app locally
3. Create a pending order from customer website
4. Open Android POS → Pending Orders → Accept
5. Verify KOT print job created in Firestore

### Debug Firestore Queries

- Use Firebase Emulator UI at `http://localhost:4000/firestore`
- Check collection data in real-time
- Manually create/update documents for testing

### Run All Tests

```bash
# Web tests
npm run test

# Android unit tests
cd dajaj-android && ./gradlew testDebugUnitTest

# Android instrumented tests (requires device)
cd dajaj-android && ./gradlew connectedDebugAndroidTest

# Firestore rules tests
firebase emulators:exec --only firestore "npm run test:rules"
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `npm run dev` fails | Check Node version matches `.nvmrc`, run `npm install` |
| Gradle sync fails | Check JDK 17, invalidate caches (File → Invalidate Caches) |
| Firebase permission denied | Check security rules, verify auth token |
| Emulator data lost | Export data before stopping: `firebase emulators:export ./data` |
| Android build OOM | Add `org.gradle.jvmargs=-Xmx4096m` to `gradle.properties` |
| Firestore listener not firing | Check query matches documents, verify emulator is running |
