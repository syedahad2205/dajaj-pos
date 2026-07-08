# Xcode Console Logging Diagnostics

## Investigation Summary

This document details the investigation into why logs weren't appearing in the Xcode console when running the iOS app.

## Configuration Analysis

### Build Configuration
- **Xcode Scheme**: `DajajFinance.xcscheme`
- **Launch Configuration**: `Debug` ✅
- **Test Configuration**: `Debug` ✅
- **Archive Configuration**: `Release`
- **Xcode Version**: 1210 (12.1.0)

### Node Environment
- **Node Binary**: `/opt/homebrew/bin/node` (via `.xcode.env.local`)
- **Configured via**: `ios/.xcode.env.local`

### React Native Environment
- **React Native Version**: 0.75.4
- **Metro Bundler**: `@react-native/metro-config` 0.86.0
- **Babel Preset**: `@react-native/babel-preset` 0.86.0
- **Platform**: iOS (Simulator/Device)

## Logger Configuration

### Default Logger Settings
```typescript
{
  minLevel: ENVIRONMENT === 'production' ? 'INFO' : 'DEBUG',
  consoleEnabled: ENVIRONMENT !== 'production',
  persistEnabled: true,
  maxStoredEntries: 500
}
```

### Environment Detection
```typescript
// In core/diagnostics/deviceInfo.ts
export const ENVIRONMENT = (process.env.APP_ENV ?? 'development') as 'development' | 'staging' | 'production';
```

**FINDING**: The app determines environment from `process.env.APP_ENV`, which defaults to `'development'` if not set.

### Backend URL Resolution
```typescript
// In config.ts
function resolveBackendUrl(): string {
  if (process.env.BACKEND_URL) return process.env.BACKEND_URL;
  return 'https://dajaj.in';
}
```

**FINDING**: 
- `process.env.BACKEND_URL` is always `undefined` in React Native without `react-native-config`
- The app **always** connects to `https://dajaj.in` (production backend)
- This is NOT an error - it's the intended behavior for the deployed app

## Code Analysis

### Console Output Verification

**No console suppressions found**:
- ✅ No `LogBox.ignoreAllLogs`
- ✅ No `LogBox.ignoreLogs`
- ✅ No `console.log =` reassignments
- ✅ No `console.error =` reassignments
- ✅ No `console.warn =` reassignments

### Logger Implementation
- Logger uses standard `console.log()` for output
- Console output is controlled by `config.consoleEnabled`
- Console output includes emoji, timestamps, and structured data
- Implementation location: `src/core/logging/logger.ts:238-248`

## Diagnostic Changes Made

### 1. Added `getLoggerConfig()` Export
**File**: `mobile/src/core/logging/logger.ts`

```typescript
export function getLoggerConfig(): LoggerConfig {
  return { ...config };
}
```

**Purpose**: Allow runtime inspection of logger configuration for diagnostics.

### 2. Enhanced App Startup Diagnostics
**File**: `mobile/src/app/App.tsx`

Added comprehensive diagnostic logging that prints:
- Raw console test (all console methods: log, info, warn, error)
- `__DEV__` flag value
- `NODE_ENV` value
- `APP_ENV` value
- Resolved `BACKEND_URL`
- `API_BASE` URL
- App version and build number
- Environment (development/staging/production)
- Firebase project ID
- Logger configuration:
  - `consoleEnabled`
  - `persistEnabled`
  - `minLevel`

**Output Format**:
```
==========================================
🚀 APP STARTUP DIAGNOSTICS
==========================================
[TEST] console.log works
[TEST] console.info works
[TEST] console.warn works
[TEST] console.error works
Build mode: DEVELOPMENT
__DEV__: true
NODE_ENV: <value>
APP_ENV: <value>
Resolved BACKEND_URL: undefined
API_BASE: https://dajaj.in/api/mobile/v1
APP_VERSION: 0.1.0
BUILD_NUMBER: 1
ENVIRONMENT: development
FIREBASE_PROJECT: dajaj-pos
Logger initialized: true
Logger consoleEnabled: true
Logger persistEnabled: true
Logger minLevel: DEBUG
==========================================
```

## Expected Behavior

### When Running from Xcode (Debug Build)

**Expected Values**:
- `__DEV__`: `true`
- `NODE_ENV`: `development` or `undefined`
- `ENVIRONMENT`: `development`
- `Logger consoleEnabled`: `true`
- `Logger minLevel`: `DEBUG`
- `BACKEND_URL`: `undefined` (expected - no react-native-config)
- `API_BASE`: `https://dajaj.in/api/mobile/v1` (production backend)

**Expected Console Output**:
1. Raw console test messages
2. All diagnostic information
3. Logger test messages with emoji and formatting
4. All subsequent network, auth, and navigation logs

### When Running Release Build

**Expected Values**:
- `__DEV__`: `false`
- `ENVIRONMENT`: `production` (if `APP_ENV=production` set)
- `Logger consoleEnabled`: `false`
- `Logger minLevel`: `INFO`

## Verification Steps

### Step 1: Clean Build
```bash
cd mobile/ios
rm -rf build DerivedData
cd ..
npm start -- --reset-cache
```

### Step 2: Open Xcode
```bash
open ios/DajajFinance.xcworkspace
```

### Step 3: Run from Xcode
1. Select the DajajFinance scheme
2. Select a simulator or device
3. Click Run (⌘R)
4. Open Xcode Console (⌘⇧Y)

### Step 4: Check Console Output
Look for:
```
🚀 APP STARTUP DIAGNOSTICS
```

If you see this, the diagnostic logging is working.

### Step 5: Use the App
- Navigate to login
- Perform login
- Open Daily Closing
- Check that network logs appear

## Troubleshooting

### If No Logs Appear in Xcode Console

**Possible Causes**:

1. **Metro Bundler Not Running**
   - Symptom: App shows red screen "Cannot connect to Metro"
   - Solution: Start Metro manually: `npm start`

2. **Wrong Build Configuration**
   - Check: Product → Scheme → Edit Scheme → Run → Build Configuration
   - Should be: `Debug`

3. **Console Filter Set**
   - Check: Xcode console bottom-right corner
   - Ensure filter is empty or set to "All Output"

4. **Console Output Redirect**
   - Check: Product → Scheme → Edit Scheme → Run → Options → Console
   - Should be: "Use Xcode's console"

5. **ENVIRONMENT Variable Override**
   - If `APP_ENV=production` is set somewhere, logger console output is disabled
   - Check for `.env` files in `mobile/` directory

6. **JavaScript Bundle Not Loaded**
   - Symptom: App shows splash screen forever
   - Check: Xcode console for bundle loading errors
   - Solution: Clean build, reset Metro cache

### Validating Logger Works

Even if Xcode console doesn't show logs, the logger still persists to storage.

**Access Persistent Logs**:
1. Open the app
2. Navigate to Settings
3. Tap "View Logs"
4. Export logs via Share sheet

If persistent logs exist but Xcode console is empty, the issue is with Xcode console output, not the logger.

## Additional Notes

### React Native Environment Variables

React Native does NOT have native support for `.env` files or `process.env` like Node.js.

**Options for environment variables**:
1. **react-native-config** (not installed in this project)
2. **react-native-dotenv** (not installed in this project)
3. **Hardcoded per build** (current approach)
4. **Xcode build scripts** (for iOS only)

**Current Approach**:
- Production backend URL is hardcoded: `https://dajaj.in`
- No environment variable configuration needed for production
- For local development, would need to install `react-native-config` and configure `.env` files

### Firebase Configuration

The Firebase config in `config.ts` is **client-side configuration** and is **not sensitive**.
These values are meant to be public and are the same as `NEXT_PUBLIC_FIREBASE_*` env vars on the web.

## Conclusion

### Summary of Findings

1. ✅ Xcode is configured for Debug builds
2. ✅ Logger is properly configured for development
3. ✅ No console suppressions exist
4. ✅ Logger uses standard console.log
5. ✅ Diagnostic logging added to app startup
6. ⚠️ `process.env.BACKEND_URL` is always undefined (expected - no react-native-config)
7. ✅ App connects to production backend (expected behavior)

### Root Cause

**TBD** - Awaiting test run with diagnostic output.

The diagnostic logging will reveal:
- Whether console.log works at all in Xcode
- Whether `__DEV__` is true
- Whether logger console output is enabled
- The actual runtime environment values

### Next Steps

1. Build and run the app from Xcode
2. Check Xcode console for diagnostic output
3. Based on the diagnostic output, determine if:
   - Console output is completely broken (no diagnostics appear)
   - Logger is misconfigured (diagnostics appear, but logger output doesn't)
   - Environment is wrong (ENVIRONMENT !== 'development')
   - Something else is interfering

Once you run the app and share what appears (or doesn't appear) in the Xcode console, we can diagnose the exact root cause.
