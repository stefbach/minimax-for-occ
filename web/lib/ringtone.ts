// Self-contained incoming-call ringtone for the desk softphone.
//
// Synthesised with the Web Audio API (no audio asset to ship, works offline,
// no network fetch). Plays a classic two-tone "ring … ring … pause" cadence
// in a loop until stopped. Created lazily on first start() so we don't spin up
// an AudioContext until an actual call rings.
//
// Browser autoplay policy: an AudioContext may start "suspended" until a user
// gesture occurs. The desk agent has almost always already clicked something
// (toggling presence to "available", granting mic) before a call arrives, so
// resume() succeeds. If it doesn't, we fail silently — the visual "Sonne…"
// indicator still tells the agent a call is waiting.

type RingHandle = {
  start: () => void;
  stop: () => void;
  isPlaying: () => boolean;
};

function createRingtone(): RingHandle {
  let ctx: AudioContext | null = null;
  let cadenceTimer: ReturnType<typeof setInterval> | null = null;
  let playing = false;

  // UK/EU-style ring: two short bursts (~0.4s on, 0.2s gap) then a long pause.
  const ON = 0.4; // seconds of tone per burst
  const GAP = 0.2; // silence between the two bursts of a ring
  const PERIOD_MS = 3000; // full cadence repeats every 3s

  function ensureCtx(): AudioContext | null {
    if (ctx) return ctx;
    try {
      const AC: typeof AudioContext =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      ctx = new AC();
    } catch {
      ctx = null;
    }
    return ctx;
  }

  // Schedule one "burst" (a short two-tone beep) at the given context time.
  function scheduleBurst(c: AudioContext, at: number, dur: number) {
    const gain = c.createGain();
    gain.connect(c.destination);
    // Soft attack/release so it doesn't click.
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.18, at + 0.02);
    gain.gain.setValueAtTime(0.18, at + dur - 0.04);
    gain.gain.linearRampToValueAtTime(0, at + dur);

    // Two tones (425Hz + 480Hz) — pleasant, telephone-like.
    for (const freq of [425, 480]) {
      const osc = c.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(at);
      osc.stop(at + dur);
    }
  }

  function fireCadence() {
    const c = ensureCtx();
    if (!c) return;
    if (c.state === "suspended") void c.resume().catch(() => {});
    const now = c.currentTime + 0.02;
    // Two bursts make one "ring ring".
    scheduleBurst(c, now, ON);
    scheduleBurst(c, now + ON + GAP, ON);
  }

  return {
    start() {
      if (playing) return;
      playing = true;
      fireCadence(); // ring immediately, then repeat
      cadenceTimer = setInterval(fireCadence, PERIOD_MS);
    },
    stop() {
      playing = false;
      if (cadenceTimer) {
        clearInterval(cadenceTimer);
        cadenceTimer = null;
      }
    },
    isPlaying() {
      return playing;
    },
  };
}

// Module-level singleton so repeated start()/stop() across renders reuse one
// AudioContext instead of leaking a new one each time.
let singleton: RingHandle | null = null;

export function getRingtone(): RingHandle {
  if (typeof window === "undefined") {
    // SSR no-op.
    return { start: () => {}, stop: () => {}, isPlaying: () => false };
  }
  if (!singleton) singleton = createRingtone();
  return singleton;
}
