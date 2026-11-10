/**
 * Convex wraps a thrown Error with its own framing — request id, function
 * name, file/line, "Called by client". That is useful in a log and useless
 * in a toast, so pull the human sentence back out.
 *
 * Anything we can't parse falls back to a generic line rather than leaking
 * internals to whoever is standing at the front desk.
 */
export function friendlyError(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (!(err instanceof Error)) return fallback;
  const raw = err.message;

  // "... Uncaught Error: <the message we threw>\n    at handler (...)"
  const match = raw.match(/Uncaught\s+\w*Error:\s*([\s\S]*?)(?:\n\s*at\s|$)/);
  const message = (match?.[1] ?? raw).split("\n")[0].trim();

  if (!message || /^\[CONVEX/.test(message)) return fallback;
  return message.replace(/\s*Called by client\s*$/, "").trim() || fallback;
}
