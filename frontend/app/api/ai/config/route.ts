import { NextRequest, NextResponse } from "next/server";
import { extractBearerToken, verifyPrivyToken } from "../../../../lib/ai/auth";
import { getMerchantByOwner, getMerchantById, verifyOwnership } from "../../../../lib/ai/guards";
import { getServiceClient } from "../../../../lib/ai/supabase-service";
import { validateConfig } from "../../../../lib/ai/config";

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

    return NextResponse.json({
      config: merchant.ai_agent_config,
      enabled: merchant.ai_agent_enabled,
      plan: merchant.ai_agent_plan,
      status: merchant.ai_agent_status,
    });
  } catch (err: any) {
    if (err.message === "FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const token = extractBearerToken(req.headers.get("authorization"));
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { sub } = await verifyPrivyToken(token);
    const body = await req.json();

    const businessId = body.businessId;
    let merchant;
    if (businessId) {
      merchant = await getMerchantById(businessId);
      if (!merchant) return NextResponse.json({ error: "Not found" }, { status: 404 });
      verifyOwnership(merchant, sub);
    } else {
      merchant = await getMerchantByOwner(sub);
      if (!merchant) return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const result = validateConfig(body.config);
    if (!result.valid) {
      return NextResponse.json({ error: "Validation failed", errors: result.errors }, { status: 422 });
    }

    const sb = getServiceClient();
    await sb
      .from("merchants")
      .update({ ai_agent_config: result.config })
      .eq("id", merchant.id);

    return NextResponse.json({ config: result.config, saved: true });
  } catch (err: any) {
    if (err.message === "FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
