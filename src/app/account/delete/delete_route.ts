import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email) return NextResponse.json({ error: "Email required" }, { status: 400 });

    const supabase = getSupabase();

    // Find the auth user by email
    const { data: { users }, error: userError } = await supabase.auth.admin.listUsers();
    if (userError) throw userError;

    const authUser = users.find(u => u.email?.toLowerCase() === email.toLowerCase());

    if (!authUser) {
      // No auth user found - check if there's a profile with this email anyway
      return NextResponse.json({ error: "No account found with that email address." }, { status: 404 });
    }

    // Get profile(s) linked to this user
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id")
      .eq("user_id", authUser.id);

    const profileIds = (profiles ?? []).map(p => p.id);

    // Delete in order (cascade should handle most, but be explicit)
    if (profileIds.length > 0) {
      await supabase.from("day_confirmed").delete().in("profile_id", profileIds);
      await supabase.from("usage").delete().in("profile_id", profileIds);
      await supabase.from("meals").delete().in("profile_id", profileIds);
      await supabase.from("profiles").delete().in("id", profileIds);
    }

    // Delete the auth user
    await supabase.auth.admin.deleteUser(authUser.id);

    console.log(`Account deleted for: ${email}`);
    return NextResponse.json({ success: true });

  } catch (err) {
    console.error("Delete account error:", err);
    return NextResponse.json({ error: "Failed to delete account. Please contact support." }, { status: 500 });
  }
}