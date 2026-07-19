/// <summary>
/// Dice & coin sound effects. Plays real samples from `public/sounds/` when they exist
/// (via the shared sfx layer, SOUND_DESIGN.md §3 Phase A) and falls back to the original
/// procedural Web Audio synth (filtered noise burst + short pitched "tock") for any sound
/// whose file is missing — so the feature still works with zero audio files.
/// </summary>

import { getSfxContext, playSfx, preloadSfx } from "../lib/sfx";
import { getSoundGain, subscribeSoundVolume } from "../lib/soundVolume";

const STORAGE_KEY = "dice-muted";

export class DiceAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted: boolean;
  private lastImpactAt = 0;
  private unsubVolume: (() => void) | null = null;

  constructor() {
    this.muted = readMuted();
    // Warm the sample cache at overlay init so buffers are decoded before the first throw.
    preloadSfx("dice-impact-soft", "dice-impact-hard", "dice-shake", "dice-throw", "coin-flip", "coin-drop");
  }

  /// <summary>Lazily builds this instance's synth graph on the app-wide shared
  /// AudioContext (browsers cap concurrent contexts); safe to call repeatedly.</summary>
  private ensure(): boolean {
    if (this.ctx) {
      return true;
    }
    const shared = getSfxContext();
    if (!shared) {
      return false;
    }
    this.ctx = shared;
    this.master = this.ctx.createGain();
    // 0.9 headroom scaled by the user's master volume (gain 1.0 at the 70 % default); kept
    // live via the slider subscription.
    this.master.gain.value = 0.9 * getSoundGain();
    this.master.connect(this.ctx.destination);
    this.unsubVolume = subscribeSoundVolume((gain) => {
      if (this.master) {
        this.master.gain.value = 0.9 * gain;
      }
    });

    const seconds = 0.25;
    const length = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noise = buffer;
    return true;
  }

  /// <summary>Resumes the context after a user gesture (autoplay policy).</summary>
  resume() {
    if (this.ensure() && this.ctx && this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    try {
      window.localStorage.setItem(STORAGE_KEY, muted ? "1" : "0");
    } catch {
      // ignore storage failures
    }
  }

  /// <summary>
  /// Plays a dice impact. `strength` (0..1) scales volume and brightness; `coin` swaps the
  /// woody clack for a metallic ring. Impacts are rate-limited so a flurry of contacts in
  /// one frame does not stack into a roar.
  /// </summary>
  impact(strength: number, coin = false) {
    if (this.muted || !this.ensure() || !this.ctx || !this.master || !this.noise) {
      return;
    }
    const now = this.ctx.currentTime;
    if (now - this.lastImpactAt < 0.02) {
      return;
    }
    this.lastImpactAt = now;

    const clamped = Math.max(0, Math.min(1, strength));
    if (coin) {
      // Real coin-drop sample when present; the synthesized metallic ring otherwise.
      if (playSfx("coin-drop", { gain: 0.4 + clamped * 0.5, rateLimitMs: 0 })) {
        return;
      }
      this.coinRing(clamped, now);
      return;
    }

    // Sample path: soft/hard sample set picked by strength, strength carried as gain.
    // If the preferred set has no files (yet), the other set covers it; only when neither
    // has anything does the synth below play. Rate limiting is this method's 20 ms gate.
    const set = clamped < 0.4 ? "dice-impact-soft" : "dice-impact-hard";
    const other = clamped < 0.4 ? "dice-impact-hard" : "dice-impact-soft";
    const sampleGain = 0.15 + clamped * 0.85;
    if (
      playSfx(set, { gain: sampleGain, rateLimitMs: 0 }) ||
      playSfx(other, { gain: sampleGain, rateLimitMs: 0 })
    ) {
      return;
    }

    const vol = 0.12 + clamped * 0.5;

    // Low body: a light sine "thud" that pitch-drops as it hits gives the die weight
    // without booming — kept quiet and short, and floored in the low-mids (not sub-bass)
    // so a flurry of dice doesn't build into mud.
    this.tone(150 + clamped * 35, vol * 0.5, 0.05 + clamped * 0.07, now, {
      type: "sine",
      glideTo: 112,
      glide: 0.06,
    });

    // The warm knock carries the clack: filtered noise with the harsh top rolled off, so it
    // reads as a solid object landing rather than a sharp click. The low-pass opens a
    // little with strength, so only hard hits get bright.
    this.noiseHit(360 + clamped * 760, vol * 0.82, 0.06 + clamped * 0.05, now, {
      q: 0.8,
      lowpass: 1700 + clamped * 2400,
    });
  }

  /// <summary>
  /// One click of held dice knocking together — fired by the engine on each direction
  /// reversal while shaking. Rate-limited here (not by the caller) so a jittery pointer
  /// can't chatter. Sample-only; silent until shake files exist.
  /// </summary>
  shake(intensity: number) {
    if (this.muted) {
      return;
    }
    const clamped = Math.max(0, Math.min(1, intensity));
    playSfx("dice-shake", { gain: 0.25 + clamped * 0.55, pitchJitter: 0.08, rateLimitMs: 70 });
  }

  /// <summary>
  /// Plays the throw-release sounds at the start of track playback (roller and remote
  /// clients alike): a shake/whoosh for dice, the airborne flip shimmer for coins.
  /// Sample-only — stays silent (no synth equivalent) until the files exist.
  /// </summary>
  throwStart(hasDice: boolean, hasCoin: boolean) {
    if (this.muted) {
      return;
    }
    if (hasDice) {
      playSfx("dice-throw", { gain: 0.55, pitchJitter: 0.04 });
    }
    if (hasCoin) {
      playSfx("coin-flip", { gain: 0.8, pitchJitter: 0.03 });
    }
  }

  /// <summary>
  /// A coin's metallic "ting": a few inharmonic partials that ring out over a soft landing
  /// thud. A higher volume floor than a die tap so the flip always sings, even on a gentle
  /// landing.
  /// </summary>
  private coinRing(clamped: number, now: number) {
    if (!this.ctx || !this.master) {
      return;
    }
    const vol = 0.14 + clamped * 0.26;

    // Bright clink at the moment of contact — brief, so it snaps without turning sharp.
    this.noiseHit(2600, vol * 0.45, 0.04, now, { q: 1.4, lowpass: 6000, attack: 0.001 });

    // Inharmonic partials read as metal, not a tuned bell; the beating between them is the
    // shimmer. Higher partials ring shorter and softer, and each glides down a hair as it
    // decays like a real coin settling.
    const f0 = 2080;
    const partials: Array<[ratio: number, gain: number, decay: number]> = [
      [1.0, vol * 0.6, 0.52],
      [1.34, vol * 0.4, 0.44],
      [1.71, vol * 0.22, 0.32],
    ];
    for (const [ratio, gain, decay] of partials) {
      const freq = f0 * ratio;
      this.tone(freq, gain, decay, now, { type: "sine", glideTo: freq * 0.985, glide: decay });
    }

    // Soft low thud so the coin still lands on the table, not in mid-air.
    this.tone(150, vol * 0.5, 0.1, now, { type: "sine", glideTo: 112, glide: 0.06 });
  }

  /// <summary>Standard percussive envelope: a fast (click-free) attack, then an exponential
  /// decay to silence.</summary>
  private envelope(gain: GainNode, peak: number, attack: number, decay: number, now: number) {
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peak, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + attack + decay);
  }

  /// <summary>Plays one oscillator voice, optionally gliding its pitch (for thud/ring).</summary>
  private tone(
    freq: number,
    peak: number,
    decay: number,
    now: number,
    opts: { type?: OscillatorType; glideTo?: number; glide?: number; attack?: number } = {},
  ) {
    if (!this.ctx || !this.master) {
      return;
    }
    const { type = "sine", glideTo, glide = 0.05, attack = 0.003 } = opts;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (glideTo) {
      osc.frequency.exponentialRampToValueAtTime(glideTo, now + glide);
    }
    const gain = this.ctx.createGain();
    this.envelope(gain, peak, attack, decay, now);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + attack + decay + 0.02);
  }

  /// <summary>Plays a filtered noise burst — a band-passed clack, optionally low-passed to
  /// tame the harsh top end.</summary>
  private noiseHit(
    bandFreq: number,
    peak: number,
    decay: number,
    now: number,
    opts: { q?: number; lowpass?: number; attack?: number } = {},
  ) {
    if (!this.ctx || !this.master || !this.noise) {
      return;
    }
    const { q = 0.9, lowpass, attack = 0.003 } = opts;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const band = this.ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = bandFreq;
    band.Q.value = q;
    let node: AudioNode = src.connect(band);
    if (lowpass) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = lowpass;
      node = node.connect(lp);
    }
    const gain = this.ctx.createGain();
    this.envelope(gain, peak, attack, decay, now);
    node.connect(gain).connect(this.master);
    src.start(now);
    src.stop(now + attack + decay + 0.05);
  }

  dispose() {
    // The context is the app-wide shared one — never close it here; just detach this
    // instance's output so its synth voices can't keep playing into the mix.
    this.unsubVolume?.();
    this.unsubVolume = null;
    this.master?.disconnect();
    this.master = null;
    this.ctx = null;
  }
}

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
