import Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// Lazily created so env vars are available at request time, not build time
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature")!;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    console.error("Webhook signature failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const profileId = (event.data.object as any).metadata?.profile_id;

  switch (event.type) {
    case "checkout.session.completed":
    case "invoice.paid": {
      const supabase = getSupabase();
      if (profileId) await supabase.from("profiles").update({ is_pro: true }).eq("id", profileId);
      break;
    }
    case "customer.subscription.deleted":
    case "invoice.payment_failed": {
      const supabase = getSupabase();
      if (profileId) await supabase.from("profiles").update({ is_pro: false }).eq("id", profileId);
      break;
    }
  }

  return NextResponse.json({ received: true });
}