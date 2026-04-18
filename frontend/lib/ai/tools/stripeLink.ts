import Stripe from "stripe";
import { getServiceClient } from "../supabase-service";
import type { Merchant } from "../guards";

type Input = {
  business_id: string;
  idempotency_key: string;
  service_id: string;
  quantity: number;
  customer_phone_e164?: string;
  customer_email?: string;
  metadata?: Record<string, string>;
};

type ToolOk = { ok: true; data: { url: string; expires_at: string; session_id: string } };
type ToolErr = { ok: false; error: { code: string; message: string } };
type ToolResult = ToolOk | ToolErr;

function err(code: string, message: string): ToolErr {
  return { ok: false, error: { code, message } };
}

export async function createStripeCheckoutLink(
  merchant: Merchant,
  input: Input
): Promise<ToolResult> {
  const config = merchant.ai_agent_config;

  if (!config?.tools?.stripe_link?.enabled) {
    return err("SERVICE_INACTIVE", "Stripe link tool is disabled");
  }

  const services: Array<Record<string, any>> = config.scope?.services || [];
  const service = services.find((s) => s.id === input.service_id);
  if (!service) {
    return err("UNKNOWN_SERVICE", `Service '${input.service_id}' not found`);
  }

  const sb = getServiceClient();

  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count } = await sb
    .from("ai_agent_conversations")
    .select("id", { count: "exact", head: true })
    .eq("business_id", input.business_id)
    .gte("started_at", tenMinAgo);
  if ((count || 0) > 20) {
    return err("RATE_LIMITED", "Too many checkout sessions");
  }

  const { data: merchantRow } = await sb
    .from("merchants")
    .select("stripe_connect_id")
    .eq("id", input.business_id)
    .single();

  const connectId = merchantRow?.stripe_connect_id;

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

    const lineItem = service.stripe_price_id
      ? { price: service.stripe_price_id, quantity: input.quantity }
      : {
          price_data: {
            currency: config.tools.stripe_link.currency || "usd",
            unit_amount: service.price_cents,
            product_data: { name: service.name },
          },
          quantity: input.quantity,
        };

    const createParams: Record<string, unknown> = {
      mode: "payment",
      line_items: [lineItem],
      success_url: config.tools.stripe_link.success_url || "https://dum.club/orders?checkout=success",
      cancel_url: config.tools.stripe_link.cancel_url || "https://dum.club?checkout=cancelled",
      metadata: {
        business_id: input.business_id,
        service_id: input.service_id,
        source: "ai_agent",
        ...input.metadata,
      },
    };

    if (input.customer_email) {
      createParams.customer_email = input.customer_email;
    }

    const requestOpts: Record<string, string> = {
      idempotencyKey: input.idempotency_key,
    };
    if (connectId) {
      requestOpts.stripeAccount = connectId;
    }

    // Stripe SDK typing varies across major versions; we pass validated
    // params and let the runtime handle it.
    const session = await (stripe.checkout.sessions.create as Function)(createParams, requestOpts);

    const url: string = session.url ?? "";
    const expiresAt = session.expires_at
      ? new Date(session.expires_at * 1000).toISOString()
      : new Date(Date.now() + 30 * 60 * 1000).toISOString();

    if (!url) {
      return err("STRIPE_ERROR", "Stripe returned no checkout URL");
    }

    return {
      ok: true,
      data: { url, expires_at: expiresAt, session_id: session.id },
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown Stripe error";
    return err("STRIPE_ERROR", message);
  }
}
