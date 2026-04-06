# Dajaj POS — System Architecture & Gap Analysis

**Date:** April 1, 2026  
**Codebase:** Next.js 14 (App Router) + Firebase + Firestore

---

## 1. System Overview

The system is a full-stack food ordering platform split into **four modules** served from a single Next.js application:

| Module | URL Namespace | Auth Method | Session Storage |
|---|---|---|---|
| **Customer** | `/`, `/menu`, `/checkout`, `/orders`, `/login` | Phone OTP (WhatsApp) | `localStorage["customerPhone"]` |
| **Admin** | `/admin/*`, `/pos`, `/bills`, `/bill/*` | Firebase Email + Password | Firebase Auth + optional `localStorage["dajaj-admin-bypass"]` |
| **Rider** | `/rider/*` | Phone + Access Code (Firestore lookup) | `localStorage["riderId"]` |
| **POS** | `/pos`, `/admin/pos` | Same as Admin | Same as Admin |

POS is **not** an independent auth module — it is an admin tool and uses the admin session. Accessible at both `/pos` (standalone) and `/admin/pos` (within admin panel).

---

## 2. Module Breakdown

---

### 2.1 Customer Module

**Login URL:** `/login` — reachable from UI (home page → `/menu` → redirects to `/login` if unauthenticated)

**Auth Flow:**
1. User enters phone number → `POST /api/auth/send-otp` → OTP stored in `otp_verifications/{normalizedPhone}` in Firestore + WhatsApp message triggered.
2. User submits OTP → `POST /api/auth/verify-otp` → validates OTP, checks expiry (5 min), enforces attempt limit (max 5 tries per phone).
3. New users get a name/DOB step → `POST /api/auth/complete-profile`.
4. On success: phone stored in `localStorage["customerPhone"]`, user redirected to `/menu` (or `?next=` path).

**Session Provider:** `CustomerAuthProvider` (mounted globally in `app/layout.tsx`)  
On hydration: reads `localStorage["customerPhone"]` → fetches `customers/{phone}` from Firestore → if profile missing, clears session.

**Firestore Model:** `customers/{phone}` with sub-collection `customers/{phone}/addresses`

**Protected Routes (via `requireCustomer()`):**
- `/menu`
- `/checkout`
- `/orders`
- `/orders/[orderId]`
- `/order-success`

**Unprotected Customer Routes:**
- `/` (home)
- `/insta` (Instagram landing)
- `/location` (map link page)

**Features accessible once logged in:**
- Browse menu with variants, modifiers, shawarma addons
- Manage saved addresses (including map picker)
- Cart management (persisted in `localStorage["dajaj-cart"]`)
- Place orders (delivery or other)
- Real-time order tracking per order
- View past orders

---

### 2.2 Admin Module

**Login URL:** `/admin/login` — **not linked from any customer-facing UI**; must be typed manually.

**Auth Flow:**
1. Firebase `signInWithEmailAndPassword` with email + password.
2. After Firebase sign-in, `admins/{uid}` document verified in Firestore. If document missing → sign out + error.
3. Dev bypass: entering `ADMIN_BYPASS_CODE` as either email or password skips Firebase entirely and sets `localStorage["dajaj-admin-bypass"]`.

**Session Provider:** `useRequireAuth("admin")` hook via `lib/roleGuard.ts`  
Checks bypass session first; otherwise listens to Firebase `onAuthStateChanged` → fetches `admins/{uid}` → redirects to `/admin/login` if unauthenticated or profile missing.

**Firestore Model:** `admins/{uid}` with fields: `id`, `name`, `email`, `createdAt`, `updatedAt`

**Protected Admin Routes (via `requireAdmin()`):**
- `/admin` (dashboard)
- `/admin/orders`
- `/admin/delivery`
- `/admin/menu-builder`
- `/admin/riders`
- `/admin/pos`
- `/pos` (standalone POS view)
- `/bills`
- `/bill/[billNo]` (partial — also accepts `?token=` public token for guests)

**Admin Capabilities:**
- Full order management (view, update status, assign riders)
- Delivery zone and fee configuration
- Menu builder (categories, items, variants, modifiers)
- Rider management (create/edit riders, assign access codes)
- POS terminal for in-store orders
- Bill viewing and printing (PDF export via `BillPDF` component)

---

### 2.3 Rider Module

**Login URL:** `/rider/login` — **not linked from any customer-facing UI**; must be typed manually.

**Auth Flow:**
1. Rider enters phone number + access code.
2. `authenticateRider()` normalizes phone → reads `riders/{normalizedPhone}` from Firestore → checks `isActive: true` and `accessCode` match.
3. On success: `localStorage["riderId"]` set → redirected to `/rider` (or `?next=` path).

**No Firebase Auth** — entirely Firestore-based credential check.

**Session Provider:** `RiderAuthProvider` (mounted globally in `app/layout.tsx`)  
On hydration: reads `localStorage["riderId"]` → fetches rider profile → if missing or `!isActive`, clears session.

**Firestore Model:** `riders/{normalizedPhone}` — fields: `phone`, `name`, `vehicleType`, `accessCode`, `isActive`, `isAvailable`, `maxConcurrentOrders`, `currentOrderCount`, `lastLocation`, `lastSeenAt`

**Protected Rider Routes (via `requireRider()`):**
- `/rider`
- `/rider/orders`
- `/rider/order/[orderId]`

**Rider Layout:** `app/rider/layout.tsx` wraps all rider pages in `RiderOrdersProvider`, which subscribes to orders assigned to the rider in real time.

**Rider Capabilities:**
- View assigned orders
- Update order status (picked up, delivered, etc.)
- Real-time location tracking (`trackingService.ts`)
- Toggle availability status

---

### 2.4 POS Module

**Login URL:** Same as Admin — `/admin/login`  
**Access paths:** `/pos` (standalone) and `/admin/pos` (embedded in admin panel)

Both paths call `requireAdmin()` and render the same `PosPage` component. The POS is an admin tool, not a standalone role. There is no separate POS-specific login.

**POS Capabilities:**
- Browse menu and build orders for walk-in customers
- Select payment method
- Generate bills (printable PDF)
- All actions apply admin-level Firestore writes

---

## 3. Cross-Cutting Infrastructure

### Auth Guards

All route protection is **client-side only** (React hooks). There is no Next.js `middleware.ts`. This means:
- The page component JS is served to all users by the server.
- The guard hook runs after hydration and redirects unauthenticated users.
- Pages render `null` or a loading state during auth resolution.

| Guard Function | File | Redirect |
|---|---|---|
| `requireAdmin()` | `lib/roleGuard.ts` | `/admin/login?next=<path>` |
| `requireCustomer()` | `lib/roleGuard.ts` | `/login?next=<path>` |
| `requireRider()` | `lib/roleGuard.ts` | `/rider/login?next=<path>` |

### Global Providers (app/layout.tsx)

```
RiderAuthProvider
  └─ CustomerAuthProvider
       └─ AddressProvider
            └─ CartProvider
                 └─ FirebaseAnalytics
                      └─ UTMTracker
                           └─ {children}
```

All four auth contexts are initialized globally on every page load, even for pages that belong to only one module.

### Firebase

- **Firebase Auth:** Used only by the Admin module (email/password sign-in).
- **Firestore:** Used by all modules as the primary data store.
- **No Firebase Storage or Functions** currently in use.

### API Routes

Located under `/app/api/auth/`:

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/send-otp` | POST | Generate and send OTP for customer login |
| `/api/auth/verify-otp` | POST | Validate OTP, return customer profile or `requiresName` flag |
| `/api/auth/complete-profile` | POST | Save name/DOB for new customers |

No API routes for admin or rider authentication — both are handled entirely client-side.

### Key Services

| File | Responsibility |
|---|---|
| `services/adminService.ts` | Read/write `admins/{uid}` |
| `services/customerService.ts` | Read/write `customers/{phone}` |
| `services/riderService.ts` | Read/write `riders/{phone}`, authenticate rider |
| `services/orderService.ts` | Full CRUD + realtime subscriptions on `orders/` |
| `services/deliveryService.ts` | Delivery zone logic |
| `services/deliveryAssignmentService.ts` | Auto-assign riders to orders |
| `services/menuService.ts` | Menu CRUD (admin) |
| `services/trackingService.ts` | Rider GPS location updates |
| `lib/delivery.ts` | Haversine distance + zone matching |
| `lib/phone.ts` | Phone normalization (`9876543210` → `919876543210`) |

---

## 4. Login Entry Points — After Fixes

| Module | Login URL | Reachable from UI? | Notes |
|---|---|---|---|
| Customer | `/login` | **Yes** — via `/menu` redirect or direct link | Phone OTP via WhatsApp |
| Admin | `/admin/login` | **No** — manual URL entry only | Firebase email/password |
| Rider | `/rider/login` | **No** — manual URL entry only | Phone + access code |
| POS | `/admin/login` | **No** — shares admin login | Same admin session |

**Changes applied (April 1, 2026):**
- Removed "Customer login" and "admin login" links from `/rider/login` page.
- Removed "Use customer login" link from `/admin/login` page.
- Removed plaintext display of `ADMIN_BYPASS_CODE` from the admin login UI.

---

## 5. Gaps & Known Issues

### 5.1 Security

| # | Issue | Severity | Location |
|---|---|---|---|
| S1 | **OTP is always `"0000"` (hardcoded bypass)**. `send-otp` route never generates a real OTP — it always stores `CUSTOMER_BYPASS_OTP = "0000"`. The WhatsApp message sent uses a generic `hello_world` template, not an OTP message. Anyone who knows this can log in as any customer. | Critical | `app/api/auth/send-otp/route.ts`, `lib/devAuthShared.ts` |
| S2 | **Admin bypass code stored and checked client-side**. `ADMIN_BYPASS_CODE = "7760293044"` is imported into the browser bundle. Even though removed from the UI display, it is embedded in the JS bundle and readable with DevTools. | High | `lib/devAuthShared.ts`, `app/admin/login/page.tsx` |
| S3 | **No server-side route protection**. All auth guards are React hooks; unauthenticated requests still receive full page HTML/JS from the server. Sensitive data should not be loaded before auth is confirmed. | High | `lib/roleGuard.ts` — no `middleware.ts` |
| S4 | **Rider access codes stored in plaintext in Firestore**. `riders/{phone}.accessCode` is a plaintext string readable by anyone with Firestore access. | Medium | `services/riderService.ts` |
| S5 | **Customer sessions use phone number as sole identity key** with no expiry. `localStorage["customerPhone"]` persists until manually cleared. A shared device grants permanent access to another user's order history. | Medium | `components/auth/CustomerAuthProvider.tsx` |
| S6 | **`/bill/[billNo]` accepts an unauthenticated `?token=` parameter** with no rate limiting or expiry on the token itself. | Low | `app/bill/[billNo]/page.tsx` |

### 5.2 Architecture

| # | Issue | Severity | Notes |
|---|---|---|---|
| A1 | **No Next.js middleware**. All guards run client-side after hydration. Pages briefly show null/loading before redirect. Should add `middleware.ts` to block unauthenticated requests at the edge. | High | Need to create `middleware.ts` |
| A2 | **All four auth providers mounted globally** on every page, including pages that need none of them (e.g., home page, insta page). Unnecessary Firestore reads on cold load. | Medium | `app/layout.tsx` |
| A3 | **`/bill/[billNo]` uses a manual `onAuthStateChanged` check** instead of the standard `requireAdmin()` guard. Inconsistent with every other admin page. | Low | `app/bill/[billNo]/page.tsx` |
| A4 | **POS has no independent identity**. If a POS terminal needs to be restricted from full admin capabilities (menu builder, rider management), there is no role separation — it's all under `requireAdmin()`. | Medium | `lib/roleGuard.ts` |
| A5 | **No Firestore Security Rules documented**. All data access is controlled only at the application layer. If Firestore rules are permissive, any authenticated Firebase user (or unauthenticated user if rules allow) can read/write all collections. | High | Firestore console |

### 5.3 Functional

| # | Issue | Severity | Notes |
|---|---|---|---|
| F1 | **No logout from customer module**. There is no visible logout button for customers — `clearCustomerSession()` is never triggered from the UI. User can only log out by clearing localStorage. | Medium | `components/auth/CustomerAuthProvider.tsx` |
| F2 | **No logout from rider module**.  Same issue — `clearRiderSession()` exists in the provider but no logout UI is present on rider pages. | Medium | `app/rider/*.tsx` pages |
| F3 | **Rider location tracking is one-directional**. Riders update their location, but the customer order detail page (`/orders/[orderId]`) does not appear to display a live rider map — only order status. | Low | `services/trackingService.ts`, `app/orders/[orderId]/page.tsx` |
| F4 | **No password reset flow** for admin login. Firebase supports this, but there is no "Forgot password" link on the admin login page. | Low | `app/admin/login/page.tsx` |
| F5 | **Order success page (`/order-success`) requires auth** but does not persist any order reference in the URL or state — if the user refreshes, they see a blank success screen (no order confirmation data). | Medium | `app/order-success/page.tsx` |
| F6 | **`/insta` page purpose is unclear** — appears to be a special menu landing page from Instagram but has no distinct layout or tracking separate from `/menu`. | Low | `app/insta/page.tsx` |

---

## 6. Recommended Next Steps (Priority Order)

1. **[Critical]** Replace the hardcoded `CUSTOMER_BYPASS_OTP = "0000"` with real OTP generation. Update the WhatsApp template to actually include the OTP in the message body.
2. **[High]** Add `middleware.ts` to enforce auth at the Next.js edge layer for `/admin/*`, `/rider/*`, `/pos`, `/bills`.
3. **[High]** Move the admin bypass mechanism to a server-side environment variable check only, removing it from the client JS bundle entirely.
4. **[Medium]** Add a logout button to the customer menu/orders pages.
5. **[Medium]** Add a logout button to the rider dashboard.
6. **[Medium]** Evaluate splitting POS into its own Firestore role (`pos-operator`) separate from full `admin` so POS staff cannot access menu builder or rider management.
7. **[Medium]** Audit Firestore Security Rules in the Firebase console to ensure unauthenticated/unauthorized reads are blocked at the database level.
8. **[Low]** Standardize `/bill/[billNo]` to use `requireAdmin()` like all other admin pages, and add proper expiry/rate-limiting to the `?token=` public access flow.
