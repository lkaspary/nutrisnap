"use client";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const err = searchParams.get("error");
    if (err) setError("Sign in failed. Please try again.");

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("id")
          .eq("user_id", session.user.id)
          .single();
        if (profile) {
          router.push(`/${profile.id}`);
          return;
        }
      }
      setLoading(false);
    });
  }, [router, searchParams]);

  // Detect whether we're running inside the Capacitor native shell.
  // window.Capacitor.isNativePlatform() exists only in the native app.
  const isNative = (): boolean => {
    if (typeof window === "undefined") return false;
    // @ts-expect-error - Capacitor is injected at runtime by the native shell
    return !!window.Capacitor?.isNativePlatform?.();
  };

  // Web flow — unchanged from before.
  const signInWeb = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setError("Could not start sign in. Try again.");
      setSigningIn(false);
    }
  };

  // Native flow — opens Google login in a Custom Tab (Chrome surface, which
  // Google permits for OAuth), and listens for the deep-link return.
  const signInNative = async () => {
    try {
      const { Browser } = await import("@capacitor/browser");
      const { App } = await import("@capacitor/app");

      // Listen for the deep link Android will deliver back to us.
      // Format: com.caloriq.mobile://login-callback#access_token=...&refresh_token=...
      const listener = await App.addListener("appUrlOpen", async ({ url }) => {
        if (!url.startsWith("com.caloriq.mobile://login-callback")) return;

        // Close the Custom Tab now that auth is complete.
        await Browser.close().catch(() => {});

        // Parse tokens from the URL fragment (after the #).
        const hash = url.split("#")[1] ?? "";
        const params = new URLSearchParams(hash);
        const access_token = params.get("access_token");
        const refresh_token = params.get("refresh_token");

        listener.remove();

        if (!access_token || !refresh_token) {
          setError("Sign in failed. Please try again.");
          setSigningIn(false);
          return;
        }

        // Plant the tokens into the Supabase client inside the WebView.
        // This is what makes the WebView "logged in" — the cookie that was
        // set in the Custom Tab does NOT carry over, so we must do this.
        const { error: setErr } = await supabase.auth.setSession({
          access_token,
          refresh_token,
        });

        if (setErr) {
          setError("Could not complete sign in. Try again.");
          setSigningIn(false);
          return;
        }

        // Look up (or create) the profile, same way the web callback does.
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
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
          setError("Could not create profile. Try again.");
          setSigningIn(false);
          return;
        }
        router.push(`/${newProfile.id}`);
      });

      // Ask Supabase for the OAuth URL but DON'T redirect the WebView itself.
      // We open it in the Custom Tab instead.
      const { data, error: oauthErr } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: "com.caloriq.mobile://login-callback",
          skipBrowserRedirect: true,
        },
      });
      if (oauthErr || !data?.url) {
        listener.remove();
        setError("Could not start sign in. Try again.");
        setSigningIn(false);
        return;
      }

      // Open in a Custom Tab — this is the Chrome surface Google allows for OAuth.
      await Browser.open({ url: data.url, presentationStyle: "popover" });
    } catch (e) {
      setError("Could not start sign in. Try again.");
      setSigningIn(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setSigningIn(true);
    setError("");
    if (isNative()) {
      await signInNative();
    } else {
      await signInWeb();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-400">Loading…</p>
      </div>
    );
  }

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

      <p className="text-center text-xs text-gray-400 mt-4">
        Your data syncs across all your devices
      </p>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><p className="text-gray-400">Loading…</p></div>}>
      <HomeContent />
    </Suspense>
  );
}