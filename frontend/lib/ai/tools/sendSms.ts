import { getServiceClient } from "../supabase-service";
import type { Merchant } from "../guards";

type Input = {
  business_id: string;
  idempotency_key: string;
  to_e164: string;
  body: string;
  kind: "checkout_link" | "confirmation" | "callback" | "after_hours";
  consent_captured: boolean;
};

type Output = { message_sid: string; status: string; segments: number };

const URL_ALLOWLIST = ["checkout.stripe.com", "dum.club", "www.dum.club"];

export async function sendSms(
  merchant: Merchant,
  input: Input
): Promise<{ ok: true; data: Output } | { ok: false; error: { code: string; message: string } }> {
  const config = merchant.ai_agent_config;

  if (!config?.tools?.sms?.enabled) {
    return { ok: false, error: { code: "SERVICE_INACTIVE", message: "SMS tool is disabled" } };
  }

  if (!input.consent_captured) {
    return { ok: false, error: { code: "NO_CONSENT", message: "Customer consent required before first SMS" } };
  }

  if (input.body.length > 480) {
    return { ok: false, error: { code: "BODY_TOO_LONG", message: "SMS body exceeds 480 chars" } };
  }

  // Validate E.164 format
  if (!/^\+[1-9]\d{6,14}$/.test(input.to_e164)) {
    return { ok: false, error: { code: "INVALID_NUMBER", message: "Invalid E.164 phone number" } };
  }

  // Strip disallowed URLs from body
  const urlRegex = /https?:\/\/[^\s]+/g;
  const urls = input.body.match(urlRegex) || [];
  for (const url of urls) {
    const hostname = new URL(url).hostname;
    if (!URL_ALLOWLIST.some((allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`))) {
      return { ok: false, error: { code: "DISALLOWED_URL", message: `URL not allowed: ${hostname}` } };
    }
  }

  // Look up merchant's assigned phone number
  const sb = getServiceClient();
  const { data: phoneRow } = await sb
    .from("ai_agent_phone_numbers")
    .select("e164")
    .eq("business_id", input.business_id)
    .is("released_at", null)
    .limit(1)
    .single();

  if (!phoneRow) {
    return { ok: false, error: { code: "SERVICE_INACTIVE", message: "No phone number provisioned" } };
  }

  // Enforce daily send cap
  const dailyCap = config.tools.sms.daily_send_cap ?? 200;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { count } = await sb
    .from("ai_agent_conversations")
    .select("id", { count: "exact", head: true })
    .eq("business_id", input.business_id)
    .eq("channel", "sms")
    .gte("started_at", todayStart.toISOString());
  if ((count || 0) >= dailyCap) {
    return { ok: false, error: { code: "DAILY_CAP_EXCEEDED", message: `Daily SMS cap (${dailyCap}) reached` } };
  }

  // Send via Twilio
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    return { ok: false, error: { code: "TWILIO_ERROR", message: "Twilio not configured" } };
  }

  try {
    const twilio = (await import("twilio")).default;
    const client = twilio(accountSid, authToken);
    const message = await client.messages.create({
      to: input.to_e164,
      from: phoneRow.e164,
      body: input.body,
    });

    return {
      ok: true,
      data: {
        message_sid: message.sid,
        status: message.status,
        segments: message.numSegments ? parseInt(message.numSegments, 10) : 1,
      },
    };
  } catch (err: any) {
    return { ok: false, error: { code: "TWILIO_ERROR", message: err.message } };
  }
}
