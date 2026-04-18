import { NextRequest } from "next/server";

const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";

export function verifyTwilioSignature(req: NextRequest, params: Record<string, string>): boolean {
  const signature = req.headers.get("x-twilio-signature");
  if (!signature || !AUTH_TOKEN) return false;

  try {
    const twilio = require("twilio");
    const url = req.url;
    return twilio.validateRequest(AUTH_TOKEN, signature, url, params);
  } catch {
    return false;
  }
}
