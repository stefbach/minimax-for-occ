/**
 * Compute the next business day (Mon–Fri) at a given hour:minute.
 *
 * Returns a Date in UTC. UK bank holidays are out of scope for v1 — we
 * only skip Saturday and Sunday.
 *
 * Examples (assuming `from` is Tuesday 14:00 UTC):
 *   nextBusinessDayAt()                 → Wednesday 09:00 UTC
 *   nextBusinessDayAt("13:30")          → Wednesday 13:30 UTC
 *   nextBusinessDayAt(undefined, FRI)   → Monday 09:00 UTC
 *
 * The function always rolls forward — calling it on a Friday returns
 * Monday, on a Saturday returns Monday, on a Sunday returns Monday.
 */
export function nextBusinessDayAt(
  hourMinute = "09:00",
  from: Date = new Date(),
): Date {
  const [hStr, mStr] = hourMinute.split(":");
  const hour = Number.parseInt(hStr ?? "9", 10);
  const minute = Number.parseInt(mStr ?? "0", 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    throw new Error(`Invalid hourMinute "${hourMinute}" (expected HH:MM)`);
  }

  // Start from `from` rolled forward by 1 day in UTC.
  const d = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate() + 1,
      hour,
      minute,
      0,
      0,
    ),
  );

  // Skip weekend days.
  while (true) {
    const dow = d.getUTCDay(); // 0 = Sun, 6 = Sat
    if (dow === 0) {
      // Sunday → bump to Monday.
      d.setUTCDate(d.getUTCDate() + 1);
    } else if (dow === 6) {
      // Saturday → bump to Monday.
      d.setUTCDate(d.getUTCDate() + 2);
    } else {
      break;
    }
  }

  return d;
}
