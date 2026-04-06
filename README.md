# DAJAJ Restaurant System

DAJAJ is a Next.js App Router restaurant application backed by Firebase Authentication and Firestore.

It includes:

- customer ordering flow
- admin dashboard
- menu builder
- delivery settings
- order management
- POS and billing
- address management with Google Maps

## Tech Stack

- Next.js
- React
- Tailwind CSS
- Firebase Authentication
- Firestore
- Google Maps JavaScript API
- Places API
- Geocoding API

## App Overview

The app has two main sides.

### Customer Side

Customers can:

- log in
- browse the menu
- customize variants with modifiers
- manage cart
- select delivery address
- place orders
- view order history

### Admin Side

Admins can:

- open the admin dashboard
- use POS
- manage delivery settings
- manage orders
- manage the menu structure

## Authentication and Roles

Admin accounts are stored in:

`admins/{userId}`

Customer accounts are stored in:

`customers/{userId}`

Routing behavior:

- `admin` users go to `/admin`
- `customer` users go to `/menu`

Route guards:

- admin-only pages use [lib/roleGuard.ts](/Users/syed/Desktop/dajaj%20pos/lib/roleGuard.ts)
- customer-only pages also use [lib/roleGuard.ts](/Users/syed/Desktop/dajaj%20pos/lib/roleGuard.ts)

## Available Routes

### Public / Shared

- `/`
  - landing page
- `/login`
  - customer login
- `/admin/login`
  - admin login

### Customer Routes

- `/menu`
  - main ordering page
- `/checkout`
  - address selection, delivery fee, payment method, place order
- `/orders`
  - customer order history
- `/orders/[orderId]`
  - full order details
- `/order-success`
  - confirmation after placing order

### Admin Routes

- `/admin`
  - admin dashboard
- `/admin/orders`
  - realtime order management
- `/admin/delivery`
  - restaurant location and delivery slabs
- `/admin/menu-builder`
  - hierarchical menu builder
- `/admin/pos`
  - admin entry route for POS

### Existing Internal / Legacy Routes

- `/pos`
  - POS system
- `/bills`
  - bill history
- `/bill/[billNo]`
  - shared/public bill view
- `/location`
  - location-related page if used in current flow
- `/insta`
  - project-specific page

## Where Each Feature Lives

## App Pages

### [app/menu/page.tsx](/Users/syed/Desktop/dajaj%20pos/app/menu/page.tsx)

Customer menu experience:

- category accordion
- variant cards
- add-to-cart flow
- cart drawer trigger
- address header
- variant customization modal

### [app/checkout/page.tsx](/Users/syed/Desktop/dajaj%20pos/app/checkout/page.tsx)

Checkout flow:

- editable cart items
- delivery fee calculation
- minimum order validation
- address selection
- payment method
- order placement

### [app/orders/page.tsx](/Users/syed/Desktop/dajaj%20pos/app/orders/page.tsx)

Customer order history list.

### [app/orders/[orderId]/page.tsx](/Users/syed/Desktop/dajaj%20pos/app/orders/%5BorderId%5D/page.tsx)

Customer order detail view.

### [app/admin/page.tsx](/Users/syed/Desktop/dajaj%20pos/app/admin/page.tsx)

Admin dashboard with links to POS, delivery, and order management.

### [app/admin/orders/page.tsx](/Users/syed/Desktop/dajaj%20pos/app/admin/orders/page.tsx)

Realtime admin order management:

- view all orders
- expand for details
- update order status
- cancel orders

### [app/admin/delivery/page.tsx](/Users/syed/Desktop/dajaj%20pos/app/admin/delivery/page.tsx)

Admin delivery setup:

- restaurant location picker
- map circles for radius slabs
- delivery fee slabs
- minimum order

### [app/admin/menu-builder/page.tsx](/Users/syed/Desktop/dajaj%20pos/app/admin/menu-builder/page.tsx)

Admin menu builder:

- hierarchical tree
- node create/edit/delete
- add child
- copy subtree
- reorder
- availability toggle

### [app/admin/pos/page.tsx](/Users/syed/Desktop/dajaj%20pos/app/admin/pos/page.tsx)

Admin wrapper route for POS.

### [app/pos/page.tsx](/Users/syed/Desktop/dajaj%20pos/app/pos/page.tsx)

Existing POS system. This is intentionally not modified by the recent admin/order changes.

## Components

### `components/menu`

Customer ordering UI:

- [CategoryList.tsx](/Users/syed/Desktop/dajaj%20pos/components/menu/CategoryList.tsx)
- [VariantGrid.tsx](/Users/syed/Desktop/dajaj%20pos/components/menu/VariantGrid.tsx)
- [VariantCard.tsx](/Users/syed/Desktop/dajaj%20pos/components/menu/VariantCard.tsx)
- [VariantModal.tsx](/Users/syed/Desktop/dajaj%20pos/components/menu/VariantModal.tsx)
- [ModifierGroup.tsx](/Users/syed/Desktop/dajaj%20pos/components/menu/ModifierGroup.tsx)

### `components/cart`

Cart system:

- [CartProvider.tsx](/Users/syed/Desktop/dajaj%20pos/components/cart/CartProvider.tsx)
- [CartDrawer.tsx](/Users/syed/Desktop/dajaj%20pos/components/cart/CartDrawer.tsx)
- [CartItem.tsx](/Users/syed/Desktop/dajaj%20pos/components/cart/CartItem.tsx)

### `components/address`

Address and map system:

- [AddressProvider.tsx](/Users/syed/Desktop/dajaj%20pos/components/address/AddressProvider.tsx)
- [AddressSelector.tsx](/Users/syed/Desktop/dajaj%20pos/components/address/AddressSelector.tsx)
- [AddressCard.tsx](/Users/syed/Desktop/dajaj%20pos/components/address/AddressCard.tsx)
- [AddAddressModal.tsx](/Users/syed/Desktop/dajaj%20pos/components/address/AddAddressModal.tsx)
- [MapPicker.tsx](/Users/syed/Desktop/dajaj%20pos/components/address/MapPicker.tsx)

## Services

### [services/menuService.ts](/Users/syed/Desktop/dajaj%20pos/services/menuService.ts)

Menu subscription and available menu tree generation.

### [services/deliveryService.ts](/Users/syed/Desktop/dajaj%20pos/services/deliveryService.ts)

Reads and writes delivery settings from Firestore.

### [services/orderService.ts](/Users/syed/Desktop/dajaj%20pos/services/orderService.ts)

Order service layer:

- `createOrder()`
- `getUserOrders()`
- `getAllOrders()`
- `getOrderById()`
- `updateOrderStatus()`
- realtime subscriptions

### [services/userService.ts](/Users/syed/Desktop/dajaj%20pos/services/userService.ts)

User profile and role service.

## Shared Libraries

### [lib/firebase.ts](/Users/syed/Desktop/dajaj%20pos/lib/firebase.ts)

Firebase app, auth, and Firestore initialization.

### [lib/menu-builder.ts](/Users/syed/Desktop/dajaj%20pos/lib/menu-builder.ts)

Menu builder data model and Firestore operations.

### [lib/delivery.ts](/Users/syed/Desktop/dajaj%20pos/lib/delivery.ts)

Distance and delivery fee helpers:

- `calculateDistanceKm()`
- `calculateDeliveryFee()`

### [lib/paymentMethods.ts](/Users/syed/Desktop/dajaj%20pos/lib/paymentMethods.ts)

Payment method structure for future expansion.

### [lib/roleGuard.ts](/Users/syed/Desktop/dajaj%20pos/lib/roleGuard.ts)

Role-based page guards:

- `requireAdmin()`
- `requireCustomer()`

### [lib/useRequireAuth.ts](/Users/syed/Desktop/dajaj%20pos/lib/useRequireAuth.ts)

Base auth hook used under the role guard layer.

## Firestore Collections

### `menus`

Hierarchical restaurant menu.

Used by:

- admin menu builder
- customer menu

### `orders`

Order documents:

```ts
{
  orderNumber: string
  userId: string
  customerName: string
  customerPhone: string
  address: Address
  location: { lat: number; lng: number }
  items: CartItem[]
  subtotal: number
  deliveryFee: number
  total: number
  paymentMethod: string
  paymentStatus: string
  orderStatus: string
  createdAt: timestamp
  updatedAt: timestamp
}
```

### `deliverySettings`

Currently uses:

`deliverySettings/config`

Stores:

- restaurant location
- delivery zones
- minimum order

### `customers`

Stores customer profiles and customer addresses:

- `customers/{userId}`
- `customers/{userId}/addresses`

### `admins`

Stores admin profiles:

- `admins/{userId}`

### `counters`

Used for incremental counters such as order numbers and POS/billing counters.

### `bills`

Used by the POS system.

## Main Flows

## Customer Flow

1. Login
2. Redirect to `/menu`
3. Browse menu
4. Add items to cart
5. Open checkout
6. Choose or add address
7. Delivery fee is calculated
8. Place order
9. Open `/orders`
10. Open `/orders/[orderId]` for details

## Admin Flow

1. Login
2. Redirect to `/admin`
3. Open one of:
   - `/admin/pos`
   - `/admin/delivery`
   - `/admin/orders`
   - `/admin/menu-builder`

## Order Flow

`/menu` → cart → `/checkout` → `orders/{orderId}` → `/admin/orders`

Admin order status flow:

- `pending`
- `accepted`
- `preparing`
- `ready`
- `out_for_delivery`
- `delivered`
- `cancelled`

## Delivery System

Restaurant location is configured by admin on a map.

Delivery fee is calculated by:

1. customer address coordinates
2. restaurant location
3. delivery slabs by radius

If customer is outside the configured max radius:

- delivery is unavailable

If subtotal is below minimum order:

- checkout is blocked

## Google Maps Setup

Set:

```bash
NEXT_PUBLIC_GOOGLE_MAPS_KEY=your_key_here
```

Enable these APIs:

- Maps JavaScript API
- Places API
- Geocoding API

## Local Setup

Install dependencies:

```bash
npm install
```

Run development server:

```bash
npm run dev
```

Type-check:

```bash
npx tsc --noEmit
```

## Firebase Notes

You need:

- Firebase Authentication enabled
- Firestore enabled
- appropriate Firestore rules for:
  - `orders`
  - `users`
  - `menus`
  - `deliverySettings`
  - `counters`
  - `bills`

Important auth note:

- customer login reads and writes only `customers`
- admin login reads only `admins`
- admin users must exist in `admins/{userId}`

## Security Model

- admins cannot use customer-only pages as their main flow
- customers cannot access admin pages
- role mismatch redirects happen in the app layer
- Firestore rules should also enforce the same access boundaries

## Additional Documentation

For a more structured internal breakdown, see:

- [docs/PROJECT_MANUAL.md](/Users/syed/Desktop/dajaj%20pos/docs/PROJECT_MANUAL.md)
