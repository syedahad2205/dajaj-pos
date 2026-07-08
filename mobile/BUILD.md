# DAJAJ Finance — React Native Build Guide

## Overview

This document covers how to build the DAJAJ Finance React Native app for Android and iOS.  
The project lives in `mobile/` inside the main `dajaj-pos` monorepo.

---

## Required Environment Variables

### Mobile App (`.env` or set before `react-native start`)

| Variable | Purpose | Example |
|---|---|---|
| `FIREBASE_API_KEY` | Firebase JS SDK API key | `AIzaSy...` |
| `FIREBASE_AUTH_DOMAIN` | Firebase Auth domain | `project.firebaseapp.com` |
| `FIREBASE_PROJECT_ID` | Firebase project ID | `dajaj-pos` |
| `FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID | `123456789` |
| `FIREBASE_APP_ID` | Firebase app ID | `1:123:android:abc...` |
| `BACKEND_URL` | URL of the Next.js backend | `https://your-app.vercel.app` |
| `APP_ENV` | Environment label | `development` / `staging` / `production` |
| `FIREBASE_PROJECT_ID` | Firebase project ID (for diagnostics display) | `dajaj-pos` |

### Next.js Backend (`dajaj-pos/.env.local`)

| Variable | Purpose |
|---|---|
| `FIREBASE_ADMIN_PROJECT_ID` | Firebase project ID for Admin SDK |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | Service account email |
| `FIREBASE_ADMIN_PRIVATE_KEY` | Service account private key (with `\n` literal newlines) |

See `.env.local.example` in the repo root for the full list.

---

## Firebase Setup

### Required files you must provide manually

1. **`google-services.json`** — Android Firebase configuration  
   - Download from: Firebase Console → Project Settings → Your Apps → Android
   - Place at: `mobile/android/app/google-services.json`

2. **`GoogleService-Info.plist`** — iOS Firebase configuration  
   - Download from: Firebase Console → Project Settings → Your Apps → iOS
   - Place at: `mobile/ios/DajajFinance/GoogleService-Info.plist`

3. **Service account credentials** — For the Next.js backend (Admin SDK)  
   - Generate from: Firebase Console → Project Settings → Service Accounts → Generate new private key  
   - Add to `.env.local` as the three `FIREBASE_ADMIN_*` variables

> **Note:** The current build does NOT use Firebase SDKs that require `google-services.json` at compile time (the JS SDK initializes from env vars at runtime). However, if you add Firebase Analytics, Crashlytics, or other native Firebase modules later, you will need these files.

---

## Android Build

### Prerequisites

- Android SDK (API 34+) at `~/Library/Android/sdk` or set `ANDROID_SDK_ROOT`
- Java 17+ (OpenJDK)
- NDK version `25.1.8937393` (installed via Android Studio SDK Manager)
- Node.js 20 (recommended) — Node 21 requires a Metro patch that is already applied in this repo

### First-time setup

```bash
cd mobile
npm install --legacy-peer-deps
```

### Debug APK

```bash
cd mobile/android
ANDROID_SDK_ROOT=~/Library/Android/sdk ./gradlew assembleDebug
```

Output: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`

### Release APK

```bash
cd mobile/android
ANDROID_SDK_ROOT=~/Library/Android/sdk ./gradlew assembleRelease
```

Output: `mobile/android/app/build/outputs/apk/release/app-release.apk`

### Release AAB (for Play Store)

```bash
cd mobile/android
ANDROID_SDK_ROOT=~/Library/Android/sdk ./gradlew bundleRelease
```

Output: `mobile/android/app/build/outputs/bundle/release/app-release.aab`

### Signing (required before publishing to Play Store)

The current release config uses the debug keystore (signing config `debug` is reused for release).  
For production, generate a real keystore and update `android/app/build.gradle`:

```bash
keytool -genkey -v -keystore dajaj-finance.keystore \
  -alias dajaj-finance -keyalg RSA -keysize 2048 -validity 10000
```

Then update `android/app/build.gradle`:
```groovy
signingConfigs {
    release {
        storeFile file('dajaj-finance.keystore')
        storePassword 'YOUR_STORE_PASSWORD'
        keyAlias 'dajaj-finance'
        keyPassword 'YOUR_KEY_PASSWORD'
    }
}
```

---

## iOS Build

### Prerequisites (all require macOS)

| Tool | Version | Install |
|---|---|---|
| Xcode | 15+ | Mac App Store |
| CocoaPods | 1.17+ | `/opt/homebrew/bin/gem install cocoapods` |
| Ruby | 3.2+ | `brew install ruby` |

> **IMPORTANT:** Xcode.app must be installed (not just Command Line Tools).  
> Run `xcode-select --install` after Xcode installation.  
> The current machine only has Command Line Tools — Xcode must be installed before iOS builds are possible.

### First-time setup

```bash
# After installing Xcode:
xcode-select --switch /Applications/Xcode.app/Contents/Developer

cd mobile
npm install --legacy-peer-deps

export PATH="/opt/homebrew/lib/ruby/gems/4.0.0/bin:/opt/homebrew/bin:$PATH"
cd ios
pod install
```

### Debug build (simulator)

```bash
cd mobile
npx react-native run-ios
```

### Release configuration

Open `mobile/ios/DajajFinance.xcworkspace` in Xcode:
1. Select the `DajajFinance` target
2. Set **Bundle Identifier** to your team's identifier (e.g. `com.yourcompany.dajajfinance`)
3. Set **Signing Team** under the Signing & Capabilities tab
4. Select **Product → Archive** for a release build

### CocoaPods installation

```bash
export PATH="/opt/homebrew/lib/ruby/gems/4.0.0/bin:/opt/homebrew/bin:$PATH"
cd mobile/ios
pod install
```

### Info.plist required entries

The following keys must be present in `mobile/ios/DajajFinance/Info.plist` for required permissions:

```xml
<!-- Camera — not currently used but required by some Firebase versions -->
<key>NSCameraUsageDescription</key>
<string>Camera access is not required by this app</string>

<!-- Keychain — used for secure auth token storage -->
<!-- No Info.plist key needed; entitlements handle this -->
```

---

## Running Metro Bundler

```bash
cd mobile
npx react-native start
```

Or with cache reset:
```bash
cd mobile
npx react-native start --reset-cache
```

---

## Required Secrets Summary

| Secret | Where to get it | Where to place it |
|---|---|---|
| `google-services.json` | Firebase Console | `mobile/android/app/google-services.json` |
| `GoogleService-Info.plist` | Firebase Console | `mobile/ios/DajajFinance/GoogleService-Info.plist` |
| Firebase Admin private key | Firebase Console → Service Accounts | `dajaj-pos/.env.local` as `FIREBASE_ADMIN_PRIVATE_KEY` |
| Android release keystore | Generate with `keytool` | `mobile/android/app/dajaj-finance.keystore` |
| Apple Developer signing cert | Apple Developer Portal | Xcode Signing & Capabilities |
| Apple Provisioning Profile | Apple Developer Portal | Xcode Signing & Capabilities |

---

## Common Build Issues & Troubleshooting

### Android: `SDK "iphoneos" cannot be located`
This is an iOS error appearing in an Android-only environment — safe to ignore for Android builds.

### Android: Metro bundle fails with `TypeError [ERR_INVALID_ARG_VALUE]: The argument 'format' must be one of...`
Cause: Node.js 21+ changed `util.styleText` to not accept arrays.  
Fix: Already patched in `node_modules/@react-native/metro-config/node_modules/metro/src/lib/`.  
If `npm install` overwrites this, re-apply by running:
```bash
node -e "
const fs = require('fs');
const files = [
  'node_modules/@react-native/metro-config/node_modules/metro/src/lib/reporting.js',
  'node_modules/@react-native/metro-config/node_modules/metro/src/lib/TerminalReporter.js',
  'node_modules/@react-native/metro-config/node_modules/metro/src/lib/logToConsole.js',
];
// Check if styleText arrays are present and need patching
files.forEach(f => {
  const content = fs.readFileSync(f, 'utf8');
  if (content.includes('styleText([') && !content.includes('Array.isArray')) {
    console.log('Needs patching:', f);
  }
});
"
```
Then apply the `style()` wrapper patch as done in this project.

**Long-term fix:** Use Node.js 20 (LTS) which has full compatibility with React Native 0.75.

### Android: `NDK not found`
Install NDK `25.1.8937393` via Android Studio: SDK Manager → SDK Tools → NDK → Show Package Details.

### Android: `ANDROID_SDK_ROOT not set`
Either set in your shell profile:
```bash
export ANDROID_SDK_ROOT=~/Library/Android/sdk
```
Or create `mobile/android/local.properties`:
```
sdk.dir=/Users/YOUR_USERNAME/Library/Android/sdk
```

### iOS: `xcrun: error: SDK "iphoneos" cannot be located`
Xcode.app is not installed. Install from the Mac App Store, then:
```bash
xcode-select --switch /Applications/Xcode.app/Contents/Developer
```

### iOS: `pod install` fails with `No such file or directory`
Run `pod repo update` then retry.

### Metro: `Unable to resolve module`
```bash
cd mobile
npx react-native start --reset-cache
```

### Gradle: `Duplicate class kotlin.collections`
Add to `android/app/build.gradle`:
```groovy
configurations.all {
    resolutionStrategy {
        force 'org.jetbrains.kotlin:kotlin-stdlib:1.9.24'
    }
}
```

---

## Build Artifacts

After successful builds, artifacts are located at:

| Artifact | Path |
|---|---|
| Android Debug APK | `mobile/android/app/build/outputs/apk/debug/app-debug.apk` |
| Android Release APK | `mobile/android/app/build/outputs/apk/release/app-release.apk` |
| Android Release AAB | `mobile/android/app/build/outputs/bundle/release/app-release.aab` |
| iOS (after Xcode build) | Xcode Organizer → Archives |
