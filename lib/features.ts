/**
 * Feature flags — set to `false` to fully disable a feature.
 * Disabled features are blocked at the middleware level (HTTP 404),
 * not just hidden in UI, so there is no security leak.
 */
export const FEATURES = {
  // ─── ENABLED ───────────────────────────────────────────
  ADMIN_MENU_BUILDER: true,

  // ─── DISABLED (enable when ready to launch) ────────────
  DELIVERY: false,
  RIDER_APP: false,
  ONLINE_ORDERING: false,
  CUSTOMER_APP: false,
} as const;

export type FeatureKey = keyof typeof FEATURES;

/**
 * URL prefixes that are blocked when the corresponding feature is disabled.
 * The middleware returns 404 for any request matching these prefixes.
 */
export const FEATURE_ROUTES: Partial<Record<FeatureKey, string[]>> = {
  ONLINE_ORDERING: ['/menu/order', '/checkout', '/order-success', '/cart', '/insta'],
  CUSTOMER_APP: ['/profile', '/login', '/location', '/orders'],
  DELIVERY: ['/admin/delivery', '/admin/riders'],
  RIDER_APP: ['/rider'],
};
