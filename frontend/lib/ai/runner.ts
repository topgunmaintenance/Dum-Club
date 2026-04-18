import { getServiceClient } from "./supabase-service";
import { getMerchantById, requireAgentActive, type Merchant } from "./guards";
import { createStripeCheckoutLink } from "./tools/stripeLink";
import { sendSms } from "./tools/sendSms";
import { createBooking } from "./tools/createBooking";

type ToolResult =
  | { ok: true; data: any }
  | { ok: false; error: { code: string; message: string } };

const TOOL_HANDLERS: Record<
  string,
  (merchant: Merchant, input: any) => Promise<ToolResult>
> = {
  create_stripe_checkout_link: createStripeCheckoutLink,
  send_sms: sendSms,
  create_booking: createBooking,
};

export async function toolRunner(
  businessId: string,
  toolName: string,
  input: Record<string, any>,
  conversationId?: string
): Promise<ToolResult> {
  const merchant = await getMerchantById(businessId);
  if (!merchant) {
    return { ok: false, error: { code: "SERVICE_INACTIVE", message: "Business not found" } };
  }

  try {
    requireAgentActive(merchant);
  } catch {
    return { ok: false, error: { code: "SERVICE_INACTIVE", message: "AI agent is inactive" } };
  }

  const handler = TOOL_HANDLERS[toolName];
  if (!handler) {
    return { ok: false, error: { code: "UNKNOWN_TOOL", message: `Unknown tool: ${toolName}` } };
  }

  const idempotencyKey = input.idempotency_key || crypto.randomUUID();
  const fullInput = { ...input, business_id: businessId, idempotency_key: idempotencyKey };

  // Check idempotency: if this key was already used, return the cached result
  const sb = getServiceClient();
  const { data: existing } = await sb
    .from("ai_agent_idempotency")
    .select("result")
    .eq("business_id", businessId)
    .eq("tool_name", toolName)
    .eq("idempotency_key", idempotencyKey)
    .limit(1)
    .single();

  if (existing?.result) {
    return existing.result;
  }

  const result = await handler(merchant, fullInput);

  // Persist idempotency record (unique index prevents duplicates)
  try {
    await sb.from("ai_agent_idempotency").insert({
      business_id: businessId,
      tool_name: toolName,
      idempotency_key: idempotencyKey,
      result: JSON.parse(JSON.stringify(result)),
    });
  } catch {
    // Duplicate key = concurrent call with same key, safe to ignore
  }

  // Audit log: append tool call to conversation if we have one
  if (conversationId) {
    try {
      const { data: conv } = await sb
        .from("ai_agent_conversations")
        .select("tool_calls")
        .eq("id", conversationId)
        .eq("business_id", businessId)
        .single();

      if (conv) {
        const calls = Array.isArray(conv.tool_calls) ? conv.tool_calls : [];
        calls.push({
          tool: toolName,
          input: fullInput,
          result: JSON.parse(JSON.stringify(result)),
          at: new Date().toISOString(),
        });
        await sb
          .from("ai_agent_conversations")
          .update({ tool_calls: calls })
          .eq("id", conversationId)
          .eq("business_id", businessId);
      }
    } catch {
      // Audit logging is non-fatal
    }
  }

  return result;
}
