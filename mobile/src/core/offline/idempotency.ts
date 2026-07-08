/**
 * Stable idempotency key generation (Requirement 10.3, 11.4).
 *
 * The key is generated ONCE at enqueue time and stored as part of the
 * QueuedMutation. It is NEVER regenerated on retry. The same key is sent
 * with every replay attempt of the same queued mutation, guaranteeing the
 * server's idempotency check (fin_mobile_idempotency) prevents double-posting.
 */

/**
 * Generates a v4-style UUID using React Native's built-in crypto.
 * This is the idempotency key for one specific queued mutation instance.
 */
export function generateIdempotencyKey(): string {
  // React Native 0.71+ exposes crypto.getRandomValues globally via Hermes/JSI
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Set version 4 bits
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  // Set variant bits
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
