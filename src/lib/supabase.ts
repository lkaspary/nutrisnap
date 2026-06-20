import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// ── Storage strategy ──────────────────────────────────────────────────────────
// - SSR (no window): a no-op store so Supabase doesn't crash with
//   "localStorage is not defined".
// - Native (Capacitor Android/iOS): use @capacitor/preferences. The WebView's
//   localStorage can be evicted (cache pressure, "clear data"), silently dropping
//   the auth session and forcing a re-login. Preferences is durable native
//   storage that survives, so users stay signed in.
// - Web/PWA: default to window.localStorage.
//
// Supabase's storage interface allows async get/set/remove, which lets us use
// Capacitor Preferences (a Promise-based API) directly.

const isBrowser = typeof window !== "undefined";

function isNativeApp(): boolean {
  if (!isBrowser) return false;
  return !!(window as any).Capacitor?.isNativePlatform?.();
}

const noopStorage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};

// Capacitor Preferences-backed storage. Lazily imports the plugin so web builds
// don't pull it in, and falls back to localStorage if the plugin isn't present.
const nativeStorage = {
  async getItem(k: string): Promise<string | null> {
    try {
      const { Preferences } = await import("@capacitor/preferences");
      const { value } = await Preferences.get({ key: k });
      return value ?? null;
    } catch {
      try { return window.localStorage.getItem(k); } catch { return null; }
    }
  },
  async setItem(k: string, v: string): Promise<void> {
    try {
      const { Preferences } = await import("@capacitor/preferences");
      await Preferences.set({ key: k, value: v });
    } catch {
      try { window.localStorage.setItem(k, v); } catch {}
    }
  },
  async removeItem(k: string): Promise<void> {
    try {
      const { Preferences } = await import("@capacitor/preferences");
      await Preferences.remove({ key: k });
    } catch {
      try { window.localStorage.removeItem(k); } catch {}
    }
  },
};

function pickStorage() {
  if (!isBrowser) return noopStorage as any;
  if (isNativeApp()) return nativeStorage as any;
  return window.localStorage;
}

export const supabase = createClient(url, key, {
  auth: {
    storage: pickStorage(),
    persistSession: isBrowser,
    autoRefreshToken: isBrowser,
    detectSessionInUrl: isBrowser,
  },
});