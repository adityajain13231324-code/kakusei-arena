// Fully synthesised audio (WebAudio, no files): SFX from sim events, procedural music, UI sounds.
// Call unlock() from a user gesture. handleEvents() should be called once per sim step (also with an empty
// array) because loops (ki charge hum, beam clash roar) are driven from state.
import type { GameState, SimEvent } from '../sim/types';
import { Engine } from './engine';
import { Music } from './music';
import { Sfx } from './sfx';
import { CHAR_REALM } from './crossover';
import type { MatchInfo } from './layer';

export type UiSound = 'move' | 'select' | 'back' | 'start' | 'error' | 'hover' | 'press';
export type MusicTrack = 'menu' | 'rooftop' | 'shrine' | 'training' | 'victory' | 'char_select' | 'market' | 'oboro_boss' | 'none';

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
    if (this.e.ctx) this.sfx.layer.warmUi();
    if (this.pendingMusic && this.e.ctx) { const t = this.pendingMusic; this.pendingMusic = null; this.mus.set(t); }
  }

  private realmSeen = new Set<string>();
  private lastRealmT = 0;

  handleEvents(events: SimEvent[], state: GameState): void {
    if (this.paused) return;
    this.sfx.handle(events, state);
    this.realmMusic(events, state);
  }

  /** Soul Realm music: duck the stage track + layer the owner's realm theme; both themes on a Realm Clash */
  private realmMusic(events: SimEvent[], state: GameState): void {
    if (!this.e.ctx) return;
    const now = this.e.now;
    const dt = Math.min(0.5, Math.max(0, now - this.lastRealmT));
    this.lastRealmT = now;
    for (const ev of events) {
      if (ev.type !== 'realmStart' && ev.type !== 'realmEnd' && ev.type !== 'realmClash' && ev.type !== 'clashEnd') continue;
      if (ev.type === 'clashEnd' && ev.tag !== 'realm' && ev.tag !== 'realmDraw') continue;
      const key = `${ev.frame}:${ev.type}:${ev.player}`;
      if (this.realmSeen.has(key)) continue;
      if (this.realmSeen.size > 40) this.realmSeen.clear();
      this.realmSeen.add(key);
      switch (ev.type) {
        case 'realmStart': this.mus.realmOn(ev.tag ?? ''); break;
        case 'realmClash':
          for (const f of state.fighters) { const k = CHAR_REALM[f.char]; if (k) this.mus.realmOn(k); }
          break;
        case 'clashEnd': {
          if (ev.tag === 'realmDraw') { this.mus.realmOff(); break; }
          // the loser's world collapses; the winner's realm keeps playing (its own realmStart follows)
          const loser = state.fighters[1 - ev.player as 0 | 1];
          const lk = loser ? CHAR_REALM[loser.char] : undefined;
          if (lk) this.mus.realmOff(lk);
          break;
        }
        case 'realmEnd': this.mus.realmOff(); break;
        default: break;
      }
    }
    this.mus.realmWatch(!!state.realm || state.clash.active, dt);
  }

  /**
   * VS / loading screen: pick the stage reverb and decode the fight SFX, the announcer and both fighters' voices in the
   * background. Never awaited by the match start; whatever is not decoded yet just stays silent (synth plays anyway).
   */
  prepareMatch(info: MatchInfo): void {
    try {
      this.e.init(); // a suspended context is fine for decoding; unlock() resumes it on the next gesture
      void this.sfx.layer.prepare(info).catch(() => undefined);
    } catch { /* audio unavailable */ }
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

  setVolumes(master: number, music: number, sfx: number, voice?: number, announcer?: number): void {
    const c = (v: number) => Math.max(0, Math.min(1, v));
    const old = this.e.vols;
    this.e.vols = { master: c(master), music: c(music), sfx: c(sfx), voice: c(voice ?? old.voice), announcer: c(announcer ?? old.announcer) };
    this.e.applyVolumes();
  }

  setPaused(p: boolean): void {
    this.paused = p;
    const e = this.e;
    if (!e.ctx) return;
    const t = e.now;
    if (p) {
      this.sfx.stopAll();
      this.sfx.layer.pauseOpen();
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
