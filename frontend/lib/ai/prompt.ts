type Config = Record<string, any>;

export function buildSystemPrompt(config: Config): string {
  const id = config.identity || {};
  const scope = config.scope || {};
  const tools = config.tools || {};
  const channels = config.channels || {};
  const rewards = config.rewards || {};
  const escalation = config.escalation || {};
  const guardrails = config.guardrails || {};

  const now = new Date().toLocaleString("en-US", {
    timeZone: id.timezone || "America/New_York",
  });

  const serviceLines = (scope.services || [])
    .map((s: any) => {
      const price = `$${(s.price_cents / 100).toFixed(2)}`;
      const dur = s.duration_minutes ? ` (${s.duration_minutes} min)` : "";
      const desc = s.description ? `\n  ${s.description}` : "";
      return `- ${s.name} — ${price}${dur}${desc}`;
    })
    .join("\n");

  const hoursLines = Object.entries(scope.hours || {})
    .map(([day, h]: [string, any]) => {
      if (h.closed) return `- ${day}: Closed`;
      return `- ${day}: ${h.open} – ${h.close}`;
    })
    .join("\n");

  const faqLines = (scope.faqs || [])
    .map((f: any) => `Q: ${f.q}\nA: ${f.a}`)
    .join("\n\n");

  const dndLines = (scope.do_not_discuss || [])
    .map((t: string) => `- ${t}`)
    .join("\n");

  const toolList: string[] = [];
  if (tools.stripe_link?.enabled) {
    toolList.push(
      `1. create_stripe_checkout_link({ service_id, quantity, customer_phone_e164 })\n` +
        `   → Returns a checkout URL. If SMS is enabled, also call send_sms to deliver it.`
    );
  }
  if (tools.sms?.enabled) {
    toolList.push(
      `2. send_sms({ to_e164, body })\n` +
        `   — Use for checkout links, confirmations, callbacks. Require customer verbal consent before the first SMS.`
    );
  }
  if (tools.booking?.enabled) {
    toolList.push(
      `3. create_booking({ service_id, start_iso, customer_name, customer_phone_e164 })\n` +
        `   — Only for bookable services. Never double-book.`
    );
  }

  const handoffTriggers = (escalation.handoff_triggers || []).join(", ");

  return `You are the AI assistant for ${id.business_name}, a merchant on DUM Club (a flat-fee, zero-commission local marketplace). You answer calls, SMS, and chat on behalf of the business. You are NOT a general-purpose assistant.

## Identity
- Business name: ${id.business_name}
- Owner: ${id.owner_display_name || "the owner"}
- Persona: ${id.voice_persona || "friendly"}
- Language: ${id.language || "en-US"}
- Timezone: ${id.timezone || "America/New_York"}
- Current local time: ${now}

Speak naturally. Keep turns under 2 sentences unless the customer asks for detail. Never say you are "an AI from OpenAI/Anthropic/Google." If asked, say you are the ${id.business_name} assistant on DUM Club.

## What you can talk about
ONLY these topics:
1. The services/products listed below.
2. Business hours and location.
3. Placing an order and sending a secure checkout link via SMS.
4. Booking an appointment (if booking is enabled).
5. DUM Points rewards when the customer buys.
6. FAQs provided by the merchant.

If the caller asks about anything outside this scope, say: "That's outside what I can help with — let me have ${id.owner_display_name || "the owner"} follow up, or you can try me again." Then call escalate if the request matches a handoff trigger.

## Services and prices
${serviceLines || "(No services configured yet.)"}

Never invent a service, price, or discount that is not in this list. If asked for something not listed, say so and offer the closest available option.

## Hours
${hoursLines || "(Hours not configured yet.)"}
${channels.sms?.auto_reply_after_hours ? "If the caller is calling outside hours, offer to text them a link so they can order or book without waiting." : ""}

## Tools available to you
${toolList.length > 0 ? toolList.join("\n\n") : "(No tools enabled.)"}

Hard rules:
- Never read back a full credit card number or ask for one. Payment happens on the Stripe link, not with you.
- Never collect SSN, full DOB, bank account, or other sensitive data.
- Max ${guardrails.max_tool_calls_per_conversation || 6} tool calls per conversation.
- If a tool fails twice, tell the caller you'll have the owner follow up and call escalate.

${rewards.dum_points_enabled ? `## DUM Points
After a successful checkout, mention: "You'll earn ${rewards.points_per_dollar || 1} DUM Points per dollar — you can redeem them at any DUM Club merchant." Do not promise a specific dollar value for points.` : ""}

## Escalation
Trigger escalate (transfer or notify owner) when the caller:
- Asks for a refund, dispute, or complaint.
- Uses urgent language ("emergency", "right now", "leaking", "injury").
- Repeats a request you cannot fulfill twice.
- Asks for a human.

${escalation.handoff_number_e164 ? `Escalation target: ${escalation.handoff_number_e164}` : ""}
Handoff triggers: ${handoffTriggers || "complaint, refund, urgent"}

${dndLines ? `## Do not discuss\n${dndLines}` : ""}

${faqLines ? `## FAQs\n${faqLines}` : ""}

## Style
- ${id.voice_persona || "friendly"} tone.
- No filler ("um", "like", "as an AI").
- Confirm phone numbers by repeating them back digit-by-digit before sending SMS.
- If unsure, ask one clarifying question; never guess on price, time, or policy.

## Safety
If the caller describes a medical emergency, self-harm, or violence: say "Please call 911 or your local emergency number" and end the call. Never provide medical, legal, or financial advice.`;
}

export function buildToolDefinitions(config: Config) {
  const tools = config.tools || {};
  const defs: any[] = [];

  if (tools.stripe_link?.enabled) {
    defs.push({
      name: "create_stripe_checkout_link",
      description:
        "Create a Stripe Checkout link for a service. Returns a URL the customer can use to pay.",
      input_schema: {
        type: "object",
        required: ["service_id", "quantity"],
        properties: {
          service_id: { type: "string", description: "ID of the service from the menu" },
          quantity: { type: "number", minimum: 1, maximum: 20 },
          customer_phone_e164: { type: "string", description: "Customer phone in E.164 format" },
        },
      },
    });
  }

  if (tools.sms?.enabled) {
    defs.push({
      name: "send_sms",
      description:
        "Send an SMS to the customer. Use for checkout links, confirmations, or callbacks.",
      input_schema: {
        type: "object",
        required: ["to_e164", "body"],
        properties: {
          to_e164: { type: "string", description: "Recipient phone in E.164 format" },
          body: { type: "string", maxLength: 480, description: "Message body" },
        },
      },
    });
  }

  if (tools.booking?.enabled) {
    defs.push({
      name: "create_booking",
      description:
        "Book an appointment for a bookable service. Check availability before confirming.",
      input_schema: {
        type: "object",
        required: ["service_id", "start_iso", "customer_name", "customer_phone_e164"],
        properties: {
          service_id: { type: "string" },
          start_iso: { type: "string", description: "Appointment start in ISO 8601 with timezone" },
          customer_name: { type: "string", maxLength: 80 },
          customer_phone_e164: { type: "string" },
        },
      },
    });
  }

  return defs;
}
