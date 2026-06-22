import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// ── Storage strategy ──────────────────────────────────────────────────────────
// Goal: native app user logs in ONCE and stays signed in across launches, WITHOUT
// slowing down session reads on web/PWA.
//
// Two earlier issues this resolves:
//  1) Native "login every launch": caused by deciding web-vs-native at import time
//     (window.Capacitor may not be injected yet), so the session was written to one
//     store and read from another. Fixed by writing through to BOTH stores.
//  2) Slow page load after that fix: caused by doing `await import(...)` on EVERY
//     storage read, and consulting Capacitor Preferences even on web. Supabase reads
//     storage several times during init, so the repeated dynamic import added latency.
//
// This version:
//  - Detects native ONCE (cached), and only touches Preferences when actually native.
//  - On web/PWA, reads/writes go straight to localStorage synchronously — no async
//    import, no overhead, fast page load.
//  - Resolves the Preferences plugin ONCE (cached promise), not on every call.
//  - Still writes through to both stores on native so a launch-time read is consistent
//    regardless of which store responds first.

const isBrowser = typeof window !== "undefined";

const noopStorage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};

// Detect native once. Capacitor injects window.Capacitor; isNativePlatform() is
// true only inside the native shell (false in a regular browser/PWA).
let _isNative: boolean | null = null;
function isNativeApp(): boolean {
  if (_isNative !== null) return _isNative;
  if (!isBrowser) { _isNative = false; return false; }
  _isNative = !!(window as any).Capacitor?.isNativePlatform?.();
  return _isNative;
}

// Resolve the Preferences plugin ONCE and cache the promise, so we don't re-import
// on every storage operation.
let _prefsPromise: Promise<any | null> | null = null;
function getPreferences(): Promise<any | null> {
  if (_prefsPromise) return _prefsPromise;
  _prefsPromise = import("@capacitor/preferences")
    .then((m) => m?.Preferences ?? null)
    .catch(() => null);
  return _prefsPromise;
}

function lsGet(k: string): string | null {
  try { return window.localStorage.getItem(k); } catch { return null; }
}
function lsSet(k: string, v: string): void {
  try { window.localStorage.setItem(k, v); } catch {}
}
function lsRemove(k: string): void {
  try { window.localStorage.removeItem(k); } catch {}
}

const durableStorage = {
  async getItem(k: string): Promise<string | null> {
    // Web/PWA: straight to localStorage, no async import, fast.
    if (!isNativeApp()) return lsGet(k);
    // Native: prefer durable Preferences, fall back to localStorage.
    const Preferences = await getPreferences();
    if (Preferences) {
      try {
        const { value } = await Preferences.get({ key: k });
        if (value != null) return value;
      } catch { /* fall through */ }
    }
    return lsGet(k);
  },
  async setItem(k: string, v: string): Promise<void> {
    if (!isNativeApp()) { lsSet(k, v); return; }
    // Native: write through to BOTH so reads are consistent.
    lsSet(k, v);
    const Preferences = await getPreferences();
    if (Preferences) {
      try { await Preferences.set({ key: k, value: v }); } catch {}
    }
  },
  async removeItem(k: string): Promise<void> {
    if (!isNativeApp()) { lsRemove(k); return; }
    lsRemove(k);
    const Preferences = await getPreferences();
    if (Preferences) {
      try { await Preferences.remove({ key: k }); } catch {}
    }
  },
};

export const supabase = createClient(url, key, {
  auth: {
    storage: isBrowser ? (durableStorage as any) : (noopStorage as any),
    persistSession: isBrowser,
    autoRefreshToken: isBrowser,
    detectSessionInUrl: isBrowser,
  },
});