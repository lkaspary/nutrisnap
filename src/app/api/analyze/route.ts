import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const maxDuration = 60; // 60 second timeout (requires Vercel Pro for >10s)
export const dynamic = "force-dynamic";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const FREE_LIMIT = 5;

async function getSupabase() {
  const cookieStore = await cookies(); // ← await added
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (c) => c.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
      },
    }
  );
}

export async function POST(req: NextRequest) {
  try {
    const { mode, text, base64, mimeType, clarification, profileId } = await req.json();

    if (!profileId) {
      return NextResponse.json({ error: "Profile ID required." }, { status: 400 });
    }

    const supabase = await getSupabase();
    const today = new Date().toISOString().split("T")[0];

    // Check pro status
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_pro")
      .eq("id", profileId)
      .single();

    const isPro = profile?.is_pro ?? false;

    if (!isPro) {
      const { data: usage } = await supabase
        .from("usage")
        .select("ai_calls")
        .eq("profile_id", profileId)
        .eq("date", today)
        .single();

      const currentCalls = usage?.ai_calls ?? 0;

      if (currentCalls >= FREE_LIMIT) {
        return NextResponse.json({
          limitReached: true,  // ← matches what page.tsx checks
          usageCount: currentCalls,
          error: "FREE_LIMIT_REACHED",
          message: `You've used your ${FREE_LIMIT} free AI analyses today. Upgrade to Pro for unlimited!`,
          used: currentCalls,
          limit: FREE_LIMIT,
        }, { status: 429 });
      }

      await supabase.from("usage").upsert({
        profile_id: profileId,
        date: today,
        ai_calls: currentCalls + 1,
      }, { onConflict: "profile_id,date" });
    }

    // ── Run AI analysis ───────────────────────────────────────────────────────
    const imgBlock = base64 && mimeType ? [{
      type: "image" as const,
      source: { type: "base64" as const, media_type: mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: base64 }
    }] : [];
    const clarNote = clarification ? `\nThe user clarified: "${clarification}"` : "";
    const hasImage = imgBlock.length > 0;
    const hasText = text && text.trim().length > 0;

    let prompt = "";
    if (mode === "label") {
      prompt = `You are a nutrition expert reading a food label image.
${hasText ? `User note: "${text}"${clarNote}` : clarNote}
Instructions:
- Read exact values from the label if visible
- If unclear, estimate based on what you can see
- If user mentioned servings, multiply accordingly
- ALWAYS provide your best estimate
- Set confidence to "high" if clearly readable, "medium" if partially unclear
You MUST respond with ONLY this JSON:
{"name":"product name","calories":N,"protein":N,"carbs":N,"fat":N,"serving_size":"...","confidence":"high"}`;
    } else if (mode === "meal") {
      const textHint = hasText ? `\nThe user described the meal as: "${text}"` : "";
      prompt = `You are a nutrition expert estimating the nutritional content of a meal.
${hasImage ? "Analyze the meal photo carefully." : ""}${textHint}${clarNote}
Instructions:
- Identify every food item visible or described
- Estimate realistic portion sizes
- Calculate totals for the ENTIRE meal
- Always provide your best estimate
- Use both photo and description together for best accuracy
You MUST respond with ONLY this JSON:
{"name":"descriptive meal name","calories":N,"protein":N,"carbs":N,"fat":N,"serving_size":"full meal","confidence":"medium"}`;
    } else if (mode === "text") {
      const imageHint = hasImage ? "\nThe user also provided a photo for additional context." : "";
      prompt = `You are a nutrition expert estimating nutritional content.
Food: "${text}"${imageHint}${clarNote}
Instructions:
- Use USDA data, restaurant info, or standard food databases
- If a brand or restaurant is mentioned, use their known data
- Always provide a complete estimate
You MUST respond with ONLY this JSON:
{"name":"food name","calories":N,"protein":N,"carbs":N,"fat":N,"serving_size":"...","confidence":"medium"}`;
    } else {
      prompt = `You are a nutrition expert. Analyze this food and estimate its nutritional content.${clarNote}
Always provide your best estimate. Never refuse.
You MUST respond with ONLY this JSON:
{"name":"food name","calories":N,"protein":N,"carbs":N,"fat":N,"serving_size":"...","confidence":"medium"}`;
    }

    const content: Anthropic.MessageParam["content"] = [
      ...imgBlock,
      { type: "text" as const, text: prompt }
    ];

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content }],
    });

    const out = response.content
      .filter(b => b.type === "text")
      .map(b => (b as { type: "text"; text: string }).text)
      .join("");

    const cleaned = out.replace(/```json|```/g, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return NextResponse.json({ error: "Could not parse nutrition data." }, { status: 500 });

    const parsed = JSON.parse(match[0]);
    const required = ["name", "calories", "protein", "carbs", "fat"];
    const missing = required.filter(k => !(k in parsed));
    if (missing.length > 0) return NextResponse.json({ error: "Incomplete nutrition data." }, { status: 500 });

    return NextResponse.json(parsed);
  } catch (e) {
    console.error("Analyze error:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Analysis failed." }, { status: 500 });
  }
}