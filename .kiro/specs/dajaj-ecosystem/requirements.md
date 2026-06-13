# Requirements Document

## Introduction

This document specifies the requirements for transforming Dajaj into a unified restaurant ecosystem. The ecosystem integrates a Customer Ordering Website, Menu Builder, Inventory Management, Reporting Dashboard, Android POS Application, Bluetooth Printing System, Firebase Backend, WhatsApp Order Bridge, and Kitchen Order Ticket Workflow. The existing Next.js web application is retained for menu building, inventory, online ordering, reports, and administration, while a new native Android application replaces the existing web POS for all cashier and printing operations.

## Glossary

- **Android_POS**: The native Android application that serves as the primary Point of Sale system for Dajaj, handling cashier operations, walk-in orders, takeaway orders, billing, KOT printing, and Bluetooth printer management.
- **Menu_Builder**: The existing web-based interface for creating and managing menu categories, items, variants, and modifiers.
- **Customer_Website**: The existing web application where customers browse the menu, build carts, and submit orders.
- **Web_Dashboard**: The web-based management interface for managers to view orders, generate bills, trigger reprints, monitor reports, and manage the menu.
- **Firestore**: Google Cloud Firestore, the real-time NoSQL database serving as the single communication backbone for the ecosystem.
- **KOT**: Kitchen Order Ticket, a printed slip sent to the kitchen containing order details for preparation.
- **Print_Agent**: A foreground service running on the Android POS that listens for print jobs in Firestore and executes them via Bluetooth printers.
- **Print_Queue**: A Firestore-backed queue system that manages all print jobs with retry, recovery, and offline support.
- **Pending_Order**: An order submitted from any channel (WhatsApp, Website, QR, third-party) that awaits cashier acceptance before entering the kitchen workflow.
- **WhatsApp_Bridge**: The integration that saves a customer cart to Firestore, generates an order number, and opens WhatsApp for customer confirmation.
- **Device_Registry**: A Firestore collection tracking connected Android POS devices, their printer status, and heartbeat information.
- **Room_Database**: The local SQLite database on the Android POS for offline caching of orders, print jobs, printer settings, and menu data.
- **Foreground_Service**: An Android service that runs continuously in the background with a persistent notification, maintaining Firestore listeners and print queue processing.

## Requirements

### Requirement 1: Single Source of Truth Menu Synchronization

**User Story:** As a restaurant manager, I want menu changes made in the Menu Builder to propagate to all systems automatically, so that all channels always display the same menu.

#### Acceptance Criteria

1. WHEN a menu node (category, variant, modifier group, or modifier) is created, updated, or deleted in the Menu_Builder, THE Firestore SHALL persist the change within 2 seconds.
2. WHEN Firestore receives a menu update, THE Android_POS SHALL reflect the updated menu within 5 seconds via real-time listener.
3. WHEN Firestore receives a menu update, THE Customer_Website SHALL reflect the updated menu on the next full page load or within 10 seconds if the page is already open via real-time listener.
4. THE Android_POS SHALL treat Firestore as the sole authoritative source for menu definitions and SHALL NOT maintain a separately-managed menu definition, while using the Room_Database exclusively as a read-through cache of Firestore data.
5. WHILE the Android_POS is offline, THE Room_Database SHALL serve the last successfully cached menu to the cashier.
6. WHEN the Android_POS regains connectivity, THE Android_POS SHALL synchronize the local menu cache with Firestore within 10 seconds.
7. IF the Menu_Builder fails to persist a menu change to Firestore (due to network error or write rejection), THEN THE Menu_Builder SHALL display an error message indicating the save failed and SHALL retain the unsaved changes in the editing interface so the user can retry.
8. IF the Android_POS fails to synchronize with Firestore upon regaining connectivity, THEN THE Android_POS SHALL retry synchronization up to 3 attempts with exponential backoff and SHALL continue serving the cached menu until synchronization succeeds.

### Requirement 2: Web POS Removal

**User Story:** As the system owner, I want the existing web POS removed from the codebase, so that the Android POS becomes the single point of sale.

#### Acceptance Criteria

1. WHEN the migration is complete, THE Web_Application SHALL NOT contain any of the following routes or their child routes: `/pos`, `/pos/login`, `/admin/pos`, `/bill`, `/bills`, or any associated POS-specific UI components (point-of-sale screen, cashier interface, KOT display, and billing confirmation modals).
2. THE Web_Application SHALL retain the admin orders management page at `/admin/orders` (delivery order tracking and status workflow) and all non-POS admin features including Menu Builder, Inventory, Online Menu, Customer Ordering, Reports, Riders, Delivery, Sales, and Administration.
3. WHEN a user navigates to any removed POS route (`/pos`, `/pos/login`, `/admin/pos`, `/bill`, `/bills`), THE Web_Application SHALL respond with an HTTP 302 redirect to `/admin` and display a notification indicating that POS functionality has moved to the Android application.
4. IF a shared library module or API route is used exclusively by removed POS screens and not by any retained feature, THEN THE Web_Application SHALL remove that module or API route as part of the POS removal.
5. WHEN the POS removal is complete, THE Web_Application SHALL build and deploy without errors, and all retained features (Menu Builder, Inventory, Online Menu, Customer Ordering, admin orders dashboard, Reports, Riders, Delivery, Sales, Administration) SHALL remain fully functional.

### Requirement 3: WhatsApp Order Bridge

**User Story:** As a customer, I want to confirm my order via WhatsApp after building a cart on the website, so that I can place orders through my preferred communication channel.

#### Acceptance Criteria

1. WHEN a customer submits a cart containing at least one item on the Customer_Website, THE WhatsApp_Bridge SHALL save the order to Firestore with status PENDING and SHALL NOT open WhatsApp until the save operation completes successfully.
2. WHEN the order is saved, THE WhatsApp_Bridge SHALL generate a unique sequential numeric order number starting above 1000.
3. WHEN the order is saved, THE WhatsApp_Bridge SHALL open the WhatsApp application with a pre-formatted message containing the order number, list of item names with quantities and prices, and the order total.
4. IF the order fails to save to Firestore, THEN THE WhatsApp_Bridge SHALL display an error message indicating the order could not be placed, SHALL NOT open WhatsApp, and SHALL preserve the cart contents so the customer can retry without re-adding items.
5. IF the customer's cart is empty at submission time, THEN THE WhatsApp_Bridge SHALL NOT attempt to save or open WhatsApp.

### Requirement 4: Pending Orders Pipeline

**User Story:** As a cashier, I want to see all incoming orders from every channel in one unified list, so that I can accept and process them without switching between systems.

#### Acceptance Criteria

1. THE Pending_Orders system SHALL accept orders from WhatsApp, Website, and future integrations (QR Orders, Swiggy, Zomato) through a single pipeline, storing each order with its source channel identifier, timestamp, customer details, item list with quantities, and order type.
2. WHEN a new pending order arrives, THE Android_POS SHALL display the order within 3 seconds of the Firestore write, sorted by arrival time with the oldest pending order first, showing the source channel, customer name, item count, and order total.
3. WHEN a new pending order arrives, THE Web_Dashboard SHALL display the order within 3 seconds of the Firestore write, sorted by arrival time with the oldest pending order first, showing the source channel, customer name, item count, and order total.
4. THE Pending_Orders system SHALL support the following order states: PENDING, ACCEPTED, REJECTED, PREPARING, READY, COMPLETED, CANCELLED, with valid transitions limited to: PENDING → ACCEPTED, PENDING → REJECTED, ACCEPTED → PREPARING, PREPARING → READY, READY → COMPLETED, and any active state → CANCELLED.
5. WHEN a cashier accepts a pending order, THE Android_POS SHALL convert the order to a POS order, generate a KOT, and trigger automatic printing without requiring manual item re-entry.
6. IF a cashier accepts a pending order and the conversion to POS order fails due to unavailable menu items or missing order data, THEN THE Android_POS SHALL display an error message indicating the failure reason, retain the order in PENDING state, and not generate a KOT.
7. WHEN a cashier rejects a pending order, THE Android_POS SHALL require a rejection reason (minimum 1 character, maximum 200 characters), update the order status to REJECTED, and record the rejection reason with a timestamp.
8. IF the Firestore listener disconnects on the Android_POS or Web_Dashboard, THEN THE system SHALL display a visible connectivity warning to the cashier within 5 seconds of disconnection and automatically re-subscribe when connectivity is restored.

### Requirement 5: Android POS Cashier Operations

**User Story:** As a cashier, I want to quickly create walk-in and takeaway orders on the Android POS, so that I can serve customers efficiently during peak hours.

#### Acceptance Criteria

1. THE Android_POS SHALL display a three-panel landscape layout: categories on the left, menu items in the center, and the current cart on the right.
2. THE Android_POS SHALL use touch targets of minimum 48dp and text/background color combinations meeting a contrast ratio of at least 4.5:1 (WCAG AA).
3. WHEN a cashier selects a category, THE Android_POS SHALL display the category items within 200 milliseconds.
4. THE Android_POS SHALL display a Favorites section containing up to 20 items configured by a manager through the admin interface.
5. WHEN a cashier taps a menu item, THE Android_POS SHALL add that item to the cart with a quantity of 1, and SHALL allow the cashier to increase, decrease, or remove item quantity directly from the cart panel.
6. WHEN a cashier selects an order type (walk-in, takeaway, or dine-in) and confirms the order with at least one item in the cart, THE Android_POS SHALL generate a bill and create a KOT print job.
7. IF the KOT print job fails due to printer unavailability, THEN THE Android_POS SHALL display an error message indicating the print failure, retain the order as confirmed, and queue the print job for automatic retry.
8. THE Android_POS SHALL require the cashier to select an order type (walk-in, takeaway, or dine-in) before the order can be confirmed.
9. THE Android_POS SHALL use Kotlin, XML layouts (not Jetpack Compose), MVVM with Clean Architecture, Hilt for dependency injection, and Material 3 design components.

### Requirement 6: Bluetooth Printer Management

**User Story:** As a cashier, I want to pair and manage Bluetooth thermal printers from the Android POS, so that I can print KOTs and bills without a network printer.

#### Acceptance Criteria

1. THE Android_POS SHALL provide a dedicated Bluetooth printer management module supporting: pair, connect, disconnect, auto-reconnect, test print, and status monitoring for up to 5 paired printers.
2. WHEN a paired printer disconnects unexpectedly, THE Android_POS SHALL attempt auto-reconnection at 5-second intervals for up to 60 seconds.
3. IF auto-reconnection fails after 60 seconds, THEN THE Android_POS SHALL stop reconnection attempts, set the printer status to "disconnected", and display a notification indicating the printer is unreachable.
4. THE Android_POS SHALL display the current printer connection status (connected, disconnected, reconnecting) in the UI at all times, updating within 2 seconds of any status change.
5. WHEN a cashier initiates a test print, THE Android_POS SHALL print a test page and confirm success or report failure within 10 seconds.
6. IF a Bluetooth scan discovers no available printers within 15 seconds, THEN THE Android_POS SHALL display a message indicating no printers were found and allow the cashier to retry the scan.
7. THE Bluetooth printer module SHALL be isolated in a dedicated Android module with no direct dependencies on POS business logic.

### Requirement 7: Print Queue System

**User Story:** As a restaurant operator, I want all print jobs to go through a queue system, so that prints are never lost even during connectivity issues or printer failures.

#### Acceptance Criteria

1. THE Print_Queue SHALL ensure that printing NEVER occurs directly from the UI; all print actions create a print job document in Firestore.
2. WHEN a print action is triggered, THE Print_Queue SHALL create a print job in Firestore with fields: id, restaurantId, jobType, printerType, status (initial value PENDING), payload, and createdAt.
3. THE Print_Queue SHALL support the following job types: KOT, Customer_Bill, and Reprint.
4. WHEN a KOT print job is created, THE Print_Queue payload SHALL contain: order number, time, items with quantities, and special notes.
5. WHEN a Customer_Bill print job is created, THE Print_Queue payload SHALL contain: restaurant header, itemized list, tax breakdown, total, and payment method.
6. WHEN a Reprint job is created, THE Print_Queue payload SHALL contain the full payload of the original print job plus a "REPRINT" header indicator, and SHALL reference the original job's id.
7. IF a print job fails, THEN THE Print_Queue SHALL retry the job up to 3 times with exponential backoff (base interval of 2 seconds, resulting in delays of 2s, 4s, and 8s) before marking the job as FAILED.
8. THE Print_Queue SHALL prevent duplicate printing by using Firestore transactions to claim jobs atomically.
9. IF a print job is marked as FAILED after all retry attempts are exhausted, THEN THE Print_Queue SHALL display a notification on the Android_POS indicating the failed job type and associated order number, allowing the cashier to manually trigger a retry.
10. THE Print_Queue SHALL transition each print job through the following statuses in order: PENDING → PROCESSING → COMPLETED, or PENDING → PROCESSING → FAILED.

### Requirement 8: Android Print Agent

**User Story:** As a restaurant operator, I want the Android POS to continuously process print jobs from Firestore, so that remote print requests from managers are fulfilled automatically.

#### Acceptance Criteria

1. THE Print_Agent SHALL run as a Foreground_Service with a persistent notification displaying the current processing state (idle, printing, or error).
2. THE Print_Agent SHALL maintain a real-time Firestore listener for documents in the print_jobs collection where status equals PENDING and restaurantId matches the current restaurant.
3. WHEN a new print job is detected, THE Print_Agent SHALL claim the job by updating the job status to PROCESSING and assigning its device identifier using a Firestore transaction within 5 seconds of detection.
4. IF the Firestore transaction to claim a print job fails, THEN THE Print_Agent SHALL retry the claim up to 3 times with a 2-second delay between attempts before skipping the job.
5. WHEN a print job is claimed, THE Print_Agent SHALL send the print job payload to the connected Bluetooth printer and wait no longer than 30 seconds for the print operation to complete.
6. WHEN a print job completes successfully, THE Print_Agent SHALL update the job status to COMPLETED in Firestore.
7. IF the print operation fails or times out, THEN THE Print_Agent SHALL retry the print up to 3 times, and if all attempts fail, update the job status to FAILED in Firestore with the failure reason.
8. IF the Bluetooth printer is disconnected, THEN THE Print_Agent SHALL queue the job locally in Room_Database (up to 100 jobs) and process queued jobs in order when the printer reconnects.
9. THE Print_Agent SHALL continue operating even when the POS application screen is closed.

### Requirement 9: Remote Printing

**User Story:** As a manager using an iPhone, I want to trigger bill reprints and KOT prints remotely, so that I can manage kitchen operations without being at the POS terminal.

#### Acceptance Criteria

1. WHEN a manager triggers a bill reprint or KOT print action from the Web_Dashboard, THE Web_Dashboard SHALL create a print job document in Firestore with the jobType set to Reprint or KOT and the source field indicating Web_Dashboard.
2. WHEN a remote print job is created in Firestore, THE Print_Agent on the Android_POS SHALL detect and claim the job within 5 seconds of creation.
3. THE Remote_Printing system SHALL ensure that the iPhone NEVER communicates directly with Bluetooth printers; all print actions flow through Firestore to the Print_Agent.
4. WHEN a remote print job is processed, THE Print_Agent SHALL update the job status in Firestore to COMPLETED, and THE Web_Dashboard SHALL display the updated status to the manager within 3 seconds of the status change.
5. IF a remote print job fails after all retry attempts, THEN THE Print_Agent SHALL update the job status to FAILED in Firestore, and THE Web_Dashboard SHALL display the failure status to the manager.
6. WHEN the manager initiates a remote print, THE Web_Dashboard SHALL display the current job status (PENDING, PROCESSING, COMPLETED, or FAILED) so the manager can track progress without refreshing.

### Requirement 10: Device Management

**User Story:** As a restaurant operator, I want to monitor all connected Android POS devices, so that I can identify the primary print node and detect offline devices.

#### Acceptance Criteria

1. THE Device_Registry SHALL store for each device: deviceId, deviceName (maximum 50 characters), isPrimaryPrinter flag, lastHeartbeat timestamp, and connection status (one of: ONLINE, OFFLINE).
2. WHEN the Android_POS application starts, THE Android_POS SHALL register itself in the Device_Registry with status ONLINE and a current heartbeat timestamp.
3. WHILE the Android_POS is running, THE Android_POS SHALL update the Device_Registry heartbeat every 30 seconds.
4. WHEN any device's lastHeartbeat timestamp is older than 90 seconds, THE Device_Registry SHALL mark that device's status as OFFLINE upon the next status evaluation by any connected client.
5. THE Device_Registry SHALL designate exactly one device as the primary printer node at any time, enforced via a Firestore transaction.
6. IF the device designated as primary printer is marked OFFLINE, THEN THE Device_Registry SHALL leave the primary printer unassigned until a restaurant operator manually designates a new primary.
7. IF a device attempts to register as primary printer while another device already holds the designation, THEN THE Device_Registry SHALL reject the request and retain the existing primary designation.

### Requirement 11: Kitchen Workflow

**User Story:** As a kitchen staff member, I want a clear workflow from order receipt to completion, so that every order is prepared and served in sequence.

#### Acceptance Criteria

1. THE Kitchen_Workflow SHALL process all orders through the states in this exact sequence: PENDING → ACCEPTED → PREPARING → READY → COMPLETED, where each state transition moves forward only and skipping states is not permitted.
2. THE Kitchen_Workflow SHALL apply the same state progression regardless of the order source (walk-in, WhatsApp, website, or third-party).
3. WHEN an order enters the PREPARING state, THE Android_POS SHALL display the order in the kitchen preparation queue showing the order number, order items with quantities, special notes, and elapsed time since the order entered PREPARING, sorted in FIFO order (oldest first).
4. WHEN an order is marked READY, THE Android_POS SHALL display a visual indicator on the cashier screen for the corresponding order and play an audible alert, and update the order status to READY in Firestore within 2 seconds.
5. IF a state transition is attempted that does not follow the defined sequence, THEN THE Kitchen_Workflow SHALL reject the transition and retain the current order state.
6. WHEN an order has been in the PREPARING state for longer than 30 minutes, THE Android_POS SHALL display a visual overdue indicator on that order in the kitchen preparation queue.

### Requirement 12: Offline Strategy

**User Story:** As a cashier, I want the POS to continue functioning during internet or printer outages, so that restaurant operations are not disrupted.

#### Acceptance Criteria

1. WHILE the internet connection is unavailable, THE Android_POS SHALL continue accepting orders and storing them in Room_Database up to a maximum of 500 orders.
2. WHEN internet connectivity is restored, THE Android_POS SHALL synchronize all locally stored orders to Firestore using WorkManager in chronological order within 60 seconds of detecting connectivity, and SHALL retry synchronization up to 5 times with exponential backoff if a sync attempt fails.
3. WHILE the Bluetooth printer is disconnected, THE Print_Agent SHALL queue print jobs in Room_Database up to a maximum of 500 print jobs.
4. WHEN the Bluetooth printer reconnects, THE Print_Agent SHALL process all queued print jobs in chronological order, and IF a print job fails during processing, THEN THE Print_Agent SHALL retry that job up to 3 times before skipping it and proceeding to the next job in the queue.
5. THE Android_POS SHALL NOT lose any print jobs or orders during connectivity interruptions.
6. WHILE the internet connection is unavailable or the Bluetooth printer is disconnected, THE Android_POS SHALL display a visible offline status indicator to the cashier identifying which connection is unavailable.

### Requirement 13: Unified Reporting

**User Story:** As a manager, I want unified reports that aggregate sales from all order channels, so that I can understand total business performance in one view.

#### Acceptance Criteria

1. THE Reporting_System SHALL aggregate order data from walk-in, WhatsApp, website, and future integration channels into a single data pipeline, including order counts, revenue sums, and item quantities per channel.
2. WHEN a manager opens the reports dashboard, THE Web_Dashboard SHALL display consolidated daily, weekly, and monthly sales summaries within 5 seconds, where "daily" means the calendar day (00:00–23:59) in the restaurant's configured timezone, "weekly" means the preceding 7 calendar days, and "monthly" means the preceding 30 calendar days.
3. THE Reporting_System SHALL attribute each order to the originating channel by storing a channel identifier on every order record, enabling filtering and comparison of order counts and revenue per channel.
4. THE Reporting_System SHALL include order counts, revenue totals, average order value, and peak hour analysis across all channels, where peak hour analysis identifies the 1-hour time slot with the highest order count within the selected period.
5. WHEN the Reporting_System data is updated by a completed order, THE Web_Dashboard SHALL reflect that order in report totals within 60 seconds of the order reaching COMPLETED status.
6. IF no orders exist for the selected reporting period, THEN THE Web_Dashboard SHALL display a zero-state message indicating no data is available for the selected period, with all metric values shown as zero.

### Requirement 14: Firebase Architecture

**User Story:** As a system architect, I want Firebase Firestore to serve as the communication backbone, so that all clients remain decoupled and synchronized.

#### Acceptance Criteria

1. THE Firestore backend SHALL provide real-time data synchronization for: menu items, orders, pending orders, print jobs, reports data, user roles, and device status, such that changes written by one client are observable by subscribing clients within 5 seconds under normal network conditions.
2. THE Firestore architecture SHALL ensure that clients NEVER communicate directly with each other; all inter-client data exchange SHALL pass through Firestore collections as the sole intermediary.
3. THE Firestore schema SHALL include collections for: menu, orders, pending_orders, print_jobs, devices, users, and reports, where each collection stores documents identifiable by a unique document ID.
4. THE Firestore security rules SHALL enforce role-based access such that: customers can read the menu collection and read/write only order documents where the userId field matches their authenticated UID; cashiers can read and write documents in the orders and print_jobs collections; managers can read and write documents in all collections.
5. IF a client attempts to read or write a Firestore document for which their role does not have permission, THEN THE Firestore security rules SHALL deny the operation and return a permission-denied error to the requesting client.
6. IF the Firestore service becomes unreachable from a client, THEN THE client SHALL display a connectivity status indicator and retry the connection, preserving any locally cached data until synchronization resumes.

### Requirement 15: User Role Management

**User Story:** As an administrator, I want distinct user roles with appropriate permissions, so that each user type can only access their relevant functionality.

#### Acceptance Criteria

1. THE Ecosystem SHALL support three user types: Customer (Website), Cashier (Android POS), and Manager (Web Dashboard or iPhone Browser).
2. WHEN a Customer accesses the system, THE Customer_Website SHALL allow: browse menu, create cart, submit order, and open WhatsApp.
3. WHEN a Cashier accesses the system, THE Android_POS SHALL allow: create orders, accept pending orders, generate bills, print KOTs, and reprint bills.
4. WHEN a Manager accesses the system, THE Web_Dashboard SHALL allow: view orders, generate bills, trigger reprints, monitor reports, and manage the menu.

### Requirement 16: Documentation

**User Story:** As a developer joining the project, I want comprehensive architecture documentation, so that I can understand and contribute to the system without extensive onboarding.

#### Acceptance Criteria

1. WHEN development begins, THE Project SHALL contain a /docs directory with the following documents: SYSTEM_ARCHITECTURE.md, FIRESTORE_SCHEMA.md, PRINTING_ARCHITECTURE.md, ANDROID_ARCHITECTURE.md, and DEVELOPER_ONBOARDING.md.
2. THE SYSTEM_ARCHITECTURE.md SHALL include: a system overview describing all major components and their responsibilities, data flow diagrams showing how data moves between components, component diagrams showing module boundaries and dependencies, user flows for each primary user action, Firestore interaction diagrams, and printing architecture overview.
3. THE FIRESTORE_SCHEMA.md SHALL include: collections, documents, fields with data types, relationships between collections, security rules, and required indexes.
4. THE PRINTING_ARCHITECTURE.md SHALL include: Bluetooth communication protocol and connection lifecycle, print queue system describing job states and transitions, Android Print Agent design and responsibilities, Firestore listeners describing which collections are observed, retry mechanisms specifying maximum retry count and backoff strategy, failure recovery describing how failed print jobs are re-queued, and duplicate prevention describing how the system avoids reprinting the same job.
5. THE ANDROID_ARCHITECTURE.md SHALL include: MVVM structure with layer responsibilities, repositories and their data sources, use cases and their business rules, services and their lifecycle, modules and their boundaries, and dependency injection configuration.
6. THE DEVELOPER_ONBOARDING.md SHALL include: step-by-step instructions to run the project locally, instructions to set up Firebase emulators and connect to a development project, instructions to set up and pair a Bluetooth printer, references to architecture documents for system understanding, and step-by-step instructions to deploy the application to each environment.
7. THE Project SHALL ensure each documentation file uses text-based diagrams in Mermaid format for all architectural and flow diagrams.
