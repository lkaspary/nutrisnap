import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// ── Storage strategy ──────────────────────────────────────────────────────────
// Goal: a user logs in ONCE on the native app and stays signed in across every
// future launch.
//
// The earlier bug: we decided web-vs-native at module-import time via
// window.Capacitor. But on the Capacitor WebView, the Supabase client is
// constructed before window.Capacitor is guaranteed to be injected, so the
// client sometimes got window.localStorage instead of Preferences. The session
// was then written to one store and read from the other (or written to
// localStorage, which the WebView evicts) — so the app demanded a fresh login on
// every launch.
//
// The fix: DO NOT branch on native-detection at construction time. Each storage
// operation resolves the durable store (Capacitor Preferences) lazily, at call
// time, and MIRRORS every write into localStorage as well. Reads prefer
// Preferences and fall back to localStorage. Because every write goes to both,
// reads are consistent no matter which store is available when the call happens —
// eliminating the mismatch race entirely.

const isBrowser = typeof window !== "undefined";

// No-op store for SSR so Supabase doesn't crash with "localStorage is not defined".
const noopStorage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};

// Lazily get the Capacitor Preferences plugin if it's present in this runtime.
// Returns null on web (or if the plugin isn't installed), so callers fall back
// to localStorage. Resolved at CALL time, never at import time.
async function getPreferences(): Promise<any | null> {
  try {
    const mod = await import("@capacitor/preferences");
    return mod?.Preferences ?? null;
  } catch {
    return null;
  }
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

// Durable, race-free storage adapter.
const durableStorage = {
  async getItem(k: string): Promise<string | null> {
    // Prefer the native durable store; fall back to localStorage.
    const Preferences = await getPreferences();
    if (Preferences) {
      try {
        const { value } = await Preferences.get({ key: k });
        if (value != null) return value;
      } catch { /* fall through to localStorage */ }
    }
    return lsGet(k);
  },
  async setItem(k: string, v: string): Promise<void> {
    // Write to BOTH stores so reads are consistent regardless of which is
    // available at read time. Preferences is the durable one on native.
    const Preferences = await getPreferences();
    if (Preferences) {
      try { await Preferences.set({ key: k, value: v }); } catch {}
    }
    lsSet(k, v);
  },
  async removeItem(k: string): Promise<void> {
    const Preferences = await getPreferences();
    if (Preferences) {
      try { await Preferences.remove({ key: k }); } catch {}
    }
    lsRemove(k);
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