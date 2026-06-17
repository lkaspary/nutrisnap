import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// On the server (SSR) there is no localStorage, which crashes Supabase with
// "ReferenceError: localStorage is not defined". Provide a no-op storage when
// `window` is not available; in the browser, fall back to the default.
const isBrowser = typeof window !== "undefined";

const noopStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

export const supabase = createClient(url, key, {
  auth: {
    storage: isBrowser ? window.localStorage : (noopStorage as any),
    persistSession: isBrowser,
    autoRefreshToken: isBrowser,
    detectSessionInUrl: isBrowser,
  },
});