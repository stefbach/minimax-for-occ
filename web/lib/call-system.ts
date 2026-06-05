// Calling-system axis, orthogonal to the Prod/Test leads axis.
//
//   Retell = calls ingested from Retell (metadata.source === 'retell_sync')
//   Axon   = calls placed natively by Axon (LiveKit/Twilio) — everything else
//
// During the Retell→Axon migration the operator wants to see each system's
// numbers separately (and the union). This is independent of which leads table
// the number belongs to, so it lives in its own helper.

export type CallSystem = "all" | "retell" | "axon";

export function parseCallSystem(raw: string | null | undefined): CallSystem {
  return raw === "retell" || raw === "axon" ? raw : "all";
}

export function callMatchesSystem(
  source: string | null | undefined,
  system: CallSystem,
): boolean {
  if (system === "retell") return source === "retell_sync";
  if (system === "axon") return source !== "retell_sync";
  return true;
}
