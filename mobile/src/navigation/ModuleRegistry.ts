/**
 * Module registry — the extensibility seam per design §17.
 * AppNavigator iterates REGISTERED_MODULES rather than hard-coding screens.
 * Add new module tab registrations here when new modules ship.
 */
export interface ModuleTabRegistration {
  key: string;
  label: string;
  /** Icon name or component — resolved at navigation assembly time */
  icon: string;
}

export const REGISTERED_MODULES: ModuleTabRegistration[] = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'history', label: 'History', icon: 'history' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
];
