/**
 * The default reminder tone — synthesised, not a file.
 *
 * WHY NOT AN MP3. This app is offline-first and installable, so an asset is one more thing that has
 * to be cached, versioned, and present before a reminder can fire. A two-note chime is fifteen
 * lines of Web Audio, weighs nothing, cannot 404, and works the first time the app is opened on a
 * plane. Preset tones later become a table of frequencies rather than a folder of downloads
 * (design/backlog-after-sync.md §7).
 *
 * ── The autoplay problem, stated plainly ────────────────────────────────────────────────────────
 * Browsers refuse to start audio until the page has had a real user gesture. A reminder is by
 * definition NOT a gesture — it fires while the user is reading something else, or not looking at
 * all — so the honest design is:
 *
 *   1. `arm()` on the first click or keypress, which resumes the AudioContext while a gesture is
 *      still on the stack. From then on the tone can play whenever it likes.
 *   2. `play()` NEVER throws. A blocked sound is a nuisance; a reminder that fails to arrive
 *      because a sound was blocked is a broken feature. The notice is the reminder; the tone is
 *      the part that makes you look up.
 *
 * The interface exists so the scheduler can be tested without an audio stack — jsdom and node have
 * no `AudioContext`, and a test that needs one is testing the browser rather than the reminder.
 */

export interface Chime {
  /** Called on the first user gesture, so later playback is permitted. Safe to call repeatedly. */
  arm(): void;
  /** Best effort. Resolves whether or not a sound was actually heard. */
  play(): Promise<void>;
}

/** two soft notes, a rising fifth — noticeable across a room, not alarming */
const NOTES: Array<{ hz: number; at: number; for: number }> = [
  { hz: 660, at: 0, for: 0.16 },
  { hz: 990, at: 0.14, for: 0.28 },
];

const PEAK = 0.16; // quiet by default; this arrives uninvited

type AudioCtor = typeof AudioContext;

function audioCtor(): AudioCtor | null {
  const w = globalThis as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Is there an audio stack at all? False in tests, in SSR, and in very old browsers. */
export const canPlaySound = (): boolean => audioCtor() !== null;

export function createChime(): Chime {
  let ctx: AudioContext | null = null;

  /**
   * One AudioContext for the life of the tab, created lazily.
   *
   * Browsers cap how many a page may open, and a reminder that fires often enough to hit that cap
   * would then be silent forever — a failure that only shows up after long use, which is the worst
   * kind to debug.
   */
  function context(): AudioContext | null {
    if (ctx) return ctx;
    const Ctor = audioCtor();
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      ctx = null; // no audio output at all — the notice still arrives
    }
    return ctx;
  }

  return {
    arm() {
      void context()?.resume().catch(() => undefined);
    },

    async play() {
      const audio = context();
      if (!audio) return;
      try {
        // resume again: a context can be suspended by the browser at any time (tab in the
        // background, system audio taken by something else), not only before the first gesture
        if (audio.state === 'suspended') await audio.resume();

        const start = audio.currentTime;
        for (const note of NOTES) {
          const osc = audio.createOscillator();
          const gain = audio.createGain();
          osc.type = 'sine';
          osc.frequency.value = note.hz;

          // a ramp, not a switch: an oscillator gated on and off clicks audibly at both ends
          const t0 = start + note.at;
          gain.gain.setValueAtTime(0.0001, t0);
          gain.gain.exponentialRampToValueAtTime(PEAK, t0 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + note.for);

          osc.connect(gain).connect(audio.destination);
          osc.start(t0);
          osc.stop(t0 + note.for + 0.02);
        }
      } catch {
        /* blocked, muted, or no output device — never let this reach the caller */
      }
    },
  };
}

/**
 * Resume the shared chime on the first user gesture of the session.
 *
 * `once: true` on both, because one gesture is all the browser needs and a listener that survives
 * it is a listener on every click in the app forever.
 */
export function armOnFirstGesture(chime: Chime): () => void {
  const arm = () => chime.arm();
  const opts = { once: true, passive: true } as const;
  document.addEventListener('pointerdown', arm, opts);
  document.addEventListener('keydown', arm, opts);
  return () => {
    document.removeEventListener('pointerdown', arm);
    document.removeEventListener('keydown', arm);
  };
}
