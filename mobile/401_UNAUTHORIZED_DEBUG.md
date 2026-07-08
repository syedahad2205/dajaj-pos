# 401 Unauthorized Error - Debug Guide

## Current Problem

You're seeing:
```
GET /api/mobile/v1/finance/closing/2026-07-08
Status: 401
```

This means the backend is rejecting the request because the authentication token is missing or invalid.

## Where to See the Diagnostic Logs

Since you can't see logs in Xcode console (this is normal for React Native), **you need to find the Metro bundler terminal**.

### Finding Metro Logs

**Option 1: Check for Auto-Opened Terminal**
When you press "Run" in Xcode, Metro should auto-start in a terminal window. Look for a terminal that shows:
```
Welcome to Metro v0.80.x
Fast - Scalable - Integrated
```

**Option 2: Manually Start Metro**
1. Open Terminal app
2. Navigate to your project:
   ```bash
   cd /Users/vitlap295/VCProjects/personal/dajaj-pos/mobile
   ```
3. Start Metro:
   ```bash
   npm start
   ```
4. Keep this terminal visible (split screen with Xcode)
5. Run app from Xcode
6. ALL console.log statements will appear in this terminal

**Option 3: Use React Native CLI**
Instead of running from Xcode:
```bash
cd /Users/vitlap295/VCProjects/personal/dajaj-pos/mobile
npx react-native run-ios
```
This shows all logs directly in the same terminal.

## Diagnostic Logs Added

I've added extensive logging to help diagnose the 401 error:

### 1. App Startup (App.tsx)
```
🚀 APP STARTUP DIAGNOSTICS
Build mode: DEVELOPMENT/PRODUCTION
__DEV__: true/false
Logger consoleEnabled: true/false
API_BASE: https://dajaj.in/api/mobile/v1
```

### 2. Login Flow (LoginScreen.tsx)
```
🔐 LOGIN STARTED
Step 1: Calling login API...
Step 2: Custom token received
Step 3: Signing in to Firebase...
Step 4: Firebase sign-in complete, UID: xxx
Step 5: Getting ID token...
Step 6: ID token obtained, length: xxx
Token preview: eyJhbGciOiJSUzI1NiIsImtp...
Step 7: Login complete
```

### 3. Daily Closing Fetch (useDailyClosing.ts)
```
[fetchDailyClosing] Starting fetch for date: 2026-07-08
[fetchDailyClosing] Initial currentUser: uid or null
[fetchDailyClosing] Getting ID token for user: uid
[fetchDailyClosing] ID token obtained, length: xxx
[fetchDailyClosing] Fetching: https://dajaj.in/api/mobile/v1/finance/closing/2026-07-08
[fetchDailyClosing] Authorization header: Bearer eyJhbGciOiJSUzI...
[fetchDailyClosing] Response status: 401
[fetchDailyClosing] Response data: {"success":false,"message":"Unauthorized."}
```

## What to Check

### Check 1: Is Login Working?

Look for this in Metro terminal after login:
```
✅ If you see:
Step 6: ID token obtained, length: 1234
Token preview: eyJhbGciOiJSUzI1NiIsImtp...

→ Login is working, token is generated

❌ If you see:
❌ LOGIN FAILED
Error: ...

→ Login itself is failing
```

### Check 2: Is Token Being Sent?

Look for this when opening Daily Closing:
```
✅ If you see:
[fetchDailyClosing] ID token obtained, length: 1234
[fetchDailyClosing] Authorization header: Bearer eyJhbGciOiJSUzI...

→ Token is being sent correctly

❌ If you see:
[fetchDailyClosing] No ID token - user not authenticated

→ User is not authenticated when trying to fetch data
```

### Check 3: What Is the Backend Response?

Look for:
```
[fetchDailyClosing] Response status: 401
[fetchDailyClosing] Response data: {"success":false,"message":"Unauthorized."}
```

This tells us:
- The request is reaching the backend
- The backend is rejecting it

## Possible Causes of 401

### Cause 1: Token Doesn't Have financeUser Claim

The backend checks:
```typescript
if (!decodedToken.financeUser) {
  return 401 Unauthorized
}
```

**How to verify**: Check backend logs at dajaj.in or check the token content

**Solution**: Ensure the user has `financeUser: true` custom claim set in Firebase Auth

### Cause 2: finance_auth Document Missing or Inactive

The backend checks:
```typescript
const snap = await adminDb.collection("finance_auth").doc(uid).get();
if (!snap.exists || !data.active) {
  return 403 Forbidden  // Note: 403, not 401
}
```

**How to verify**: Check Firestore console for `finance_auth/{uid}` document

### Cause 3: Token Expired

Firebase ID tokens expire after 1 hour.

**How to verify**: Check if the error happens after 1 hour of inactivity

**Solution**: The app should automatically refresh tokens, but we can force a refresh

### Cause 4: Wrong Firebase Project

The mobile app might be authenticating to a different Firebase project than the backend expects.

**How to verify**: Check the diagnostic logs for:
```
FIREBASE_PROJECT: dajaj-pos  // Should match backend
```

## Action Items

1. **Find Metro Terminal**
   - Look for auto-opened terminal OR
   - Start Metro manually: `cd mobile && npm start`

2. **Run the App**
   - Run from Xcode OR
   - Run from terminal: `npx react-native run-ios`

3. **Login**
   - Watch Metro terminal for login flow logs
   - Copy the "Token preview" value

4. **Open Daily Closing**
   - Watch Metro terminal for fetch logs
   - Note the exact error message

5. **Share the Logs**
   - Copy ALL console output from Metro terminal
   - Share it so we can see exactly what's happening

## Quick Test

To verify logging is working, you should see this IMMEDIATELY when the app starts:
```
==========================================
🚀 APP STARTUP DIAGNOSTICS
==========================================
[TEST] console.log works
[TEST] console.info works
[TEST] console.warn works
[TEST] console.error works
...
==========================================
```

If you see this in Metro terminal, logging is working. If you don't see this anywhere, we have a different problem (Metro not running or connected).

## Expected Flow

**Correct Flow**:
1. App starts → diagnostic output
2. Login → custom token → Firebase sign-in → ID token obtained
3. Navigate to Daily Closing
4. Fetch data → send ID token → 200 OK → data displayed

**Your Current Flow**:
1. App starts → (logs not visible - need Metro terminal)
2. Login → (unknown if working)
3. Navigate to Daily Closing
4. Fetch data → send ID token(?) → **401 Unauthorized** → error

The Metro terminal logs will tell us exactly where this is breaking.
