import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
export async function POST(req: NextRequest) {
  try {
    const {mode,text,base64,mimeType,clarification} = await req.json();
    const imgBlock = base64?[{type:"image" as const,source:{type:"base64" as const,media_type:mimeType,data:base64}}]:[];
    const clarNote = clarification?`\nUser clarified: "${clarification}"`:"";
    const prompts: Record<string,string> = {
      label:`Read this nutrition label per serving. Always estimate if unclear.\nJSON only: {"name":"...","calories":N,"carbs":N,"fat":N,"protein":N,"servingSize":"...","confidence":"high","notes":"...","source":"nutrition label"}`,
      text:`Food: "${text}"${clarNote}\nSearch web, then estimate. Always return a result.\nJSON only: {"name":"...","calories":N,"carbs":N,"fat":N,"protein":N,"confidence":"low|medium|high","notes":"...","source":"web search"}`,
      meal:`Analyze meal photo.${clarNote} Always estimate.\nJSON only: {"name":"...","calories":N,"carbs":N,"fat":N,"protein":N,"confidence":"low|medium|high","notes":"...","source":"photo analysis"}`,
    };
    const tools = mode==="text"?[{type:"web_search_20250305" as const,name:"web_search" as const}]:undefined;
    const response = await client.messages.create({
      model:"claude-sonnet-4-20250514",max_tokens:1000,tools,
      messages:[{role:"user",content:[...imgBlock,{type:"text",text:prompts[mode]??prompts.meal}]}],
    });
    const out = response.content.filter(b=>b.type==="text").map(b=>(b as {type:"text";text:string}).text).join("");
    const match = out.replace(/```json|```/g,"").trim().match(/\{[\s\S]*\}/);
    if(!match) return NextResponse.json({error:"No JSON"},{status:500});
    return NextResponse.json(JSON.parse(match[0]));
  } catch(e) {
    return NextResponse.json({error:e instanceof Error?e.message:"Error"},{status:500});
  }
}
