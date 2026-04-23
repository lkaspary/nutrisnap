"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) {
        router.push("/?error=auth_failed");
        return;
      }

      const user = session.user;

      // Check if profile already exists
      const { data: existingProfile } = await supabase
        .from("profiles")
        .select("id")
        .eq("user_id", user.id)
        .single();

      if (existingProfile) {
        router.push(`/${existingProfile.id}`);
        return;
      }

      // Create new profile from Google data
      const name = user.user_metadata?.full_name ?? user.email?.split("@")[0] ?? "User";
      const photoUrl = user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? null;

      const { data: newProfile, error } = await supabase
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

      if (error || !newProfile) {
        router.push("/?error=profile_failed");
        return;
      }

      router.push(`/${newProfile.id}`);
    });
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <p className="text-gray-400">Signing you in…</p>
    </div>
  );
}