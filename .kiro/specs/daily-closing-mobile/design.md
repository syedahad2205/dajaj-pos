# Design Document: DAJAJ Finance Mobile Application (Daily Closing Module)

## Overview

This document is an implementation blueprint for the React Native Daily Closing mobile client. No code is written as part of producing this document. It satisfies every requirement in `requirements.md` (same directory) and does not introduce any capability not already specified there.

The application is architected as a general-purpose **Finance Mobile Application** with exactly one populated module today (Daily Closing), per Requirement 15. It is a second client against the existing DAJAJ Firestore/finance backend — not a new backend, not a redesign of Daily Closing's workflow or formulas. Two things anchor every decision in this document: (1) authorization happens through Firestore Security Rules for simple reads and through Identity-Forwarding API routes for transactional mutations, and (2) `services/financeClosingService.ts` remains the single source of truth for Daily Closing's business logic, called by — never duplicated for — the mobile client.

## Architecture

### 1. Overall System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Existing DAJAJ Web App                          │
│  (Next.js, unchanged except the one narrow revocation addition)         │
│                                                                           │
│  app/admin/finance/closing/page.tsx  ──uses──▶  financeClosingService.ts │
│  app/admin/finance/settings/users/page.tsx ──▶  financeUsersService.ts   │
│                                                        │                 │
└────────────────────────────────────────────────────────┼─────────────────┘
                                                          │ (same file, both
                                                          │  callers below)
┌─────────────────────────────────────────────────────────────────────────┐
│              New: Next.js API Routes, versioned (this feature)          │
│                                                                           │
│  POST /api/mobile/v1/finance/auth/login       (Requirement 1)            │
│    └─ Admin SDK: verify creds via authenticateFinanceUser(), mint token  │
│                                                                           │
│  /api/mobile/v1/finance/closing/[date]              (Requirement 4)      │
│  /api/mobile/v1/finance/closing/[date]/expenses     │                    │
│  /api/mobile/v1/finance/closing/[date]/expenses/[id]│  each: verifyIdToken│
│  /api/mobile/v1/finance/closing/[date]/deposits     │  → check claim     │
│  /api/mobile/v1/finance/closing/[date]/deposits/[id]│  → check active    │
│  /api/mobile/v1/finance/closing/[date]/sales        │  → call EXISTING   │
│  /api/mobile/v1/finance/closing/[date]/opening-cash │  service function  │
│                                                                           │
│  (a future breaking change ships as /api/mobile/v2/... alongside v1,     │
│   never by mutating v1's contract — see §2a)                             │
│                                                                           │
└─────────────────┬─────────────────────────────────────────┬─────────────┘
                   │ verifies ID token, forwards identity    │ mints custom
                   │ to unmodified financeClosingService.ts  │ token only
                   ▼                                          ▼
┌─────────────────────────────┐            ┌──────────────────────────────┐
│   Firebase Admin SDK          │            │   Firebase Auth (project)     │
│   (server-side only, secret   │            │                                │
│    service account credential)│            │   Custom Token → ID Token      │
└─────────────────────────────┘            └──────────────┬───────────────┘
                                                            │ signInWithCustomToken()
                                                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    React Native App (this feature)                       │
│                                                                           │
│   Firebase Auth session (client SDK)                                     │
│   Direct Firestore reads: fin_daily_closing, fin_expense_categories,     │
│                            finance_defaults — authorized by Firestore    │
│                            Security Rules' isFinanceUser()                │
│                                                                           │
│   Mutations: routed through the mobile API routes above, never direct.  │
│   Server's returned `closing` object is the ONLY authoritative source    │
│   of Daily Closing totals — the client computes NO finance formula.     │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
                   ▲
                   │ enforces
┌─────────────────────────────────────────────────────────────────────────┐
│                     firestore.rules (this feature adds)                 │
│   isAdmin() [unchanged]        isFinanceUser() [new, narrowly scoped]   │
└─────────────────────────────────────────────────────────────────────────┘
```

**The one invariant this entire design protects:** `financeClosingService.ts` has exactly one implementation of Daily Closing's business logic, called by exactly two kinds of caller (Admin web routes, Finance User mobile routes), both of which authenticate the caller and then hand off to the unmodified functions. Nothing about Daily Closing's math, validation, or locking is reimplemented anywhere else — not in the mobile app, not in Firestore Rules, not in the new API routes. **The mobile app contains zero lines of finance calculation code.** Every total it ever displays as final is a value the server sent it; the only thing the client is permitted to compute locally is a clearly-labeled, throwaway visual estimate while mutations are queued offline (§7.3), and that estimate is never written anywhere or trusted for anything beyond "does this look roughly right while we wait."

### 2. Technology Stack

| Concern | Choice | Justification |
|---|---|---|
| Framework | React Native (latest stable) + TypeScript (strict mode) | Per requirements; single codebase for Android + iOS. |
| Navigation | React Navigation — Native Stack | Per requirements; native stack gives native transition performance and matches the "premium native app" feel requested at project kickoff. |
| Server state / caching | TanStack Query (React Query) | Per requirements. Used for all Direct-Firestore reads and all mobile API route calls — gives cache, retry, and loading/error state for free, replacing hand-rolled fetch-and-setState logic the web app uses. |
| Local/ephemeral UI state | Zustand | Per requirements. Holds session state (current Finance User, auth status), the offline mutation queue, and connectivity/sync status — small, no boilerplate, easy to persist selectively. |
| Persistent storage | MMKV | Per requirements. Used for the offline mutation queue, cached Daily Closing drafts, and non-sensitive app preferences. Chosen over AsyncStorage for synchronous access (needed for instant queue reads on app start) and significantly better performance. **Not** used for the Firebase Auth refresh token (see Security Storage below — that has a stricter requirement). |
| Secure/session storage | `react-native-keychain` (iOS Keychain / Android Keystore-backed) | Required by Requirement 1.9 — the Firebase Auth refresh token must never sit in plain MMKV or AsyncStorage. The Firebase JS SDK's default RN persistence adapter is replaced with a Keychain-backed adapter (see §6). |
| Backend/data | Firebase JS SDK (`firebase` npm package, same major version family already used by the web app) | Per requirements; this is literally the same client SDK, just running in React Native instead of a browser. No separate `@react-native-firebase/*` native-module SDK is used, to avoid the extra native linking complexity and to keep parity of behavior with the web app's SDK version. |
| Forms | React Hook Form | Per requirements. Used for Login, Add Expense modal, Add Deposit modal — each a small, isolated form; RHF minimizes re-renders and centralizes validation error display. |
| Connectivity | `@react-native-community/netinfo` | Per requirements. Sole source of truth for online/offline detection (Requirement 10.8, Requirement 13.2) — no ad hoc "infer offline from a failed fetch" logic anywhere. |
| App lifecycle | React Native's built-in `AppState` API (no extra dependency) | **New, justified addition — but zero-cost.** Requirement 11.9 requires sync to also trigger on foreground return; `AppState` is a core React Native API, not a third-party package, so this line exists only to make the mechanism explicit, not to introduce a dependency. |
| Date handling | `date-fns` (lightweight, tree-shakeable) | **New, justified addition.** Used only for display-oriented date formatting (matching `lib/financeFormat.ts`'s `formatDateDisplay`/`todayDateKey` intent, re-implemented locally since these are pure presentation helpers with no business logic) and for the History screen's date-range picker widget's internal date arithmetic (adding/subtracting days for range validation). This is display/UI code only — no Daily Closing formula (§9 clarifies none exist client-side at all). |
| Date picker UI | `@react-native-community/datetimepicker` | **New, justified addition.** Standard, actively maintained native date picker; needed for History's date-range selector (Requirement 5.6) and has no equivalent already implied by the requested stack. |
| Haptics | `react-native-haptic-feedback` (or Expo's `expo-haptics` if the project uses Expo — decided in Task 1 of the implementation plan, not here) | **New, justified addition.** Requested in the original project brief ("haptic feedback where appropriate"); a single well-maintained library for this is simpler than hand-rolling per-platform vibration calls. |
| Toasts | A minimal toast library (e.g. `react-native-toast-message`) OR a small custom in-house component | **New, justified addition, deferred decision.** The brief asks for toast messages; a tiny dependency or ~80 lines of custom code both satisfy this — Task-level design (not this document) should pick one during implementation, since it has no bearing on architecture. Flagged here only so it isn't a silent omission. |
| Testing | Jest + React Native Testing Library; a property-based testing library (e.g. `fast-check`) for the formula correctness properties in Requirement 6.2–6.3 | Not requested explicitly but required to fulfil "Verification" expectations once implementation starts; mentioned here for completeness, not elaborated further since this document is pre-implementation. |

No state management library beyond Zustand + TanStack Query is introduced. No Redux, no MobX, no custom event bus. This is a deliberate simplicity choice consistent with "avoid unnecessary architectural complexity."

### 2a. API Versioning Convention

Every mobile-facing API route introduced by this feature lives under `/api/mobile/v1/...` (Requirement 1.1). Concretely:

- `POST /api/mobile/v1/finance/auth/login`
- `GET|POST|PATCH|DELETE /api/mobile/v1/finance/closing/[date]`
- `POST /api/mobile/v1/finance/closing/[date]/expenses`
- `DELETE /api/mobile/v1/finance/closing/[date]/expenses/[entryId]`
- `POST /api/mobile/v1/finance/closing/[date]/deposits`
- `DELETE /api/mobile/v1/finance/closing/[date]/deposits/[entryId]`
- `PATCH /api/mobile/v1/finance/closing/[date]/sales`
- `PATCH /api/mobile/v1/finance/closing/[date]/opening-cash`

The `v1` segment is a plain path prefix (Next.js route group `app/api/mobile/v1/finance/...`), not a header or content-negotiation scheme — this is the simplest possible versioning mechanism and matches how most REST APIs version by default. A future `v2` would be introduced as a sibling `app/api/mobile/v2/finance/...` folder, coexisting with `v1` for as long as older installed app builds are still in the field, rather than ever changing `v1`'s request/response contract in place. The mobile app's `core/api/apiClient.ts` (§3) reads the version prefix from a single constant, so bumping versions later is a one-line change on the client side too. This is the entire versioning strategy — no additional API-gateway infrastructure, no content-negotiation headers, nothing beyond a path segment.

### 3. Folder Structure (Finance Mobile Application, not "Daily Closing App")

Per Requirement 15, the structure is module-oriented from day one, even though only one module (`daily-closing`) ships now.

```
src/
  app/                          # Root app shell: providers, navigation container
    App.tsx
    providers/
      QueryProvider.tsx         # TanStack Query client setup
      AuthProvider.tsx          # Wraps Firebase Auth session state (Zustand-backed)
      ConnectivityProvider.tsx  # NetInfo subscription → Zustand connectivity store

  navigation/
    RootNavigator.tsx           # Splash → (Auth stack | App stack) switch
    AuthNavigator.tsx           # Login screen only, for now
    AppNavigator.tsx            # Bottom-tab or drawer shell: Home, History, Settings
    ModuleRegistry.ts           # See §14 — the extensibility seam

  modules/
    daily-closing/               # Everything specific to THIS module lives here
      screens/
        HomeScreen.tsx           # Actually module-agnostic "app home", see §14 note
        DailyClosingScreen.tsx
        HistoryScreen.tsx
      components/
        OpeningCashCard.tsx
        CashExpensesSection.tsx
        AddExpenseModal.tsx
        CashDepositsSection.tsx
        AddDepositModal.tsx
        TodaysSalesSection.tsx
        ClosingCashSection.tsx
        DailySummarySection.tsx
        PostingWarningsBanner.tsx
        LockedBanner.tsx
        HistoryListItem.tsx
        HistoryDateRangeFilter.tsx
      hooks/
        useDailyClosing.ts        # TanStack Query: direct Firestore read of one date
        useDailyClosingHistory.ts # TanStack Query: direct Firestore range read
        useExpenseCategories.ts   # TanStack Query: direct Firestore read
        useFinanceDefaults.ts     # TanStack Query: direct Firestore read
        useAddExpense.ts          # mutation hook → offline-aware, calls API route
        useRemoveExpense.ts
        useAddDeposit.ts
        useRemoveDeposit.ts
        useUpdateSales.ts
        useSetOpeningCash.ts
        useCloseDailyClosing.ts
      preview/
        estimatePendingTotals.ts  # NON-authoritative offline display estimate only — see §9.
                                  # Deliberately NOT a formula port; see §9 for the constraint
                                  # this file must satisfy.
      types.ts                    # Type-only mirror of the relevant lib/finance.ts shapes
                                  # (types have no logic, so mirroring them is not "duplicating
                                  # business logic" — see §9's explicit scope note)
      api.ts                      # Thin fetch wrappers for /api/mobile/v1/finance/closing/...

  core/                           # Shared across ALL modules, present + future
    auth/
      authApi.ts                 # POST /api/mobile/v1/finance/auth/login wrapper
      useAuthStore.ts            # Zustand: current FinanceUserPublic, session status
      secureTokenStorage.ts      # Keychain-backed persistence adapter for Firebase Auth
    firebase/
      firebaseClient.ts          # Firebase JS SDK init (same config shape as web's lib/firebase.ts)
    offline/
      mutationQueue.ts           # Generic queued-mutation store (MMKV-backed) — see §7, §17
      QueueProcessor.ts          # FIFO-per-date replay engine, triggered by connectivity,
                                  # manual Sync Now, AND AppState foreground — see §8
      idempotency.ts             # Idempotency key generation
    connectivity/
      useConnectivityStore.ts    # Zustand: 4-state sync status (synced/pending/offline/failed)
    diagnostics/
      DiagnosticsSection.tsx     # Shared Settings component — see §10.6
      deviceInfo.ts              # deviceId, clientVersion, buildNumber helpers
    logging/
      errorLogStore.ts           # Local-only error log (MMKV-backed, bounded) — see §13a
      ErrorBoundary.tsx           # Top-level React error boundary, writes to errorLogStore
    api/
      apiClient.ts               # Shared fetch wrapper: attaches Authorization header + deviceTime,
                                  # parses {success, message, serverTime} envelope identically to
                                  # the web app's readJson() convention, targets the versioned
                                  # /api/mobile/v1/... prefix from a single constant (§2a)
    format/
      financeFormat.ts           # Display-only date/currency formatting helpers (UI concern,
                                  # not a finance calculation — see §9's scope boundary)
    ui/
      screens/SettingsScreen.tsx # Shared: identity + logout + sync status + diagnostics
      components/                # Shared primitives: Modal, Button, SummaryRow, Banner,
                                  # BreakdownBars-equivalent, etc. — UI-pattern equivalents of
                                  # components/finance/Modal.tsx, BreakdownBars.tsx (presentation
                                  # only, no business logic to duplicate)
      theme/                     # DAJAJ brand tokens (colors, spacing, typography)

  constants/
    finance.ts                   # Type-only/constant mirror of lib/finance.ts's pure enums
                                  # (CASH_DEPOSIT_TYPE_LABELS, SUPPORTED_CASH_DEPOSIT_TYPES,
                                  # DEFAULT_BRANCH_ID — constants, not calculations; see §9)
```

Why this shape satisfies Requirement 15 without building anything extra: `modules/daily-closing/` is the *only* populated module folder. Adding a future "Inventory Count" module means adding `modules/inventory-count/` with the same internal shape (`screens/`, `components/`, `hooks/`, `api.ts`) and one line in `ModuleRegistry.ts` — nothing in `core/` needs to change, because `core/offline`, `core/auth`, `core/api`, and `core/connectivity` are already written generically (a queued mutation doesn't know or care that its payload happens to be "add expense" today).

**Note on the removed `formulas/` folder:** an earlier revision of this design ported `computeDerivedTotals()` client-side for local preview purposes. That approach is no longer used (see §9) — the client never calculates Daily Closing totals, so there is no formula module to house. `preview/estimatePendingTotals.ts` is intentionally not a "formula" — it is described precisely in §9.

### 4. Navigation Flow

```
RootNavigator
 ├─ (no session) ──▶ AuthNavigator
 │                     └─ LoginScreen
 │
 └─ (session)     ──▶ AppNavigator (bottom tabs)
                        ├─ Tab: Home
                        │    └─ HomeScreen
                        │         ├─(push)→ DailyClosingScreen
                        │         └─(push)→ HistoryScreen
                        │                     └─(push)→ DailyClosingScreen (read-only mode)
                        ├─ Tab: History          (same screen, reachable two ways per UX §5.6)
                        └─ Tab: Settings
                             └─ SettingsScreen (identity, logout, sync, diagnostics)

SplashScreen is not a navigator route with a back-stack entry — it is the RootNavigator's
initial render state while `AuthProvider` determines session validity (Requirement 1.10),
then RootNavigator swaps to AuthNavigator or AppNavigator. This avoids a Splash screen
ever being reachable via back-navigation.
```

`DailyClosingScreen` takes a route param `{ date: string, mode: "edit" | "readonly" }`. From Home's "Start/Continue Daily Closing" it opens with `mode: "edit"` and `date: todayDateKey()`. From History it always opens with `mode: "readonly"` (Requirement 5.6 — "no edits permitted from History even if that day happens to be unlocked"). The screen component is shared; `mode` gates whether any mutation affordance renders, independent of `locked`.

Bottom tabs (Home / History / Settings) satisfy Requirement 5.1's screen inventory while keeping History reachable both as its own tab and via Home's "History" button (Requirement 5.4) — both routes resolve to the same `HistoryScreen`, consistent with React Navigation's shared-screen pattern.

### 5. Authentication Flow (detailed)

### 5.1 Login sequence

1. User enters username + password on `LoginScreen` (React Hook Form; both fields required per Requirement 7.7).
2. `authApi.login(username, password)` calls `POST /api/mobile/v1/finance/auth/login` with no Authorization header (Requirement 1.1), including a `deviceTime` field per Requirement 10.4.
3. Server route (new, Next.js):
   ```
   1. Parse { username, password } from body.
   2. Call authenticateFinanceUser(username, password, adminFirestore)
      — the EXACT existing function from services/financeUsersService.ts,
        given a Firestore instance obtained via the Admin SDK app.
   3. If it throws → return 401 { success: false, message: err.message }.
   4. On success → admin.auth().createCustomToken(user.id, { financeUser: true, active: true })
   5. Return 200 { success: true, customToken, user: toFinanceUserPublic(user) }
      (toFinanceUserPublic is already imported by financeUsersService.ts — reused, not re-implemented)
   ```
4. Client receives `{ customToken, user }`, calls `signInWithCustomToken(auth, customToken)`.
5. On success, `AuthProvider`/`useAuthStore` records `user` (the `FinanceUserPublic`) and marks session `authenticated`. `RootNavigator` swaps to `AppNavigator`, landing on Home.
6. On failure (network drop between steps 3 and 4, Requirement 1.7), Login screen shows a retry button; the already-issued custom token is short-lived and simply expires unused if never exchanged — no cleanup needed server-side.

### 5.2 Session persistence

Firebase Auth for React Native normally persists its session via a pluggable `persistence` adapter. This design specifies a custom adapter backed by `react-native-keychain`, satisfying Requirement 1.9's "never plain AsyncStorage" constraint:

```ts
// core/auth/secureTokenStorage.ts (interface sketch, not implementation)
const secureTokenStorage: Persistence = {
  async setItem(key, value) { await Keychain.setGenericPassword(key, value, { service: key }); },
  async getItem(key) { const r = await Keychain.getGenericPassword({ service: key }); return r ? r.password : null; },
  async removeItem(key) { await Keychain.resetGenericPassword({ service: key }); },
};
```

This adapter is passed to `initializeAuth(app, { persistence: secureTokenStorage })` at app start. No username, password, or plaintext credential is ever written anywhere on-device (Requirement 1.8) — only the SDK-managed refresh token material passes through this adapter, and the SDK itself decides its shape/rotation.

### 5.3 Cold start / Splash

`AuthProvider` calls Firebase Auth's `onAuthStateChanged` once on mount. Firebase Auth internally attempts to restore its persisted session (via the Keychain adapter) and either fires the listener with a `User` (→ Home, Requirement 1.10) or with `null` (→ Login). `SplashScreen` is what's visible while this first callback is pending — typically sub-second, but the screen exists so there is never a flash of the Login screen before a valid session is confirmed.

### 5.4 Logout

`signOut(auth)` → Keychain adapter's `removeItem` clears the refresh token → `useAuthStore` resets → any cached Daily Closing draft for the current device session is cleared from MMKV (Requirement 1.11, Requirement 2.7) → `RootNavigator` swaps to `AuthNavigator`.

### 5.5 Session invalidation (disable / password change / revoked token)

Per Requirement 2.4–2.7, `disableFinanceUser()` and `changeFinancePassword()` gain one new line each (the only source-code change to any existing finance service file in this entire feature):

```ts
// services/financeUsersService.ts — inside disableFinanceUser() and changeFinancePassword(),
// after the existing Firestore batch.commit():
await getAdminAuth().revokeRefreshTokens(userId);
```

This requires `services/financeUsersService.ts` to gain a way to reach the Admin SDK's Auth instance. Since this file is otherwise a pure Firestore-client-SDK module (imported by both web admin API routes and, potentially, this feature's mobile routes), the Admin SDK Auth handle is passed in as an optional parameter with a default that no-ops in contexts where it's unavailable (e.g. existing unit tests), preserving the existing function signatures' call sites elsewhere in the codebase. Design intent, not final code:

```ts
export async function disableFinanceUser(
  userId: string, actorUserId: string, actorName: string,
  db: Firestore = defaultFirestore,
  revokeTokens: (uid: string) => Promise<void> = async () => {}, // new, defaulted no-op
): Promise<void> {
  await updateFinanceUser(userId, { active: false }, actorUserId, actorName, db);
  await revokeTokens(userId);
}
```

The web admin API route (`app/api/finance/users/[id]/route.ts`) is updated to pass a real `revokeTokens` implementation (Admin SDK `getAuth().revokeRefreshTokens`) when calling `disableFinanceUser`/`changeFinancePassword`; every other existing call site is unaffected since the parameter is optional and defaulted.

Client-side, the mobile app's Firestore/Auth SDK will surface a `permission-denied` (Firestore) or an ID-token-refresh failure (Auth) once the revoked token's short remaining lifetime elapses (up to the standard ~1 hour ID token TTL, refreshed automatically by the SDK — revocation takes effect on the *next* refresh attempt, which Firebase's SDK performs proactively before expiry). `AuthProvider` listens for exactly these two error classes globally (via a shared Firestore error interceptor and the Auth SDK's own error callback) and performs the Requirement 2.7 flow: sign out locally, clear cached drafts, navigate to Login with the "session no longer valid" message.

### 5.6 Approved exception: `FinanceUserDataSource` abstraction in `financeUsersService.ts`

**This section documents a second narrowly-scoped exception to Requirement 12.7 ("no changes to existing finance service files"), discovered during implementation of the Task 4.1 login route and approved before implementation.**

The original design (§5.1) specified that the login route should call `authenticateFinanceUser(username, password, adminFirestore)` where `adminFirestore` is a Firestore instance obtained from the Firebase Admin SDK. This was found to be runtime-incompatible: the Firebase client SDK's modular functions (`collection()`, `getDocs()`, `writeBatch()`, etc.) perform an internal type-brand check and throw synchronously when given a `firebase-admin` Firestore object, even though both SDKs expose structurally similar APIs at the TypeScript level. A cast with `as unknown as Firestore` would silence the compiler but crash at runtime on every login attempt.

The priority constraint — all credential verification logic lives in exactly one place (`financeUsersService.ts`), never duplicated in the login route — is correct and non-negotiable. The solution is to abstract the two Firestore operations that `authenticateFinanceUser()` actually needs behind a `FinanceUserDataSource` interface:

```ts
export interface FinanceUserDataSource {
  findByNormalizedUsername(normalizedUsername: string): Promise<{ id: string; data: FinanceUser } | null>;
  recordLogin(userId: string, user: FinanceUser): Promise<void>;
}
```

`authenticateFinanceUser()` gains an optional fourth parameter `dataSource?: FinanceUserDataSource`. When omitted, the existing default client-SDK path is used unchanged (via `makeClientSdkDataSource(db)` — all current callers are unaffected). The login route passes an Admin-SDK-backed implementation that uses `adminDb.collection().where().get()` and `adminDb.batch()` directly.

**What is and is not changed:**
- All authentication behavior (username normalization, bcrypt verify, active check, `lastLogin` update, audit logging) is unchanged and remains implemented exactly once.
- The `FinanceUserDataSource` interface is purely a Firestore access abstraction — not a rewrite of auth logic.
- All existing call sites of `authenticateFinanceUser(username, password, db)` continue to work identically (the new `dataSource` parameter is optional and defaulted).
- No new behavior, no new validation rules, no new password handling.



### 6. Firestore Interaction Strategy

Two distinct access patterns, matching the Architecture Decision in requirements.md exactly:

### 6.1 Direct-Firestore reads (TanStack Query + Firebase client SDK)

Every query below filters on `branchId == DEFAULT_BRANCH_ID` (imported from `constants/finance.ts`'s mirror of `lib/finance.ts`'s `"main"` constant — never a hard-coded string literal repeated in multiple places, and never a user-facing branch selector; per Requirement 16, this app is single-branch, matching the web app's current scope):

| Data | Query shape | Hook |
|---|---|---|
| One day's Daily Closing | `getDoc(doc(db, "fin_daily_closing", date))` | `useDailyClosing(date)` |
| History range | `query(collection(db,"fin_daily_closing"), where("branchId","==",DEFAULT_BRANCH_ID), where("date",">=",from), where("date","<=",to), orderBy("date","desc"))` | `useDailyClosingHistory(from, to)` |
| Expense categories | `query(collection(db,"fin_expense_categories"), where("branchId","==",DEFAULT_BRANCH_ID), where("active","==",true))` | `useExpenseCategories()` |
| Finance Defaults (optional UI hint) | `query(collection(db,"finance_defaults"), where("branchId","==",DEFAULT_BRANCH_ID))` | `useFinanceDefaults()` |

Every one of these is a straight port of the equivalent `services/financeCategoriesService.ts`/`financeClosingService.ts`/`financeDefaultsService.ts` query shape — same collection, same field names, same filters — just issued from the RN Firebase client SDK instead of the web's. TanStack Query wraps each in a `useQuery` with a moderate `staleTime` (favoring freshness for today's document, longer for historical/immutable locked documents — locked days never change, so their cache can be effectively infinite once `locked === true`).

**No Firestore real-time `onSnapshot` listeners are used for these reads in this design.** The web app itself uses simple one-shot `getDocs`/`getDoc` calls (see `financeClosingService.ts`, `financeCategoriesService.ts`) rather than listeners; matching that behavior (poll-on-focus via TanStack Query's refetch-on-focus, rather than a live subscription) preserves parity and avoids introducing a class of real-time-listener bugs (stale rules-denial handling, listener leak on unmount) that the web app doesn't have to solve either. TanStack Query's `refetchOnReconnect` and pull-to-refresh cover the "does this feel live enough" requirement.

### 6.2 API-route mutations (TanStack Query mutations + fetch)

Every mutation hook (`useAddExpense`, `useCloseDailyClosing`, etc.) is a `useMutation` whose `mutationFn` does NOT talk to Firestore directly. It:
1. Obtains the current Firebase ID token (`auth.currentUser.getIdToken()` — SDK-cached, auto-refreshed).
2. Attaches a `deviceTime` field (current client clock, ISO 8601) to the request payload, per Requirement 10.4.
3. POSTs to the corresponding `/api/mobile/v1/finance/closing/...` route (§2a) with `Authorization: Bearer <idToken>`.
4. Parses the `{ success, closing, serverTime }` / `{ success: false, message }` envelope via the shared `apiClient.ts` helper (matching the web app's `readJson()` convention in `app/admin/finance/closing/page.tsx`, extended with the `serverTime` field).
5. On success, writes the returned authoritative `closing` object into TanStack Query's cache for `useDailyClosing(date)` (`queryClient.setQueryData`), so the UI reflects server truth immediately without an extra refetch round-trip. `serverTime` is stored alongside (e.g. as the query's `dataUpdatedAt` companion, or a small side-record) purely for diagnostics (§10.6) — it is never used to compute or adjust any displayed total.

If offline, the mutation is instead handed to the **Offline Mutation Queue** (§7) rather than attempted directly — see §8 for the exact online/offline branching logic.

### 6.3 New Firestore collection: mutation idempotency records

Per Requirement 11.4 and 12.5, a new collection `fin_mobile_idempotency/{idempotencyKey}` is introduced, written only by the mobile API routes (server-side, using the same identity-forwarding Firestore client instance — not the Admin SDK, keeping the "no Admin SDK Firestore bypass" rule intact per Requirement 4.8). Each mobile mutation route:
1. Reads `fin_mobile_idempotency/{key}` first. If it exists and records a prior success for this exact operation, the route returns that prior result WITHOUT calling the underlying service function again (true idempotency, no double-post risk).
2. If absent, proceeds to call the underlying `financeClosingService.ts` function, then writes `fin_mobile_idempotency/{key}` = `{ status: "succeeded", closingSnapshot, createdAt }` (or `{ status: "failed", message }` on a definitive, non-transient failure — so a lock-conflict failure is also remembered and not silently retried server-side).

Firestore Rules for this collection: `isFinanceUser()` gets no direct access at all (it's an internal server-side implementation detail of the API routes, written using the Finance User's own forwarded identity but never read directly by the client) — actually, since the API route acts *as* the Finance User (forwarding their ID token context), the simplest correct rule is: **no client rule needed at all**, because this collection is only ever touched from the trusted Next.js server runtime using the same Firestore client SDK authenticated as that specific Finance User's session token obtained server-side (mirroring exactly how `getAuthenticatedFirestoreForRequest` already works for admin routes today — the server uses `initializeServerApp` with the caller's ID token, not the Admin SDK, for this one piece too). Its rule is therefore: `match /fin_mobile_idempotency/{key} { allow read, write: if isFinanceUser(); }` — scoped exactly as tightly as `fin_daily_closing`'s read grant, since only a legitimately-authenticated Finance User's own forwarded session can ever reach it, and it contains no data more sensitive than a Daily Closing document itself.

A scheduled cleanup (Cloud Scheduler + a small function, OR a simple TTL field with Firestore's native TTL policy feature — decided at implementation time, not architecturally significant) removes records older than 24 hours per Requirement 11.9.

### 7. Offline Architecture

### 7.1 Queue data model (generic, per Requirement 15.3)

```ts
// core/offline/mutationQueue.ts — type shape, not final code
interface QueuedMutation<TPayload = unknown> {
  id: string;                 // idempotency key (Requirement 11.4)
  module: "daily-closing";    // extensibility seam — future modules add their own value
  operation: string;          // e.g. "addExpense" | "removeExpense" | "closeDailyClosing"
  targetDate: string;         // YYYY-MM-DD — the document this mutation applies to
  payload: TPayload;
  deviceTime: string;         // ISO 8601, client clock at enqueue time (Requirement 10.4) —
                               // sent as-is on every replay attempt, never regenerated
  createdAt: number;          // client timestamp, ms epoch (queue bookkeeping, distinct
                               // from deviceTime which is the wire-protocol field)
  deviceId: string;           // Requirement 10.3 diagnostics field
  clientVersion: string;      // Requirement 10.3 diagnostics field
  retryCount: number;         // Requirement 10.3 diagnostics field, starts at 0
  createdOffline: boolean;    // Requirement 10.3 diagnostics field
  status: "pending" | "syncing" | "failed";
}
```

This shape is intentionally generic (`module` + `operation` + `payload`) rather than a Daily-Closing-specific union type, so a future Inventory Count module can enqueue `{ module: "inventory-count", operation: "recordCount", ... }` mutations through the exact same `MutationQueue` class without any change to the queue's storage, ordering, or replay engine — only a new "operation → API route" resolver table entry is needed per module (see §17).

The queue itself is persisted to MMKV as a single JSON-serialized array under one key, read synchronously on app start (Requirement 10.10 — survive app kill/crash) and rewritten on every enqueue/dequeue. MMKV's synchronous API means this never blocks on an async storage read before the app can show queue state.

### 7.2 What queues, what doesn't (per Requirement 10.1–10.2, 10.6)

- Queueable: `addExpense`, `removeExpense`, `addDeposit`, `removeDeposit`, `updateSales`, `setOpeningCash`, `closeDailyClosing` — always for **today's date only**, and only if today's document has been successfully fetched at least once this session (Requirement 10.2).
- Never queued, never offline-capable: viewing History for a day never fetched before while offline (Requirement 10.2 — no legitimate baseline to show); Reopen/Backfill (not exposed to Finance Users at all, per Requirement 4.4, so this is moot rather than an offline-specific restriction).
- Ordering constraint (Requirement 10.6): before enqueueing a `closeDailyClosing` mutation, the queue is checked for any other pending/failed mutation targeting the same date; if the queue is non-empty for that date, `closeDailyClosing` is appended after them (never reordered ahead) — enforced in the enqueue function itself, not left to the replay engine to sort out.

### 7.3 Non-authoritative local preview (Requirement 6.3, Requirement 10.6)

While mutations are queued, the Daily Closing screen's Daily Summary section does **not** attempt to recompute `cashRevenue`/`totalRevenue`/etc. client-side. Per Requirement 6.1, there is no client-side formula to run in the first place — `financeClosingService.ts` is the only place `computeDerivedTotals()` exists. Instead, the screen shows the **last-known authoritative `closing` document** (from TanStack Query's cache, per §6.1) alongside a simple, clearly-labeled banner or badge on the affected rows: "Pending changes — totals will update after sync," listing the queued mutations themselves (e.g. "+ ₹500 expense (pending)") as a plain list, not as numbers folded into a recomputed total. See §9 for the full rationale and the one narrow exception (`estimatePendingTotals.ts`) permitted by Requirement 6.3, and its constraints.

### 8. Synchronization Flow

Three independent triggers feed the same replay engine (Requirement 11.1, 11.8, 11.9):

```
 ┌────────────────────┐   ┌──────────────────────┐   ┌───────────────────────────┐
 │ NetInfo: online      │   │ Settings "Sync Now"   │   │ AppState → "active"        │
 │ again (within 5s)    │   │ tapped manually        │   │ (app returns from bg)     │
 └──────────┬───────────┘   └──────────┬────────────┘   └─────────────┬─────────────┘
            │                          │                                │
            └──────────────────────────┼────────────────────────────────┘
                                        ▼
                          ┌─────────────────────────┐
                          │ QueueProcessor.runAll()  │
                          └───────────┬─────────────┘
                                       │
                for each distinct targetDate present in the queue, IN PARALLEL:
                                       │
                                       ▼
                          ┌─────────────────────────┐
                          │ replay that date's queue │
                          │ strictly FIFO            │
                          └───────────┬─────────────┘
                                       │
                           for each queued mutation, IN ORDER:
                                       │
                                       ▼
                    ┌─────────────────────────────────────────┐
                    │ call versioned mobile API route (§2a)    │
                    │ with the mutation's idempotency key,     │
                    │ payload, and deviceTime (Req 10.4)       │
                    └───────────┬───────────────────────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 ▼ success                        ▼ failure
      remove from queue,              is it a lock-conflict / validation error
      cache server's returned          (Requirement 7, "already closed") ?
      `closing` + `serverTime`            │                  │
      via setQueryData; continue         yes                 no (network/transient)
      to next item in this date's         │                  │
      queue                               ▼                  ▼
                              mark this + every later    increment retryCount;
                              queued item for this date   if retryCount < 3, retry
                              as "Sync Failed"; STOP       automatically (Req 11.6);
                              replaying this date's        else mark "Sync Failed",
                              queue (Req 11.5); continue    STOP replaying this date's
                              other dates' queues           queue, continue others
```

Idempotency (Requirement 11.4) is enforced server-side per §6.3 — the client's responsibility is only to always send the same idempotency key on every retry of the same queued mutation (the key is generated once, at enqueue time, and never regenerated on retry).

State exposed to the UI (Requirement 13.1) is a pure derivation of connectivity + the queue's contents, computed by `useConnectivityStore`, using all four distinct states — Offline and Sync Failed are never merged:
- **🟢 Synced**: online, and queue is empty for the relevant date (or globally, for the Home indicator).
- **🟡 Pending Sync**: online, queue has ≥1 item in `pending` or `syncing` status for the relevant date, and none has failed out.
- **🔴 Offline**: NetInfo reports no connectivity — takes precedence over Pending Sync regardless of queue contents (Requirement 13.2).
- **🔴 Sync Failed**: online, but queue has ≥1 item in `failed` status (retryCount exhausted per Requirement 11.6) for the relevant date — takes precedence over Pending Sync when both exist simultaneously (Requirement 13.2).

### 8.1 Foreground-return trigger (Requirement 11.9)

`app/providers/ConnectivityProvider.tsx` (or a small sibling provider) subscribes to React Native's `AppState.addEventListener("change", ...)` once, at root level, for the lifetime of the app. On any transition where `nextAppState === "active"` and the previous state was `"background"` or `"inactive"`, it invokes `QueueProcessor.runAll()` — the exact same function invoked by the NetInfo listener and by Settings' "Sync Now" button. There is one replay engine with three call sites, not three replay engines; this keeps FIFO-per-date ordering, retry-count limits, and lock-conflict handling (§8's diagram) uniformly applied regardless of which trigger fired.

## Components and Interfaces

### 9. No Client-Side Finance Logic (revised — supersedes the earlier "Shared Formula Module" approach)

**This section documents a deliberate reversal from an earlier revision of this design**, which specified porting `computeDerivedTotals()`/`roundCurrency()` into the mobile client as a "byte-for-byte" copy for offline preview purposes. That approach is rejected as of this revision, per explicit direction: **the mobile application SHALL NOT contain any implementation of Daily Closing's finance formulas, in any form, including a "verbatim port."** `services/financeClosingService.ts` is the one and only implementation of `computeDerivedTotals()`, `roundCurrency()`, and `resolveOpeningCash()` in the entire system.

**Why the "verbatim port is safe because it's identical" argument is rejected, not just unnecessary:** a verbatim port is still a second implementation. It requires a human (or an automated check) to notice the moment the server-side function ever changes and manually re-port it — which is exactly the "maintain two implementations" burden this revision exists to eliminate. A test suite that checks the two copies still agree does not remove the maintenance burden; it only catches drift after the fact. The only design that has zero risk of drift is one where there is only one copy.

**What the mobile app displays instead, concretely:**

1. **Every screen that shows Daily Closing totals reads them from a server response.** Either a Direct-Firestore read of `fin_daily_closing/{date}` (§6.1) or the `closing` object in a mobile API route's mutation response (§6.2). There is no other source for `cashExpenseTotal`, `depositTotal`, `totalCashOut`, `cashRevenue`, or `totalRevenue` anywhere in the mobile codebase.
2. **While mutations are queued offline** (§7.3), the Daily Summary section continues to display the last-known server totals, unmodified, alongside a plain, non-numeric "pending changes" indicator — no recomputation happens.
3. **The one narrow, explicitly-permitted exception** (Requirement 6.3) is `modules/daily-closing/preview/estimatePendingTotals.ts`. This file exists only if the implementation team judges that showing literally zero preview (just "pending changes, totals will update after sync") is insufficient UX, and if so, it must satisfy every one of these constraints:
   - It MAY sum the *queued mutations' own input amounts* (e.g. "3 pending expenses totaling ₹1,200") for display as a supplementary line, clearly labeled "estimated" / "pending" / with a distinct visual treatment (never rendered in the same style as the authoritative `SummaryRow` values).
   - It SHALL NOT compute `cashRevenue`, `totalRevenue`, or apply `roundCurrency`'s exact rounding semantics, or replicate `resolveOpeningCash`'s chaining logic, or replicate the locking check — i.e., it SHALL NOT resemble `computeDerivedTotals()` in shape, inputs, or output fields, even partially.
   - It is never written to any cache key that `useDailyClosing(date)` reads from, and it is discarded entirely (not merged, not reconciled) the instant a fresh server `closing` object arrives.
   - If, during implementation, satisfying all of the above turns out to be impractical or the resulting code starts to resemble a partial formula reimplementation, the correct resolution is to remove the preview and show only the "pending changes, totals will update after sync" message — not to relax this constraint.
4. **Types remain type-only.** `modules/daily-closing/types.ts` mirrors the shape of `FinanceDailyClosing`, `DailyClosingExpenseEntry`, `DailyClosingDepositEntry`, etc., and `constants/finance.ts` mirrors pure enums/constants (`CASH_DEPOSIT_TYPE_LABELS`, `SUPPORTED_CASH_DEPOSIT_TYPES`, `DEFAULT_BRANCH_ID`). Mirroring a TypeScript `interface` or a `Record<string, string>` label map is not "business logic" — there is no calculation, no branching, no rule to drift. This is explicitly distinguished from porting a *function* like `computeDerivedTotals()`, which contains actual business rules.

Correctness Property 1 in this document (below) is rewritten accordingly — it no longer asserts "two implementations agree," it asserts "no second implementation exists to disagree."

### 10. Screen-by-Screen UI Specification

### 10.1 Splash
- Full-bleed DAJAJ logo/branding, no interactive elements.
- Purely a rendering of "auth state pending" (§5.3). No timer-based navigation — navigation is driven entirely by the `onAuthStateChanged` callback resolving.

### 10.2 Login
- Fields: Username (autoCapitalize: none, autoCorrect: false), Password (secure entry, with a show/hide toggle for usability).
- Login button: disabled until both fields are non-empty (Requirement 7.7); shows a loading spinner while the login request is in flight; on failure, displays the exact server-returned `message` beneath the form (Requirement 7.5 applies to this flow too, by the same convention used for Daily Closing mutations).
- No "forgot password" / self-service link — password resets are Admin-managed (matches Non-Goals).

### 10.3 Home
Top to bottom:
1. Connectivity/sync indicator (Requirement 13.1) — a small pill/badge showing exactly one of 🟢 Synced / 🟡 Pending Sync / 🔴 Offline / 🔴 Sync Failed, tappable only in the Sync Failed state (navigates to Settings' sync detail, per Requirement 13.3).
2. Today's date (large, matches web's `formatDateDisplay` styling intent).
3. Status card: "Not Started" / "In Progress" / "Closed" derived from: no document exists → Not Started; document exists, `locked: false` → In Progress; `locked: true` → Closed. This status reflects the server's document as last read — it is not independently computed.
4. Opening Cash card: value + chained/manual badge, mirroring the web page's "1. Opening Cash" section presentation but read-only here (editing only happens inside the Daily Closing screen itself). This value comes straight from the server document, per §9.
5. Primary CTA button: "Start Daily Closing" (Not Started state) or "Continue Daily Closing" (In Progress state) or, when Closed, a disabled/secondary "View Today's Closing" affordance that opens the screen in `readonly` mode.
6. Secondary button: "History".

Pull-to-refresh re-fetches today's document (Direct-Firestore read, §6.1).

### 10.4 Daily Closing
Section order is fixed and matches Requirement 6.13 / the web page exactly:
1. **Opening Cash** — read-only text (chained) or editable numeric field with on-blur save (manual), deficit banner when negative (Requirement 6.5–6.6).
2. **Cash Expenses** — list of expense line items (category name, amount, remarks, delete affordance when unlocked) + "Add Expense" button (hidden when locked) + running `Cash Expense Total` row.
3. **Cash Deposits** — same shape as #2, for deposits; subtitle text "Cash moving out of the drawer — not a business expense" ported verbatim from the web copy; `Cash Deposit Total` + `Total Cash Out` rows.
4. **Today's Sales** — 4 numeric fields (UPI/Zomato/Swiggy/Other), on-blur save, disabled when locked.
5. **Count the Drawer** — single Closing Cash numeric field, disabled when locked, no default value.
6. **Daily Summary** — `SummaryRow`-equivalent list in the exact order specified in Requirement 6.13, then either the "Save Daily Closing" button (unlocked) or a locked confirmation message with `closingTime`/`closedByName` (locked).

A `PostingWarningsBanner` renders above section 1 whenever `postingWarnings.length > 0`, verbatim text, no rewording (Requirement 6.17).

In `readonly` mode (opened from History), every input renders as static text and no Add/Delete/Save affordance renders at all — visually identical field layout, zero interactivity, so a Finance User reviewing a past day sees the same information architecture as the day they're used to editing.

Modals (`AddExpenseModal`, `AddDepositModal`) are React Hook Form–driven, matching the field sets and validation in Requirement 6.7–6.8 / Requirement 7.1–7.2, with the Save button disabled until validation passes and showing the server's exact error message on failure (Requirement 7.1, 7.5).

### 10.5 History
- Date-range control at the top (two date pickers, defaulting to "this month" through today, mirroring the web Lock Settings page's default range).
- Chronological list (newest first) below, each row: date, total revenue (once closed) or "Not yet closed", lock badge, `closedByName`/`closingTime` when locked (Requirement 5.7).
- Tapping a row pushes `DailyClosingScreen` with `mode: "readonly"`.
- No search box anywhere on this screen (Requirement 5.6).

### 10.6 Settings
Sections, top to bottom:
1. **Identity** — Finance User's `fullName` and `username`, read-only (Requirement 5.9).
2. **Sync** — current overall sync status using the four-state vocabulary (🟢 Synced / 🟡 Pending Sync / 🔴 Offline / 🔴 Sync Failed, Requirement 13.1), a list of any currently-failed queued mutations with per-item Retry/Discard actions, and a manual "Sync Now" button (Requirement 11.7–11.8).
3. **Diagnostics** (Requirement 14.1) — a read-only, informational list:
   - Current User
   - App Version
   - Build Number
   - Environment (Development / Staging / Production)
   - Firebase Project
   - API Version (e.g. `v1`, read from the same constant `apiClient.ts` uses per §2a)
   - Last Successful Sync (timestamp)
   - Current Sync Status (four-state vocabulary)
   - Queue Size (total count of queued mutations across all dates)
   - Pending Operations (count of queue items in `pending`/`syncing` status)
   - Failed Operations (count of queue items in `failed` status)

   No destructive actions live here beyond what's already exposed elsewhere (Requirement 14.2). Optionally (Requirement 17.5, not mandatory), a "Copy diagnostic logs" or "View error log" action surfaces the local error log described in §13a.
4. **Logout** button, with a confirmation prompt.

### 11. Component Hierarchy (Daily Closing screen, as the representative example)

```
DailyClosingScreen
 ├─ ConnectivityBanner (shared, core/ui)               — Offline / Pending Sync banner
 ├─ PostingWarningsBanner (module-local)
 ├─ OpeningCashCard (module-local)
 ├─ CashExpensesSection (module-local)
 │   ├─ ExpenseListItem[] 
 │   └─ AddExpenseModal (opened on demand)
 │       └─ RHF-managed form fields + shared Modal (core/ui) shell
 ├─ CashDepositsSection (module-local)
 │   ├─ DepositListItem[]
 │   └─ AddDepositModal (opened on demand)
 ├─ TodaysSalesSection (module-local) — 4 numeric inputs
 ├─ ClosingCashSection (module-local) — 1 numeric input
 └─ DailySummarySection (module-local)
     ├─ SummaryRow[] (shared, core/ui)
     └─ SaveButton | LockedMessage
```

Data flow: `DailyClosingScreen` owns the `useDailyClosing(date)` query and passes the resulting `closing` object (plus `isLoading`/`isError`) down as props; each mutation-triggering child (Add Expense modal's Save, Sales field's onBlur, etc.) calls its own dedicated mutation hook (`useAddExpense`, `useUpdateSales`, ...) rather than lifting all mutation logic into the screen component — this keeps each section's concerns local and matches the web page's per-handler structure (`handleAddExpense`, `handleSaveSales`, etc.) one-to-one, which is intentional: a developer familiar with the web page's code should recognize the same seams here.

## Data Models

### 12. Mobile Data Models

The following are type-only mirrors (no logic, per §9's scope boundary) of the corresponding shapes in `lib/finance.ts`. No field is renamed, reordered, retyped, or given a different optionality than the source:

- `FinanceDailyClosing`, `DailyClosingExpenseEntry`, `DailyClosingDepositEntry`, `CashDepositType`, `FinanceExpenseCategory`, `FinanceDefault`, `FinanceUserPublic`.

Types that exist ONLY in the mobile app, with no server-side equivalent (because they describe mobile-only concerns):

```ts
// core/offline/mutationQueue.ts
interface QueuedMutation<TPayload = unknown> {
  id: string;                 // idempotency key
  module: "daily-closing";
  operation: string;
  targetDate: string;
  payload: TPayload;
  deviceTime: string;         // ISO 8601 — Requirement 10.4
  createdAt: number;
  deviceId: string;
  clientVersion: string;
  retryCount: number;
  createdOffline: boolean;
  status: "pending" | "syncing" | "failed";
}

// core/connectivity/useConnectivityStore.ts — four distinct states, never merged (Req 13.1)
type SyncStatus = "synced" | "pending-sync" | "offline" | "sync-failed";

// core/logging/errorLogStore.ts — Requirement 17
interface LocalErrorLogEntry {
  timestamp: string;   // ISO 8601
  screen: string;      // route name active at the time of the error
  operation: string | null; // mutation/query name, if identifiable
  message: string;
  stack?: string;      // when available
}
```

And the idempotency record persisted server-side (§6.3), extended with the mutation-metadata fields from Requirement 10.4:

```ts
interface MobileIdempotencyRecord {
  status: "succeeded" | "failed";
  closingSnapshot?: FinanceDailyClosing; // present when status === "succeeded"
  message?: string;                       // present when status === "failed"
  deviceTime?: string;                    // echoed from the request, for reconciliation only
  serverTime: FirebaseFirestore.Timestamp; // when this record was written
  createdAt: FirebaseFirestore.Timestamp;
}
```

## Correctness Properties

The following properties, restated from `requirements.md` Requirement 6.2–6.3 and grounded in the ported formula module (§9), are the properties any implementation of this design must uphold and that property-based tests must verify before this feature is considered done:

### Property 1: No client-side finance calculation exists

A static/dependency audit of the mobile app's source tree (`modules/`, `core/`, `constants/`) SHALL find zero references to, or reimplementations of, `computeDerivedTotals`, `roundCurrency`'s exact rounding behavior applied to any of `cashRevenue`/`totalRevenue`/`cashExpenseTotal`/`depositTotal`/`totalCashOut`, or `resolveOpeningCash`'s chaining logic — enforceable as an automated lint/grep-based CI check (e.g. flagging any function whose parameter shape structurally matches `computeDerivedTotals`'s input) in addition to code review. This replaces the earlier "formula parity" property, which assumed a client-side port would exist; it does not.

**Validates: Requirements 6.1**

### Property 2: Every displayed authoritative total traces to a server response

For any Daily Closing total rendered on any screen in a non-"pending/estimated" visual state, there SHALL exist a traceable server response (a Direct-Firestore document read or a mobile API route's `closing` payload) that is the direct, unmodified source of the displayed value — verifiable by an integration test that intercepts all network/Firestore calls during a screen render and asserts every authoritative number shown matches a value present in one of those intercepted responses, byte for byte (i.e. same numeric value, not independently recomputed).

**Validates: Requirements 6.2**

### Property 3: Null-closingCash invariant

Whenever the server's `closing.closingCash === null`, the mobile app SHALL render `cashRevenue` and `totalRevenue` as unset (`—`) rather than `0`, on every screen that displays them, matching exactly what the server itself never computes in that case (Requirement 6.4's `—` display rule) — there is no client-side branch that could compute `0` instead, since there is no client-side computation at all.

**Validates: Requirements 6.4**

### Property 4: Idempotent mutation replay

Replaying the same queued mutation (same idempotency key) against a mobile API route two or more times SHALL produce the exact same server-side effect as replaying it once — verified via the `fin_mobile_idempotency` record check in §6.3, and testable by asserting that a given `fin_daily_closing` document's `expenses`/`deposits` arrays never contain two entries for one logical retry.

**Validates: Requirements 11.4**

### Property 5: No direct Finance User write ever reaches `fin_daily_closing`

For any Firestore Rules test harness run against `firestore.rules`, a session with `isFinanceUser() === true` and no other role SHALL fail every `create`/`update`/`delete` attempt against `fin_daily_closing/{anyId}`, while succeeding on `get`/`list`. This is the rules-level counterpart to Requirement 3.2 and should be encoded as an automated Firestore Rules unit test (using the Firebase Rules testing library) before implementation is considered complete.

**Validates: Requirements 3.2**

## Error Handling

### 13. Error Handling Strategy

| Layer | Failure mode | Handling |
|---|---|---|
| Direct-Firestore read | `permission-denied` | Treated as session invalidation (§5.5) — signs out, navigates to Login. Any other read error surfaces as a TanStack Query `isError` state with a retry affordance on the screen (standard React Query error boundary pattern, no custom logic). |
| Login API route | 401 (bad credentials / disabled) | Exact server message shown under the form (Requirement 7.5 convention applied here too). |
| Mutation API route (online) | 400 (validation, e.g. "Amount must be a positive number.") | Exact server message shown in the relevant modal/field, matching Requirement 7.1–7.2, 7.5. |
| Mutation API route (online) | 400 ("already closed and locked") | Surfaced as a blocking error; screen refetches the document (now `locked: true`) so the UI updates to the locked state immediately, consistent with Requirement 8.3. |
| Mutation API route (online) | 401/403 (token/claim/active check failed) | Treated as session invalidation (§5.5). |
| Mutation attempted offline | n/a — never attempted | Routed to the queue (§7–§8) instead of hitting the network; no error surfaces to the user at enqueue time, only a "Pending Sync" indicator. |
| Queued mutation replay | Lock-conflict or validation failure | Requirement 8.4 / 11.5 — stop replaying that date's queue, surface a conflict requiring explicit Discard, never silently drop data. |
| Queued mutation replay | Transient/network failure | Auto-retry up to 3 times (Requirement 11.6), then "Sync Failed" requiring manual Retry. |
| Unexpected/unhandled exception anywhere | n/a | A top-level React error boundary (standard RN pattern) renders a generic "Something went wrong" screen with a restart affordance, rather than a white screen of death — this is baseline mobile app hygiene, not a Daily-Closing-specific requirement, and is not itself a business-logic concern. |

The unifying principle, carried over directly from the web app's `readJson()`/`financeErrorResponse()` convention: **server error messages are always shown verbatim, never re-worded by the client** (Requirement 7.5). This is true for every layer in the table above that involves a server response.

### 13a. Local Error Logging (Requirement 17)

`core/logging/errorLogStore.ts` and `core/logging/ErrorBoundary.tsx` implement a small, local-only diagnostic log, entirely separate from (and not a replacement for) the error-handling table above:

- **Capture points**: the top-level `ErrorBoundary` (catches render-time exceptions), a global unhandled-promise-rejection handler (standard RN pattern), and any explicit `catch` block that represents an unexpected/unrecoverable condition (as distinct from a normal, expected validation failure already handled per the table above — a "category is required" validation error is NOT logged here; a Firestore SDK throwing an unexpected internal error IS).
- **Entry shape**: `{ timestamp, screen, operation, message, stack }`, per §12's `LocalErrorLogEntry` type — satisfying Requirement 17.1 exactly.
- **Storage**: MMKV, capped at a fixed maximum entry count (e.g. 200) with oldest-first eviction, satisfying Requirement 17.2's bounded-size requirement. Stored under a distinct MMKV key from the mutation queue, since the two have different lifecycles and eviction policies.
- **No transmission**: nothing in `errorLogStore.ts` ever makes a network call. There is no remote crash-reporting SDK integrated as part of this feature (Requirement 17.3).
- **No sensitive data**: the logger never receives or stores usernames, passwords, tokens, or full Firestore document bodies — only whatever plain-text `message`/`stack` the JS error object itself already contains (Requirement 17.4). Call sites are responsible for not manually attaching sensitive context to a logged error.
- **Optional viewer**: Settings' Diagnostics section (§10.6) may expose a "Copy diagnostic logs" action that serializes the current log to the OS clipboard for a support person to request and inspect — this satisfies Requirement 17.5's "MAY," not "SHALL," so its absence in an early implementation milestone is not a defect.

### 14. Loading States, Empty States, and Connectivity Handling

**Loading states** (all via TanStack Query's `isLoading`/`isFetching`): skeleton placeholders for Home's status card and Daily Closing's sections while the initial `useDailyClosing` fetch resolves; a spinner on any button whose tap triggers a mutation, disabled for the duration of that specific mutation only (not the whole screen) so unrelated fields remain usable — matching the web page's per-action `saving`/`expenseSaving`/`depositSaving` boolean pattern exactly.

**Empty states**: "No expenses added yet." / "No deposits added yet." (verbatim from the web page) when the respective array is empty; "No Daily Closings in this range." on History when a date-range query returns nothing (verbatim from the web Lock Settings page's equivalent empty state).

**Connectivity handling**: `ConnectivityProvider` (root-level) subscribes to NetInfo once and writes to `useConnectivityStore`, and also owns the `AppState` subscription described in §8.1; every screen that needs to show a banner reads from that single store rather than re-subscribing to NetInfo or `AppState` itself. The store exposes the four-state vocabulary from Requirement 13.1 (🟢 Synced / 🟡 Pending Sync / 🔴 Offline / 🔴 Sync Failed) as its primary output, plus a separate, purely advisory "slow network" flag (heuristic: a request has been in flight longer than a threshold, e.g. 8 seconds, without resolving) that never overrides or merges into the four-state indicator itself (Requirement 10.9's offline/slow-network distinction) — it is surfaced as a secondary, dismissible hint only.

## 15. Security Considerations

1. **Service account credential** (Requirement 12.2): stored via the hosting platform's secret manager (e.g. Vercel/Netlify environment variable, or a `.env` excluded from git and populated per-environment) — never committed, never logged. The API routes that use it (`/mobile-auth/login`'s token-minting step, and each mutation route's `verifyIdToken` step) are the only code that ever touches it; it is not exposed to any client bundle.
2. **No Admin SDK Firestore bypass** (Requirement 4.8 restated as a security property): every mutation route's actual Firestore read/write goes through the same client-SDK-based, per-caller-authenticated pattern the web admin routes already use (`getAuthenticatedFirestoreForRequest`-equivalent, adapted for Finance User tokens) — so even a bug in a mobile route can, at worst, do what that specific Finance User's Firestore Rules already permit, never more.
3. **Least-privilege Firestore Rules** (Requirement 3 in full): re-affirmed here as a security property, not just a data-access convenience — a stolen/leaked mobile session cannot read account balances, vendors, other Finance Users, audit logs, or admin data, and cannot write anywhere at all except through the audited, validated API route path.
4. **Refresh token revocation on disable/password-change** (Requirement 2, §5.5): closes the "disabled account stays logged in for up to an hour" gap that would otherwise exist with token-based auth.
5. **Secure on-device credential storage** (Requirement 1.9, §5.2): Keychain/Keystore-backed, not MMKV, not AsyncStorage — MMKV is explicitly reserved for non-sensitive data (queue, drafts, preferences) in this design.
6. **No client-side finance calculation to trust or distrust**: per §9, the mobile app performs no Daily Closing calculation at all — every persisted write is validated and computed authoritatively server-side inside the unmodified `financeClosingService.ts`, and the display-only local preview (§7.3) is structurally incapable of being mistaken for, or substituted as, an authoritative value, since it is never written to the same cache the authoritative reads populate.
7. **Idempotency records contain no more sensitive data than the Daily Closing document they snapshot** (§6.3) and are governed by the same `isFinanceUser()` scoping, with a bounded retention window (Requirement 11.10).
8. **Local error logs never leave the device** (§13a) — no remote transmission path exists, and the logger is deliberately excluded from receiving credentials or tokens, limiting the blast radius if a device is ever inspected.
9. **API versioning (§2a) is a compatibility mechanism, not a security boundary** — every version under `/api/mobile/v1/...`, `/api/mobile/v2/...`, etc. SHALL apply the exact same identity-forwarding verification (Requirement 4.2) with no version ever granted weaker authentication than another, so introducing `v2` in the future must not become an accidental way to bypass a security check `v1` enforces.

## 16. Performance Considerations

1. **MMKV for the mutation queue and drafts**: synchronous reads mean the app's initial render can immediately reflect "you have pending changes" without an async storage round-trip blocking first paint.
2. **TanStack Query caching**: locked (historical) Daily Closing documents are effectively immutable — cached with a long/infinite `staleTime` once `locked === true`, avoiding redundant refetches when a Finance User revisits History repeatedly. Today's (unlocked) document uses a short `staleTime` with refetch-on-focus/reconnect instead of a live listener (§6.1), balancing freshness against unnecessary Firestore read volume.
3. **Firestore read minimization**: because Finance Users have no access to `fin_accounts`, `fin_transactions`, `fin_vendors`, etc. (Requirement 3), the app never issues reads it has no use for — read volume is bounded by exactly the four Direct-Firestore query shapes in §6.1.
4. **Native Stack navigation**: React Navigation's native-stack (not JS-stack) implementation delegates transition rendering to native platform APIs, satisfying the "smooth, native-feeling transitions" performance expectation from the original brief with no custom animation code.
5. **Debounced on-blur saves, not on-keystroke**: Today's Sales and Opening Cash fields save on blur (matching the web page exactly, per Requirement 6.6/6.11), avoiding a network/API call per keystroke.
6. **List rendering**: expense/deposit line-item lists and the History list use a virtualization-capable list component (React Native's `FlatList` or an equivalent) rather than mapping into a `ScrollView`, keeping performance flat regardless of how many line items or historical days accumulate.
7. **No client-side formula computation on every render**: because Daily Closing totals are never recomputed client-side (§9), the Daily Closing screen's render cost for its summary section is O(1) display of already-fetched values, not O(n) arithmetic over expense/deposit arrays on every keystroke or re-render — a minor but real simplification that falls out naturally from the "no duplicate logic" architecture decision, not something separately engineered for performance.

## 17. Future Extensibility (concrete mechanism, per Requirement 15)

`navigation/ModuleRegistry.ts` is the seam:

```ts
// Design-time sketch — illustrates the mechanism, not final code.
interface FinanceModule {
  key: string;                        // "daily-closing", future: "inventory-count", ...
  homeEntry: { label: string; icon: string; route: string } | null; // null = no Home tile (e.g. always-on module)
  navigator: React.ComponentType;     // the module's own stack navigator
}

export const REGISTERED_MODULES: FinanceModule[] = [
  dailyClosingModule, // the only entry today
];
```

`AppNavigator` renders tabs/entries by iterating `REGISTERED_MODULES` rather than hard-coding "Daily Closing" as a special case, and `core/offline/mutationQueue.ts`'s `QueuedMutation.module` field (§7.1) means the same queue/replay/idempotency infrastructure works for any future module's mutations without modification — a future module author writes its own `operation → API route` resolver and its own Identity-Forwarding API routes (following the exact pattern established in Requirement 4), and registers itself in this one file. No part of `core/` needs to change to add a module; no placeholder code for unbuilt modules exists today (Requirement 15.4) — the registry array simply has one entry.

## Testing Strategy

1. **Static audit — no client-side finance calculation**: a CI-enforced check (Correctness Property 1) scanning the mobile app's source tree for any reimplementation of `computeDerivedTotals`, `roundCurrency`'s exact semantics, or `resolveOpeningCash`, failing the build if one is introduced. This replaces what would previously have been "formula module unit tests" — there is no formula module to unit test.
2. **Unit tests — offline queue**: enqueue ordering (Requirement 10.6's "close is always last"), MMKV persistence round-trip, and idempotency-key stability across retries (§7.1, §8), independent of any network or Firestore dependency (all mockable).
3. **Integration tests — Identity-Forwarding API routes**: for each `/api/mobile/v1/finance/closing/...` route (§2a), tests that (a) a request with no token is rejected 401, (b) a request with a valid token but `financeUser` claim missing/false is rejected 401, (c) a request from a Finance User whose `finance_auth` doc has `active: false` is rejected 403, (d) a valid request correctly forwards to the real `financeClosingService.ts` function and returns its result unmodified (including the added `serverTime` field, Requirement 10.4), (e) a request against a locked day surfaces the existing `assertNotLocked` error verbatim. These tests exercise the real service functions (against a Firestore emulator), never mocks of them, so a regression in the shared service is caught here too.
4. **Firestore Rules unit tests**: using the Firebase Rules testing library against the local emulator, covering every grant and denial enumerated in Requirement 3 (positive test per allowed collection/operation, negative test per explicitly denied collection/operation) — this is the automated form of Correctness Property 5.
5. **End-to-end / manual verification**: a full Daily Closing cycle performed from the mobile app (login → add expenses/deposits → enter sales → close) for a given date, then verified against the same date's data as rendered by the existing web admin Daily Closing page, confirming byte-for-byte total agreement and correct `fin_daily_closing`/`fin_transactions` state — this is the ultimate acceptance check for "the mobile app is indistinguishable from the web app," and should be run before this feature is considered shippable.
6. **Offline/sync scenario tests**: simulated network loss mid-session (device connectivity mocked via NetInfo's test utilities) covering: adding entries offline then reconnecting (Requirement 11.1-11.3), a lock-conflict discovered on replay (Requirement 8.4/11.5), and a mutation retried past its idempotency window (Requirement 11.4) — verifying no duplicate expense/deposit ever lands in the resulting document.

## Explicit Non-Duplication Checklist (traceability back to requirements.md)

This section exists so a reviewer can verify, line by line, that nothing in this design reimplements what requirements.md said must not be reimplemented:

- Daily Closing math (`computeDerivedTotals`, `roundCurrency`) → **not implemented client-side at all, not even as a "verbatim port"** (§9 — this is a deliberate reversal from an earlier design revision); every displayed authoritative total is a server response value, full stop. The only client-side arithmetic permitted is the narrowly-constrained, clearly-non-authoritative offline preview (§7.3, §9 item 3), which is explicitly required to avoid resembling the real formula.
- Opening Cash chaining/resolution (`resolveOpeningCash`) → **never implemented client-side**; mobile only ever reads the already-resolved `openingCash`/`openingCashSource` fields (§9, Requirement 6.5).
- Locking (`assertNotLocked`) → **never re-implemented**; enforced exclusively by the untouched service function, mobile only reacts to its results (§13).
- Auto-posting to the ledger (`postDailyClosingToLedger`) → **never touched, never called, never read from directly** (`fin_transactions` access removed entirely per Requirement 3.6); mobile only displays `autoPostedTransactionsByEvent`/`postingWarnings` as already-computed fields.
- Credential verification (`authenticateFinanceUser`) → **called, not reimplemented** (§5.1).
- Audit logging (`writeFinanceAuditLog`/`logFinanceAudit`) → **untouched**; continues to fire from inside the same service functions, now also on behalf of Finance User callers (Requirement 4.9).
- Finance service files → **exactly one file, one function pair, one added line each** is touched (`financeUsersService.ts`'s `disableFinanceUser`/`changeFinancePassword`, for token revocation only) — every other finance service file is imported and called, never edited.
- API versioning (§2a) → additive only; introduces a path prefix, never a second implementation of any route's business logic. A future `v2` would still call the same `financeClosingService.ts` functions a `v1` route calls today.
- Branching (Requirement 16) → **no multi-branch abstraction introduced**; every query and API route uses the single existing `DEFAULT_BRANCH_ID` constant, matching the web app's current single-branch scope exactly, with no branch-selection UI or per-branch state anywhere in the mobile app.
