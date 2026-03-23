import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
export async function POST(req: NextRequest) {
  try {
    const {mode,text,base64,mimeType,clarification} = await req.json();
    const imgBlock = base64 && mimeType ? [{type:"image" as const,source:{type:"base64" as const,media_type:mimeType as "image/jpeg"|"image/png"|"image/gif"|"image/webp",data:base64}}] : [];
    const clarNote = clarification ? `\nUser clarified: "${clarification}"` : "";
    const hasImage = imgBlock.length > 0;
    const hasText = text && text.trim().length > 0;

    let prompt = "";
    if (mode === "label") {
      prompt = `Read this nutrition label carefully. Extract exact values per serving.${clarNote}\nJSON only: {"name":"...","calories":N,"protein":N,"carbs":N,"fat":N,"sodium":N,"serving_size":"...","confidence":"high"}`;
    } else if (mode === "meal") {
      const textHint = hasText ? `\nUser also described it as: "${text}"` : "";
      prompt = `Analyze this meal photo and estimate nutrition.${textHint}${clarNote} Always provide your best estimate.\nJSON only: {"name":"...","calories":N,"protein":N,"carbs":N,"fat":N,"sodium":N,"serving_size":"1 plate","confidence":"medium"}`;
    } else if (mode === "text") {
      const imageHint = hasImage ? "\nUser also provided a photo of the food." : "";
      prompt = `Food: "${text}"${imageHint}${clarNote}\nEstimate nutrition accurately. Always return a result.\nJSON only: {"name":"...","calories":N,"protein":N,"carbs":N,"fat":N,"sodium":N,"serving_size":"...","confidence":"medium"}`;
    } else {
      // fallback: use whatever we have
      prompt = `Analyze this food and estimate nutrition.${clarNote} Always provide your best estimate.\nJSON only: {"name":"...","calories":N,"protein":N,"carbs":N,"fat":N,"sodium":N,"serving_size":"...","confidence":"medium"}`;
    }

    const content: Anthropic.MessageParam["content"] = [...imgBlock, {type:"text" as const, text:prompt}];
    const response = await client.messages.create({
      model:"claude-sonnet-4-20250514",
      max_tokens:1000,
      messages:[{role:"user", content}],
    });
    const out = response.content.filter(b=>b.type==="text").map(b=>(b as {type:"text";text:string}).text).join("");
    const match = out.replace(/```json|```/g,"").trim().match(/\{[\s\S]*\}/);
    if(!match) return NextResponse.json({error:"No JSON"},{status:500});
    const parsed = JSON.parse(match[0]);
    // ensure sodium exists (default 0 if not returned)
    if (parsed.sodium === undefined) parsed.sodium = 0;
    return NextResponse.json(parsed);
  } catch(e) {
    console.error("Analyze error:", e);
    return NextResponse.json({error:e instanceof Error?e.message:"Error"},{status:500});
  }
}