const FALLBACK = "The step failed.";
const TEXT_KEYS = ["error", "message", "detail", "reason", "msg"] as const;

/**
 * Turns the "message" the toolkit posts back for a failed job into text a person can read.
 * The toolkit sends a plain string for some steps and an object such as
 * `{ "error": "..." }` for others, so `String(message)` would show "[object Object]".
 */
export function toolkitMessageText(message: unknown, depth = 0): string {
  if (message === null || message === undefined) return FALLBACK;
  if (typeof message === "string") return message.trim() || FALLBACK;
  if (typeof message === "number" || typeof message === "boolean") return String(message);
  if (depth > 3) return FALLBACK;
  if (Array.isArray(message)) {
    const parts = message
      .map((part) => toolkitMessageText(part, depth + 1))
      .filter((part) => part !== FALLBACK);
    return parts.length ? parts.join(" ") : FALLBACK;
  }
  if (typeof message === "object") {
    const record = message as Record<string, unknown>;
    for (const key of TEXT_KEYS) {
      if (record[key] === undefined || record[key] === null) continue;
      const text = toolkitMessageText(record[key], depth + 1);
      if (text !== FALLBACK) return text;
    }
    // No field we know: show the object itself rather than "[object Object]".
    try {
      const json = JSON.stringify(message);
      return json && json !== "{}" ? json : FALLBACK;
    } catch {
      return FALLBACK;
    }
  }
  return FALLBACK;
}

// FFmpeg's log opens with a long banner and says what went wrong at the end, so a long
// error keeps its start and its end rather than being cut after the banner.
export function keepEnds(text: string, max = 6000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, 1500)}\n…\n${text.slice(text.length - (max - 1500))}`;
}
