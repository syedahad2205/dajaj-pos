/**
 * Safe MMKV factory — never lets storage failures brick the app.
 *
 * `new MMKV()` throws when JSI is unavailable (e.g. legacy remote debugger
 * attached, or bridgeless edge cases). Module-scope instances previously
 * crashed the whole bundle ("DajajFinance has not been registered"). This
 * factory falls back to an in-memory shim so the app always boots; only
 * persistence across restarts is lost in that mode.
 */
import { MMKV } from 'react-native-mmkv';

export interface SafeStorage {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
  delete: (key: string) => void;
  contains: (key: string) => boolean;
  getAllKeys: () => string[];
}

class MemoryStorage implements SafeStorage {
  private map = new Map<string, string>();

  getString(key: string) {
    return this.map.get(key);
  }
  set(key: string, value: string) {
    this.map.set(key, value);
  }
  delete(key: string) {
    this.map.delete(key);
  }
  contains(key: string) {
    return this.map.has(key);
  }
  getAllKeys() {
    return Array.from(this.map.keys());
  }
}

let warned = false;

export function createSafeStorage(idOrOptions: string | { id: string }): SafeStorage {
  const id = typeof idOrOptions === 'string' ? idOrOptions : idOrOptions.id;
  try {
    const instance = new MMKV({ id });
    return instance as unknown as SafeStorage;
  } catch (error) {
    if (!warned) {
      warned = true;
      console.warn(
        '[safeStorage] MMKV unavailable — falling back to in-memory storage.',
        error instanceof Error ? error.message : error,
      );
    }
    return new MemoryStorage();
  }
}
