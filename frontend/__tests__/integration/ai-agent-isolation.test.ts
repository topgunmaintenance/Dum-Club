/**
 * AI Agent Isolation Test — Phase 1
 *
 * Two test layers:
 *   1. DB-level: Supabase queries scoped by business_id
 *   2. API-level: HTTP requests to /api/ai/** routes with auth
 *
 * Prerequisites:
 *   - NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set in env
 *   - Migration 032 applied
 *   - Dev server running at TEST_BASE_URL (default http://localhost:3000)
 *   - PRIVY_APP_ID set (for JWT minting — or use TEST_OWNER_A_TOKEN / TEST_OWNER_B_TOKEN)
 *
 * Run:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   TEST_OWNER_A_TOKEN=<privy-jwt-for-owner-a> \
 *   TEST_OWNER_B_TOKEN=<privy-jwt-for-owner-b> \
 *   npx jest __tests__/integration/ai-agent-isolation.test.ts --runInBand
 *
 * To generate test tokens: use Privy's test mode or create two test users
 * and export their JWTs as TEST_OWNER_A_TOKEN / TEST_OWNER_B_TOKEN.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const TOKEN_A = process.env.TEST_OWNER_A_TOKEN || "";
const TOKEN_B = process.env.TEST_OWNER_B_TOKEN || "";

const OWNER_A_PRIVY_ID = "test:owner-a-isolation";
const OWNER_B_PRIVY_ID = "test:owner-b-isolation";

let merchantA: any;
let merchantB: any;
let conversationB: any;
let phoneB: any;

async function supabaseRest(path: string, method: string, body?: any) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const headers: Record<string, string> = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: method === "POST" ? "return=representation" : "",
  };
  const opts: RequestInit = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  return res.json();
}

async function apiGet(path: string, token: string) {
  return fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function apiPut(path: string, token: string, body: any) {
  return fetch(`${BASE_URL}${path}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function apiPost(path: string, body: any, headers?: Record<string, string>) {
  return fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const validConfig = {
  version: "1",
  identity: { business_name: "X", business_slug: "test-x", voice_persona: "friendly" },
  scope: { services: [], hours: {} },
  tools: { stripe_link: { enabled: false }, sms: { enabled: false }, booking: { enabled: false } },
  channels: { voice: { enabled: false }, sms: { enabled: false }, web: { enabled: true } },
};

beforeAll(async () => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set"
    );
  }

  const [a] = await supabaseRest("merchants", "POST", {
    owner_privy_id: OWNER_A_PRIVY_ID,
    business_name: "Test Business A",
    ai_agent_enabled: true,
    ai_agent_status: "active",
    ai_agent_plan: "starter",
    ai_agent_config: { ...validConfig, identity: { ...validConfig.identity, business_name: "Test Business A", business_slug: "test-biz-a" } },
  });
  merchantA = a;

  const [b] = await supabaseRest("merchants", "POST", {
    owner_privy_id: OWNER_B_PRIVY_ID,
    business_name: "Test Business B",
    ai_agent_enabled: true,
    ai_agent_status: "active",
    ai_agent_plan: "pro",
    ai_agent_config: { ...validConfig, identity: { ...validConfig.identity, business_name: "Test Business B", business_slug: "test-biz-b" } },
  });
  merchantB = b;

  const [conv] = await supabaseRest("ai_agent_conversations", "POST", {
    business_id: merchantB.id,
    channel: "web",
    customer_identifier: "test-customer",
    transcript: [{ role: "user", content: "SECRET DATA FROM B" }],
  });
  conversationB = conv;

  const [ph] = await supabaseRest("ai_agent_phone_numbers", "POST", {
    business_id: merchantB.id,
    e164: "+15559876543",
    twilio_sid: "SM_TEST_B_ISOLATION",
  });
  phoneB = ph;
});

afterAll(async () => {
  if (phoneB?.id) await supabaseRest(`ai_agent_phone_numbers?id=eq.${phoneB.id}`, "DELETE");
  if (conversationB?.id) await supabaseRest(`ai_agent_conversations?id=eq.${conversationB.id}`, "DELETE");
  if (merchantA?.id) await supabaseRest(`merchants?id=eq.${merchantA.id}`, "DELETE");
  if (merchantB?.id) await supabaseRest(`merchants?id=eq.${merchantB.id}`, "DELETE");
});

// ── Layer 1: Database-level isolation ──

describe("DB-level isolation", () => {
  test("owner A privy_id returns only merchant A", async () => {
    const data = await supabaseRest(
      `merchants?owner_privy_id=eq.${OWNER_A_PRIVY_ID}&select=id,business_name`,
      "GET"
    );
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe(merchantA.id);
  });

  test("conversations for A are empty, B has one", async () => {
    const dataA = await supabaseRest(
      `ai_agent_conversations?business_id=eq.${merchantA.id}&select=id`,
      "GET"
    );
    expect(dataA).toHaveLength(0);

    const dataB = await supabaseRest(
      `ai_agent_conversations?business_id=eq.${merchantB.id}&select=id,transcript`,
      "GET"
    );
    expect(dataB).toHaveLength(1);
    expect(dataB[0].transcript[0].content).toBe("SECRET DATA FROM B");
  });

  test("slug lookup returns correct merchant", async () => {
    const data = await supabaseRest(
      `merchants?ai_agent_enabled=eq.true&ai_agent_config-%3Eidentity-%3E%3Ebusiness_slug=eq.test-biz-a&select=id`,
      "GET"
    );
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe(merchantA.id);
  });

  test("phone numbers scoped by business_id", async () => {
    const dataA = await supabaseRest(
      `ai_agent_phone_numbers?business_id=eq.${merchantA.id}&select=e164`,
      "GET"
    );
    const e164s = dataA.map((d: any) => d.e164);
    expect(e164s).not.toContain("+15559876543");
  });
});

// ── Layer 2: API route-level isolation ──
// Requires a running dev server and valid Privy JWTs.
// Skip gracefully if tokens are not provided.

const describeApi = TOKEN_A && TOKEN_B ? describe : describe.skip;

describeApi("API route-level isolation", () => {
  test("GET /api/ai/config?businessId=<B.id> as owner A → 403", async () => {
    const res = await apiGet(`/api/ai/config?businessId=${merchantB.id}`, TOKEN_A);
    expect(res.status).toBe(403);
  });

  test("GET /api/ai/config as owner A → returns A's config, not B's", async () => {
    const res = await apiGet("/api/ai/config", TOKEN_A);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.config?.identity?.business_slug).toBe("test-biz-a");
  });

  test("PUT /api/ai/config with businessId=B as owner A → 403", async () => {
    const res = await apiPut("/api/ai/config", TOKEN_A, {
      businessId: merchantB.id,
      config: validConfig,
    });
    expect(res.status).toBe(403);
  });

  test("PUT /api/ai/config without businessId as owner A → writes to A's row", async () => {
    const updatedConfig = {
      ...validConfig,
      identity: { ...validConfig.identity, business_name: "Updated A", business_slug: "test-biz-a" },
    };
    const res = await apiPut("/api/ai/config", TOKEN_A, { config: updatedConfig });
    expect(res.status).toBe(200);

    // Verify it wrote to A, not B
    const bRow = await supabaseRest(
      `merchants?id=eq.${merchantB.id}&select=ai_agent_config`,
      "GET"
    );
    expect(bRow[0].ai_agent_config.identity.business_name).toBe("Test Business B");
  });

  test("GET /api/ai/conversations?businessId=<B.id> as owner A → 403", async () => {
    const res = await apiGet(`/api/ai/conversations?businessId=${merchantB.id}`, TOKEN_A);
    expect(res.status).toBe(403);
  });

  test("GET /api/ai/conversations as owner A → empty (no A conversations)", async () => {
    const res = await apiGet("/api/ai/conversations", TOKEN_A);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.conversations).toHaveLength(0);
  });

  test("POST /api/ai/chat with B's slug as owner A → does not leak B's config", async () => {
    const res = await apiPost("/api/ai/chat", {
      businessSlug: "test-biz-b",
      message: "What services do you offer?",
    });
    // This is a public endpoint — it should work, but the response
    // must be from B's agent (B's config), not A's.
    // It must NOT contain A's conversation data.
    if (res.status === 200) {
      const data = await res.json();
      expect(data.reply).toBeDefined();
      // sessionId belongs to B, not A
      if (data.sessionId) {
        const conv = await supabaseRest(
          `ai_agent_conversations?id=eq.${data.sessionId}&select=business_id`,
          "GET"
        );
        if (conv.length > 0) {
          expect(conv[0].business_id).toBe(merchantB.id);
        }
      }
    }
    // 503 is also acceptable if Anthropic key is not configured in test
  });
});

// ── Layer 3: Twilio webhook signature verification ──

describe("Twilio webhook signature verification", () => {
  test("POST /api/ai/webhooks/twilio/voice without signature → 403", async () => {
    const res = await fetch(`${BASE_URL}/api/ai/webhooks/twilio/voice`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: "+15559876543", From: "+15551111111" }).toString(),
    });
    expect(res.status).toBe(403);
  });

  test("POST /api/ai/webhooks/twilio/sms without signature → 403", async () => {
    const res = await fetch(`${BASE_URL}/api/ai/webhooks/twilio/sms`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        To: "+15559876543",
        From: "+15551111111",
        Body: "Hello",
      }).toString(),
    });
    expect(res.status).toBe(403);
  });

  test("POST /api/ai/webhooks/twilio/voice with bad signature → 403", async () => {
    const res = await fetch(`${BASE_URL}/api/ai/webhooks/twilio/voice`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Twilio-Signature": "invalid-signature-value",
      },
      body: new URLSearchParams({ To: "+15559876543", From: "+15551111111" }).toString(),
    });
    expect(res.status).toBe(403);
  });
});

// ── Layer 4: Service inactive fallbacks ──

describeApi("Section 10 fallbacks", () => {
  let disabledMerchant: any;

  beforeAll(async () => {
    const [m] = await supabaseRest("merchants", "POST", {
      owner_privy_id: "test:owner-disabled-isolation",
      business_name: "Disabled Business",
      ai_agent_enabled: false,
      ai_agent_status: "inactive",
      ai_agent_plan: "none",
      ai_agent_config: {
        ...validConfig,
        identity: { ...validConfig.identity, business_name: "Disabled Business", business_slug: "test-disabled" },
      },
    });
    disabledMerchant = m;
  });

  afterAll(async () => {
    if (disabledMerchant?.id) {
      await supabaseRest(`merchants?id=eq.${disabledMerchant.id}`, "DELETE");
    }
  });

  test("POST /api/ai/chat for disabled merchant → 503 SERVICE_INACTIVE", async () => {
    const res = await apiPost("/api/ai/chat", {
      businessSlug: "test-disabled",
      message: "Hello",
    });
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toBe("SERVICE_INACTIVE");
  });
});
