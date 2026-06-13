# Implementation Plan: Dajaj Ecosystem

## Overview

This implementation plan transforms the Dajaj single-channel web POS into a unified multi-channel restaurant ecosystem. The Android POS application is built using Kotlin, XML layouts, MVVM + Clean Architecture, Hilt, Room, and Firebase Firestore. The existing Next.js web application is retained for menu management, inventory, customer ordering, and administration. Implementation follows 12 milestones progressing from architecture setup through production launch.

## Tasks

- [x] 1. Architecture Setup & Project Skeleton
  - [x] 1.1 Create Android multi-module Gradle project structure
    - Create root `dajaj-android/` project with `settings.gradle.kts` and `build.gradle.kts`
    - Create module directories: `app`, `feature-pos`, `feature-pending-orders`, `feature-kitchen`, `feature-reports`, `feature-settings`, `core-domain`, `core-data`, `core-bluetooth`, `core-print-agent`, `core-ui`, `core-common`
    - Configure each module's `build.gradle.kts` with appropriate plugins (android-library or android-application)
    - Set up Kotlin version, compileSdk, minSdk (API 26), targetSdk
    - Configure module dependencies following Clean Architecture (presentation → domain ← data)
    - _Requirements: 5.9, 14.1_

  - [x] 1.2 Configure Hilt dependency injection
    - Add Hilt Gradle plugin and dependencies to root and module build files
    - Create `@HiltAndroidApp` Application class in `app` module
    - Create `FirestoreModule` providing `FirebaseFirestore` and collection references
    - Create `RoomModule` providing `AppDatabase` and DAOs
    - Create `BluetoothModule` providing `BluetoothAdapter` and `PrinterManager`
    - Create `NetworkModule` providing `ConnectivityMonitor`
    - _Requirements: 5.9, 14.1_

  - [x] 1.3 Set up Navigation Component and Activity structure
    - Create `AuthActivity` (portrait) with NavGraph for login flow
    - Create `MainActivity` (supports landscape for POS) with NavGraph for post-auth screens
    - Define navigation graph XML with destinations: Dashboard, POS, PendingOrders, Kitchen, Reports, Settings, Bills
    - Configure deep linking and safe-args plugin
    - _Requirements: 5.9_

  - [x] 1.4 Configure core-ui module with Material 3 theme and shared components
    - Define Material 3 color scheme (light/dark) in `themes.xml`
    - Create shared styles: button styles, card styles, text styles meeting WCAG AA contrast (4.5:1)
    - Create reusable XML components: status indicator, loading overlay, error banner
    - Set minimum touch target size to 48dp across all shared components
    - _Requirements: 5.2, 5.9_

  - [x] 1.5 Set up core-common module with utilities
    - Create extension functions for common operations (timestamps, formatting, currency)
    - Create constants file (retry limits, timeouts, queue capacities)
    - Create `Result<T>` wrapper for domain layer results
    - Create connectivity state enum and observer interface
    - _Requirements: 5.9_

- [x] 2. Firebase Setup
  - [x] 2.1 Configure Firebase project and Android SDK integration
    - Add `google-services.json` to `app` module
    - Configure Firebase dependencies (Firestore, Auth, Crashlytics)
    - Set up Firebase Auth with email/password provider
    - Configure Firestore persistence settings for offline support
    - _Requirements: 14.1, 14.2_

  - [x] 2.2 Create Firestore security rules
    - Write security rules for `menus` collection (public read, manager/admin write)
    - Write security rules for `orders` collection (authenticated read, cashier/manager/admin write)
    - Write security rules for `pending_orders` collection (authenticated read, public create, cashier/manager/admin update)
    - Write security rules for `print_jobs` collection (authenticated read/write for staff)
    - Write security rules for `devices` collection (authenticated read/write for staff)
    - Write security rules for `users` collection (self-read, manager read, admin write)
    - Write security rules for `bills` collection (public read by token, staff write)
    - Deploy rules to Firebase
    - _Requirements: 14.4, 14.5, 15.1, 15.2, 15.3, 15.4_

  - [ ]* 2.3 Write property test for security rules enforcement
    - **Property 21: Security Rules Enforce Role-Based Access**
    - Test all (role, collection, operation) combinations against expected access matrix
    - Verify unauthorized attempts return permission-denied error
    - Use Firebase Emulator for rule testing
    - **Validates: Requirements 14.4, 14.5**

  - [x] 2.4 Create Firestore composite indexes
    - Create index: `menus` → `parentId` + `order`
    - Create index: `menus` → `type` + `isAvailable`
    - Create index: `orders` → `restaurantId` + `status` + `createdAt`
    - Create index: `orders` → `restaurantId` + `createdAt`
    - Create index: `orders` → `restaurantId` + `channel` + `createdAt`
    - Create index: `pending_orders` → `restaurantId` + `status` + `createdAt`
    - Create index: `print_jobs` → `restaurantId` + `status`
    - Create index: `devices` → `restaurantId` + `status`
    - Create index: `bills` → `restaurantId` + `createdAt`
    - _Requirements: 14.1, 14.3_

  - [x] 2.5 Set up counters collection for atomic sequence generation
    - Create `counters/orders` document for global order counter (starting value >1000)
    - Create `counters/bills` document for bill counter
    - Implement atomic increment function using `runTransaction()`
    - Implement daily counter (`orders_DDMMYY`) for POS order labels
    - _Requirements: 3.2_

  - [ ]* 2.6 Write property test for sequential order number generation
    - **Property 3: Sequential Order Number Generation**
    - Test that N concurrent requests produce N unique, strictly sequential numbers > 1000
    - Simulate concurrent counter increments
    - **Validates: Requirements 3.2**

- [x] 3. Checkpoint - Ensure architecture builds and Firebase connects
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Android Foundation - Authentication
  - [x] 4.1 Create domain layer for authentication
    - Define `User` domain model with id, email, name, role, status fields
    - Define `AuthRepository` interface in core-domain with methods: signIn, signOut, getCurrentUser, resetPassword
    - Create `SignInUseCase` with credential validation (email format, min 6 chars password)
    - Create `ValidateRoleUseCase` to check `pos_staff` status is active
    - _Requirements: 15.1, 15.3_

  - [x] 4.2 Implement data layer for authentication
    - Create `AuthRepositoryImpl` in core-data using Firebase Auth SDK
    - Implement `signIn()` with Firebase `signInWithEmailAndPassword`
    - Implement `getCurrentUser()` reading from Firestore `users` collection
    - Implement role validation checking `pos_staff` document status
    - Store auth token in Android Keystore
    - Implement auto-login on app restart if token valid
    - Handle session expiry after 30 days of inactivity
    - _Requirements: 15.1, 15.3_

  - [x] 4.3 Build Authentication UI screen
    - Create `LoginFragment` XML layout: app logo, email TextInputLayout, password TextInputLayout (toggle visibility), Sign In MaterialButton, Forgot Password link, CircularProgressIndicator, error TextView
    - Create `LoginViewModel` with LiveData for UI state (idle, loading, success, error)
    - Implement input validation: email format, password minimum 6 characters
    - Handle error states: invalid credentials, pending account, rejected account, network error
    - Implement loading state: button shows progress, inputs disabled during auth
    - Navigate to Dashboard on success
    - _Requirements: 5.9, 15.3_

  - [ ]* 4.4 Write unit tests for authentication flow
    - Test login success navigates to dashboard
    - Test invalid credentials shows error message
    - Test pending account shows "pending approval" message
    - Test rejected account shows "access denied" message
    - Test network error shows connectivity message
    - Test empty field validation
    - _Requirements: 15.3_

- [x] 5. Android Foundation - Dashboard & Connectivity
  - [x] 5.1 Build Dashboard screen
    - Create `DashboardFragment` XML layout: header (restaurant name, cashier name, date/time), status bar (internet dot, printer dot, device name), 2x3 navigation grid cards
    - Create navigation cards: New Order, Pending Orders (with badge), Kitchen (with badge), Reports, Settings, Bills
    - Create `DashboardViewModel` with LiveData for pending count, preparing count, connectivity status
    - Set up Firestore real-time listener for pending order count badge
    - Ensure all cards have `contentDescription` for accessibility
    - Ensure touch targets ≥48dp, color indicators supplemented with text labels
    - _Requirements: 5.2, 5.9, 12.6_

  - [x] 5.2 Implement ConnectivityMonitor service
    - Create `ConnectivityMonitor` class using Android `ConnectivityManager` callbacks
    - Detect internet availability changes within 2 seconds
    - Expose connectivity state as `StateFlow<ConnectivityState>` (ONLINE/OFFLINE)
    - Display offline indicator across all screens when internet unavailable
    - Display printer connectivity status (CONNECTED/RECONNECTING/DISCONNECTED)
    - _Requirements: 12.6, 4.8_

  - [ ]* 5.3 Write unit tests for connectivity monitoring
    - Test online/offline state transitions update UI within 2 seconds
    - Test offline indicator shows correct message
    - Test badge counts update from Firestore listener
    - _Requirements: 12.6_

- [x] 6. Menu Synchronization
  - [x] 6.1 Create Room Database schema for menu cache
    - Define `MenuEntity` Room entity with all fields matching Firestore menu document
    - Create `MenuDao` with queries: getAllMenuItems, getByParentId, getByType, getAvailableVariants, upsert, deleteAll
    - Create `AppDatabase` abstract class extending RoomDatabase with migration support
    - Configure database version and export schema
    - _Requirements: 1.4, 1.5_

  - [x] 6.2 Implement menu sync from Firestore to Room
    - Create `MenuFirestoreDataSource` with `onSnapshot` listener on `menus` collection
    - Create `MenuLocalDataSource` wrapping Room DAO operations
    - Create `MenuRepositoryImpl` implementing `MenuRepository` interface
    - On snapshot update: diff incoming data with Room cache, upsert changed nodes, delete removed nodes
    - Ensure sync completes within 5 seconds of Firestore write
    - _Requirements: 1.2, 1.4, 1.6_

  - [x] 6.3 Implement offline menu serving and sync recovery
    - When offline, serve menu exclusively from Room Database
    - On reconnection, re-establish Firestore listener
    - Reconcile full collection snapshot with local cache within 10 seconds
    - Implement retry logic: up to 3 attempts with exponential backoff on sync failure
    - Continue serving cached menu until synchronization succeeds
    - _Requirements: 1.5, 1.6, 1.8_

  - [ ]* 6.4 Write property test for offline menu cache round-trip
    - **Property 1: Offline Menu Cache Round-Trip**
    - Generate random menu trees, cache them, verify offline read returns exact same tree
    - Test no missing nodes, no altered prices, no changed availability
    - **Validates: Requirements 1.5**

  - [ ]* 6.5 Write unit tests for menu synchronization
    - Test menu update reflects in Room within 5 seconds
    - Test offline serves cached menu
    - Test reconnection syncs within 10 seconds
    - Test retry with exponential backoff on failure
    - _Requirements: 1.2, 1.5, 1.6, 1.8_

- [x] 7. POS Screen - Layout and Categories
  - [x] 7.1 Create three-panel landscape POS layout
    - Create `PosFragment` XML layout with horizontal LinearLayout: left panel (200dp), center panel (flexible), right panel (320dp)
    - Left panel: RecyclerView for categories with "★ Favorites" as first fixed item
    - Center panel: search bar (EditText) at top, GridLayoutManager RecyclerView (3-4 columns) for items
    - Right panel: order label, ScrollView for cart items, subtotal/tax/total, order type RadioGroup, Confirm Order button, Clear Cart button
    - Force landscape orientation for POS Activity/Fragment
    - _Requirements: 5.1, 5.2_

  - [x] 7.2 Implement category navigation and menu item display
    - Create `CategoryAdapter` for left panel RecyclerView
    - Load categories from Room DB (cached from Firestore)
    - On category tap: display items within 200ms using shimmer placeholder
    - Create `MenuItemAdapter` for center panel GridLayoutManager
    - Each item card shows: name, variant label, price, availability badge
    - Show unavailable items grayed out and non-tappable
    - Implement search bar filtering items by name (case-insensitive) across all categories
    - Implement pull-to-refresh to force sync from Firestore
    - _Requirements: 5.1, 5.3, 5.4_

  - [x] 7.3 Implement Favorites section
    - Create Favorites data model (up to 20 items configured by manager)
    - Display Favorites as first category in left panel
    - Load favorites from Firestore/Room cache
    - Show favorite items in center panel when "★ Favorites" is selected
    - _Requirements: 5.4_

- [x] 8. POS Screen - Cart and Order Confirmation
  - [x] 8.1 Implement cart management
    - Create `CartViewModel` managing cart state as LiveData<List<CartItem>>
    - Implement: add item (qty 1), increment qty, decrement qty (remove at 0), swipe-to-delete
    - Create `CartAdapter` showing: quantity (- / +), name, variant, modifiers, line total, remove button
    - Calculate subtotal = sum of all item totals, compute CGST/SGST, compute grand total
    - Display totals updating in real-time as cart changes
    - _Requirements: 5.5_

  - [ ]* 8.2 Write property test for cart arithmetic
    - **Property 9: Cart Arithmetic**
    - Test initial quantity is 1, increment produces N+1, decrement produces N-1 (remove at 0)
    - Test subtotal always equals sum of all item totals
    - Use random items and quantities as generators
    - **Validates: Requirements 5.5**

  - [x] 8.3 Implement modifier selection dialog
    - Create `ModifierBottomSheetDialogFragment` with modifier groups
    - Show selection type (single via RadioButton, multiple via CheckBox) per group
    - Enforce min/max selection constraints per modifier group
    - Display price adjustments for each modifier
    - "Add to Cart" button at bottom, disabled until valid selection
    - _Requirements: 5.5_

  - [x] 8.4 Implement order type selection and order confirmation
    - Create order type selector: Walk-in / Takeaway / Dine-in (SegmentedButton or RadioGroup)
    - "Confirm Order" button disabled until: order type selected AND cart has ≥1 item
    - On confirm: create order document in Firestore with atomic order number, generate bill, create KOT print job
    - Generate order number format: DDMMYY#### using daily counter transaction
    - Show full-screen loading overlay during "Creating order..."
    - On success: show bill summary, reset cart
    - On Firestore write failure: retry with exponential backoff, show snackbar error
    - On offline: save order to Room DB, queue for sync
    - _Requirements: 5.6, 5.7, 5.8, 12.1_

  - [ ]* 8.5 Write property test for order confirmation producing bill and print job
    - **Property 10: Order Confirmation Produces Bill and Print Job**
    - For any valid cart with selected order type, confirm produces exactly one bill and one KOT print job referencing same order number
    - **Validates: Requirements 5.6**

  - [ ]* 8.6 Write unit tests for POS screen operations
    - Test category switch loads items within 200ms
    - Test add item to cart increments count
    - Test confirm with empty cart is prevented
    - Test confirm without order type is prevented
    - Test modifier validation enforces min/max selection
    - Test offline order saves to Room
    - _Requirements: 5.3, 5.5, 5.6, 5.8_

- [x] 9. Checkpoint - Ensure POS order creation flow works end-to-end
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Pending Orders Pipeline
  - [x] 10.1 Create domain models and repository for pending orders
    - Define `PendingOrder` domain model with: id, restaurantId, orderNumber, channel, status, customerName, customerPhone, items, total, notes, rejectionReason, createdAt, processedAt
    - Define `PendingOrderStatus` enum: PENDING, ACCEPTED, REJECTED
    - Define `OrderChannel` enum: WHATSAPP, WEBSITE, QR, SWIGGY, ZOMATO
    - Define `PendingOrderRepository` interface: observePendingOrders, acceptOrder, rejectOrder
    - Create `AcceptPendingOrderUseCase` and `RejectPendingOrderUseCase`
    - _Requirements: 4.1, 4.4_

  - [x] 10.2 Implement pending orders data layer with real-time listener
    - Create `PendingOrderFirestoreDataSource` with `onSnapshot` listener on `pending_orders` where status == "pending"
    - Create `PendingOrderLocalDataSource` with Room entity and DAO for offline cache
    - Create `PendingOrderRepositoryImpl` combining Firestore and Room sources
    - Ensure new pending orders display within 3 seconds of Firestore write
    - Sort pending orders by creation timestamp ascending (oldest first)
    - _Requirements: 4.2, 4.3_

  - [ ]* 10.3 Write property test for pending orders sort order
    - **Property 6: Pending Orders Sort Order**
    - For any list of pending orders, verify display is sorted by creation timestamp ascending
    - **Validates: Requirements 4.2, 4.3**

  - [x] 10.4 Implement accept pending order flow
    - On accept: convert pending order to POS order preserving all items, quantities, and prices
    - Generate KOT print job automatically (no manual item re-entry)
    - Update pending order status to ACCEPTED with processedAt timestamp
    - Handle unavailable menu items: show error, retain order as PENDING, do not generate KOT
    - _Requirements: 4.5, 4.6_

  - [ ]* 10.5 Write property test for pending-to-POS conversion
    - **Property 7: Pending-to-POS Conversion Preserves Items**
    - For any valid pending order accepted, resulting POS order has exact same items/quantities/prices
    - **Validates: Requirements 4.5**

  - [x] 10.6 Implement reject pending order flow
    - Show rejection reason dialog (TextInputLayout, 1-200 chars)
    - Validate reason: non-empty, max 200 characters
    - On reject: update status to REJECTED, store rejection reason and timestamp
    - _Requirements: 4.7_

  - [ ]* 10.7 Write property test for rejection reason validation
    - **Property 8: Rejection Reason Validation**
    - Test rejecting succeeds iff reason length is 1-200 chars inclusive
    - Test empty and >200 char strings are rejected
    - **Validates: Requirements 4.7**

  - [x] 10.8 Build Pending Orders UI screen
    - Create `PendingOrdersFragment` XML layout: tab bar (All/WhatsApp/Website/QR), RecyclerView of order cards
    - Each card shows: order #, source channel icon, customer name, item count, total, elapsed time, Accept/Reject buttons
    - Implement channel filtering via tabs
    - Implement expandable card to show full item details on tap
    - Show connectivity warning banner when Firestore listener disconnects
    - Implement pull-to-refresh for force re-sync
    - Show empty state: "No pending orders. Orders from all channels will appear here."
    - _Requirements: 4.2, 4.3, 4.8_

- [x] 11. Bluetooth Printer Module
  - [x] 11.1 Create core-bluetooth module with printer management
    - Create isolated `core-bluetooth` module with no POS business logic dependencies
    - Define `PrinterManager` interface: scanForPrinters, pair, connect, disconnect, sendData, getStatus
    - Define `PrinterStatus` enum: CONNECTED, DISCONNECTED, RECONNECTING
    - Define `Printer` model: name, macAddress, status, isKotPrinter, isBillPrinter
    - Implement `BluetoothPrinterManager` using Android Bluetooth Classic API
    - _Requirements: 6.1, 6.7_

  - [x] 11.2 Implement Bluetooth scanning and pairing
    - Implement device discovery scan with 15-second timeout
    - Handle Bluetooth permissions (BLUETOOTH_CONNECT, BLUETOOTH_SCAN for API 31+)
    - Implement pairing workflow: scan → select → pair → test
    - Support up to 5 paired printers
    - Show "No printers found" if scan discovers nothing within 15 seconds
    - Handle Bluetooth disabled state: show system dialog to enable
    - _Requirements: 6.1, 6.6_

  - [x] 11.3 Implement auto-reconnection logic
    - On unexpected disconnect: attempt reconnection every 5 seconds for 60 seconds
    - After 60 seconds timeout: stop attempts, set status "disconnected", show notification
    - Update printer status in UI within 2 seconds of any status change
    - Expose printer status as observable for other modules
    - _Requirements: 6.2, 6.3, 6.4_

  - [x] 11.4 Implement ESC/POS command builder and test print
    - Create `EscPosCommandBuilder` for formatting print data (text alignment, bold, cut, feed)
    - Implement test print functionality: send test page, confirm success/failure within 10 seconds
    - Build KOT print template: order number, time, items with qty, modifiers, special notes
    - Build Customer Bill template: restaurant header, itemized list, tax breakdown, total, payment method
    - Build Reprint template: original payload + "REPRINT" header
    - _Requirements: 6.5, 7.4, 7.5, 7.6_

  - [x] 11.5 Build Printer Settings UI screen
    - Create `PrinterSettingsFragment` XML: "Scan for Printers" button, paired printers list with status indicators
    - Each printer shows: name, MAC address, status indicator (green/yellow/red)
    - Actions per printer: Connect, Disconnect, Test Print, Set as KOT Printer, Set as Bill Printer
    - Show scanning progress during 15-second discovery
    - Handle error states: no printers found, pairing failed, test print failed
    - _Requirements: 6.1, 6.4, 6.5, 6.6_

  - [ ]* 11.6 Write unit tests for Bluetooth printer operations
    - Test scan timeout shows "no printers found"
    - Test auto-reconnection attempts every 5s for 60s
    - Test reconnection stops after timeout
    - Test status updates within 2 seconds
    - Test test print confirms within 10 seconds
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.6_

- [x] 12. Print Queue System
  - [x] 12.1 Create print job domain models and repository
    - Define `PrintJob` domain model: id, restaurantId, jobType, printerType, status, claimedBy, orderId, orderNumber, payload, retryCount, failureReason, source, timestamps
    - Define `PrintJobType` enum: KOT, CUSTOMER_BILL, REPRINT
    - Define `PrintJobStatus` enum: PENDING, PROCESSING, COMPLETED, FAILED
    - Define `PrintJobRepository` interface: createJob, claimJob, updateStatus, observePendingJobs, getJobsByOrder
    - Create `CreatePrintJobUseCase` ensuring all required payload fields per job type
    - _Requirements: 7.1, 7.2, 7.3, 7.10_

  - [ ]* 12.2 Write property test for print job creation completeness
    - **Property 11: Print Job Creation Completeness**
    - For any print action (KOT, Bill, Reprint), verify job has all required fields and type-specific payload content
    - **Validates: Requirements 7.1, 7.2, 7.4, 7.5, 7.6**

  - [ ]* 12.3 Write property test for print job state machine
    - **Property 12: Print Job State Machine**
    - Test valid transitions: PENDING→PROCESSING→COMPLETED, PENDING→PROCESSING→FAILED, FAILED→PENDING
    - Test all other transitions are rejected
    - **Validates: Requirements 7.10**

  - [x] 12.4 Implement Print Agent Foreground Service
    - Create `PrintAgentService` extending `Service` with `startForeground()` and persistent notification
    - Display current state in notification: idle, printing, error
    - Maintain real-time Firestore listener for `print_jobs` where status=PENDING and restaurantId matches
    - Only process jobs if device is `isPrimaryPrinter: true`
    - Start service on app launch and BOOT_COMPLETED broadcast
    - Continue operating when POS application screen is closed
    - _Requirements: 8.1, 8.2, 8.9_

  - [x] 12.5 Implement job claiming with Firestore transactions
    - On new PENDING job detected: claim via `runTransaction` (read status, verify PENDING, set PROCESSING + claimedBy=deviceId)
    - Claim must complete within 5 seconds of detection
    - On transaction failure: retry up to 3 times with 2-second delay, then skip job
    - Verify `claimedBy` matches own device ID before printing
    - _Requirements: 8.3, 8.4, 7.8_

  - [ ]* 12.6 Write property test for duplicate print prevention
    - **Property 14: Duplicate Print Prevention**
    - Simulate multiple agents claiming same PENDING job concurrently
    - Verify exactly one claims successfully, all others fail
    - **Validates: Requirements 7.8**

  - [x] 12.7 Implement print execution with retry logic
    - Send claimed job payload to connected Bluetooth printer via `PrinterManager`
    - Wait no longer than 30 seconds for print operation to complete
    - On success: update job status to COMPLETED in Firestore
    - On failure: retry up to 3 times with exponential backoff (2s, 4s, 8s)
    - After all retries exhausted: update status to FAILED with failure reason
    - Show notification on FAILED indicating job type and order number, allow manual retry
    - _Requirements: 7.7, 8.5, 8.6, 8.7, 7.9_

  - [ ]* 12.8 Write property test for retry with exponential backoff
    - **Property 13: Retry with Exponential Backoff**
    - Test retries up to configured max (3 for print, 5 for sync) with correct backoff intervals
    - Test operation marked failed after exhausting retries
    - **Validates: Requirements 7.7, 8.4, 8.7, 1.8**

  - [x] 12.9 Implement local print queue for offline/disconnected printer
    - Create `local_print_queue` Room table for jobs waiting for printer or internet
    - When Bluetooth printer disconnected: queue jobs locally (up to 500)
    - When printer reconnects: drain local queue in FIFO chronological order
    - On drain failure: retry each job up to 3 times, skip on failure, continue with next
    - Sync completed job statuses to Firestore when internet available
    - _Requirements: 8.8, 12.3, 12.4, 12.5_

- [x] 13. Checkpoint - Ensure printing pipeline works end-to-end
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Kitchen Workflow
  - [x] 14.1 Implement order state machine in domain layer
    - Create `OrderStateMachine` with valid transitions: PENDING→ACCEPTED→PREPARING→READY→COMPLETED, any→CANCELLED, PENDING→REJECTED
    - Implement `transition(currentState, targetState)` returning success/failure
    - Reject invalid transitions, retain current state
    - Apply same state progression regardless of order channel
    - _Requirements: 11.1, 11.2, 11.5_

  - [ ]* 14.2 Write property test for order state machine validity
    - **Property 2: Order State Machine Validity**
    - For any (state, transition) pair, verify transition succeeds iff it follows valid sequence
    - Test all channel types use same state progression
    - **Validates: Requirements 4.4, 11.1, 11.2, 11.5**

  - [x] 14.3 Build Kitchen screen UI
    - Create `KitchenFragment` XML layout: header with PREPARING order count, RecyclerView of kitchen cards
    - Each card shows: order number, items with quantities, special notes, elapsed timer, "Mark Ready" button
    - Sort orders by `preparingAt` timestamp ascending (FIFO, oldest first)
    - Display overdue indicator (red border + "OVERDUE" badge) after 30 minutes in PREPARING
    - Play audible alert when order marked READY
    - Show visual indicator on cashier screen for READY orders
    - Update order status to READY in Firestore within 2 seconds of tap
    - Empty state: "Kitchen is clear. New orders will appear when accepted."
    - _Requirements: 11.3, 11.4, 11.6_

  - [ ]* 14.4 Write property test for kitchen queue FIFO order
    - **Property 17: Kitchen Queue FIFO Order**
    - For random orders in PREPARING state, verify sorted by preparingAt ascending
    - Verify orders >30 minutes marked with overdue indicator
    - **Validates: Requirements 11.3, 11.6**

  - [ ]* 14.5 Write unit tests for kitchen workflow
    - Test mark ready transitions to READY and updates Firestore
    - Test FIFO ordering with multiple orders
    - Test overdue detection at 30-minute boundary
    - Test audio alert fires on ready
    - _Requirements: 11.3, 11.4, 11.6_

- [x] 15. Device Management & Heartbeat
  - [x] 15.1 Implement device registration and heartbeat system
    - On app start: register device in `devices` collection with status ONLINE, current heartbeat, device info
    - Create `HeartbeatWorker` using WorkManager PeriodicWorkRequest every 30 seconds
    - Update `lastHeartbeat` field every 30 seconds
    - Mark device OFFLINE when `lastHeartbeat` > 90 seconds (evaluated by reading clients)
    - Store deviceName (max 50 chars), isPrimaryPrinter flag, printerStatus map
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [ ]* 15.2 Write property test for device offline detection
    - **Property 16: Device Offline Detection**
    - For any device, status returns OFFLINE iff lastHeartbeat > 90 seconds from current time
    - **Validates: Requirements 10.4**

  - [x] 15.3 Implement primary printer designation
    - Enforce exactly one device as `isPrimaryPrinter: true` via Firestore transaction
    - On designation attempt: check-then-set atomically, reject if another device already primary
    - If primary device goes OFFLINE: leave primary unassigned (no auto-failover)
    - Non-primary devices do NOT process print jobs from Firestore listener
    - _Requirements: 10.5, 10.6, 10.7_

  - [ ]* 15.4 Write property test for primary printer uniqueness
    - **Property 15: Primary Printer Uniqueness Invariant**
    - For any set of registered devices, at most one has isPrimaryPrinter:true
    - Test concurrent designation attempts result in exactly one success
    - **Validates: Requirements 10.5, 10.7**

- [x] 16. Offline Strategy
  - [x] 16.1 Implement offline order storage and sync
    - Create `local_orders` Room table for orders created while offline (capacity: 500)
    - On internet loss: save orders to Room DB with chronological timestamps
    - On internet restore: sync all local orders to Firestore via WorkManager in chronological order within 60 seconds
    - Retry sync up to 5 times with exponential backoff on failure
    - Ensure no orders lost during connectivity interruptions
    - _Requirements: 12.1, 12.2, 12.5_

  - [ ]* 16.2 Write property test for offline queue capacity and ordering
    - **Property 18: Offline Queue Capacity and Ordering**
    - Test up to 500 items stored locally, processed in strict chronological order on restore
    - Test no items within capacity limit are lost
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5**

  - [ ]* 16.3 Write unit tests for offline operations
    - Test order saved locally when offline
    - Test sync happens within 60 seconds of reconnect
    - Test retry with exponential backoff on sync failure
    - Test 500 order capacity limit
    - Test offline status indicator displayed
    - _Requirements: 12.1, 12.2, 12.5, 12.6_

- [x] 17. Checkpoint - Ensure offline operations and device management work
  - Ensure all tests pass, ask the user if questions arise.

- [x] 18. Reports
  - [x] 18.1 Implement reports data aggregation
    - Create `ReportsRepository` querying orders by restaurantId + date range from Firestore
    - Calculate: total orders count, total revenue (sum of grandTotal), average order value
    - Calculate channel breakdown: order counts and revenue per channel
    - Calculate peak hour: identify 1-hour slot with highest order count in period
    - Support daily (calendar day 00:00-23:59 in configured timezone), weekly (7 days), monthly (30 days) periods
    - Reflect completed orders in totals within 60 seconds of COMPLETED status
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [ ]* 18.2 Write property test for report aggregation correctness
    - **Property 19: Report Aggregation Correctness**
    - For random order sets, verify aggregate totals = sum of individual channel totals
    - Verify count, revenue, average, peak hour calculations are correct
    - Each order attributed to exactly one channel
    - **Validates: Requirements 13.1, 13.3, 13.4**

  - [ ]* 18.3 Write property test for daily report date boundary
    - **Property 20: Daily Report Date Boundary**
    - For random timestamps near midnight, verify each order assigned to exactly one daily bucket
    - Verify no double-counting or missed orders at boundaries
    - **Validates: Requirements 13.2**

  - [x] 18.4 Build Reports screen on Android
    - Create `ReportsFragment` XML layout: date picker (defaults to today), summary card (total orders, revenue, average), channel breakdown, peak hour indicator, bill list
    - Load data from Firestore via repository
    - Show zero-state message when no data for selected period with all metrics at zero
    - _Requirements: 13.2, 13.6_

- [x] 19. Remote Printing (Web Dashboard Integration)
  - [x] 19.1 Add print job creation to Web Dashboard
    - Implement "Reprint Bill" button on Web Dashboard orders page creating print job in Firestore with jobType=Reprint, source=web_dashboard
    - Implement "Print KOT" button creating print job with jobType=KOT, source=web_dashboard
    - Display current job status (PENDING, PROCESSING, COMPLETED, FAILED) in real-time via Firestore listener
    - Update status display to manager within 3 seconds of status change
    - Show failure status when remote print fails after all retries
    - _Requirements: 9.1, 9.4, 9.5, 9.6_

  - [ ]* 19.2 Write unit tests for remote printing
    - Test web dashboard creates print job with correct fields
    - Test Print Agent detects and claims remote job within 5 seconds
    - Test status updates shown to manager in real-time
    - Test failure status propagates to dashboard
    - _Requirements: 9.1, 9.2, 9.4, 9.5_

- [x] 20. WhatsApp Order Bridge Enhancement
  - [x] 20.1 Verify and enhance WhatsApp Bridge integration
    - Verify existing WhatsApp bridge saves order to Firestore with status PENDING before opening WhatsApp
    - Verify sequential order number generation (>1000) via atomic counter
    - Verify formatted WhatsApp message contains: order number, all item names, quantities, prices, total
    - Ensure empty cart does not trigger save or WhatsApp open
    - Ensure failed save displays error, preserves cart, does not open WhatsApp
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ]* 20.2 Write property test for WhatsApp message completeness
    - **Property 4: WhatsApp Message Completeness**
    - For any order with items, verify message contains order number, every item name, quantity, price, and correct total
    - **Validates: Requirements 3.3**

  - [ ]* 20.3 Write property test for pending order data completeness
    - **Property 5: Pending Order Data Completeness**
    - For any order from any channel, verify stored document contains: channel, timestamp, customer details, items with quantities, order type
    - **Validates: Requirements 4.1**

- [x] 21. Checkpoint - Ensure all features integrated and cross-channel flow works
  - Ensure all tests pass, ask the user if questions arise.

- [x] 22. Web POS Removal (Migration)
  - [x] 22.1 Remove web POS routes and components
    - Delete `/app/pos/` directory and all child routes
    - Delete `/app/pos/login/` page
    - Delete `/app/bill/` directory (billNo page)
    - Delete `/app/bills/` page
    - Modify `/app/admin/pos/page.tsx` to redirect to `/admin`
    - Remove POS-specific UI components (point-of-sale screen, cashier interface, KOT display, billing modals)
    - Remove POS-specific functions from `lib/firestore.ts` that are unused by retained features
    - _Requirements: 2.1, 2.4_

  - [x] 22.2 Implement redirects for removed routes
    - Add HTTP 302 redirects from `/pos`, `/pos/login`, `/admin/pos`, `/bill`, `/bills` to `/admin`
    - Display notification/toast indicating POS functionality has moved to Android application
    - _Requirements: 2.3_

  - [x] 22.3 Verify retained features remain functional
    - Ensure `npm run build` succeeds without errors
    - Verify Menu Builder (`/admin/menu-builder`) functions correctly
    - Verify Inventory (`/admin/inventory`) works
    - Verify Customer Ordering (`/menu`, `/checkout`) works
    - Verify Admin Orders (`/admin/orders`) works
    - Verify Reports (`/admin/sales`) shows data from all channels
    - Verify Riders (`/admin/riders`) and Delivery (`/admin/delivery`) work
    - Remove any broken imports or dead code references
    - _Requirements: 2.2, 2.5_

- [x] 23. Documentation
  - [x] 23.1 Create architecture documentation
    - Create `/docs/SYSTEM_ARCHITECTURE.md`: system overview, data flow diagrams (Mermaid), component diagrams, user flows, Firestore interaction diagrams, printing overview
    - Create `/docs/FIRESTORE_SCHEMA.md`: collections, documents, fields with types, relationships, security rules, indexes
    - Create `/docs/PRINTING_ARCHITECTURE.md`: Bluetooth protocol, print queue system, Print Agent design, Firestore listeners, retry mechanisms, failure recovery, duplicate prevention
    - Create `/docs/ANDROID_ARCHITECTURE.md`: MVVM structure, repositories, use cases, services, modules, DI configuration
    - Create `/docs/DEVELOPER_ONBOARDING.md`: local setup, Firebase emulators, Bluetooth printer setup, architecture references, deployment instructions
    - Use Mermaid format for all diagrams
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7_

- [x] 24. Final Checkpoint - Full system verification
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at key integration points
- Property tests validate universal correctness properties using Kotest with minimum 100 iterations
- Unit tests use JUnit 5 + MockK for Kotlin
- Integration tests use Espresso + Firebase Emulator Suite
- The Android project uses Kotlin, XML layouts (NO Jetpack Compose), MVVM + Clean Architecture, Hilt, Room, Material 3
- All code targets API 26+ (Android 8.0+)
- Firebase Firestore serves as the single communication backbone between all clients

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.4", "1.5"] },
    { "id": 2, "tasks": ["1.3", "2.1"] },
    { "id": 3, "tasks": ["2.2", "2.4", "2.5"] },
    { "id": 4, "tasks": ["2.3", "2.6"] },
    { "id": 5, "tasks": ["4.1", "4.2"] },
    { "id": 6, "tasks": ["4.3", "4.4"] },
    { "id": 7, "tasks": ["5.1", "5.2"] },
    { "id": 8, "tasks": ["5.3", "6.1"] },
    { "id": 9, "tasks": ["6.2"] },
    { "id": 10, "tasks": ["6.3"] },
    { "id": 11, "tasks": ["6.4", "6.5"] },
    { "id": 12, "tasks": ["7.1"] },
    { "id": 13, "tasks": ["7.2", "7.3"] },
    { "id": 14, "tasks": ["8.1", "8.3"] },
    { "id": 15, "tasks": ["8.2", "8.4"] },
    { "id": 16, "tasks": ["8.5", "8.6"] },
    { "id": 17, "tasks": ["10.1"] },
    { "id": 18, "tasks": ["10.2", "10.4", "10.6"] },
    { "id": 19, "tasks": ["10.3", "10.5", "10.7", "10.8"] },
    { "id": 20, "tasks": ["11.1"] },
    { "id": 21, "tasks": ["11.2", "11.3"] },
    { "id": 22, "tasks": ["11.4", "11.5"] },
    { "id": 23, "tasks": ["11.6", "12.1"] },
    { "id": 24, "tasks": ["12.2", "12.3", "12.4"] },
    { "id": 25, "tasks": ["12.5"] },
    { "id": 26, "tasks": ["12.6", "12.7"] },
    { "id": 27, "tasks": ["12.8", "12.9"] },
    { "id": 28, "tasks": ["14.1", "15.1"] },
    { "id": 29, "tasks": ["14.2", "14.3", "15.2", "15.3"] },
    { "id": 30, "tasks": ["14.4", "14.5", "15.4"] },
    { "id": 31, "tasks": ["16.1"] },
    { "id": 32, "tasks": ["16.2", "16.3"] },
    { "id": 33, "tasks": ["18.1"] },
    { "id": 34, "tasks": ["18.2", "18.3", "18.4"] },
    { "id": 35, "tasks": ["19.1", "20.1"] },
    { "id": 36, "tasks": ["19.2", "20.2", "20.3"] },
    { "id": 37, "tasks": ["22.1"] },
    { "id": 38, "tasks": ["22.2"] },
    { "id": 39, "tasks": ["22.3"] },
    { "id": 40, "tasks": ["23.1"] }
  ]
}
```
