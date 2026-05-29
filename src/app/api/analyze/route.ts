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

    // ── #25: Weekly insights mode (no usage count deduction) ─────────────────
    if (mode === "insights") {
      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 400,
        messages: [{ role: "user", content: text }],
      });
      const insights = response.content
        .filter(b => b.type === "text")
        .map(b => (b as { type: "text"; text: string }).text)
        .join("");
      return NextResponse.json({ insights });
    }

    // ── #17: Check OpenFoodFacts first for text mode ─────────────────────────
    if (mode === "text" && text && text.trim().length > 2 && !clarification) {
      try {
        const offRes = await fetch(
          `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(text.trim())}&search_simple=1&action=process&json=1&page_size=3&fields=product_name,brands,nutriments,serving_size`,
          { signal: AbortSignal.timeout(3000) }
        );
        const offData = await offRes.json();
        const product = (offData.products ?? []).find((p: any) =>
          p.product_name && p.nutriments?.["energy-kcal_100g"] !== undefined
        );
        if (product) {
          const n = product.nutriments;
          return NextResponse.json({
            name: `${product.brands ? product.brands + " " : ""}${product.product_name}`.trim(),
            calories: Math.round(n["energy-kcal_100g"] ?? 0),
            protein: Math.round(n["proteins_100g"] ?? 0),
            carbs: Math.round(n["carbohydrates_100g"] ?? 0),
            fat: Math.round(n["fat_100g"] ?? 0),
            serving_size: product.serving_size ?? "per 100g",
            confidence: "high",
            source: "openfoodfacts",
          });
        }
      } catch {
        // OpenFoodFacts failed or timed out — fall through to AI
      }
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
      // Step 1: Extract product name from label to check OpenFoodFacts
      if (hasImage) {
        try {
          const namePrompt = `Look at this nutrition label image. What is the product name and brand? Reply with ONLY this JSON, nothing else: {"name":"brand and product name"}`;
          const nameResponse = await client.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 100,
            messages: [{ role: "user", content: [...imgBlock, { type: "text" as const, text: namePrompt }] }],
          });
          const nameText = nameResponse.content.filter(b => b.type === "text").map(b => (b as any).text).join("");
          const nameMatch = nameText.match(/\{[\s\S]*\}/);
          if (nameMatch) {
            const { name: productName } = JSON.parse(nameMatch[0]);
            if (productName && productName.length > 2) {
              const offRes = await fetch(
                `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(productName)}&search_simple=1&action=process&json=1&page_size=3&fields=product_name,brands,nutriments,serving_size`,
                { signal: AbortSignal.timeout(3000) }
              );
              const offData = await offRes.json();
              const product = (offData.products ?? []).find((p: any) =>
                p.product_name && p.nutriments?.["energy-kcal_100g"] !== undefined
              );
              if (product) {
                const n = product.nutriments;
                return NextResponse.json({
                  name: `${product.brands ? product.brands + " " : ""}${product.product_name}`.trim(),
                  calories: Math.round(n["energy-kcal_100g"] ?? 0),
                  protein: Math.round(n["proteins_100g"] ?? 0),
                  carbs: Math.round(n["carbohydrates_100g"] ?? 0),
                  fat: Math.round(n["fat_100g"] ?? 0),
                  serving_size: product.serving_size ?? "per 100g",
                  confidence: "high",
                  source: "openfoodfacts",
                });
              }
            }
          }
        } catch {
          // Fall through to full label AI reading
        }
      }

      prompt = `You are an expert nutrition label reader with exceptional attention to detail.

TASK: Read the Nutrition Facts panel in this image and extract the EXACT printed values.

STEP 1 — Find the panel: Look for "Nutrition Facts" or "Informação Nutricional". It may be rotated, angled, partially cropped, or low contrast — still read it.

STEP 2 — Read these exact fields:
  • Serving Size / Porção (e.g. "1 cup 240ml", "28g", "2 biscoitos")
  • Calories / Calorias / Valor Energético (large bold number, per serving)
  • Total Fat / Gorduras Totais (grams)
  • Total Carbohydrate / Carboidratos Totais (grams)
  • Protein / Proteínas (grams)

STEP 3 — CRITICAL serving size logic (most common error):
  • Label shows per 100g AND per serving → use PER SERVING values
  • Label shows ONLY per 100g → calculate for the package weight shown
  • Small single-serve packages (bars, sachets, small bags) → values are often for the ENTIRE package
  • User says "2 servings" → multiply all values by 2
  • Energy in kJ only → divide by 4.184 to get kcal

STEP 4 — Sanity check before answering: (protein×4) + (carbs×4) + (fat×9) should roughly equal your calories. If off by more than 20%, re-read the label.

${hasText ? `User note: "${text}"${clarNote}` : clarNote}

IMPORTANT: Return ONLY numbers you can actually see printed. Do NOT invent or estimate values you cannot read. If truly illegible, use 0.

Respond with ONLY this JSON, nothing else:
{"name":"brand and product name","calories":N,"protein":N,"carbs":N,"fat":N,"serving_size":"exact serving text from label","confidence":"high","fiber":N,"sodium":N,"vitamin_c":N,"vitamin_d":N,"iron":N,"calcium":N}
Extended fields: fiber (g), sodium (mg), vitamin_c (mg), vitamin_d (mcg), iron (mg), calcium (mg) — read from label if present, otherwise 0.`;
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
{"name":"descriptive meal name","calories":N,"protein":N,"carbs":N,"fat":N,"serving_size":"full meal","confidence":"medium","fiber":N,"sodium":N,"vitamin_c":N,"vitamin_d":N,"iron":N,"calcium":N}
All extended fields (fiber g, sodium mg, vitamin_c mg, vitamin_d mcg, iron mg, calcium mg) are required — use 0 if unknown.`;
    } else if (mode === "text") {
      const imageHint = hasImage ? "\nThe user also provided a photo for additional context." : "";
      prompt = `You are a nutrition expert estimating nutritional content.
Food: "${text}"${imageHint}${clarNote}
Instructions:
- Use USDA data, restaurant info, or standard food databases
- If a brand or restaurant is mentioned, use their known data
- Always provide a complete estimate
You MUST respond with ONLY this JSON:
{"name":"food name","calories":N,"protein":N,"carbs":N,"fat":N,"serving_size":"...","confidence":"medium","fiber":N,"sodium":N,"vitamin_c":N,"vitamin_d":N,"iron":N,"calcium":N}
All extended fields (fiber g, sodium mg, vitamin_c mg, vitamin_d mcg, iron mg, calcium mg) are required — use 0 if unknown.`;
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

    // Pass extended fields through if present (fiber, sodium, vitamins)
    return NextResponse.json({
      name: parsed.name,
      calories: parsed.calories,
      protein: parsed.protein,
      carbs: parsed.carbs,
      fat: parsed.fat,
      serving_size: parsed.serving_size,
      confidence: parsed.confidence,
      source: parsed.source,
      fiber: parsed.fiber ?? null,
      sodium: parsed.sodium ?? null,
      vitamin_c: parsed.vitamin_c ?? null,
      vitamin_d: parsed.vitamin_d ?? null,
      iron: parsed.iron ?? null,
      calcium: parsed.calcium ?? null,
    });
  } catch (e) {
    console.error("Analyze error:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Analysis failed." }, { status: 500 });
  }
}