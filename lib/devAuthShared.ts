export const CUSTOMER_BYPASS_OTP = "0000";
export const ADMIN_BYPASS_CODE = "7760293044";
export const ADMIN_BYPASS_SESSION_KEY = "dajaj-admin-bypass";

// The admin bypass code above grants full, unrestricted Admin access with no
// real Firebase account. It exists purely as a local-development convenience
// and must never be usable in a deployed environment. Every call site that
// checks the bypass code or session MUST also check this flag first.
export function isAdminBypassAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}
