import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getServiceClient } from "../../../../../../lib/ai/supabase-service";
import { buildSystemPrompt, buildToolDefinitions } from "../../../../../../lib/ai/prompt";
import { toolRunner } from "../../../../../../lib/ai/runner";
import { verifyTwilioSignature } from "../../../../../../lib/ai/twilio-verify";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

const MODEL = process.env.AI_AGENT_DEFAULT_MODEL || "claude-sonnet-4-20250514";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const params: Record<string, string> = {};
  new URLSearchParams(rawBody).forEach((v, k) => { params[k] = v; });

  if (!verifyTwilioSignature(req, params)) {
    console.warn("[twilio/sms] Invalid signature — rejecting request");
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const to = params.To || "";
  const from = params.From || "";
  const body = params.Body || "";

  if (!to || !body) {
    return twimlResponse("<Message>Something went wrong. Please try again.</Message>");
  }

  const sb = getServiceClient();

  // Resolve business by the receiving number
  const { data: phoneRow } = await sb
    .from("ai_agent_phone_numbers")
    .select("business_id")
    .eq("e164", to)
    .is("released_at", null)
    .limit(1)
    .single();

  if (!phoneRow) {
    return twimlResponse("<Message>This number is not in service.</Message>");
  }

  const { data: merchant } = await sb
    .from("merchants")
    .select("id, business_name, ai_agent_enabled, ai_agent_status, ai_agent_config")
    .eq("id", phoneRow.business_id)
    .single();

  if (!merchant || !merchant.ai_agent_enabled || merchant.ai_agent_status !== "active") {
    return twimlResponse(
      "<Message>Our AI assistant is currently unavailable. Please visit our website or try again later.</Message>"
    );
  }

  const config = merchant.ai_agent_config || {};
  if (!config.channels?.sms?.enabled) {
    return twimlResponse(
      "<Message>SMS is not enabled for this business. Please visit our website.</Message>"
    );
  }

  // Load or create conversation for this phone number
  const { data: existingConv } = await sb
    .from("ai_agent_conversations")
    .select("id, transcript")
    .eq("business_id", merchant.id)
    .eq("channel", "sms")
    .eq("customer_identifier", from)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .single();

  let conversationId: string;
  let existingMessages: any[] = [];

  if (existingConv) {
    conversationId = existingConv.id;
    existingMessages = Array.isArray(existingConv.transcript) ? existingConv.transcript : [];
  } else {
    const { data: newConv } = await sb
      .from("ai_agent_conversations")
      .insert({
        business_id: merchant.id,
        channel: "sms",
        customer_identifier: from,
        transcript: [],
      })
      .select("id")
      .single();
    conversationId = newConv?.id || "";
  }

  // Build LLM messages
  const systemPrompt = buildSystemPrompt(config);
  const toolDefs = buildToolDefinitions(config);
  const messages: Anthropic.MessageParam[] = [
    ...existingMessages
      .filter((m: any) => m.role === "user" || m.role === "assistant")
      .slice(-10) // Keep last 10 turns for context window
      .map((m: any) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: body },
  ];

  try {
    const apiParams: Anthropic.MessageCreateParams = {
      model: MODEL,
      max_tokens: 480,
      system: systemPrompt,
      messages,
    };
    if (toolDefs.length > 0) {
      apiParams.tools = toolDefs;
    }

    let response = await anthropic.messages.create(apiParams);

    // Handle tool use (one round max for SMS)
    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        const result = await toolRunner(
          merchant.id,
          block.name,
          block.input as Record<string, any>,
          conversationId
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
          is_error: !result.ok,
        });
      }

      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });
      response = await anthropic.messages.create({ ...apiParams, messages });
    }

    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );
    const reply = textBlocks.map((b) => b.text).join("\n");

    // Persist transcript
    const updatedTranscript = [
      ...existingMessages,
      { role: "user", content: body, at: new Date().toISOString() },
      { role: "assistant", content: reply, at: new Date().toISOString() },
    ];
    await sb
      .from("ai_agent_conversations")
      .update({ transcript: updatedTranscript })
      .eq("id", conversationId);

    // SMS reply capped at 480 chars
    const smsReply = reply.length > 480 ? reply.slice(0, 477) + "..." : reply;
    return twimlResponse(`<Message>${escapeXml(smsReply)}</Message>`);
  } catch (err: any) {
    console.error("[ai/sms] LLM error:", err.message);
    return twimlResponse(
      "<Message>I'm having trouble right now. Please try again in a moment.</Message>"
    );
  }
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
