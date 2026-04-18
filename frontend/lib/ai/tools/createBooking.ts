import type { Merchant } from "../guards";

type Input = {
  business_id: string;
  idempotency_key: string;
  service_id: string;
  start_iso: string;
  customer_name: string;
  customer_phone_e164: string;
  notes?: string;
};

// Phase 1 stub: booking table (ai_agent_bookings) ships in Phase 2.
// Returns SERVICE_INACTIVE so the LLM falls back gracefully.
export async function createBooking(
  _merchant: Merchant,
  _input: Input
): Promise<{ ok: false; error: { code: string; message: string } }> {
  return {
    ok: false,
    error: {
      code: "SERVICE_INACTIVE",
      message: "Booking is not yet available. Please call the business directly to schedule.",
    },
  };
}
