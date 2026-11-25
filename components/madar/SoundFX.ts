'use client';

/**
 * Lightweight procedural Web Audio sound synthesizer for MADAR games.
 * Muted by default per user preference; unlocks automatically once enabled.
 */
class MadarSoundEngine {
  private ctx: AudioContext | null = null;
  private enabled = false;

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(next: boolean) {
    this.enabled = next;
    if (next) {
      this.ensureContext();
      this.playClick();
    }
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private playTone(freq: number, duration: number, type: OscillatorType = 'sine', gainPeak = 0.08, delay = 0) {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainPeak, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  public playClick() {
    this.playTone(540, 0.06, 'triangle', 0.04);
  }

  public playCardSnap() {
    this.playTone(320, 0.055, 'triangle', 0.065);
    this.playTone(620, 0.04, 'sine', 0.045, 0.02);
  }

  public playBottleTick() {
    this.playTone(760, 0.035, 'triangle', 0.035);
  }

  public playBottleStop() {
    this.playTone(440, 0.14, 'sine', 0.07);
    this.playTone(660, 0.18, 'triangle', 0.075, 0.09);
    this.playTone(880, 0.28, 'sine', 0.07, 0.18);
  }

  public playCorrect() {
    this.playTone(523.25, 0.12, 'triangle', 0.07);
    this.playTone(659.25, 0.16, 'triangle', 0.08, 0.09);
  }

  public playWrong() {
    this.playTone(230, 0.18, 'sawtooth', 0.05);
    this.playTone(175, 0.22, 'sawtooth', 0.045, 0.1);
  }

  public playWinFanfare() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, i) => {
      this.playTone(n, 0.24, 'triangle', 0.08, i * 0.09);
    });
  }

  public playNightTransition() {
    this.playTone(220, 0.35, 'sine', 0.06);
    this.playTone(164.8, 0.45, 'sine', 0.05, 0.12);
  }
}

export const madarSound = new MadarSoundEngine();
