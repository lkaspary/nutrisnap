"use client";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [checking, setChecking] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState("");

  // DEBUG: on-screen log panel. Remove after debugging is done.
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const log = (msg: string) => {
    const ts = new Date().toISOString().split("T")[1].slice(0, 12);
    setDebugLog(prev => [...prev, `${ts} ${msg}`]);
    console.log("[debug]", msg);
  };

  useEffect(() => {
    log("page mounted");
    const cap = typeof window !== "undefined" ? (window as any).Capacitor : undefined;
    log(`window.Capacitor exists: ${!!cap}`);
    if (cap) {
      log(`isNativePlatform: ${!!cap.isNativePlatform?.()}`);
      log(`platform: ${cap.getPlatform?.() ?? "?"}`);
    }

    const err = searchParams.get("error");
    if (err) setError("Sign in failed. Please try again.");

    // Hard timeout: never block the UI on session check for more than 3s.
    // If getSession or profile lookup hangs, the user still sees the sign-in
    // button and can re-authenticate.
    const timeout = setTimeout(() => {
      log("session check timed out after 3s — showing login UI anyway");
      setChecking(false);
    }, 3000);

    (async () => {
      try {
        log("calling supabase.auth.getSession()");
        const { data: { session } } = await supabase.auth.getSession();
        log(`getSession returned: session=${!!session}`);
        if (!session?.user) {
          clearTimeout(timeout);
          setChecking(false);
          return;
        }

        log("session found, looking up profile");
        const { data: profile, error: profErr } = await supabase
          .from("profiles")
          .select("id")
          .eq("user_id", session.user.id)
          .single();

        if (profErr) log(`profile lookup error: ${profErr.message}`);

        if (profile) {
          log(`have profile, redirecting to /${profile.id}`);
          clearTimeout(timeout);
          router.push(`/${profile.id}`);
          return;
        }

        clearTimeout(timeout);
        setChecking(false);
      } catch (e: any) {
        log(`session check threw: ${e?.message ?? e}`);
        clearTimeout(timeout);
        setChecking(false);
      }
    })();

    return () => clearTimeout(timeout);
  }, [router, searchParams]);

  const isNative = (): boolean => {
    if (typeof window === "undefined") return false;
    return !!(window as any).Capacitor?.isNativePlatform?.();
  };

  const signInWeb = async () => {
    log("signInWeb start");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      log(`signInWeb error: ${error.message}`);
      setError("Could not start sign in. Try again.");
      setSigningIn(false);
    }
  };

  const signInNative = async () => {
    log("signInNative start");
    try {
      log("importing @capacitor/browser");
      const { Browser } = await import("@capacitor/browser");
      log("importing @capacitor/app");
      const { App } = await import("@capacitor/app");
      log("plugins imported OK");

      const listener = await App.addListener("appUrlOpen", async ({ url }) => {
        log(`appUrlOpen fired: ${url}`);
        if (!url.startsWith("com.caloriq.mobile://login-callback")) {
          log("URL doesn't match login-callback prefix, ignoring");
          return;
        }

        await Browser.close().catch((e) => log(`Browser.close err: ${e}`));

        const hash = url.split("#")[1] ?? "";
        const params = new URLSearchParams(hash);
        const access_token = params.get("access_token");
        const refresh_token = params.get("refresh_token");
        log(`tokens parsed: access=${!!access_token} refresh=${!!refresh_token}`);

        listener.remove();

        if (!access_token || !refresh_token) {
          setError("Sign in failed. Please try again.");
          setSigningIn(false);
          return;
        }

        const { error: setErr } = await supabase.auth.setSession({
          access_token,
          refresh_token,
        });
        if (setErr) {
          log(`setSession error: ${setErr.message}`);
          setError("Could not complete sign in. Try again.");
          setSigningIn(false);
          return;
        }
        log("setSession OK");

        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          log("no session after setSession");
          setError("Sign in failed. Try again.");
          setSigningIn(false);
          return;
        }
        const user = session.user;
        const { data: existingProfile } = await supabase
          .from("profiles")
          .select("id")
          .eq("user_id", user.id)
          .single();
        if (existingProfile) {
          log(`existing profile, navigating`);
          router.push(`/${existingProfile.id}`);
          return;
        }
        const name = user.user_metadata?.full_name ?? user.email?.split("@")[0] ?? "User";
        const photoUrl = user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? null;
        const { data: newProfile, error: insErr } = await supabase
          .from("profiles")
          .insert({
            user_id: user.id,
            name,
            avatar: "🧑",
            avatar_bg: "#EEEDFE",
            photo_url: photoUrl,
          })
          .select("id")
          .single();
        if (insErr || !newProfile) {
          log(`profile insert err: ${insErr?.message}`);
          setError("Could not create profile. Try again.");
          setSigningIn(false);
          return;
        }
        router.push(`/${newProfile.id}`);
      });
      log("appUrlOpen listener registered");

      log("calling signInWithOAuth (skipBrowserRedirect)");
      const { data, error: oauthErr } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: "com.caloriq.mobile://login-callback",
          skipBrowserRedirect: true,
        },
      });
      log(`signInWithOAuth returned: url=${!!data?.url} err=${oauthErr?.message ?? "none"}`);
      if (oauthErr || !data?.url) {
        listener.remove();
        setError("Could not start sign in. Try again.");
        setSigningIn(false);
        return;
      }

      log("opening Browser with OAuth url");
      await Browser.open({ url: data.url, presentationStyle: "popover" });
      log("Browser.open returned");
    } catch (e: any) {
      log(`signInNative caught: ${e?.message ?? e}`);
      setError("Could not start sign in. Try again.");
      setSigningIn(false);
    }
  };

  const handleGoogleSignIn = async () => {
    log("button clicked");
    setSigningIn(true);
    setError("");
    if (isNative()) {
      log("→ native path");
      await signInNative();
    } else {
      log("→ web path");
      await signInWeb();
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <div className="text-center mb-10">
        <img src="/icons/icon-192.png" alt="Caloriq" className="w-20 h-20 mx-auto mb-4 rounded-2xl" />
        <h1 className="text-3xl font-bold mb-2">Caloriq</h1>
        <p className="text-gray-500 text-sm">AI-powered calorie & macro tracker</p>
      </div>

      <div className="space-y-3 mb-6">
        <div className="flex items-center gap-3 bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-2xl px-4 py-3">
          <span className="text-xl">📸</span>
          <p className="text-sm text-gray-600 dark:text-gray-300">Snap a photo to log meals instantly</p>
        </div>
        <div className="flex items-center gap-3 bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-2xl px-4 py-3">
          <span className="text-xl">🤖</span>
          <p className="text-sm text-gray-600 dark:text-gray-300">AI estimates calories & macros automatically</p>
        </div>
        <div className="flex items-center gap-3 bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-2xl px-4 py-3">
          <span className="text-xl">📊</span>
          <p className="text-sm text-gray-600 dark:text-gray-300">Track trends across days, weeks & months</p>
        </div>
      </div>

      {error && (
        <p className="text-red-500 text-sm text-center mb-4">{error}</p>
      )}

      <button
        onClick={handleGoogleSignIn}
        disabled={signingIn}
        className="w-full flex items-center justify-center gap-3 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-2xl px-4 py-4 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 shadow-sm"
      >
        <svg width="20" height="20" viewBox="0 0 48 48">
          <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
          <path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
          <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
          <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
        </svg>
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          {signingIn ? "Redirecting…" : "Continue with Google"}
        </span>
      </button>

      {/* Tiny background-checking indicator (doesn't block UI) */}
      {checking && (
        <p className="text-center text-xs text-gray-300 mt-3">
          Checking for existing session…
        </p>
      )}

      <p className="text-center text-xs text-gray-400 mt-4">
        Your data syncs across all your devices
      </p>

      {/* DEBUG PANEL — REMOVE AFTER DEBUGGING */}
      <div className="mt-8 p-3 bg-black/80 text-green-300 text-[10px] font-mono rounded-lg whitespace-pre-wrap break-all max-h-96 overflow-auto">
        <div className="text-yellow-300 mb-1 font-bold">DEBUG LOG</div>
        {debugLog.length === 0 ? <div className="text-gray-500">(no entries yet)</div> :
          debugLog.map((line, i) => <div key={i}>{line}</div>)
        }
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><p className="text-gray-400">Loading…</p></div>}>
      <HomeContent />
    </Suspense>
  );
}cd C:\Users\lkasp\nutrisnap
git add src/app/page.tsx public/sw.js
git commit -m "fix: non-blocking login page, bump sw cache"
git push