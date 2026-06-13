# Printing Architecture

## Overview

The Dajaj printing system uses a queue-based architecture where all print operations flow through Firestore. No client ever communicates directly with a Bluetooth printer. The Android POS runs a Print Agent as a Foreground Service that listens for pending print jobs and executes them via Bluetooth.

```mermaid
graph TB
    subgraph "Print Requesters"
        POS[Android POS UI]
        WEB[Web Dashboard]
        FUTURE[Future Clients]
    end

    subgraph "Firestore"
        PJ[(print_jobs collection)]
    end

    subgraph "Android Print Agent"
        FGS[Foreground Service]
        LQ[Local Queue<br/>Room Database]
        PM[Printer Manager]
    end

    subgraph "Hardware"
        KOT[KOT Printer<br/>Bluetooth SPP]
        BILL[Bill Printer<br/>Bluetooth SPP]
    end

    POS -->|Create print job| PJ
    WEB -->|Create print job| PJ
    FUTURE -->|Create print job| PJ
    PJ -->|onSnapshot listener| FGS
    FGS -->|Claim via transaction| PJ
    FGS -->|Queue if offline| LQ
    LQ -->|Drain on reconnect| PM
    FGS -->|Send to printer| PM
    PM -->|ESC/POS commands| KOT
    PM -->|ESC/POS commands| BILL
    FGS -->|Update status| PJ
```

---

## Bluetooth Communication Protocol

### SPP (Serial Port Profile)

- **UUID:** `00001101-0000-1000-8000-00805F9B34FB` (standard SPP UUID)
- **Protocol:** ESC/POS commands over Bluetooth RFCOMM socket
- **Data format:** Byte arrays containing ESC/POS command sequences
- **Character encoding:** UTF-8 for text, raw bytes for control commands
- **Paper width:** 58mm or 80mm thermal paper (configured per printer)

### ESC/POS Command Flow

```mermaid
sequenceDiagram
    participant Agent as Print Agent
    participant Socket as BluetoothSocket
    participant Printer as Thermal Printer

    Agent->>Socket: Connect to printer MAC via SPP UUID
    Socket-->>Agent: Connection established
    Agent->>Socket: Write ESC/POS init commands
    Agent->>Socket: Write header (bold, centered)
    Agent->>Socket: Write line items (left-aligned)
    Agent->>Socket: Write separator line
    Agent->>Socket: Write totals (right-aligned)
    Agent->>Socket: Write footer
    Agent->>Socket: Write cut command (partial cut)
    Socket->>Printer: Raw byte stream
    Printer-->>Agent: Print complete (no ACK — fire and forget)
    Agent->>Socket: Close or keep alive
```

### Common ESC/POS Commands Used

| Command | Hex | Purpose |
|---------|-----|---------|
| Initialize | `0x1B 0x40` | Reset printer |
| Bold On | `0x1B 0x45 0x01` | Enable bold text |
| Bold Off | `0x1B 0x45 0x00` | Disable bold text |
| Center Align | `0x1B 0x61 0x01` | Center text alignment |
| Left Align | `0x1B 0x61 0x00` | Left text alignment |
| Right Align | `0x1B 0x61 0x02` | Right text alignment |
| Double Height | `0x1B 0x21 0x10` | Double-height text |
| Normal Size | `0x1B 0x21 0x00` | Normal text size |
| Line Feed | `0x0A` | New line |
| Partial Cut | `0x1D 0x56 0x01` | Cut paper (partial) |

---

## Connection Lifecycle

### Connect / Disconnect / Reconnect

```mermaid
stateDiagram-v2
    [*] --> Disconnected : App starts
    Disconnected --> Connecting : User initiates connect
    Connecting --> Connected : Socket opened successfully
    Connecting --> Disconnected : Connection failed
    Connected --> Disconnected : Connection lost unexpectedly
    Disconnected --> Reconnecting : Auto-reconnect triggered
    Reconnecting --> Connected : Reconnect success
    Reconnecting --> Reconnecting : Retry every 5s
    Reconnecting --> Failed : 60s timeout exceeded
    Failed --> Connecting : Manual retry from Settings
    Failed --> Connected : Manual connect succeeds
    Connected --> Disconnected : User disconnects manually
```

### Connection Sequence

```mermaid
sequenceDiagram
    participant UI as Settings UI
    participant PM as PrinterManager
    participant BT as BluetoothAdapter
    participant Device as Paired Printer

    UI->>PM: connectPrinter(macAddress)
    PM->>BT: getRemoteDevice(macAddress)
    BT-->>PM: BluetoothDevice
    PM->>BT: cancelDiscovery()
    PM->>Device: createRfcommSocketToServiceRecord(SPP_UUID)
    Device-->>PM: BluetoothSocket
    PM->>Device: socket.connect()
    Device-->>PM: Connection established
    PM->>PM: Store OutputStream reference
    PM->>UI: Status: CONNECTED
    PM->>PM: Start connection monitor thread
```

### Auto-Reconnection Strategy

| Parameter | Value |
|-----------|-------|
| Trigger | Unexpected disconnection (IOException on read/write) |
| Interval | 5 seconds between attempts |
| Maximum duration | 60 seconds total |
| Max attempts | 12 attempts (60s / 5s) |
| On success | Resume print queue processing |
| On timeout | Stop reconnection, set status "disconnected", show notification |
| Manual retry | Available from Printer Settings screen |

---

## Print Queue System

### Job States & Transitions

```mermaid
stateDiagram-v2
    [*] --> PENDING : Job created by any client
    PENDING --> PROCESSING : Print Agent claims via transaction
    PROCESSING --> COMPLETED : Print succeeded
    PROCESSING --> PENDING : Retry needed (retryCount < 3)
    PROCESSING --> FAILED : All 3 retries exhausted
    FAILED --> PENDING : Manual retry by cashier
```

### Job Types

| Job Type | Printer Type | When Created |
|----------|-------------|--------------|
| `kot` | KOT printer | Order confirmed or pending order accepted |
| `customer_bill` | Bill printer | Order completed, bill generated |
| `reprint` | KOT or Bill | Manager triggers from Web Dashboard |

### Job Document Fields

```json
{
  "id": "pj_xyz789",
  "restaurantId": "dajaj_main",
  "jobType": "kot",
  "printerType": "kot",
  "status": "pending",
  "claimedBy": null,
  "orderId": "1045",
  "orderNumber": "1104260001",
  "payload": { "..." },
  "retryCount": 0,
  "failureReason": null,
  "source": "android_pos",
  "createdAt": "2024-01-15T14:30:00.000Z",
  "claimedAt": null,
  "completedAt": null
}
```

---

## Print Agent Design

### Foreground Service

The Print Agent runs as an Android Foreground Service with a persistent notification. It survives app screen closure and device sleep.

```mermaid
graph TB
    subgraph "Print Agent Service"
        LS[Firestore Listener<br/>print_jobs where status=PENDING]
        CL[Job Claimer<br/>Firestore transaction]
        PR[Print Processor<br/>ESC/POS builder]
        LQ[Local Queue<br/>Room Database]
        RM[Retry Manager<br/>Exponential backoff]
    end

    LS -->|New PENDING job| CL
    CL -->|Claim success| PR
    CL -->|Claim failed| LS
    PR -->|Print success| StatusUpdate[Update: COMPLETED]
    PR -->|Print failed| RM
    RM -->|Retry count < 3| PR
    RM -->|Retry count = 3| StatusUpdate2[Update: FAILED]
    PR -->|Printer offline| LQ
    LQ -->|Printer reconnects| PR
```

### Service Lifecycle

| Event | Behavior |
|-------|----------|
| App starts | Service starts, registers Firestore listener |
| App screen closed | Service continues running (foreground notification) |
| Device restarts | Service restarts via `BOOT_COMPLETED` BroadcastReceiver |
| Internet lost | Listener disconnects, local queue processes via Bluetooth |
| Internet restored | Listener re-establishes, sync pending statuses |
| User force-stops app | Service stops, resumes on next app open |

### Persistent Notification States

| State | Notification Text |
|-------|------------------|
| Idle | "Print Agent running — waiting for jobs" |
| Printing | "Printing Order #1045..." |
| Error | "Print failed — Order #1045 (tap to retry)" |
| Offline | "Print Agent running — offline mode" |

---

## Firestore Listeners

The Print Agent listens to a single query:

```kotlin
firestore.collection("print_jobs")
    .whereEqualTo("restaurantId", currentRestaurantId)
    .whereEqualTo("status", "pending")
    .addSnapshotListener { snapshots, error ->
        // Process new PENDING jobs
    }
```

### Listener Behavior

- Fires on any new document matching the query
- Fires on document returning to PENDING (manual retry)
- Only the **primary printer device** processes jobs
- Non-primary devices ignore the listener events

---

## Retry Mechanisms

### Print Retry (Exponential Backoff)

| Attempt | Delay | Total elapsed |
|---------|-------|---------------|
| 1st retry | 2 seconds | 2s |
| 2nd retry | 4 seconds | 6s |
| 3rd retry | 8 seconds | 14s |
| After 3rd failure | Mark as FAILED | — |

```mermaid
sequenceDiagram
    participant Agent as Print Agent
    participant Printer as BT Printer
    participant FS as Firestore

    Agent->>Printer: Print attempt 1
    Printer--xAgent: IOException (disconnected)
    Note over Agent: Wait 2 seconds
    Agent->>Printer: Print attempt 2
    Printer--xAgent: IOException
    Note over Agent: Wait 4 seconds
    Agent->>Printer: Print attempt 3
    Printer--xAgent: IOException
    Note over Agent: Wait 8 seconds
    Agent->>Printer: Print attempt 4 (final)
    Printer--xAgent: IOException
    Agent->>FS: Update status: FAILED, retryCount: 3
    Agent->>Agent: Show failure notification
```

### Job Claim Retry (Fixed Interval)

| Parameter | Value |
|-----------|-------|
| Max attempts | 3 |
| Interval | 2 seconds (fixed) |
| On all failures | Skip job, wait for next |

### Printer Reconnection Retry

| Parameter | Value |
|-----------|-------|
| Interval | 5 seconds (fixed) |
| Duration | 60 seconds maximum |
| Total attempts | 12 |
| On timeout | Stop, mark disconnected |

### Order Sync Retry (WorkManager)

| Parameter | Value |
|-----------|-------|
| Max attempts | 5 |
| Backoff | Exponential, base 5 seconds |
| Constraint | Network available |

---

## Failure Recovery

### Scenario: Printer Disconnects Mid-Print

```mermaid
sequenceDiagram
    participant Agent as Print Agent
    participant Printer as BT Printer
    participant Room as Room DB
    participant FS as Firestore

    Agent->>Printer: Send print data
    Printer--xAgent: IOException (connection lost)
    Agent->>Agent: Retry with backoff (2s, 4s, 8s)
    Note over Agent: All retries failed
    Agent->>Room: Queue job locally
    Agent->>FS: Update status: FAILED
    Agent->>Agent: Start reconnection loop (every 5s)

    Note over Printer: Printer powered back on
    Agent->>Printer: Reconnect success
    Agent->>Room: Read local queue (FIFO)
    loop Each queued job
        Agent->>Printer: Print job
        Agent->>FS: Update status: COMPLETED
        Agent->>Room: Remove from local queue
    end
```

### Scenario: Internet Disconnects

1. Firestore listener disconnects
2. Print Agent switches to local-only mode
3. New orders saved to Room Database
4. Print jobs created in Room local queue
5. Agent prints from local queue via Bluetooth (still connected)
6. On internet restore: WorkManager syncs orders and print statuses to Firestore

### Scenario: App Crash / Device Restart

1. `BOOT_COMPLETED` receiver starts the Print Agent service
2. Agent checks Room DB for unsynced jobs (printed locally but not synced)
3. Agent reconnects to paired printers
4. Agent re-registers device in Firestore, updates heartbeat
5. Agent re-establishes `print_jobs` listener
6. Agent processes any unsynced local jobs first, then resumes normal operation

### Scenario: Manual Retry After FAILED

1. Cashier sees failed job notification on Android POS
2. Cashier taps retry (or uses the failed jobs list)
3. App updates job in Firestore: `status: "pending"`, `retryCount: 0`
4. Print Agent's listener detects the PENDING job
5. Normal claim → process flow resumes

---

## Duplicate Prevention

### 1. Firestore Transactions for Job Claiming

Only one device can claim a job. The transaction:
1. Reads current job status
2. Verifies it's still `PENDING`
3. Atomically sets `status: PROCESSING` and `claimedBy: deviceId`

If another device already claimed it, the transaction fails and the device skips the job.

```kotlin
firestore.runTransaction { transaction ->
    val jobRef = firestore.collection("print_jobs").document(jobId)
    val snapshot = transaction.get(jobRef)

    if (snapshot.getString("status") == "pending") {
        transaction.update(jobRef, mapOf(
            "status" to "processing",
            "claimedBy" to currentDeviceId,
            "claimedAt" to FieldValue.serverTimestamp()
        ))
        true // Claimed successfully
    } else {
        false // Already claimed by another device
    }
}
```

### 2. Device ID Verification

Before printing, the agent verifies `claimedBy` matches its own device ID.

### 3. Idempotent Status Updates

If the agent crashes after printing but before updating Firestore:
- On restart, it checks Room DB for jobs marked "printed locally"
- Syncs their COMPLETED status to Firestore
- Prevents reprinting the same job

### 4. Primary Printer Enforcement

Only the device with `isPrimaryPrinter: true` processes jobs from Firestore. Non-primary devices ignore PENDING jobs entirely.

### 5. Job Expiry (Future Enhancement)

Jobs in PROCESSING for >5 minutes without completion are released back to PENDING. This prevents stuck jobs when a device crashes after claiming but before printing.

---

## Local Queue (Room Database)

### Table: `local_print_queue`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT (PK) | Same as Firestore job ID |
| `jobType` | TEXT | kot, customer_bill, reprint |
| `printerType` | TEXT | kot, bill |
| `orderId` | TEXT | Order reference |
| `orderNumber` | TEXT | Order number |
| `payload` | TEXT (JSON) | Serialized print payload |
| `status` | TEXT | local_pending, printed, synced |
| `retryCount` | INTEGER | Local retry count |
| `createdAt` | INTEGER | Epoch timestamp |
| `printedAt` | INTEGER | When printed locally |

### Queue Limits

- Maximum: **500 print jobs** (configurable)
- When limit reached: Oldest completed jobs purged first
- If queue is full with pending jobs: Warning shown to cashier

### Drain Strategy

1. On printer reconnect: Process all `local_pending` jobs in FIFO order
2. Each job retried up to 3 times
3. Failed jobs skipped, continue with next
4. On internet reconnect: Sync all `printed` status to Firestore via WorkManager
