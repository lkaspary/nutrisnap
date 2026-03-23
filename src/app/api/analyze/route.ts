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
      prompt = `You are a nutrition expert reading a food label. Look carefully at this nutrition facts label image.

Extract the EXACT values shown on the label per ONE serving.
${hasText ? `The user added this note: "${text}"${clarNote}` : clarNote}

Rules:
- Read the label precisely — do not estimate, use the exact printed numbers
- If the user mentioned a number of servings, multiply accordingly
- The name should be the product name visible on the label
- confidence should be "high" since this is a label reading

Respond with ONLY this JSON, no other text:
{"name":"product name","calories":N,"protein":N,"carbs":N,"fat":N,"serving_size":"Xg or X cups etc","confidence":"high"}`;

    } else if (mode === "meal") {
      const textHint = hasText ? `\nThe user described the meal as: "${text}"` : "";
      prompt = `You are a nutrition expert and dietitian estimating the nutritional content of a meal.
${hasImage ? "Carefully analyze the meal photo." : ""}${textHint}${clarNote}

Instructions:
- Identify every food item visible
- Estimate portion sizes based on typical serving sizes and visual cues
- Calculate total calories and macros for the ENTIRE meal shown
- Be realistic — do not over or underestimate
- You MUST always provide your best estimate, never refuse
- If unsure, use common restaurant or home-cooked portion assumptions

Respond with ONLY this JSON, no other text:
{"name":"descriptive meal name","calories":N,"protein":N,"carbs":N,"fat":N,"serving_size":"1 plate / full meal","confidence":"medium"}`;

    } else if (mode === "text") {
      const imageHint = hasImage ? "\nThe user also provided a photo of the food for additional context." : "";
      prompt = `You are a nutrition expert and registered dietitian. Estimate the nutritional content of this food.

Food description: "${text}"${imageHint}${clarNote}

Instructions:
- Use your knowledge of standard serving sizes and nutritional databases (USDA, restaurant data)
- If a specific brand or restaurant is mentioned, use their actual nutritional data
- Be accurate and realistic — use typical portion sizes unless specified
- Always provide a complete estimate, never refuse or say you can't estimate
- For restaurant foods, use the standard menu item nutritional data

Respond with ONLY this JSON, no other text:
{"name":"food name","calories":N,"protein":N,"carbs":N,"fat":N,"serving_size":"standard serving description","confidence":"medium"}`;

    } else {
      prompt = `You are a nutrition expert. Analyze this food and estimate its nutritional content.${clarNote}
Always provide your best estimate. Never refuse.
Respond with ONLY this JSON:
{"name":"food name","calories":N,"protein":N,"carbs":N,"fat":N,"serving_size":"...","confidence":"medium"}`;
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

    // Try to extract JSON from the response
    const cleaned = out.replace(/```json|```/g, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      console.error("No JSON in response:", out);
      return NextResponse.json({error: "Could not parse nutrition data. Please try again."}, {status: 500});
    }

    const parsed = JSON.parse(match[0]);

    // Validate required fields
    if (!parsed.calories || !parsed.protein || !parsed.carbs || !parsed.fat) {
      return NextResponse.json({error: "Incomplete nutrition data returned. Please try again."}, {status: 500});
    }

    return NextResponse.json(parsed);
  } catch(e) {
    console.error("Analyze error:", e);
    return NextResponse.json({error: e instanceof Error ? e.message : "Analysis failed. Please try again."}, {status: 500});
  }
}