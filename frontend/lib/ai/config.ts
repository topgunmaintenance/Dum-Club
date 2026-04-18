import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "./schemas/business_config.schema.json";

const ajv = new Ajv2020({ allErrors: true, useDefaults: true });
addFormats(ajv);
const validate = ajv.compile(schema);

export type ValidationResult = {
  valid: boolean;
  config: Record<string, any> | null;
  errors: { path: string; message: string }[];
};

export function validateConfig(config: unknown): ValidationResult {
  const copy = JSON.parse(JSON.stringify(config));
  const valid = validate(copy);
  if (valid) {
    return { valid: true, config: copy, errors: [] };
  }
  const errors = (validate.errors || []).map((e) => ({
    path: e.instancePath || "/",
    message: e.message || "validation error",
  }));
  return { valid: false, config: null, errors };
}

export function emptyConfig(): Record<string, any> {
  return {
    version: "1",
    identity: {
      business_name: "",
      business_slug: "",
      voice_persona: "friendly",
      language: "en-US",
      timezone: "America/New_York",
    },
    scope: {
      services: [],
      hours: {},
      faqs: [],
      do_not_discuss: [],
    },
    tools: {
      stripe_link: { enabled: false },
      sms: { enabled: false },
      booking: { enabled: false },
    },
    channels: {
      voice: { enabled: false },
      sms: { enabled: false },
      web: { enabled: true, widget_color: "#00FFA3" },
    },
    rewards: {
      dum_points_enabled: true,
      points_per_dollar: 1,
      mention_on_checkout: true,
    },
    escalation: {
      handoff_triggers: ["complaint", "refund", "urgent"],
      notify_owner_on_handoff: true,
    },
    guardrails: {
      never_promise_prices_outside_services: true,
      require_consent_before_sms: true,
      max_tool_calls_per_conversation: 6,
    },
  };
}
