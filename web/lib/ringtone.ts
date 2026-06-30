// Self-contained incoming-call ringtone for the desk softphone.
//
// Synthesised with the Web Audio API (no audio asset to ship, works offline,
// no network fetch). Plays a smartphone-style "dring dring" pattern — a short
// descending three-note melody repeated with a pause — so it sounds unmistakably
// like an INCOMING call rather than the outgoing UK ringback (425+480Hz dual tone).
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

  // Smartphone-style: three quick descending notes, then silence.
  // Each note: 0.12s on, 0.06s gap — total burst ~0.54s, repeats every 2s.
  const NOTES = [1100, 880, 660]; // Hz — descending, clearly melodic
  const NOTE_ON = 0.12;
  const NOTE_GAP = 0.06;
  const PERIOD_MS = 2000;

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

  function scheduleNote(c: AudioContext, freq: number, at: number, dur: number) {
    const gain = c.createGain();
    gain.connect(c.destination);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.22, at + 0.01);
    gain.gain.setValueAtTime(0.22, at + dur - 0.03);
    gain.gain.linearRampToValueAtTime(0, at + dur);

    // Slightly detuned second oscillator for a warmer, phone-like timbre.
    for (const f of [freq, freq * 1.005]) {
      const osc = c.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f;
      osc.connect(gain);
      osc.start(at);
      osc.stop(at + dur);
    }
  }

  function fireCadence() {
    const c = ensureCtx();
    if (!c) return;
    if (c.state === "suspended") void c.resume().catch(() => {});
    let t = c.currentTime + 0.02;
    for (const freq of NOTES) {
      scheduleNote(c, freq, t, NOTE_ON);
      t += NOTE_ON + NOTE_GAP;
    }
  }

  return {
    start() {
      if (playing) return;
      playing = true;
      fireCadence();
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
