/// <summary>
/// Procedurally synthesizes dice-clatter sound effects with the Web Audio API.
/// Generating the sound in code (a filtered noise burst plus a short pitched "tock")
/// means the feature ships zero audio files — no bundle weight and no R2 usage.
/// </summary>

const STORAGE_KEY = "dice-muted";

export class DiceAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted: boolean;
  private lastImpactAt = 0;

  constructor() {
    this.muted = readMuted();
  }

  /// <summary>Lazily creates the audio graph; safe to call repeatedly.</summary>
  private ensure(): boolean {
    if (this.ctx) {
      return true;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      return false;
    }
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);

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
  /// Plays a dice impact. `strength` (0..1) scales volume and brightness. Impacts are
  /// rate-limited so a flurry of contacts in one frame does not stack into a roar.
  /// </summary>
  impact(strength: number) {
    if (this.muted || !this.ensure() || !this.ctx || !this.master || !this.noise) {
      return;
    }
    const now = this.ctx.currentTime;
    if (now - this.lastImpactAt < 0.02) {
      return;
    }
    this.lastImpactAt = now;

    const clamped = Math.max(0, Math.min(1, strength));
    const vol = 0.1 + clamped * 0.55;

    // Filtered noise burst — the clack of a die hitting the surface.
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const band = this.ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 850 + clamped * 1900;
    band.Q.value = 1.1;
    const burstGain = this.ctx.createGain();
    burstGain.gain.setValueAtTime(vol, now);
    burstGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.12);
    src.connect(band).connect(burstGain).connect(this.master);
    src.start(now);
    src.stop(now + 0.14);

    // A short pitched body so it reads as a solid object, not just static.
    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(150 + clamped * 130, now);
    const oscGain = this.ctx.createGain();
    oscGain.gain.setValueAtTime(vol * 0.35, now);
    oscGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.08);
    osc.connect(oscGain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.09);
  }

  dispose() {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
