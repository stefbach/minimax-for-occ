import type { SyntheticEvent } from "react";

// Streamed recordings (esp. Twilio's on-the-fly MP3) can report
// duration=Infinity, which pins the playhead to the end and breaks the
// timecode. Forcing a seek to a huge time makes the browser read the real
// duration; we then snap back to 0. No-op once the duration is already finite.
export function fixAudioDuration(e: SyntheticEvent<HTMLAudioElement>): void {
  const a = e.currentTarget;
  if (Number.isFinite(a.duration) && a.duration > 0) return;
  const onUpdate = () => {
    a.removeEventListener("timeupdate", onUpdate);
    // Back to the start once the browser has learned the real duration.
    try { a.currentTime = 0; } catch { /* ignore */ }
  };
  a.addEventListener("timeupdate", onUpdate);
  try { a.currentTime = 1e7; } catch { /* ignore */ }
}
