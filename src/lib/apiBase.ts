const isBrowser = typeof window !== "undefined";
export const API_BASE: string =
  isBrowser && !!(window as any).Capacitor?.isNativePlatform?.()
    ? "https://calor-iq.com"
    : "";
