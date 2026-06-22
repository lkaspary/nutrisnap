"use client";
import { useEffect } from "react";

// ── NativeResumeHandler ───────────────────────────────────────────────────────
// Fixes the "dark, unresponsive screen when returning to the app" freeze on the
// native (Capacitor) build.
//
// Root cause (best-effort, since on-device debugging wasn't available): the app
// loads the remote site in the WebView (capacitor.config server.url). When Android
// backgrounds the app, the WebView's render surface is suspended; on resume it can
// fail to repaint, and any auth/token-refresh awaiting in the background can be
// left in a stuck state — leaving a blank, frozen screen.
//
// This component, mounted anywhere on the food-log page, listens for the app
// returning to the foreground and:
//   1) closes any lingering in-app Browser overlay (defensive),
//   2) forces the WebView to repaint (visibility + reflow nudge),
//   3) re-validates the Supabase session so a stuck refresh can't wedge the UI.
//
// It is a no-op on web/PWA — only runs inside the native shell.
export default function NativeResumeHandler() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const Cap = (window as any).Capacitor;
    if (!Cap?.isNativePlatform?.()) return;

    let appListener: any = null;
    let cancelled = false;

    const onResume = async () => {
      // 1) Dismiss any leftover OAuth browser overlay.
      try {
        const { Browser } = await import("@capacitor/browser");
        await Browser.close().catch(() => {});
      } catch {}

      // 2) Nudge the WebView to repaint. Toggling a layout property forces Android
      //    WebView to re-composite the surface, which clears the blank-screen state.
      try {
        const html = document.documentElement;
        const prev = html.style.transform;
        html.style.transform = "translateZ(0)";
        // Force reflow
        void html.offsetHeight;
        requestAnimationFrame(() => {
          html.style.transform = prev || "";
        });
      } catch {}

      // 3) Re-validate the session WITHOUT blocking the UI. If a background token
      //    refresh got stuck, this kicks Supabase to reconcile. We race it against a
      //    short timeout so this handler can never itself hang.
      try {
        const mod = await import("@/lib/supabase");
        const supabase = (mod as any).supabase;
        if (supabase?.auth?.getSession) {
          await Promise.race([
            supabase.auth.getSession(),
            new Promise((res) => setTimeout(res, 1500)),
          ]);
        }
      } catch {}
    };

    (async () => {
      try {
        const { App } = await import("@capacitor/app");
        appListener = await App.addListener("appStateChange", ({ isActive }: { isActive: boolean }) => {
          if (isActive && !cancelled) onResume();
        });
      } catch {}
    })();

    return () => {
      cancelled = true;
      appListener?.remove?.();
    };
  }, []);

  return null;
}