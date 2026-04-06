# Project Manual

## System Overview

This project is a Next.js App Router restaurant system backed by Firebase Authentication and Firestore.

Core modules:

- Menu Builder: Admin tool to create the hierarchical menu stored in `menus`.
- Ordering System: Customer-facing `/menu` flow for browsing categories, variants, and modifiers.
- Cart: In-memory cart with merging logic, customization, quantity changes, and checkout handoff.
- Checkout: Address selection, delivery fee calculation, minimum order validation, and order creation.
- Delivery: Admin-configured restaurant location and delivery slabs stored in `deliverySettings/config`.
- Admin Dashboard: Central admin entry point for POS, delivery settings, and order management.
- POS: Existing point-of-sale flow used for internal billing. It is linked from the admin dashboard.
- Orders: Customer order history and admin realtime order management.

## Folder Structure

### `app/menu`

Customer ordering experience. Loads the menu, displays categories and variants, opens customization, and connects to the cart.

### `app/checkout`

Checkout page. Handles address selection, delivery fee calculation, minimum order validation, payment method selection, and order creation.

### `app/orders`

Customer order history page.

### `app/orders/[orderId]`

Customer order detail page showing items, modifiers, delivery address, payment method, and order status.

### `app/admin`

Admin dashboard landing page.

### `app/admin/orders`

Realtime admin order management. Displays all orders and allows status changes.

### `app/admin/delivery`

Admin delivery settings page. Manages restaurant location and delivery fee slabs by radius.

### `app/admin/menu-builder`

Admin menu builder. Creates and manages the category → variant → modifier group → modifier hierarchy.

### `app/admin/pos`

Admin POS entry route. Reuses the existing POS page and keeps admin navigation consistent.

### `app/pos`

Existing POS workflow. Internal billing and order creation logic for counter operations.

### `components/cart`

Cart provider, cart drawer, and cart item presentation.

### `components/menu`

Customer menu UI: category list, variant cards, modal customization, and modifier groups.

### `components/address`

Address selection, address editor modal, and Google Maps picker.

### `services`

Firestore service layer for orders, delivery settings, menu subscriptions, admins, and customers.

### `lib`

Shared logic and framework helpers:

- Firebase initialization
- delivery calculation helpers
- role/auth guards
- Firestore data utilities

## Data Collections

### `menus`

Hierarchical menu nodes used by both admin and customer menu flows.

### `orders`

Customer orders. Each document contains:

- `orderNumber`
- `userId`
- `customerName`
- `customerPhone`
- `address`
- `location`
- `items`
- `subtotal`
- `deliveryFee`
- `total`
- `paymentMethod`
- `paymentStatus`
- `orderStatus`
- `createdAt`
- `updatedAt`

### `deliverySettings`

Stores delivery configuration, currently under `deliverySettings/config`.

### `customers`

Stores customer profiles and addresses:

- `customers/{userId}`
- `customers/{userId}/addresses`

### `admins`

Stores admin profiles:

- `admins/{userId}`

### `counters`

Stores numeric counters such as the order number sequence.

### `bills`

Used by the POS and billing system.

## Order Flow

Menu → Cart → Checkout → Order Creation → Admin Dashboard

1. Customer browses `/menu`
2. Adds variants with modifier selections
3. Reviews the cart
4. Proceeds to `/checkout`
5. Selects address and receives a delivery fee
6. Places the order
7. Order is saved into `orders`
8. Admin sees it immediately in `/admin/orders`

## Admin Flow

Admin Login → Admin Dashboard → POS / Delivery Settings / Order Management

1. Admin signs in
2. User role resolves to `admin`
3. Login redirects to `/admin`
4. Admin opens:
   - `/admin/pos`
   - `/admin/delivery`
   - `/admin/orders`

## Customer Flow

Customer Login → Menu → Cart → Checkout → Orders Page

1. Customer signs in
2. User role resolves to `customer`
3. Login redirects to `/menu`
4. Customer builds an order and checks out
5. Customer can review past orders at `/orders`
6. Customer can open `/orders/[orderId]` for full details

## Security Model

- Admin access is resolved from `admins/{userId}`
- Customer access is resolved from `customers/{userId}`
- Admin route protection redirects non-admin users away from `/admin/*`
- Customer route protection redirects admin users away from customer-only pages
- Firestore rules should reinforce the same access model for:
  - `orders`
  - `admins`
  - `customers`
  - `menus`
  - `deliverySettings`
  - `counters`

## Important Notes

- POS behavior is intentionally left unchanged and is only linked from the admin dashboard.
- Delivery calculation logic remains in shared helpers and is reused by checkout.
- Menu builder structure remains unchanged and still drives the customer menu.
