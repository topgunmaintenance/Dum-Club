import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "../../../../../../lib/ai/supabase-service";
import { verifyTwilioSignature } from "../../../../../../lib/ai/twilio-verify";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const params: Record<string, string> = {};
  new URLSearchParams(body).forEach((v, k) => { params[k] = v; });

  if (!verifyTwilioSignature(req, params)) {
    console.warn("[twilio/voice] Invalid signature — rejecting request");
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const to = params.To || "";
  const from = params.From || "";

  if (!to) {
    return twimlResponse(
      "<Say>We're sorry, something went wrong. Please try again later.</Say>"
    );
  }

  const sb = getServiceClient();

  const { data: phoneRow } = await sb
    .from("ai_agent_phone_numbers")
    .select("business_id")
    .eq("e164", to)
    .is("released_at", null)
    .limit(1)
    .single();

  if (!phoneRow) {
    return twimlResponse(
      "<Say>This number is not currently in service. Please visit dum.club for more information.</Say>"
    );
  }

  const { data: merchant } = await sb
    .from("merchants")
    .select("id, business_name, ai_agent_enabled, ai_agent_status, ai_agent_config")
    .eq("id", phoneRow.business_id)
    .single();

  if (!merchant || !merchant.ai_agent_enabled || merchant.ai_agent_status !== "active") {
    return twimlResponse(
      "<Say>Our AI assistant is currently unavailable. Please leave a message after the beep, or visit our website.</Say><Record maxLength=\"120\" />"
    );
  }

  const config = merchant.ai_agent_config || {};
  const greeting =
    config.channels?.voice?.greeting ||
    `Hi, thanks for calling ${merchant.business_name}. How can I help you today?`;

  await sb.from("ai_agent_conversations").insert({
    business_id: merchant.id,
    channel: "voice",
    customer_identifier: from || "unknown",
    transcript: [{ role: "system", content: "Inbound voice call", at: new Date().toISOString() }],
  });

  return twimlResponse(
    `<Say>${escapeXml(greeting)}</Say><Pause length="1" /><Say>I'm connecting you now. Please hold.</Say><Record maxLength="300" playBeep="true" />`
  );
}

function twimlResponse(body: string): NextResponse {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
  return new NextResponse(xml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
