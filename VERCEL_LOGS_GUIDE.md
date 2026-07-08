# How to View Vercel Backend Logs

## Problem
When the iOS app calls `https://dajaj.in/api/mobile/v1/finance/closing/[date]` and gets a 401 error, we need to see the **backend console.log statements** to understand why token verification is failing.

## Why You Don't See Logs in Vercel Dashboard

The Vercel Functions panel (Logs tab) shows:
- Request URL, method, status
- Response time
- Firewall status
- But **NOT** console.log statements by default

## Solution: View Real-Time Logs

### Method 1: Vercel CLI (Recommended)

1. **Install Vercel CLI** (if not already installed):
   ```bash
   npm install -g vercel
   ```

2. **Login to Vercel**:
   ```bash
   vercel login
   ```

3. **Stream real-time logs**:
   ```bash
   cd /Users/vitlap295/VCProjects/personal/dajaj-pos
   vercel logs --follow
   ```

4. **Test the app**:
   - Open the iOS app
   - Navigate to Daily Closing
   - Watch the terminal for all console.log output

### Method 2: Vercel Dashboard (Real-Time Logs)

1. Go to https://vercel.com/dashboard
2. Select your project: **dajaj-pos**
3. Click on **"Logs"** in the left sidebar (not the "Functions" tab)
4. This shows real-time streaming logs including console.log

### Method 3: View Specific Function Invocation Logs

1. Go to https://vercel.com/dashboard
2. Select **dajaj-pos** project
3. Go to **Deployments** > Select latest deployment
4. Click **Functions** tab
5. Find the specific request (by timestamp)
6. Click on it to expand
7. Look for **"Logs"** section within that request

## What Logs to Look For

After the latest deployment (commit `f5a603d`), you should see:

### Stage 1: Request Arrival
```
[mobileFinanceAuth] ═══════════════════════════════════════════════
[mobileFinanceAuth] Starting verifyFinanceUserRequest
[mobileFinanceAuth] Request URL: https://dajaj.in/api/mobile/v1/finance/closing/2026-07-08
[mobileFinanceAuth] Request method: GET
[mobileFinanceAuth] Authorization header present: true
[mobileFinanceAuth] Authorization header starts with Bearer: true
[mobileFinanceAuth] ✓ Token extracted, length: 816
```

### Stage 2: Firebase Admin Initialization (First Request Only)
```
[firebaseAdmin] Initializing Firebase Admin SDK...
[firebaseAdmin] ✓ Project ID loaded: dajaj-pos
[firebaseAdmin] ✓ Client email loaded: firebase-adminsdk-fbsvc@dajaj-pos.iam.gserviceaccount.com
[firebaseAdmin] ✓ Private key loaded, raw length: 1708
[firebaseAdmin] Private key starts with quotes: true/false
[firebaseAdmin] Private key ends with quotes: true/false
[firebaseAdmin] Private key first 50 chars: -----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgk...
[firebaseAdmin] Private key has literal \n: true/false
[firebaseAdmin] Private key has actual newlines: true/false
[firebaseAdmin] ✓ Private key processed, final length: 1704
[firebaseAdmin] ✓ Firebase Admin SDK initialized successfully
```

### Stage 3: Token Verification
```
[mobileFinanceAuth] Calling getAdminAuth()...
[mobileFinanceAuth] ✓ Admin Auth obtained
[mobileFinanceAuth] Verifying ID token...
[mobileFinanceAuth] ✓ Token verified successfully
[mobileFinanceAuth] UID: n4X8yt2R4wpS7r4ni3k7
[mobileFinanceAuth] financeUser claim (direct): true
```

### If Error Occurs
```
[firebaseAdmin] ❌ Failed to initialize Firebase Admin SDK: Error: ...
[mobileFinanceAuth] ❌ Token verification failed
[mobileFinanceAuth] Error type: FirebaseAuthError
[mobileFinanceAuth] Error message: ...
```

## Expected Behavior

- **Local (localhost:3000)**: Works ✓ - Shows all logs in terminal
- **Production (dajaj.in)**: Should work after deployment completes

## Next Steps

1. **Wait for deployment** (~2 minutes after push)
   - Check: https://vercel.com/dashboard → dajaj-pos → Deployments
   - Latest commit should show: "Add comprehensive logging to diagnose production 401 error"

2. **Open Vercel CLI logs**:
   ```bash
   vercel logs --follow
   ```

3. **Test on iOS app**:
   - Log out and log back in (to ensure fresh token with claims)
   - Navigate to Daily Closing
   - Watch Vercel CLI output

4. **Analyze the logs** to identify exact failure point:
   - Does Firebase Admin SDK initialize correctly?
   - What does the private key format look like?
   - Does token verification fail? If so, what's the error?
   - Is the `financeUser` claim present?

## Troubleshooting

### If you see: "Private key starts with quotes: true"
**Problem**: Vercel environment variable has double quotes as part of the value
**Fix**: Remove the surrounding double quotes from `FIREBASE_ADMIN_PRIVATE_KEY` in Vercel dashboard

### If you see: "Private key has actual newlines: true"
**Problem**: Vercel stored the key with real newlines instead of `\n` escapes
**Status**: This might be okay - let's check if verification still works

### If you see: "FirebaseAuthError: invalid_argument"
**Problem**: Private key format is corrupted
**Fix**: Copy the exact value from `.env.local` (with quotes and `\n` escapes) into Vercel

## Correct Format for Vercel Environment Variable

Copy this EXACTLY into Vercel's `FIREBASE_ADMIN_PRIVATE_KEY` field:

```
"-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQD7r1adAJKaZeb9\ngr8hYFpVgbcYtZRe9T7dstF0g20nwypw7VezYaj/mkpXkXiEQfJpPcatus2NgmRV\nxBlPrRPfIyBeVE/k0S6JUaDJCUxMUWsAoNdLeB79ZLpNE7IiZlNZYD0FxtvNbBOG\ntYv5gia+QBUbtsUtDB6qZY6l2B17TyO/2pyvgG92xkbKAb6WA5QoOzHgkRA/6iHS\ngv0xec+QtvZ+uCGJP6ZeJ4Fa8lJsivV8WoAR+UivFqwemsu4oAkz5sWdSmoktHVP\n2WMjbDucqU7XpbSyobEcHmdrCE+YTm9z5cTml034ysho+U05Jf0tFGRqWjQQz4mw\nSAKK1YeHAgMBAAECggEAYV89qDJPhbKFAnFyFqybZldwCfw+Mdq5/rWu+V/bfDWy\nlswMURcodfMwbd6W/Lwy1+qRkiciXWwj+1aJ4Fx6wqppXHVMD5+qXHAbP4v8W85o\nEm8nvEf13Vz6AtXq5gomlv53vWNpKHl2uHhGdjqXWKWcRQOaF0qIFq6B2MHa7hg0\nuLWGjXMGMZKzEb69NSo/S1AGPIO+6YiKpslfUTTrg6MCMZDoea0QLTFAa9KihOoE\nwMbCPifYA8bvKqMrB3w2je9DpffIUmffaFou5bNhNSZxhOh5g4w+Mt5YZtcut+Xi\nJpypDvXcDFTfy676SpqpSLHLkCJHDWJBpt/1QBKc6QKBgQD9/avKMmQjwxXscQ3R\n1JqLNJZe+dmJqsvKEc+j9/20rVfTaVvL+pPQLv2CTCCjulav8b8Tx+YuITnUsezQ\nAPZIkRQbRviBhXm2gxISYrrzEvo5qgx+gXXL0XiA5zruQ3giLXmrN4y8Cazyv+zg\ncYoRc63pLjvd8Mc1NL54v/7afQKBgQD9rP9n44Zf3nL9PfI/z7PYqfxYkKdGo0Ji\nyPgvsPdEOm34gApmT9MLGRvTFhkh/nqRVsF6HMzrm9EUWhaeNLpClAC9kaS1TIap\n6vYms5Bo3znf0vDgXtnfi6UHh2k0tq1uInXBi0UPSrbEVsiTaeSERUSiiBjkeIa/\n4Qrns2VFUwKBgQDZWwBsZHs173kPgiAldR9cCYC1fnMfUL5dCqj61PqUZ9NE5GDe\nSm28NrpTivpTot8UanjuYJ8m0uA+mJTj3C7nIuBmB3IaxTLHcZtBiKQb6B2iw1c1\n22wHJBdPmJHh3HMuLGR2lW8ma9FJW91GpWNWU/x8FEi/QZH4gk6N3yAlsQKBgEy0\nyBI4+YP5ttmepqbm/mHwnK6HJx2z9jn6vRlmsI5AAMrYpMxlLNK5R/GfSABAe/2A\nt0ZeeRRxbFp0F0zFcuD48fRgmuZ7emjc9IulVnBvt4dXuKCP7d+r0T4ikwxuhKi9\n4M+idkJ2fCeIemQg7AmXDHb9IlHLpCtXOD3xwBijAoGBALAAQxOSiGoS8nkUEpRx\nccXbDvoGceY88Eml57z0SZ1NlYL/OvWYS5YLGFRHP/RYv+Z31/5U+qIGDZwEosI9\n98bk+lMqpjWmA54M/Yd0frpw2uKydU0buHFX5+m+1W/zm414qYLNYCCQI+4EDNxXS\nMsXE+4Ep2BT2j5gewr+pjg6I\n-----END PRIVATE KEY-----\n"
```

**Important**: 
- Include the opening and closing double quotes
- Use `\n` (backslash-n), not actual newlines
- Should be a single line
- No spaces before/after

