import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
export async function POST(req: NextRequest) {
  try {
    const {mode,text,base64,mimeType} = await req.json();
    const imgBlock = base64?[{type:"image" as const,source:{type:"base64" as const,media_type:mimeType,data:base64}}]:[];
    const desc = mode==="text"?`User described: "${text}"`:mode==="label"?"Nutrition label photo.":"Meal photo.";
    const prompt = `${desc}\nNeed one clarifying question to improve estimate? Only ask if portion/prep is genuinely unclear.\nJSON only:\nAsk: {"needsClarification":true,"question":"...","options":["a","b","c","d"]}\nNo: {"needsClarification":false}`;
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
