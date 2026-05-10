import { NextRequest, NextResponse } from "next/server";
import { extractBearerToken, verifyPrivyToken } from "../../../../lib/ai/auth";
import { getMerchantByOwner, getMerchantById, verifyOwnership } from "../../../../lib/ai/guards";
import { getServiceClient } from "../../../../lib/ai/supabase-service";

export async function GET(req: NextRequest) {
  try {
    const token = extractBearerToken(req.headers.get("authorization"));
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { sub } = await verifyPrivyToken(token);

    const businessId = req.nextUrl.searchParams.get("businessId");
    let merchant;
    if (businessId) {
      merchant = await getMerchantById(businessId);
      if (!merchant) return NextResponse.json({ error: "Not found" }, { status: 404 });
      verifyOwnership(merchant, sub);
    } else {
      merchant = await getMerchantByOwner(sub);
      if (!merchant) return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const limit = Math.min(
      parseInt(req.nextUrl.searchParams.get("limit") || "50", 10),
      100
    );
    const channel = req.nextUrl.searchParams.get("channel");

    const sb = getServiceClient();
    let query = sb
      .from("ai_agent_conversations")
      .select("id, channel, started_at, ended_at, customer_identifier, outcome, cost_cents")
      .eq("business_id", merchant.id)
      .order("started_at", { ascending: false })
      .limit(limit);

    if (channel && ["voice", "sms", "web"].includes(channel)) {
      query = query.eq("channel", channel);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    return NextResponse.json({ conversations: data || [] });
  } catch (err: any) {
    if (err.message === "FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
