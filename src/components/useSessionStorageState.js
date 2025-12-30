import { useEffect, useState } from "react";

/**
 * useSessionStorageState
 * - Persists a piece of state in sessionStorage
 * - Safe JSON parsing
 * - Cross-tab sync is NOT needed for sessionStorage (per-tab), so we keep it simple.
 */
export function useSessionStorageState(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw == null) return initialValue;
      return JSON.parse(raw);
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // If storage is full or blocked, fail silently.
      // UI still works; persistence just won't.
    }
  }, [key, value]);

  return [value, setValue];
}


