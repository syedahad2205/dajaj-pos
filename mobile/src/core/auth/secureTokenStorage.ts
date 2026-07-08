/**
 * Keychain-backed persistence adapter — reserved for future hardening.
 *
 * Currently NOT used for Firebase Auth persistence (see firebaseClient.ts
 * which uses getReactNativePersistence + AsyncStorage to avoid the Hermes
 * "Expected a class definition" error that occurs with custom class adapters).
 *
 * For production hardening, the Firebase Auth token should be migrated from
 * AsyncStorage to the iOS Keychain / Android Keystore after sign-in to
 * satisfy Requirement 1.9 fully.
 */
export {};
