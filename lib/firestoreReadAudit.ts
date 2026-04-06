export const FIRESTORE_READ_AUDIT_SUMMARY = {
  primaryCollections: ["orders", "counters/orders", "delivery_assignments", "order_tracking"],
  knownRealtimeViews: [
    "app/admin/orders/page.tsx",
    "app/orders/[orderId]/page.tsx",
    "app/admin/delivery/page.tsx",
    "app/admin/menu-builder/page.tsx",
  ],
  convertedToManualFetch: [
    "app/orders/page.tsx",
    "app/admin/riders/page.tsx",
    "app/menu/page.tsx",
    "app/pos/page.tsx",
    "app/checkout/page.tsx",
    "components/auth/CustomerAuthProvider.tsx",
    "components/auth/RiderAuthProvider.tsx",
    "components/address/AddressProvider.tsx",
  ],
} as const;
