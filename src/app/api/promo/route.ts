import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Parse codes from env: "CODE:duration,CODE2:duration2"
// duration options: "lifetime", "1y", "6m", "3m", "1m"
function getCodes(): Record<string, string> {
  const raw = process.env.PROMO_CODES ?? "";
  const result: Record<string, string> = {};
  raw.split(",").forEach(entry => {
    const [code, duration] = entry.trim().split(":");
    if (code && duration) result[code.toUpperCase()] = duration;
  });
  return result;
}

function getExpiryDate(duration: string): string | null {
  if (duration === "lifetime") return null;
  const now = new Date();
  if (duration === "1y") now.setFullYear(now.getFullYear() + 1);
  else if (duration === "6m") now.setMonth(now.getMonth() + 6);
  else if (duration === "3m") now.setMonth(now.getMonth() + 3);
  else if (duration === "1m") now.setMonth(now.getMonth() + 1);
  return now.toISOString();
}

function durationLabel(duration: string): string {
  if (duration === "lifetime") return "lifetime";
  if (duration === "1y") return "1 year";
  if (duration === "6m") return "6 months";
  if (duration === "3m") return "3 months";
  if (duration === "1m") return "1 month";
  return duration;
}

export async function POST(req: NextRequest) {
  try {
    const { code, profileId } = await req.json();
    if (!code || !profileId) {
      return NextResponse.json({ error: "Missing code or profileId" }, { status: 400 });
    }

    const codes = getCodes();
    const duration = codes[code.toUpperCase().trim()];

    if (!duration) {
      return NextResponse.json({ error: "Invalid promo code" }, { status: 400 });
    }

    const expiresAt = getExpiryDate(duration);
    const supabase = getSupabase();

    const { error } = await supabase
      .from("profiles")
      .update({
        is_pro: true,
        pro_expires_at: expiresAt,
      })
      .eq("id", profileId);

    if (error) {
      console.error("Promo update error:", error);
      return NextResponse.json({ error: "Failed to apply code" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      duration: durationLabel(duration),
      lifetime: duration === "lifetime",
    });
  } catch (err) {
    console.error("Promo error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}