/**
 * errorText — normalize any backend or thrown error shape into a single
 * plain-English string for display.
 *
 * The buy/checkout and go-live paths surface backend errors in red
 * banners. Backend errors arrive in several shapes:
 *   - FastAPI HTTPException:        { detail: "Card declined." }
 *   - FastAPI structured detail:    { detail: { code, message, reason } }
 *   - FastAPI 422 validation:       { detail: [ { loc, msg, type }, ... ] }
 *   - a thrown Error:               Error("Network error")
 *
 * Passing any of the object/array shapes straight into a template
 * literal or `setError(x)` renders "[object Object]" (or a stringified
 * array) in front of the customer. This helper pulls the human message
 * out of every shape and falls back to a friendly default when it
 * can't find one — so a user-facing banner never shows raw object text.
 *
 * Resolution order:
 *   null / undefined            -> fallback
 *   string                      -> the string (fallback if blank)
 *   Error                       -> the Error's message (recursed)
 *   { detail }                  -> errorText(detail)        (unwrap FastAPI)
 *   array [{ msg } | string]    -> each item's msg/message/string, joined
 *   { message } | { msg }       -> that field
 *   anything else               -> fallback
 */
export function errorText(
  input: unknown,
  fallback = "Something went wrong. Try again.",
): string {
  if (input == null) return fallback;

  if (typeof input === "string") {
    return input.trim() || fallback;
  }

  if (input instanceof Error) {
    return errorText(input.message, fallback);
  }

  if (Array.isArray(input)) {
    const parts = input
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") {
          const o = item as Record<string, unknown>;
          if (typeof o.msg === "string") return o.msg.trim();
          if (typeof o.message === "string") return o.message.trim();
        }
        return "";
      })
      .filter((s) => s.length > 0);
    return parts.length ? parts.join("; ") : fallback;
  }

  if (typeof input === "object") {
    const o = input as Record<string, unknown>;
    if ("detail" in o) return errorText(o.detail, fallback);
    if (typeof o.message === "string") return o.message.trim() || fallback;
    if (typeof o.msg === "string") return o.msg.trim() || fallback;
  }

  return fallback;
}
