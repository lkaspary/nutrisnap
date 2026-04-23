import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${origin}/?error=no_code`);
  }

  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: sessionData, error: sessionError } = await anonClient.auth.exchangeCodeForSession(code);
  if (sessionError || !sessionData.user) {
    return NextResponse.redirect(`${origin}/?error=auth_failed`);
  }

  const user = sessionData.user;
  const supabase = getSupabase();

  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (existingProfile) {
    return NextResponse.redirect(`${origin}/${existingProfile.id}`);
  }

  const name = user.user_metadata?.full_name ?? user.email?.split("@")[0] ?? "User";
  const photoUrl = user.user_metadata?.avatar_url ?? null;

  const { data: newProfile, error: profileError } = await supabase
    .from("profiles")
    .insert({
      user_id: user.id,
      name,
      avatar: photoUrl ? "" : "🧑",
      avatar_bg: "#EEEDFE",
      photo_url: photoUrl,
    })
    .select("id")
    .single();

  if (profileError || !newProfile) {
    return NextResponse.redirect(`${origin}/?error=profile_failed`);
  }

  return NextResponse.redirect(`${origin}/${newProfile.id}`);
}