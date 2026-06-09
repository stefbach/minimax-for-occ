// Call-slot windows for the OCC dialer.
//
// The calling windows are anchored to the patient's UK day, so we bucket every
// call by its Europe/London local time (DST-aware) rather than raw UTC. The
// Mauritius operator times shown in the UI are simply the same instants
// expressed in Indian/Mauritius (UK + 3h during BST, + 4h during GMT) — they
// fall in the exact same bucket, so bucketing by London is correct year-round.
//
//   Mon–Thu :  matin 08:00–10:00 · midi 13:00–14:00 · soir 18:00–20:30  (UK)
//   Fri     :  matin 08:00–11:00  (no midi / soir)                       (UK)
//   Sat/Sun :  no windows → everything is "hors créneau"
//
// Keep this the single source of truth: both the director KPI counts and the
// drill-down filter import slotForDate so they can never drift apart.

export type CallSlot = "matin" | "midi" | "soir" | "hors";

// One formatter, reused across rows. Emits the UK weekday + 24h time so we can
// derive minutes-since-midnight and the day of week in London local time.
const ukParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Bucket a call's start time into its UK calling window. */
export function slotForDate(d: Date): CallSlot {
  if (Number.isNaN(d.getTime())) return "hors";
  const parts = ukParts.formatToParts(d);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  let hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  if (hh === 24) hh = 0; // some runtimes emit "24" at midnight
  const mins = hh * 60 + mm;

  if (wd === "Sat" || wd === "Sun") return "hors";
  if (wd === "Fri") {
    return mins >= 8 * 60 && mins < 11 * 60 ? "matin" : "hors";
  }
  // Monday–Thursday
  if (mins >= 8 * 60 && mins < 10 * 60) return "matin";
  if (mins >= 13 * 60 && mins < 14 * 60) return "midi";
  if (mins >= 18 * 60 && mins < 20 * 60 + 30) return "soir";
  return "hors";
}

// UK / MU window labels for the dashboard cards. The Friday morning window is
// wider (08:00–11:00) than Mon–Thu, hence the separate `fri` note.
export const SLOT_WINDOWS: Record<
  Exclude<CallSlot, "hors">,
  { uk: string; mu: string }
> = {
  matin: { uk: "08h–10h", mu: "11h–13h" },
  midi: { uk: "13h–14h", mu: "16h–17h" },
  soir: { uk: "18h–20h30", mu: "21h–23h30" },
};
