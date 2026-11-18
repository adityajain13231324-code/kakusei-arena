// Fully synthesised audio (WebAudio, no files): SFX from sim events, procedural music, UI sounds.
// Call unlock() from a user gesture. handleEvents() should be called once per sim step (also with an empty
// array) because loops (ki charge hum, beam clash roar) are driven from state.
import type { GameState, SimEvent } from '../sim/types';
import { Engine } from './engine';
import { Music } from './music';
import { Sfx } from './sfx';

export type UiSound = 'move' | 'select' | 'back' | 'start' | 'error';
export type MusicTrack = 'menu' | 'rooftop' | 'shrine' | 'training' | 'victory' | 'none';

export class AudioSystem {
  private e = new Engine();
  private sfx = new Sfx(this.e);
  private mus = new Music(this.e);
  private paused = false;
  private pendingMusic: MusicTrack | null = null;
  private wd: number | null = null;

  /** must be called from a user gesture */
  unlock(): void {
    this.e.resume();
    if (this.wd === null && this.e.ctx) this.wd = window.setInterval(() => { if (!this.paused) this.sfx.watchdog(); }, 250);
    if (this.pendingMusic && this.e.ctx) { const t = this.pendingMusic; this.pendingMusic = null; this.mus.set(t); }
  }

  handleEvents(events: SimEvent[], state: GameState): void {
    if (this.paused) return;
    this.sfx.handle(events, state);
  }

  ui(s: UiSound): void {
    this.e.resume();
    this.sfx.ui(s);
  }

  music(t: MusicTrack): void {
    if (!this.e.ctx) { this.pendingMusic = t; this.e.resume(); if (!this.e.ctx) return; }
    this.e.resume();
    this.mus.set(t);
  }

  setVolumes(master: number, music: number, sfx: number): void {
    const c = (v: number) => Math.max(0, Math.min(1, v));
    this.e.vols = { master: c(master), music: c(music), sfx: c(sfx) };
    this.e.applyVolumes();
  }

  setPaused(p: boolean): void {
    this.paused = p;
    const e = this.e;
    if (!e.ctx) return;
    const t = e.now;
    if (p) {
      this.sfx.stopAll();
      e.sfxPause.gain.setTargetAtTime(0, t, 0.03);
      e.musicLP.frequency.setTargetAtTime(450, t, 0.08);
      e.musicBus.gain.setTargetAtTime(e.vols.music * 0.35, t, 0.08);
    } else {
      e.sfxPause.gain.setTargetAtTime(1, t, 0.03);
      e.musicLP.frequency.setTargetAtTime(20000, t, 0.15);
      e.musicBus.gain.setTargetAtTime(e.vols.music, t, 0.1);
    }
  }

  /** extra: toggle speechSynthesis announcer ("Round one", "Fight", "K.O."); default on */
  setAnnouncer(on: boolean): void { this.sfx.announcer = on; }
  /** extra: fires when the victory jingle ends */
  onMusicEnd(cb: (() => void) | null): void { this.mus.onEnd = cb; }
  /** extra (debug): peak level of the master bus, 0..1 */
  debugPeak(): number {
    const a = this.e.analyser;
    if (!a) return 0;
    const d = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(d);
    let m = 0;
    for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]!));
    return m;
  }
  debugVoices(): number { return this.e.voices; }
}
