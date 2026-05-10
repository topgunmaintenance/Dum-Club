import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getMerchantBySlug, requireAgentActive, ServiceInactiveError } from "../../../../lib/ai/guards";
import { buildSystemPrompt, buildToolDefinitions } from "../../../../lib/ai/prompt";
import { getServiceClient } from "../../../../lib/ai/supabase-service";
import { toolRunner } from "../../../../lib/ai/runner";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

const MODEL = process.env.AI_AGENT_DEFAULT_MODEL || "claude-sonnet-4-20250514";

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { businessSlug, sessionId, message } = body;
  if (!businessSlug || !message) {
    return NextResponse.json(
      { error: "businessSlug and message are required" },
      { status: 400 }
    );
  }

  const merchant = await getMerchantBySlug(businessSlug);
  if (!merchant) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  try {
    requireAgentActive(merchant);
  } catch (e) {
    if (e instanceof ServiceInactiveError) {
      return NextResponse.json(
        { error: "SERVICE_INACTIVE", message: "This assistant is currently unavailable." },
        { status: 503 }
      );
    }
    throw e;
  }

  const config = merchant.ai_agent_config;
  if (!config?.channels?.web?.enabled) {
    return NextResponse.json(
      { error: "SERVICE_INACTIVE", message: "Web chat is not enabled for this business." },
      { status: 503 }
    );
  }

  const sb = getServiceClient();

  // Load or create conversation
  let conversationId = sessionId;
  let existingMessages: any[] = [];

  if (sessionId) {
    const { data: conv } = await sb
      .from("ai_agent_conversations")
      .select("id, transcript")
      .eq("id", sessionId)
      .eq("business_id", merchant.id)
      .single();

    if (conv) {
      conversationId = conv.id;
      existingMessages = Array.isArray(conv.transcript) ? conv.transcript : [];
    }
  }

  if (!conversationId) {
    const { data: newConv } = await sb
      .from("ai_agent_conversations")
      .insert({
        business_id: merchant.id,
        channel: "web",
        customer_identifier: `web:${crypto.randomUUID().slice(0, 8)}`,
        transcript: [],
      })
      .select("id")
      .single();
    conversationId = newConv?.id;
  }

  // Build messages for Anthropic
  const systemPrompt = buildSystemPrompt(config);
  const toolDefs = buildToolDefinitions(config);

  const messages: Anthropic.MessageParam[] = [
    ...existingMessages.map((m: any) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: message },
  ];

  try {
    const apiParams: Anthropic.MessageCreateParams = {
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    };

    if (toolDefs.length > 0) {
      apiParams.tools = toolDefs;
    }

    let response = await anthropic.messages.create(apiParams);

    // Handle tool use in a loop (max iterations from guardrails)
    const maxToolCalls = config.guardrails?.max_tool_calls_per_conversation || 6;
    let toolCallCount = 0;

    while (response.stop_reason === "tool_use" && toolCallCount < maxToolCalls) {
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        toolCallCount++;
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

      response = await anthropic.messages.create({
        ...apiParams,
        messages,
      });
    }

    // Extract text response
    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );
    const reply = textBlocks.map((b) => b.text).join("\n");

    // Persist transcript
    const updatedTranscript = [
      ...existingMessages,
      { role: "user", content: message, at: new Date().toISOString() },
      { role: "assistant", content: reply, at: new Date().toISOString() },
    ];

    if (conversationId) {
      await sb
        .from("ai_agent_conversations")
        .update({ transcript: updatedTranscript })
        .eq("id", conversationId)
        .eq("business_id", merchant.id);
    }

    return NextResponse.json({
      reply,
      sessionId: conversationId,
    });
  } catch (err: any) {
    console.error("[ai/chat] LLM error:", err.message);
    return NextResponse.json(
      { error: "Assistant error", message: "I'm having trouble right now. Please try again." },
      { status: 500 }
    );
  }
}
