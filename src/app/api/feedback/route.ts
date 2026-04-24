import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { message, profileName } = await req.json();
    if (!message?.trim()) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const to = process.env.FEEDBACK_EMAIL!;
    const subject = `Caloriq Feedback from ${profileName ?? "a user"}`;
    const body = `Message:\n\n${message}\n\nFrom: ${profileName ?? "Unknown user"}\nSent via Caloriq app`;

    // Send via mailto API using fetch to a simple email service
    // Using Resend if available, otherwise log to console for now
    const resendKey = process.env.RESEND_API_KEY;
    
    if (resendKey) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${resendKey}`,
        },
        body: JSON.stringify({
          from: "Caloriq Feedback <onboarding@resend.dev>",
          to: [to],
          subject,
          text: body,
        }),
      });
    } else {
      // Fallback: log to Vercel logs if no email provider
      console.log("FEEDBACK RECEIVED:", { subject, body });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Feedback error:", err);
    return NextResponse.json({ error: "Failed to send" }, { status: 500 });
  }
}