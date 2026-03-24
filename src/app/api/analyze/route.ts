import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const {mode,text,base64,mimeType,clarification} = await req.json();
    const imgBlock = base64 && mimeType ? [{
      type:"image" as const,
      source:{type:"base64" as const, media_type: mimeType as "image/jpeg"|"image/png"|"image/gif"|"image/webp", data:base64}
    }] : [];
    const clarNote = clarification ? `\nThe user clarified: "${clarification}"` : "";
    const hasImage = imgBlock.length > 0;
    const hasText = text && text.trim().length > 0;

    let prompt = "";

    if (mode === "label") {
      prompt = `You are a nutrition expert reading a food label image.

Your job is to extract nutritional values from this label. The user may have also added a text description for context.
${hasText ? `User note: "${text}"${clarNote}` : clarNote}

Instructions:
- Try to read the exact values from the label if visible
- If parts of the label are unclear or cut off, use reasonable estimates based on what you can see and the product type
- If the user mentioned a number of servings (e.g. "2 servings"), multiply the per-serving values accordingly
- ALWAYS provide your best estimate — never refuse or say you cannot read the label
- Use the product name if visible, otherwise describe the food type
- Set confidence to "high" if label is clearly readable, "medium" if partially unclear

You MUST respond with ONLY this JSON and nothing else:
{"name":"product name","calories":N,"protein":N,"carbs":N,"fat":N,"serving_size":"serving size from label","confidence":"high"}`;

    } else if (mode === "meal") {
      const textHint = hasText ? `\nThe user described the meal as: "${text}"` : "";
      prompt = `You are a nutrition expert estimating the nutritional content of a meal.
${hasImage ? "Analyze the meal photo carefully." : ""}${textHint}${clarNote}

Instructions:
- Identify every food item visible or described
- Estimate realistic portion sizes based on visual cues and typical servings
- Calculate totals for the ENTIRE meal
- Always provide your best estimate — never refuse
- When in doubt, use moderate/average portion assumptions
- If both a photo and description are provided, use both together for best accuracy

You MUST respond with ONLY this JSON and nothing else:
{"name":"descriptive meal name","calories":N,"protein":N,"carbs":N,"fat":N,"serving_size":"full meal","confidence":"medium"}`;

    } else if (mode === "text") {
      const imageHint = hasImage ? "\nThe user also provided a photo for additional context — use it to improve accuracy." : "";
      prompt = `You are a nutrition expert and registered dietitian estimating nutritional content.

Food: "${text}"${imageHint}${clarNote}

Instructions:
- Use USDA data, restaurant nutritional info, or standard food databases
- If a brand or restaurant is mentioned, use their known nutritional data
- Always provide a complete estimate — never refuse
- Use typical portion sizes unless the user specified otherwise

You MUST respond with ONLY this JSON and nothing else:
{"name":"food name","calories":N,"protein":N,"carbs":N,"fat":N,"serving_size":"serving description","confidence":"medium"}`;

    } else {
      prompt = `You are a nutrition expert. Analyze this food and estimate its full nutritional content.${clarNote}
Always provide your best estimate. Never refuse or say you cannot estimate.
You MUST respond with ONLY this JSON and nothing else:
{"name":"food name","calories":N,"protein":N,"carbs":N,"fat":N,"serving_size":"serving description","confidence":"medium"}`;
    }

    const content: Anthropic.MessageParam["content"] = [
      ...imgBlock,
      {type:"text" as const, text: prompt}
    ];

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{role:"user", content}],
    });

    const out = response.content
      .filter(b => b.type === "text")
      .map(b => (b as {type:"text"; text:string}).text)
      .join("");

    const cleaned = out.replace(/```json|```/g, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      console.error("No JSON in response:", out);
      return NextResponse.json({error: "Could not parse nutrition data. Please try again."}, {status: 500});
    }

    const parsed = JSON.parse(match[0]);

    // Validate required fields exist (use hasOwnProperty to allow 0 values)
    const required = ["name", "calories", "protein", "carbs", "fat"];
    const missing = required.filter(k => !(k in parsed));
    if (missing.length > 0) {
      console.error("Missing fields:", missing, parsed);
      return NextResponse.json({error: "Incomplete nutrition data. Please try again."}, {status: 500});
    }

    return NextResponse.json(parsed);
  } catch(e) {
    console.error("Analyze error:", e);
    return NextResponse.json({error: e instanceof Error ? e.message : "Analysis failed. Please try again."}, {status: 500});
  }
}