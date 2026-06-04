// Twilio + LiveKit use 'in' / 'out' as the direction values stored in
// public.calls.direction. The dashboard code was originally written against
// the longer 'inbound' / 'outbound' tokens, which caused every "is this
// inbound?" check to silently return false in production. These helpers are
// the single source of truth — use them everywhere instead of inline
// equality checks.

// Accept anything (loose typing) because both the DB and various caller
// sites flow strings/nulls through here. The match is on value, not type.
export function isInbound(direction: unknown): boolean {
  return direction === "in" || direction === "inbound";
}

export function isOutbound(direction: unknown): boolean {
  return direction === "out" || direction === "outbound";
}

// Map UI-facing direction tokens ("inbound"/"outbound") to the DB values
// ("in"/"out") so a `.eq("direction", normalizeDirectionForDb(x))` call
// actually matches rows.
export function normalizeDirectionForDb(direction: unknown): "in" | "out" | null {
  if (direction === "in" || direction === "inbound") return "in";
  if (direction === "out" || direction === "outbound") return "out";
  return null;
}
