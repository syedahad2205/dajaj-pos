# Implementation Plan: DAJAJ Finance Mobile Application (Daily Closing Module)

## Overview

This plan implements the React Native Daily Closing mobile client and its narrow, additive backend surface (mobile auth route, identity-forwarding mutation routes, Firestore rules additions, and the single approved edit to `financeUsersService.ts`). Work proceeds backend-first (rules → auth bridge → mutation routes → idempotency) so the mobile client always has a real API to call against, then builds the RN app's core infrastructure (auth session, offline queue, sync engine) before layering screens on top, finishing with the Daily Closing screen (the most complex UI) and the remaining screens/wiring. Property tests for the five design correctness properties are placed immediately next to the code that implements the behavior they check.

## Tasks

- [x] 1. Set up backend project scaffolding for the mobile API surface
  - Add `firebase-admin` as a dependency in the Next.js project's `package.json`
  - Create `lib/firebaseAdmin.ts` exporting a lazily-initialized Admin SDK app (service account credential read from environment variables, never hard-coded), an `getAdminAuth()` helper, and an `getAdminFirestore()` helper
  - Document required environment variables in `.env.local.example` (or equivalent) without ever writing real secret values into the repo
  - _Requirements: 12.1, 12.2, 12.3_

- [x] 2. Update Firestore Security Rules with `isFinanceUser()`
  - [x] 2.1 Add the `isFinanceUser()` helper function to `firestore.rules`
    - Implement exactly the check from design §3.1: signed in, `request.auth.token.financeUser == true`, `finance_auth/{uid}` exists, and its `active == true`
    - _Requirements: 3.1_
  - [x] 2.2 Add `isFinanceUser()` grants to `fin_daily_closing`, `fin_expense_categories`, `finance_defaults`, and `fin_mobile_idempotency`
    - `fin_daily_closing`: read-only for `isFinanceUser()`, no write
    - `fin_expense_categories`: read-only for `isFinanceUser()`
    - `finance_defaults`: read-only for `isFinanceUser()`
    - `fin_mobile_idempotency`: read/write for `isFinanceUser()` only
    - Leave every existing `isAdmin()` grant byte-for-byte unchanged
    - Explicitly verify (by inspection) that `fin_accounts`, `fin_transactions`, `fin_audit_logs`, `admins`, `pos_staff`, `pos_open_orders`, `bills`, `fin_expense_subcategories`, `fin_income_categories`, `fin_vendors`, `fin_settings`, `finance_auth`, `menus`, `inventory_entries`, `zomato_imports` grant `isFinanceUser()` no access, and that the trailing default-deny rule is untouched
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10_
  - [ ]* 2.3 Write Firestore Rules unit tests using the Firebase Rules testing library against the local emulator
    - Positive test per allowed collection/operation for `isFinanceUser()` (read on `fin_daily_closing`, `fin_expense_categories`, `finance_defaults`; read/write on `fin_mobile_idempotency`)
    - Negative test per explicitly denied collection/operation, including every collection listed in Requirement 3.8
    - **Property 5: No direct Finance User write ever reaches `fin_daily_closing`**
    - **Validates: Requirements 3.2**
  - [x] 2.4 Add/update `firestore.indexes.json` for the History date-range query if a matching composite index does not already exist
    - Confirm the query shape (`branchId ==`, `date >=`, `date <=`, `orderBy date desc`) against the existing web `getDailyClosingsForRange()` index
    - _Requirements: 9.6, 12.6_

- [x] 3. Add the one approved edit to `services/financeUsersService.ts`: refresh-token revocation
  - [x] 3.1 Add an optional, defaulted `revokeTokens` parameter to `disableFinanceUser()` and `changeFinancePassword()`
    - Default is a no-op async function so every existing call site (and existing unit tests) is unaffected
    - Call `revokeTokens(userId)` after the existing Firestore write in both functions
    - Do not change either function's existing validation, Firestore writes, or audit logging
    - _Requirements: 2.4, 2.6_
  - [x] 3.2 Wire a real `revokeTokens` implementation into the existing web admin route(s) that call these two functions
    - Pass `getAdminAuth().revokeRefreshTokens` (from the `lib/firebaseAdmin.ts` created in Task 1) as the `revokeTokens` argument at those call sites only
    - _Requirements: 2.4_
  - [ ]* 3.3 Write unit tests for `disableFinanceUser()` and `changeFinancePassword()`
    - Assert `revokeTokens` is called with the correct `userId` on success
    - Assert the default no-op is used (no throw) when `revokeTokens` is omitted, preserving existing call-site behavior
    - _Requirements: 2.4, 2.6_

- [ ] 4. Implement the mobile login API route
  - [x] 4.1 Create `app/api/mobile/v1/finance/auth/login/route.ts`
    - Parse `{ username, password }` from the request body
    - Call the existing, unmodified `authenticateFinanceUser()` from `services/financeUsersService.ts` with a Firestore instance obtained via the Admin SDK
    - On throw, return HTTP 401 `{ success: false, message: <thrown message> }` and mint no token
    - On success, mint a custom token via `getAdminAuth().createCustomToken(user.id, { financeUser: true, active: true })`
    - Return HTTP 200 `{ success: true, customToken, user: toFinanceUserPublic(user) }`, reusing `toFinanceUserPublic` and never including `passwordHash`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.12_
  - [ ]* 4.2 Write integration tests for the login route
    - Valid credentials → 200 with `customToken` and `user`, no `passwordHash` present
    - Invalid credentials → 401 with the exact thrown message, no token minted
    - Disabled account → 401 with the disabled-account message, no token minted
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.12_

- [ ] 5. Checkpoint - Ensure backend auth + rules tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement the identity-forwarding verification helper for mutation routes
  - [ ] 6.1 Create a shared `verifyFinanceUserRequest()` helper (e.g. `lib/mobileFinanceAuth.ts`)
    - Verify `Authorization: Bearer <idToken>` via `getAdminAuth().verifyIdToken()`
    - Reject (return a 401 signal) if verification fails or the token lacks `financeUser: true`
    - Look up `finance_auth/{uid}` via the Admin SDK and reject (403 signal) if missing or `active != true`
    - Return the caller's `uid` and `fullName` on success, for use as `userId`/`userName` in the underlying service call
    - _Requirements: 4.2_
  - [ ]* 6.2 Write unit tests for `verifyFinanceUserRequest()`
    - No token → rejected as 401
    - Valid token, missing/false `financeUser` claim → rejected as 401
    - Valid token and claim, `finance_auth` doc missing or `active: false` → rejected as 403
    - Valid token, claim, and active doc → resolves with `uid`/`fullName`
    - _Requirements: 4.2_

- [ ] 7. Implement the `fin_mobile_idempotency` record helper
  - [ ] 7.1 Create `lib/mobileIdempotency.ts` with `getIdempotencyRecord(key)` and `writeIdempotencyRecord(key, record)` functions
    - Use the Finance User's own forwarded-identity Firestore client instance (never the Admin SDK) per design §6.3, matching the existing `getAuthenticatedFirestoreForRequest` pattern
    - Record shape: `{ status: "succeeded" | "failed", closingSnapshot?, message?, deviceTime?, serverTime, createdAt }`
    - _Requirements: 11.4, 11.10_
  - [ ]* 7.2 Write unit tests for the idempotency helper
    - Writing then reading a record round-trips the stored fields
    - A `"failed"` record's `message` is retrievable and a `"succeeded"` record's `closingSnapshot` is retrievable
    - **Property 4: Idempotent mutation replay**
    - **Validates: Requirements 11.4**
    - _Requirements: 11.4_

- [ ] 8. Implement the identity-forwarding mutation API routes
  - [ ] 8.1 Create `app/api/mobile/v1/finance/closing/[date]/expenses/route.ts` (POST) and `[entryId]/route.ts` (DELETE)
    - Use `verifyFinanceUserRequest()` (Task 6) for identity checks
    - Check `fin_mobile_idempotency` first (Task 7); return the prior result unchanged if a success record exists for the request's idempotency key
    - Otherwise call the existing `addDailyClosingExpense`/`removeDailyClosingExpense` from `services/financeClosingService.ts` unmodified, passing the Finance User's `uid`/`fullName`
    - Accept and store (never forward into service function params) the `deviceTime` field; include `serverTime` in the success response
    - Write the idempotency record after the call (success or definitive failure)
    - Return `{ success: true, closing, serverTime }` or `{ success: false, message }`, reusing `financeErrorResponse()` unmodified for status mapping
    - _Requirements: 4.1, 4.3, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 11.4_
  - [ ] 8.2 Create `app/api/mobile/v1/finance/closing/[date]/deposits/route.ts` (POST) and `[entryId]/route.ts` (DELETE)
    - Same pattern as 8.1, calling `addDailyClosingDeposit`/`removeDailyClosingDeposit`
    - _Requirements: 4.1, 4.3, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 11.4_
  - [ ] 8.3 Create `app/api/mobile/v1/finance/closing/[date]/sales/route.ts` (PATCH)
    - Same pattern, calling `updateDailyClosingSales`
    - _Requirements: 4.1, 4.3, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10_
  - [ ] 8.4 Create `app/api/mobile/v1/finance/closing/[date]/opening-cash/route.ts` (PATCH)
    - Same pattern, calling `setDailyClosingOpeningCash`
    - _Requirements: 4.1, 4.3, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10_
  - [ ] 8.5 Create `app/api/mobile/v1/finance/closing/[date]/route.ts` (GET/PATCH for close/save)
    - PATCH calls `closeDailyClosing`, same identity + idempotency pattern
    - Confirm `reopenDailyClosing`/`backfillDailyClosingPostings` are NOT exposed anywhere under `/api/mobile/v1/...`
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10_
  - [ ]* 8.6 Write integration tests for every mobile mutation route against a Firestore emulator
    - No token → 401; invalid/missing `financeUser` claim → 401; inactive Finance User → 403
    - Valid request forwards to the real service function and returns its result unmodified, including `serverTime`
    - Request against a locked day surfaces the existing `assertNotLocked` message verbatim with HTTP 400
    - Same idempotency key sent twice produces one effect in the underlying document (no duplicate expense/deposit entries)
    - **Property 4: Idempotent mutation replay**
    - **Validates: Requirements 11.4**
    - _Requirements: 4.2, 4.3, 4.5, 4.6, 4.9, 4.10, 11.4_

- [ ] 9. Checkpoint - Ensure all backend route and idempotency tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Scaffold the React Native project and shared type/constant mirrors
  - [ ] 10.1 Initialize the React Native + TypeScript (strict mode) project and install the stack from design §2: React Navigation (native stack), TanStack Query, Zustand, MMKV, `react-native-keychain`, the Firebase JS SDK, React Hook Form, `@react-native-community/netinfo`, `date-fns`, `@react-native-community/datetimepicker`
    - Create the folder structure from design §3 (`src/app`, `src/navigation`, `src/modules/daily-closing`, `src/core`, `src/constants`)
    - _Requirements: 15.1_
  - [ ] 10.2 Create `constants/finance.ts` as a type-only/constant mirror of `lib/finance.ts`'s pure enums (`CASH_DEPOSIT_TYPE_LABELS`, `SUPPORTED_CASH_DEPOSIT_TYPES`, `DEFAULT_BRANCH_ID`)
    - Copy values verbatim; no derived logic
    - _Requirements: 16.1, 16.2_
  - [ ] 10.3 Create `modules/daily-closing/types.ts` as a type-only mirror of `FinanceDailyClosing`, `DailyClosingExpenseEntry`, `DailyClosingDepositEntry`, `CashDepositType`, `FinanceExpenseCategory`, `FinanceDefault`, `FinanceUserPublic`
    - No field renamed, reordered, retyped, or given different optionality than the source
    - _Requirements: 6.1_
  - [ ]* 10.4 Write a static audit / lint-based CI check scanning `modules/`, `core/`, `constants/` for reimplementations of `computeDerivedTotals`, `roundCurrency`'s rounding behavior, or `resolveOpeningCash`
    - Flag any function whose parameter shape structurally matches `computeDerivedTotals`'s input, or any function named/aliased to those three names
    - **Property 1: No client-side finance calculation exists**
    - **Validates: Requirements 6.1**

- [ ] 11. Implement core Firebase client, secure auth storage, and the auth API wrapper
  - [ ] 11.1 Create `core/firebase/firebaseClient.ts` initializing the Firebase JS SDK with the same config shape as the web app's `lib/firebase.ts`
    - _Requirements: 1.6_
  - [ ] 11.2 Create `core/auth/secureTokenStorage.ts`: a `Persistence` adapter backed by `react-native-keychain` (`setItem`/`getItem`/`removeItem` via `Keychain.setGenericPassword`/`getGenericPassword`/`resetGenericPassword`)
    - Pass this adapter to `initializeAuth(app, { persistence: secureTokenStorage })`
    - Never write username, password, or plaintext credentials through this adapter
    - _Requirements: 1.8, 1.9_
  - [ ] 11.3 Create `core/auth/authApi.ts` with a `login(username, password)` function calling `POST /api/mobile/v1/finance/auth/login` (no Authorization header), including `deviceTime`
    - _Requirements: 1.1_
  - [ ]* 11.4 Write unit tests for `secureTokenStorage.ts`
    - `setItem`/`getItem`/`removeItem` round-trip through a mocked Keychain module
    - _Requirements: 1.9_

- [ ] 12. Implement the shared API client and offline mutation queue
  - [ ] 12.1 Create `core/api/apiClient.ts`: a shared fetch wrapper that attaches `Authorization: Bearer <idToken>` (via `auth.currentUser.getIdToken()`) and `deviceTime`, parses the `{success, message, serverTime}`/`{success, closing, serverTime}` envelope, and targets `/api/mobile/v1/...` from a single version constant
    - _Requirements: 2a (design §2a), 10.4, 4.6_
  - [ ] 12.2 Create `core/offline/idempotency.ts` generating a stable idempotency key at enqueue time (never regenerated on retry)
    - _Requirements: 10.3, 11.4_
  - [ ] 12.3 Create `core/offline/mutationQueue.ts` implementing the generic `QueuedMutation` shape from design §7.1/§12, persisted to MMKV as a single JSON array, read synchronously on app start
    - Enqueue function enforces: `closeDailyClosing` is always appended after any other pending/failed mutation for the same date, never reordered ahead
    - Enqueue writes to MMKV synchronously before any network attempt
    - _Requirements: 10.3, 10.6, 10.7, 10.10, 11.7_
  - [ ]* 12.4 Write unit tests for the mutation queue
    - Enqueueing a `closeDailyClosing` mutation when other mutations are already queued for the same date places it last
    - A queued mutation survives a simulated app restart (re-reading MMKV)
    - Idempotency key is stable across multiple reads of the same queued item
    - _Requirements: 10.3, 10.6, 10.7, 10.10_

- [ ] 13. Implement connectivity store and the sync/replay engine
  - [ ] 13.1 Create `core/connectivity/useConnectivityStore.ts` (Zustand) exposing the four-state `SyncStatus` (`synced`/`pending-sync`/`offline`/`sync-failed`) plus a secondary advisory "slow network" flag
    - Derive state per design §8's precedence rules: Offline takes precedence over Pending Sync; Sync Failed takes precedence over Pending Sync when both exist
    - _Requirements: 13.1, 13.2, 10.9_
  - [ ] 13.2 Create `core/offline/QueueProcessor.ts` implementing `runAll()`: for each distinct `targetDate` in the queue, replay that date's mutations strictly FIFO, in parallel across dates
    - On success: remove from queue, cache the server's `closing`/`serverTime`
    - On lock-conflict/validation failure: mark this and every later queued item for that date "Sync Failed," stop replaying that date's queue, continue other dates
    - On transient/network failure: increment `retryCount`; auto-retry while `retryCount < 3`; else mark "Sync Failed" and stop replaying that date's queue
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 8.4_
  - [ ] 13.3 Wire `QueueProcessor.runAll()` to three trigger points: a NetInfo online-transition listener (within 5s), a manual "Sync Now" call site, and an `AppState` foreground-transition listener
    - Implement as a single `ConnectivityProvider` at root level subscribing to NetInfo and `AppState` once
    - _Requirements: 11.1, 11.8, 11.9, 8.1 (design §8.1)_
  - [ ]* 13.4 Write unit tests for `QueueProcessor.runAll()` using mocked API responses
    - Two dates' queues replay independently; a failure on one date's queue does not block the other date's queue
    - A lock-conflict failure stops replay for that date without auto-retry
    - A transient failure retries up to 3 times then marks "Sync Failed"
    - _Requirements: 11.2, 11.3, 11.5, 11.6_

- [ ] 14. Checkpoint - Ensure offline queue and sync engine tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Implement auth session state, provider, and navigation shell
  - [ ] 15.1 Create `core/auth/useAuthStore.ts` (Zustand): current `FinanceUserPublic`, session status (`pending`/`authenticated`/`unauthenticated`)
    - _Requirements: 1.6, 1.10_
  - [ ] 15.2 Create `app/providers/AuthProvider.tsx`: subscribes to `onAuthStateChanged` once on mount, resolves session status, and listens globally for `permission-denied`/token-revoked errors to trigger sign-out + cache-clear + navigate-to-Login-with-message flow
    - On Logout: call `signOut(auth)`, clear the current device session's cached Daily Closing draft from MMKV
    - _Requirements: 1.7, 1.10, 1.11, 2.5, 2.7_
  - [ ] 15.3 Create `navigation/RootNavigator.tsx`, `AuthNavigator.tsx`, `AppNavigator.tsx` (bottom tabs: Home, History, Settings), and `navigation/ModuleRegistry.ts` per design §17
    - `RootNavigator` renders Splash while auth state is pending, then switches to `AuthNavigator` or `AppNavigator`
    - `AppNavigator` iterates `REGISTERED_MODULES` rather than hard-coding Daily Closing as a special case
    - _Requirements: 1.10, 5.1, 5.2, 15.2, 15.3, 15.4_
  - [ ]* 15.4 Write unit tests for `useAuthStore` and the sign-out/cache-clear flow
    - Sign-out clears the store's user/session state and clears the MMKV draft cache key
    - _Requirements: 1.11, 2.7_

- [ ] 16. Implement Splash and Login screens
  - [ ] 16.1 Create `SplashScreen` (in `navigation/` or `app/`, since Splash/Login are app-level, not module-local) and `AuthNavigator`'s `LoginScreen`
    - Splash: branding only, no timer-based navigation, navigates purely on `onAuthStateChanged` resolution
    - Login: Username/Password fields (React Hook Form), Login button disabled until both fields are non-empty, loading state while request is in flight, exact server error message shown on failure, no forgot-password link
    - On successful `/login` response, call `signInWithCustomToken`; on failure of that exchange, show a retry-capable error without navigating past Login
    - _Requirements: 5.2, 5.3, 7.7, 1.6, 1.7, 1.11 (10.2 UI spec)_
  - [ ]* 16.2 Write unit tests for the Login screen
    - Login button is disabled when either field is empty, enabled when both are non-empty
    - Server error message is rendered verbatim on a failed login attempt
    - _Requirements: 7.7, 7.5_

- [ ] 17. Checkpoint - Ensure auth flow (backend + client) is fully wired and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 18. Implement Direct-Firestore read hooks
  - [ ] 18.1 Create `modules/daily-closing/hooks/useDailyClosing.ts` (TanStack Query wrapping `getDoc(doc(db, "fin_daily_closing", date))`)
    - Short `staleTime` for today's (unlocked) document; effectively-infinite `staleTime` once `locked === true`
    - _Requirements: 9.1_
  - [ ] 18.2 Create `modules/daily-closing/hooks/useDailyClosingHistory.ts` (range query: `branchId == DEFAULT_BRANCH_ID`, `date >= from`, `date <= to`, `orderBy date desc`)
    - _Requirements: 9.6, 16.1_
  - [ ] 18.3 Create `modules/daily-closing/hooks/useExpenseCategories.ts` (`fin_expense_categories` filtered to `branchId == DEFAULT_BRANCH_ID` and `active == true`) and `useFinanceDefaults.ts` (`finance_defaults` filtered to `branchId == DEFAULT_BRANCH_ID`)
    - _Requirements: 9.2, 9.3, 16.1_
  - [ ]* 18.4 Write integration tests for the three read hooks against a Firestore emulator
    - Each hook returns only documents matching its documented filter (branch, active flag, date range)
    - **Property 2: Every displayed authoritative total traces to a server response**
    - **Validates: Requirements 6.2**
    - _Requirements: 9.1, 9.2, 9.3, 9.6, 6.2_

- [ ] 19. Implement offline-aware mutation hooks
  - [ ] 19.1 Create `modules/daily-closing/hooks/useAddExpense.ts`, `useRemoveExpense.ts`, `useAddDeposit.ts`, `useRemoveDeposit.ts`, `useUpdateSales.ts`, `useSetOpeningCash.ts`, `useCloseDailyClosing.ts`
    - Each is a `useMutation` whose `mutationFn`: if online, calls `apiClient` directly against the corresponding `/api/mobile/v1/finance/closing/...` route and on success writes the returned `closing` into `useDailyClosing(date)`'s cache via `setQueryData`; if offline, enqueues via `core/offline/mutationQueue.ts` instead of attempting the network call
    - `useCloseDailyClosing` simply calls the generic enqueue function when offline — the queue itself (Task 12.3) is responsible for guaranteeing close is always ordered last for that date
    - _Requirements: 4.1, 4.6, 6.2, 10.1, 10.7_
  - [ ]* 19.2 Write unit tests for one representative mutation hook (`useAddExpense`) covering both branches
    - Online: calls `apiClient`, writes result into query cache
    - Offline: enqueues via the mutation queue instead of calling `apiClient`
    - _Requirements: 10.1, 6.2_

- [ ] 20. Implement the non-authoritative offline preview (optional, narrowly scoped)
  - [ ] 20.1 Create `modules/daily-closing/preview/estimatePendingTotals.ts` per design §9 item 3
    - Sums only the queued mutations' own input amounts for a clearly-labeled supplementary display line; never computes `cashRevenue`/`totalRevenue`, never replicates `roundCurrency` or `resolveOpeningCash`
    - Never written to the `useDailyClosing(date)` cache key; discarded the instant a fresh server `closing` arrives
    - _Requirements: 6.3, 10.6_
  - [ ]* 20.2 Write unit tests for `estimatePendingTotals.ts`
    - Sums only queued mutation input amounts, never reproduces an authoritative total field
    - Output is structurally distinct from `FinanceDailyClosing`'s summary fields (different field names/shape)
    - _Requirements: 6.3_

- [ ] 21. Checkpoint - Ensure data hooks and mutation hooks are fully tested
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 22. Implement shared UI primitives and connectivity/pending-sync banners
  - [ ] 22.1 Create `core/ui/components/`: `Modal`, `Button`, `SummaryRow`, `Banner`, and a breakdown-bars-equivalent presentation component
    - _Requirements: 5.1 (screen inventory, shared primitives)_
  - [ ] 22.2 Create `core/ui/components/ConnectivityBanner.tsx` rendering the four-state indicator (🟢 Synced / 🟡 Pending Sync / 🔴 Offline / 🔴 Sync Failed) sourced from `useConnectivityStore`
    - Tappable only in the Sync Failed state, navigating to Settings' sync detail
    - _Requirements: 13.1, 13.2, 13.3, 13.4_
  - [ ]* 22.3 Write unit tests for `ConnectivityBanner`
    - Renders exactly one of the four states, never two merged; tap only navigates when state is Sync Failed
    - _Requirements: 13.1, 13.3_

- [ ] 23. Implement the Home screen
  - [ ] 23.1 Create `modules/daily-closing/screens/HomeScreen.tsx`
    - Connectivity/sync indicator, today's date, status card (Not Started/In Progress/Closed derived from `useDailyClosing(todayDateKey())`), Opening Cash card (read-only), primary CTA (Start/Continue/View, opening `DailyClosingScreen` with the correct `mode`), History button, pull-to-refresh
    - _Requirements: 5.4, 6.4 (unset display), 6.5_
  - [ ]* 23.2 Write unit tests for the Home screen's status-card derivation logic
    - No document → "Not Started"; document with `locked: false` → "In Progress"; `locked: true` → "Closed"
    - _Requirements: 5.4_

- [ ] 24. Implement Daily Closing screen — Opening Cash and Cash Expenses sections
  - [ ] 24.1 Create `modules/daily-closing/screens/DailyClosingScreen.tsx` accepting route params `{ date, mode: "edit" | "readonly" }`, owning the `useDailyClosing(date)` query and passing `closing`/`isLoading`/`isError` down to children
    - Render `PostingWarningsBanner` above section 1 whenever `postingWarnings.length > 0`, verbatim text
    - In `readonly` mode, render every input as static text with no Add/Delete/Save affordances
    - _Requirements: 5.5, 6.18, 5.6_
  - [ ] 24.2 Create `modules/daily-closing/components/OpeningCashCard.tsx`
    - Read-only text when `openingCashSource == "chained"` (with amber deficit indicator when `< 0`); editable numeric field with on-blur save via `useSetOpeningCash` when `openingCashSource == "manual"`
    - _Requirements: 6.5, 6.6, 6.7, 7.4_
  - [ ] 24.3 Create `modules/daily-closing/components/CashExpensesSection.tsx` and `AddExpenseModal.tsx`
    - List of expense line items with delete affordance (confirmation prompt) when unlocked; "Add Expense" button hidden when locked; running `Cash Expense Total` row
    - Modal fields: Category (picker from `useExpenseCategories`), Amount (numeric), Remarks (optional); Save disabled until Category set and Amount is a positive finite number
    - _Requirements: 6.8, 6.10, 6.11, 7.1_
  - [ ]* 24.4 Write unit tests for `AddExpenseModal` validation
    - Save disabled with empty category or non-positive/non-finite amount; enabled otherwise
    - _Requirements: 7.1_

- [ ] 25. Implement Daily Closing screen — Cash Deposits, Sales, Closing Cash, Summary sections
  - [ ] 25.1 Create `modules/daily-closing/components/CashDepositsSection.tsx` and `AddDepositModal.tsx`
    - Same shape as Cash Expenses; Deposit Type picker from `SUPPORTED_CASH_DEPOSIT_TYPES`/`CASH_DEPOSIT_TYPE_LABELS`; `Cash Deposit Total` + `Total Cash Out` rows
    - _Requirements: 6.9, 6.10, 6.11, 7.2_
  - [ ] 25.2 Create `modules/daily-closing/components/TodaysSalesSection.tsx`
    - Four numeric fields (UPI/Zomato/Swiggy/Other), defaulting to stored value or 0, disabled when locked, on-blur save via `useUpdateSales`
    - _Requirements: 6.12_
  - [ ] 25.3 Create `modules/daily-closing/components/ClosingCashSection.tsx`
    - Single numeric Closing Cash field, disabled when locked, no pre-filled default beyond the last saved value
    - _Requirements: 6.13_
  - [ ] 25.4 Create `modules/daily-closing/components/DailySummarySection.tsx`
    - Rows in exact order: Opening Cash, Cash Expenses, Cash Deposits, Total Cash Out, Cash Revenue, UPI Sales, Zomato Sales, Swiggy Sales, Other Income, Total Revenue, Closing Cash
    - When `closingCash === null`, render `cashRevenue`/`totalRevenue` as `—`, never `0`
    - Unlocked: "Save Daily Closing" button disabled until Closing Cash is a valid number; on tap, persist the sales draft first, then call `useCloseDailyClosing`
    - Locked: replace Save with a locked message plus `closingTime`/`closedByName`
    - Overlay the non-authoritative preview (Task 20) only where mutations are queued, visually distinguished from authoritative rows
    - _Requirements: 6.4, 6.14, 6.15, 6.16, 6.17, 7.3, 6.3_
  - [ ]* 25.5 Write unit tests for `DailySummarySection`'s null-closingCash rendering
    - `closingCash === null` renders `cashRevenue`/`totalRevenue` as `—` in every case, never `0`
    - **Property 3: Null-closingCash invariant**
    - **Validates: Requirements 6.4**
  - [ ]* 25.6 Write unit tests for the Save button's enablement and the section order
    - Save disabled when Closing Cash is empty/non-numeric; sections render in the exact specified order
    - _Requirements: 6.15, 6.14_

- [ ] 26. Checkpoint - Ensure the Daily Closing screen is fully wired and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 27. Implement the History screen
  - [ ] 27.1 Create `modules/daily-closing/screens/HistoryScreen.tsx`
    - Date-range control (defaulting to "this month" through today) driving `useDailyClosingHistory`
    - Chronological list (newest first): date, total revenue or "Not yet closed", lock badge, `closedByName`/`closingTime` when locked; empty state "No Daily Closings in this range."
    - Tapping a row pushes `DailyClosingScreen` with `mode: "readonly"`; no search box anywhere on this screen
    - _Requirements: 5.6, 5.7_
  - [ ]* 27.2 Write unit tests for the History list rendering
    - Locked rows show lock badge, `closingTime`, `closedByName`; unlocked/no-document rows show "Not yet closed"
    - No search input is rendered anywhere on the screen
    - _Requirements: 5.6, 5.7_

- [ ] 28. Implement local error logging infrastructure
  - [ ] 28.1 Create `core/logging/errorLogStore.ts` (MMKV-backed, capped at a fixed max entry count with oldest-first eviction) and `core/logging/ErrorBoundary.tsx`
    - Capture points: top-level render errors, a global unhandled-promise-rejection handler, explicit `catch` blocks representing unexpected/unrecoverable conditions
    - Entry shape: `{ timestamp, screen, operation, message, stack }`; never stores usernames, passwords, tokens, or full document bodies
    - No network call anywhere in this module
    - _Requirements: 17.1, 17.2, 17.3, 17.4_
  - [ ] 28.2 Wrap the root app component with `ErrorBoundary`, rendering a generic "Something went wrong" screen with a restart affordance on catch
    - _Requirements: 17.1_
  - [ ]* 28.3 Write unit tests for `errorLogStore.ts`
    - Logging beyond the max entry count evicts the oldest entry first
    - Logged entries never contain a manually-attached credential/token when call sites follow the documented convention (test the store's own scrubbing/pass-through behavior, not call-site discipline)
    - _Requirements: 17.2, 17.4_

- [ ] 29. Implement the Settings screen (identity, sync, diagnostics, logout)
  - [ ] 29.1 Create `modules/daily-closing/screens/SettingsScreen.tsx` (or `core/ui/screens/SettingsScreen.tsx` per design §3's shared location) with four sections: Identity, Sync, Diagnostics, Logout
    - Identity: `fullName`/`username`, read-only
    - Sync: four-state status, list of failed queued mutations with per-item Retry/Discard, manual "Sync Now" button triggering `QueueProcessor.runAll()`
    - Logout: confirmation prompt, then the sign-out flow from Task 15.2
    - _Requirements: 5.9, 11.7, 11.8_
  - [ ] 29.2 Create `core/diagnostics/deviceInfo.ts` (deviceId, clientVersion, buildNumber helpers) and wire the Diagnostics section
    - Display: Current User, App Version, Build Number, Environment, Firebase Project, API Version, Last Successful Sync, Current Sync Status, Queue Size, Pending Operations, Failed Operations
    - Read-only, no destructive actions beyond Logout/Sync Now/per-item Retry/Discard already present elsewhere; never displays raw Firestore data, tokens, or credentials
    - _Requirements: 14.1, 14.2, 14.3_
  - [ ]* 29.3 Write unit tests for the Diagnostics section's derived counts
    - Queue Size, Pending Operations, and Failed Operations counts match the mutation queue's actual contents for a given fixture queue state
    - _Requirements: 14.1_

- [ ] 30. Final wiring: assemble the app shell and connect all providers
  - [ ] 30.1 Wire `App.tsx` with `QueryProvider`, `AuthProvider`, `ConnectivityProvider`, `ErrorBoundary`, and `RootNavigator` in the correct nesting order
    - Confirm the full navigation flow: Splash → (Login | Home/History/Settings tabs) → DailyClosingScreen (edit from Home, readonly from History)
    - _Requirements: 1.10, 5.1, 5.2, 15.2, 15.3_
  - [ ] 30.2 Confirm no placeholder screens or navigation entries exist for any module other than `daily-closing`
    - _Requirements: 15.4_
  - [ ]* 30.3 Write an end-to-end scenario test (mocked network/Firestore) covering: login → view Home → open Daily Closing → add an expense and a deposit → edit sales → set Closing Cash → Save → verify the screen reflects the server's returned `closing` object exactly, with every authoritative total traced to that response
    - **Property 2: Every displayed authoritative total traces to a server response**
    - **Validates: Requirements 6.2**
  - [ ]* 30.4 Write an offline/sync scenario test (NetInfo mocked offline, then online)
    - Add entries while offline → verify they queue and display "Pending Sync" → go online → verify `QueueProcessor` replays them FIFO and the screen ends up showing only server-authoritative totals with no queued items remaining
    - Simulate a lock-conflict discovered on replay → verify replay stops for that date and the conflict is surfaced for Discard, with no auto-retry
    - _Requirements: 11.1, 11.2, 11.3, 8.4, 11.5_

- [ ] 31. Final checkpoint - Ensure all tests pass across backend and mobile app
  - Ensure all tests pass, ask the user if questions arise.

## Task Dependency Graph

```
1 (backend scaffolding)
 └─▶ 2 (Firestore rules) ──▶ 3 (financeUsersService revocation) ──▶ 4 (login route) ──▶ 5 (checkpoint)
                                                                                          │
                                                                                          ▼
                              6 (verify helper) ──▶ 7 (idempotency) ──▶ 8 (mutation routes) ──▶ 9 (checkpoint)
                                                                                          │
                                                                                          ▼
10 (RN scaffold + type mirrors) ──▶ 11 (firebase client + secure storage) ──▶ 12 (offline queue) ──▶ 13 (sync engine) ──▶ 14 (checkpoint)
                                                                                          │
                                                                                          ▼
                              15 (auth store + navigation shell) ──▶ 16 (Splash/Login) ──▶ 17 (checkpoint)
                                                                                          │
                                                                                          ▼
                              18 (read hooks) ──▶ 19 (mutation hooks) ──▶ 20 (offline preview) ──▶ 21 (checkpoint)
                                                                                          │
                                                                                          ▼
                              22 (shared UI/banners) ──▶ 23 (Home) ──▶ 24/25 (Daily Closing screen) ──▶ 26 (checkpoint)
                                                                                          │
                                                                                          ▼
                              27 (History) ──▶ 28 (error logging) ──▶ 29 (Settings) ──▶ 30 (final wiring) ──▶ 31 (final checkpoint)
```

Backend tasks (1-9) can proceed independently of, and ahead of, the RN app scaffolding (10) since the mobile client needs a real API to call against. Within the RN app, infrastructure (11-15) must land before any screen (16, 23-29) is built on top of it, and data/mutation hooks (18-19) must exist before the Daily Closing screen (24-25) that consumes them.

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"], "description": "Backend scaffolding (Admin SDK, env vars)" },
    { "wave": 2, "tasks": ["2"], "description": "Firestore rules: isFinanceUser() and collection grants" },
    { "wave": 3, "tasks": ["3"], "description": "Approved edit to financeUsersService.ts for token revocation" },
    { "wave": 4, "tasks": ["4"], "description": "Mobile login API route" },
    { "wave": 5, "tasks": ["5"], "description": "Checkpoint: backend auth + rules tests" },
    { "wave": 6, "tasks": ["6"], "description": "Identity-forwarding verification helper" },
    { "wave": 7, "tasks": ["7"], "description": "Idempotency record helper" },
    { "wave": 8, "tasks": ["8"], "description": "Identity-forwarding mutation API routes" },
    { "wave": 9, "tasks": ["9"], "description": "Checkpoint: backend routes + idempotency tests" },
    { "wave": 10, "tasks": ["10"], "description": "RN project scaffold + type/constant mirrors" },
    { "wave": 11, "tasks": ["11"], "description": "Firebase client + secure auth storage" },
    { "wave": 12, "tasks": ["12"], "description": "Offline mutation queue" },
    { "wave": 13, "tasks": ["13"], "description": "Connectivity store + sync/replay engine" },
    { "wave": 14, "tasks": ["14"], "description": "Checkpoint: offline queue + sync engine tests" },
    { "wave": 15, "tasks": ["15"], "description": "Auth session state + navigation shell" },
    { "wave": 16, "tasks": ["16"], "description": "Splash and Login screens" },
    { "wave": 17, "tasks": ["17"], "description": "Checkpoint: auth flow fully wired" },
    { "wave": 18, "tasks": ["18"], "description": "Direct-Firestore read hooks" },
    { "wave": 19, "tasks": ["19"], "description": "Offline-aware mutation hooks" },
    { "wave": 20, "tasks": ["20"], "description": "Non-authoritative offline preview" },
    { "wave": 21, "tasks": ["21"], "description": "Checkpoint: data + mutation hooks tested" },
    { "wave": 22, "tasks": ["22"], "description": "Shared UI primitives + connectivity banner" },
    { "wave": 23, "tasks": ["23"], "description": "Home screen" },
    { "wave": 24, "tasks": ["24"], "description": "Daily Closing screen: Opening Cash + Cash Expenses" },
    { "wave": 25, "tasks": ["25"], "description": "Daily Closing screen: Deposits, Sales, Closing Cash, Summary" },
    { "wave": 26, "tasks": ["26"], "description": "Checkpoint: Daily Closing screen fully wired" },
    { "wave": 27, "tasks": ["27"], "description": "History screen" },
    { "wave": 28, "tasks": ["28"], "description": "Local error logging infrastructure" },
    { "wave": 29, "tasks": ["29"], "description": "Settings screen" },
    { "wave": 30, "tasks": ["30"], "description": "Final wiring: app shell + provider composition" },
    { "wave": 31, "tasks": ["31"], "description": "Final checkpoint: all backend + mobile tests pass" }
  ]
}
```

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP; they are not implemented automatically as part of task execution.
- Every mutation route, hook, and screen task references the specific requirement clauses it satisfies for traceability back to `requirements.md`.
- Correctness properties 1–5 from `design.md` are each covered by exactly one property/verification task, placed next to the implementation it validates: Property 1 (Task 10.4), Property 2 (Tasks 18.4, 30.3), Property 3 (Task 25.5), Property 4 (Tasks 7.2, 8.6), Property 5 (Task 2.3).
- No task in this plan ports, re-implements, or references `computeDerivedTotals()`, `roundCurrency()`, or `resolveOpeningCash()` client-side, consistent with Requirement 6.1 and design §9.
- Checkpoints are placed after each major subsystem (backend auth/rules, offline/sync engine, auth+navigation shell, data/mutation hooks, Daily Closing screen) so issues are caught before the next subsystem builds on top.
