import Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const PRICE_IDS: Record<string, string> = {
  monthly: process.env.STRIPE_PRICE_MONTHLY ?? "",
  yearly: process.env.STRIPE_PRICE_YEARLY ?? "",
};

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  try {
    const { plan, profileId } = await req.json();

    if (!plan || !profileId) {
      return NextResponse.json({ error: "Missing plan or profileId" }, { status: 400 });
    }

    const priceId = PRICE_IDS[plan];
    if (!priceId) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    const supabase = getSupabase();

    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id, name")
      .eq("id", profileId)
      .single();

    let customerId = profile?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: profile?.name ?? "NutriSnap User",
        metadata: { profile_id: profileId },
      });
      customerId = customer.id;
      await supabase.from("profiles").update({ stripe_customer_id: customerId }).eq("id", profileId);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/${profileId}?upgraded=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/${profileId}`,
      metadata: { profile_id: profileId },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Checkout error:", err);
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}