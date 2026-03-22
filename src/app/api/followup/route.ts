
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
export async function POST(req: NextRequest) {
  try {
    const {mode,text,base64,mimeType} = await req.json();
    const imgBlock = base64 && mimeType ? [{type:"image" as const,source:{type:"base64" as const,media_type:mimeType as "image/jpeg"|"image/png"|"image/gif"|"image/webp",data:base64}}] : [];
    const hasImage = imgBlock.length > 0;
    const hasText = text && text.trim().length > 0;
    let desc = "";
    if (hasImage && hasText) desc = `User provided a photo and described: "${text}"`;
    else if (hasImage) desc = mode==="label" ? "Nutrition label photo." : "Meal photo.";
    else desc = `User described: "${text}"`;
    const prompt = `${desc}\nDo you need one clarifying question to significantly improve the nutrition estimate? Only ask if portion size or preparation method is genuinely unclear and would meaningfully change the estimate.\nJSON only:\nAsk: {"needsClarification":true,"question":"...","options":["a","b","c","d"]}\nNo: {"needsClarification":false}`;
    const response = await client.messages.create({
      model:"claude-sonnet-4-20250514",max_tokens:300,
      messages:[{role:"user",content:[...imgBlock,{type:"text",text:prompt}]}],
    });
    const raw = response.content.filter(b=>b.type==="text").map(b=>(b as {type:"text";text:string}).text).join("");
    const match = raw.replace(/```json|```/g,"").trim().match(/\{[\s\S]*\}/);
    if(!match) return NextResponse.json({needsClarification:false});
    return NextResponse.json(JSON.parse(match[0]));
  } catch { return NextResponse.json({needsClarification:false}); }
}