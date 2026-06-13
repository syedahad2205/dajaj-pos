# System Architecture

## Overview

The Dajaj Ecosystem is a unified multi-channel restaurant platform. It consists of:

- **Android POS** — Native Kotlin app for cashier operations and Bluetooth printing
- **Web Dashboard** — Next.js app for menu management, inventory, reports, and administration
- **Customer Website** — Next.js app for browsing the menu, building carts, and ordering via WhatsApp
- **Firebase Firestore** — Real-time NoSQL database serving as the sole communication backbone
- **Bluetooth Thermal Printers** — KOT and customer bill printing via the Android Print Agent

All inter-client communication flows through Firestore. No client communicates directly with another.

---

## High-Level Architecture

```mermaid
graph TB
    subgraph "Clients"
        CW[Customer Website<br/>Next.js]
        WD[Web Dashboard<br/>Next.js]
        AP[Android POS<br/>Kotlin/XML]
        WA[WhatsApp Bridge]
    end

    subgraph "Firebase"
        FS[(Firestore)]
        FA[Firebase Auth]
    end

    subgraph "Hardware"
        BP1[Bluetooth Printer 1<br/>KOT]
        BP2[Bluetooth Printer 2<br/>Bill]
    end

    CW -->|Read menu, Write orders| FS
    WD -->|Read/Write all| FS
    AP -->|Read/Write orders, print jobs| FS
    WA -->|Write pending orders| FS

    CW --> FA
    WD --> FA
    AP --> FA

    AP -->|Bluetooth ESC/POS| BP1
    AP -->|Bluetooth ESC/POS| BP2

    FS -->|Real-time listeners| AP
    FS -->|Real-time listeners| WD
```

---

## Component Boundaries

| Component | Technology | Responsibility |
|-----------|-----------|----------------|
| Android POS | Kotlin, XML, MVVM, Hilt, Room, Firebase | Cashier operations, Bluetooth printing, KOT workflow, offline mode |
| Web Dashboard | Next.js, React, Firestore SDK | Menu Builder, Inventory, Reports, Online Menu, Admin |
| Customer Website | Next.js, React | Browse menu, cart, order via WhatsApp |
| Firebase Firestore | Google Cloud Firestore | Real-time sync, security rules, inter-client communication |
| Firebase Auth | Firebase Authentication | User identity for all clients |
| Bluetooth Printers | ESC/POS thermal printers | KOT printing, customer bill printing |

---

## Data Flow Diagrams

### Order Creation (Walk-in)

```mermaid
sequenceDiagram
    participant Cashier
    participant AndroidPOS as Android POS
    participant Firestore
    participant PrintAgent as Print Agent
    participant Printer as BT Printer

    Cashier->>AndroidPOS: Create order (select items, order type)
    AndroidPOS->>Firestore: Write order document (status: ACCEPTED)
    AndroidPOS->>Firestore: Write print_job (type: KOT, status: PENDING)
    Firestore-->>PrintAgent: onSnapshot detects PENDING job
    PrintAgent->>Firestore: Claim job (transaction: PROCESSING)
    PrintAgent->>Printer: Send ESC/POS commands via Bluetooth
    Printer-->>PrintAgent: Print success
    PrintAgent->>Firestore: Update job (status: COMPLETED)
```

### WhatsApp Order Flow

```mermaid
sequenceDiagram
    participant Customer
    participant Website as Customer Website
    participant Firestore
    participant WhatsApp
    participant AndroidPOS as Android POS

    Customer->>Website: Build cart, submit order
    Website->>Firestore: Write pending_order (status: PENDING)
    Website->>WhatsApp: Open pre-formatted message
    Firestore-->>AndroidPOS: onSnapshot detects new pending order
    AndroidPOS->>AndroidPOS: Display in Pending Orders list
    Note over AndroidPOS: Cashier accepts order
    AndroidPOS->>Firestore: Convert to POS order + create KOT print job
```

### Menu Synchronization

```mermaid
sequenceDiagram
    participant MenuBuilder as Menu Builder (Web)
    participant Firestore
    participant AndroidPOS as Android POS
    participant RoomDB as Room Database
    participant CustomerWeb as Customer Website

    MenuBuilder->>Firestore: Write menu change
    Firestore-->>AndroidPOS: onSnapshot event (< 5s)
    AndroidPOS->>RoomDB: Cache updated menu node
    Firestore-->>CustomerWeb: onSnapshot event (< 10s)
```

### Remote Printing (Manager on iPhone)

```mermaid
sequenceDiagram
    participant Manager
    participant WebDashboard as Web Dashboard
    participant Firestore
    participant PrintAgent as Print Agent
    participant Printer as BT Printer

    Manager->>WebDashboard: Tap "Reprint Bill"
    WebDashboard->>Firestore: Create print_job (type: reprint, source: web_dashboard)
    Firestore-->>PrintAgent: onSnapshot detects PENDING job
    PrintAgent->>Firestore: Claim via transaction
    PrintAgent->>Printer: Send reprint data
    Printer-->>PrintAgent: Success
    PrintAgent->>Firestore: Update status: COMPLETED
    Firestore-->>WebDashboard: onSnapshot updates
    WebDashboard-->>Manager: Show "Print completed ✓"
```

---

## User Flows

### Customer Flow

1. Browse menu on Customer Website
2. Add items to cart
3. Submit order → saved to Firestore as `pending_order`
4. WhatsApp opens with pre-formatted confirmation message
5. Order appears on Android POS for cashier acceptance

### Cashier Flow

1. Log in to Android POS via Firebase Auth
2. View Dashboard (pending order count, printer status, connectivity)
3. Create walk-in/takeaway orders from POS screen (3-panel layout)
4. Accept pending orders from WhatsApp/Website channels
5. Orders auto-generate KOT print jobs
6. Mark orders as READY when kitchen completes
7. Complete orders when customer picks up

### Manager Flow

1. Log in to Web Dashboard
2. Manage menu via Menu Builder (changes sync to all clients)
3. View unified reports (all channels aggregated)
4. Monitor pending orders and kitchen queue
5. Trigger remote reprints (flows through Firestore → Android Print Agent)
6. Monitor device status and printer health

---

## Firestore Interaction Overview

```mermaid
graph LR
    subgraph "Collections"
        M[menus]
        O[orders]
        PO[pending_orders]
        PJ[print_jobs]
        D[devices]
        U[users]
        B[bills]
        C[counters]
    end

    subgraph "Readers"
        CW[Customer Website]
        WD[Web Dashboard]
        AP[Android POS]
    end

    CW -->|read| M
    CW -->|write| PO
    WD -->|read/write| M
    WD -->|read/write| O
    WD -->|read| PO
    WD -->|write| PJ
    WD -->|read| D
    WD -->|read| B
    AP -->|read| M
    AP -->|read/write| O
    AP -->|read/write| PO
    AP -->|read/write| PJ
    AP -->|write| D
    AP -->|write| B
    AP -->|read/write| C
```

---

## Printing Architecture Overview

All printing goes through a Firestore-backed queue. No client ever communicates directly with a Bluetooth printer except the Print Agent running as a Foreground Service on the Android POS.

```mermaid
graph TB
    subgraph "Print Requesters"
        POS_UI[Android POS UI]
        WEB[Web Dashboard]
    end

    subgraph "Firestore"
        PJ[(print_jobs collection)]
    end

    subgraph "Android Print Agent"
        FGS[Foreground Service]
        LQ[Local Queue - Room DB]
        PM[Printer Manager]
    end

    subgraph "Hardware"
        KOT[KOT Printer]
        BILL[Bill Printer]
    end

    POS_UI -->|Create print job| PJ
    WEB -->|Create print job| PJ
    PJ -->|onSnapshot listener| FGS
    FGS -->|Claim via transaction| PJ
    FGS -->|Queue if offline| LQ
    LQ -->|Drain on reconnect| PM
    FGS -->|Send to printer| PM
    PM -->|ESC/POS| KOT
    PM -->|ESC/POS| BILL
    FGS -->|Update status| PJ
```

---

## Design Principles

1. **Firestore as Single Source of Truth** — No direct client-to-client communication.
2. **Offline-First Android** — POS operates during internet outages using Room Database.
3. **Print Queue Pattern** — All printing goes through Firestore queue; never print directly from UI.
4. **Clean Architecture** — Android follows MVVM + Clean Architecture with clear layer boundaries.
5. **Zero-Downtime Migration** — Web POS removed only after Android POS validated in production.

---

## Technology Stack Summary

| Layer | Technology |
|-------|-----------|
| Android UI | Kotlin, XML Layouts, ViewBinding, Material 3 |
| Android Architecture | MVVM, Clean Architecture, Hilt DI |
| Android Persistence | Room Database (SQLite) |
| Android Services | Foreground Service, WorkManager |
| Android Bluetooth | BluetoothSocket, SPP UUID |
| Web Frontend | Next.js, React, TypeScript |
| Backend | Firebase Firestore, Firebase Auth |
| Real-time Sync | Firestore onSnapshot listeners |
| Printing | ESC/POS commands over Bluetooth SPP |
