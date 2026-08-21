/**
 * Tracks the most recent in-flight Today's Sales save so the Close Day action
 * can wait for it before locking — mirrors the web app's
 * `await handleSaveSales()` before POSTing the close (prevents the close
 * request racing ahead of the last sales PATCH).
 */
let pendingSave: Promise<void> = Promise.resolve();

export function trackSalesSave(save: Promise<unknown>): void {
  pendingSave = save.then(
    () => undefined,
    () => undefined,
  );
}

export async function waitForSalesSave(): Promise<void> {
  await pendingSave;
}
