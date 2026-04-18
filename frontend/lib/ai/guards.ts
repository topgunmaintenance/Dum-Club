import { getServiceClient } from "./supabase-service";

export type Merchant = {
  id: string;
  owner_privy_id: string;
  business_name: string;
  ai_agent_enabled: boolean;
  ai_agent_plan: string;
  ai_agent_status: string;
  ai_agent_config: Record<string, any>;
};

const MERCHANT_SELECT =
  "id, owner_privy_id, business_name, ai_agent_enabled, ai_agent_plan, ai_agent_status, ai_agent_config";

export async function getMerchantByOwner(
  privyId: string
): Promise<Merchant | null> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("merchants")
    .select(MERCHANT_SELECT)
    .eq("owner_privy_id", privyId)
    .limit(1)
    .single();
  return data;
}

export async function getMerchantById(
  businessId: string
): Promise<Merchant | null> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("merchants")
    .select(MERCHANT_SELECT)
    .eq("id", businessId)
    .limit(1)
    .single();
  return data;
}

export async function getMerchantBySlug(
  slug: string
): Promise<Merchant | null> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("merchants")
    .select(MERCHANT_SELECT)
    .eq("ai_agent_enabled", true)
    .filter("ai_agent_config->identity->>business_slug", "eq", slug)
    .limit(1)
    .single();
  return data ?? null;
}

export function requireAgentActive(merchant: Merchant): void {
  if (!merchant.ai_agent_enabled || merchant.ai_agent_status !== "active") {
    throw new ServiceInactiveError();
  }
}

export function verifyOwnership(merchant: Merchant, privyId: string): void {
  if (merchant.owner_privy_id !== privyId) {
    throw new ForbiddenError();
  }
}

export class ServiceInactiveError extends Error {
  constructor() {
    super("SERVICE_INACTIVE");
  }
}

export class ForbiddenError extends Error {
  constructor() {
    super("FORBIDDEN");
  }
}
