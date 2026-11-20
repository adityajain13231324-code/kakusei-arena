// Sound v2 sample layer: maps sim events (+ state) to the bundled sample library, layered on top of the synth SFX.
// Reads events/state only. Anything that is not loaded yet simply does not play (the synth underneath covers it).
import type { CharId, GameState, SimEvent, StageId } from '../sim/types';
import { moveDef } from '../data';
import type { Engine } from './engine';
import { SampleBank } from './samples';
import type { PlayOpts } from './samples';
import { findCallout } from './callouts';

export interface MatchInfo { p1: CharId; p2: CharId; stage: StageId; mode: string }

const LV = { light: 'light', medium: 'medium', heavy: 'heavy', super: 'heavy' } as const;
const BLADE_RE = /slash|draw|sword|blade|katana|thrust|petal|cut/i;
const KICK_RE = /kick|sweep|heel|wheel|stomp/i;

export class SampleLayer {
  readonly bank: SampleBank;
  announcer = true;
  private info: MatchInfo | null = null;
  private calloutCache = new Map<string, string>();
  private mat = new Map<string, number>(); // 0 flesh 1 metal 2 stone
  private limb = new Map<string, number>(); // 0 punch 1 kick 2 sword
  private lastT: Record<string, number> = {};
  private prevX = new Float64Array(2); private prevZ = new Float64Array(2);
  private accum = new Float64Array(2); private havePrev = false;
  private realmRev = false;
  private matchEndDone = -1;

  constructor(private e: Engine) { this.bank = new SampleBank(e); }

  // ------------------------------------------------------------ loading
  /** UI sounds: first user interaction */
  warmUi(): void {
    if (!this.e.ctx) return;
    void this.bank.loadManifest().then(() => this.bank.preload(this.bank.ids((_, d) => d.category === 'ui')));
  }

  /** VS / loading screen: fight SFX, announcer and both fighters' voices; resolves when decoded (callers never await it) */
  prepare(info: MatchInfo): Promise<void> {
    this.info = info;
    this.calloutCache.clear();
    this.havePrev = false; this.matchEndDone = -1;
    this.lastT = {};
    const e = this.e;
    if (!e.ctx) return Promise.resolve();
    e.setStageReverb(info.stage);
    return this.bank.loadManifest().then(() => this.bank.preload(this.bank.ids((id, d) => {
      if (d.category === 'ui') return false;
      if (id.startsWith('announcer_')) return true;
      if (id.startsWith('voice_')) return d.fighter === info.p1 || d.fighter === info.p2;
      return true;
    })));
  }

  private since(k: string, gap: number): boolean {
    const t = this.e.now;
    if (t - (this.lastT[k] ?? -99) < gap) return false;
    this.lastT[k] = t;
    return true;
  }

  // ------------------------------------------------------------ helpers
  private sfx(id: string, cat: string, o?: PlayOpts): number { return this.bank.play(id, cat, o); }

  private ann(id: string, delay = 0, music = 0.4): number {
    if (!this.announcer) return 0;
    const d = this.bank.play(id, 'announcer', { delay, gj: 0, pj: 0 });
    if (d > 0) this.e.duckVoice(music, 0.75, delay + d);
    return d;
  }

  private fighterVoice(char: CharId, line: string, delay = 0, gain = 1, duck = true): number {
    const d = this.bank.play(`voice_${char}_${line}`, 'fighter', { delay, gain, gj: 0.05, pj: 40 });
    if (d > 0 && duck) this.e.duckVoice(0.6, 0.85, delay + d);
    return d;
  }

  private calloutFor(char: CharId, moveId: string): string {
    const key = char + ':' + moveId;
    let c = this.calloutCache.get(key);
    if (c === undefined) {
      const m = moveDef(char, moveId);
      c = m && this.bank.defs ? findCallout(this.bank.defs, char, m) : '';
      this.calloutCache.set(key, c);
    }
    return c;
  }

  private material(char: CharId, moveId: string | undefined, el: string | undefined): number {
    const key = char + ':' + (moveId ?? '') + ':' + (el ?? '');
    let v = this.mat.get(key);
    if (v === undefined) {
      const m = moveId ? moveDef(char, moveId) : undefined;
      const blade = el === 'blade' || !!m && (m.element === 'blade' || m.anim.some((a) => BLADE_RE.test(a[1])) || BLADE_RE.test(m.fx ?? ''));
      v = blade ? 1 : (char === 'goro' || el === 'earth' || m?.element === 'earth') ? 2 : 0;
      this.mat.set(key, v);
    }
    return v;
  }

  private impact(t: 'light' | 'medium' | 'heavy', material: number, o?: PlayOpts): void {
    this.sfx(`hit_${t}_${material === 1 ? 'metal' : material === 2 ? 'stone' : 'flesh'}`, 'impact', o);
  }

  private foot(delay = 0, gain = 1): void {
    const st = this.info?.stage;
    let id = st === 'shrine' ? 'foot_wood' : 'foot_concrete';
    if (st === 'shrine' && this.bank.rnd() < 0.25) id = 'foot_stone';
    this.sfx(id, 'foot', { delay, gain, pj: 120, gj: 0.2 });
  }

  // ------------------------------------------------------------ per step state (footsteps, realm reverb)
  update(state: GameState): void {
    const e = this.e;
    const realm = !!state.realm || (state.clash.active && state.clash.kind === 'realm');
    if (realm !== this.realmRev) { this.realmRev = realm; e.setRealmReverb(realm); }
    for (let i = 0; i < 2; i++) {
      const f = state.fighters[i]!;
      const x = f.pos.x, z = f.pos.z;
      if (this.havePrev && (f.mode === 'walk' || f.mode === 'sidewalk') && !f.airborne) {
        this.accum[i] = this.accum[i]! + Math.abs(x - this.prevX[i]!) + Math.abs(z - this.prevZ[i]!);
        if (this.accum[i]! > 640) { this.accum[i] = 0; this.foot(0, 0.8); }
      } else this.accum[i] = 0;
      this.prevX[i] = x; this.prevZ[i] = z;
    }
    this.havePrev = true;
  }

  // ------------------------------------------------------------ events
  /** returns true if an announcer sample took over this event's speech (the TTS fallback then stays quiet) */
  onEvent(ev: SimEvent, state: GameState): boolean {
    const b = this.bank;
    if (!b.defs) return false;
    const fi = state.fighters[ev.player];
    const char = ev.charId ?? fi?.char ?? 'kaito';
    const tgt = ev.target !== undefined ? state.fighters[ev.target] : undefined;
    const lv = LV[ev.strength ?? 'medium'];
    let said = 0;
    switch (ev.type) {
      case 'moveStart': this.moveStart(ev, char); break;
      case 'hit': {
        if (ev.tag === 'heat' && !ev.damage) break;
        const mat = this.material(char, ev.moveId, ev.element);
        const big = ev.tag === 'throw' || ev.tag === 'otg' ? 'heavy' : lv;
        this.impact(ev.tag === 'armor' && big === 'heavy' ? 'medium' : big, mat);
        if (tgt && (big === 'heavy' || (ev.damage ?? 0) >= 90) && this.since('hurt' + ev.target, 1.4) && b.rnd() < 0.75) this.fighterVoice(tgt.char, 'hurt', 0.04, 0.9, false);
        break;
      }
      case 'counter':
        this.sfx('parry', 'block', { gain: 0.5, delay: 0.01 });
        if (this.since('crowdCheer', 3)) this.sfx('crowd_cheer', 'crowd', { delay: 0.1, gain: 0.8 });
        if (this.since('annCounter', 4)) said = this.ann('announcer_counter', 0.12, 0.6);
        break;
      case 'block': this.sfx(`block_${lv}`, 'block'); break;
      case 'parry': this.sfx('parry', 'block'); break;
      case 'infinityBlock': this.sfx('parry', 'block', { gain: 0.8, rate: 0.9 }); break;
      case 'guardCrush':
        this.sfx('guard_crush', 'block');
        if (this.since('gasp', 2.5)) this.sfx('crowd_gasp', 'crowd', { delay: 0.1 });
        if (this.since('annCrush', 5)) said = this.ann('announcer_guard_crush', 0.3, 0.6);
        break;
      case 'throw': this.impact('heavy', 0); this.sfx('cloth', 'cloth', { delay: 0.02 }); break;
      case 'throwBreak': this.sfx('parry', 'block', { gain: 0.6, rate: 1.1 }); break;
      case 'jump': this.sfx('cloth', 'cloth', { gain: 0.8 }); break;
      case 'sidestep': this.sfx('cloth_belt', 'cloth'); this.foot(0.02, 0.6); break;
      case 'dash': this.sfx('cloth', 'cloth', { gain: 0.9 }); this.foot(0, 0.9); break;
      case 'land': if (ev.tag === 'tech') this.sfx('cloth', 'cloth', { gain: 0.8 }); else if (ev.tag !== 'body') this.foot(0, 1.3); break;
      case 'launch': this.sfx('whoosh_heavy', 'whoosh', { gain: 0.6 }); break;
      case 'wallSplat': this.impact('medium', 2); break;
      case 'groundBounce': this.sfx('fall_body', 'fall', { gain: 0.7 }); break;
      case 'knockdown': {
        const heavy = (ev.combo ?? 0) >= 4 || (ev.damage ?? 0) >= 150;
        this.sfx(heavy ? 'fall_knockdown_heavy' : 'fall_body', 'fall');
        break;
      }
      case 'projectileHit': this.impact('medium', this.material(char, ev.moveId, ev.element), { gain: 0.8 }); break;
      case 'awaken':
        this.sfx('fx_awaken', 'fx');
        if (this.since('annAwaken', 6)) said = this.ann('announcer_awakening', 0.45, 0.45);
        if (this.since('crowdCheer', 3)) this.sfx('crowd_cheer', 'crowd', { delay: 1.2 });
        break;
      case 'ultimateStart':
        if (this.since('crowdCheer', 3)) this.sfx('crowd_cheer', 'crowd', { delay: 0.7 });
        break;
      case 'ultimateHit': this.sfx('ko_blast', 'impact', { gain: 0.7 }); break;
      case 'realmStart': {
        this.sfx('fx_awaken', 'fx', { gain: 0.8 });
        if (this.since('gasp', 2.5)) this.sfx('crowd_gasp', 'crowd', { delay: 0.2 });
        const f = fi?.char;
        if (f && this.since('callout' + ev.player, 2)) { const c = this.calloutFor(f, ev.moveId ?? ''); if (c) this.bank.play(c, 'fighter', { gj: 0.03, pj: 0 }); }
        said = this.ann(ev.tag === 'infinite_void' ? 'announcer_domain_expansion' : 'announcer_soul_realm', 0.95, 0.4);
        break;
      }
      case 'realmClash':
        if (this.since('gasp', 1)) this.sfx('crowd_gasp', 'crowd', { delay: 0.1 });
        if (this.since('crowdCheer', 2)) this.sfx('crowd_cheer', 'crowd', { delay: 0.6 });
        said = this.ann('announcer_realm_clash', 0.1, 0.4);
        break;
      case 'ko': this.ko(ev, state); said = 1; break;
      case 'timeout': said = this.ann(ev.tag === 'draw' ? 'announcer_draw_game' : 'announcer_time', 0, 0.4); if (ev.tag === 'draw') this.lastT.drawAnn = this.e.now; break;
      case 'roundStart': said = this.roundStart(ev, state) ? 1 : 0; break;
      case 'fight': if (ev.tag !== 'training') said = this.ann('announcer_fight', 0, 0.5); break;
      case 'matchEnd': this.matchEnd(ev, state); break;
      default: break;
    }
    return said > 0;
  }

  private moveStart(ev: SimEvent, char: CharId): void {
    const m = ev.moveId ? moveDef(char, ev.moveId) : undefined;
    if (!m) return;
    const b = this.bank;
    // fighter voice: special / ultimate / realm callouts always; plain heavy attacks and uncalled specials only sometimes
    const call = this.calloutFor(char, m.id);
    if (call) {
      if (this.since('callout' + ev.player, 0.6)) { const d = b.play(call, 'fighter', { gj: 0.03, pj: 0 }); if (d > 0) this.e.duckVoice(0.6, 0.85, d); }
    } else if (m.kind !== 'universal' && m.kind !== 'ultimate' && m.input) {
      const p = m.kind === 'special' || m.kind === 'ki' || m.kind === 'throw' ? 0.55 : m.strength === 'heavy' ? 0.35 : 0;
      if (p > 0 && b.rnd() < p && this.since('shout' + ev.player, 1.6)) this.fighterVoice(char, 'attack', 0.02, 0.9, false);
    }
    // whoosh per limb
    if (m.kind === 'ultimate' || m.hitboxes.length === 0) return;
    let limb = this.limb.get(m.id);
    if (limb === undefined) {
      limb = this.material(char, m.id, m.element) === 1 ? 2 : (KICK_RE.test(m.name) || KICK_RE.test(m.id) || m.anim.some((a) => /kick/i.test(a[1]))) ? 1 : 0;
      this.limb.set(m.id, limb);
    }
    const id = limb === 2 ? (m.strength === 'heavy' || m.strength === 'super' ? 'whoosh_sword_long' : 'whoosh_sword')
      : limb === 1 ? (m.strength === 'heavy' || m.strength === 'super' ? 'whoosh_heavy' : 'whoosh_kick')
        : m.strength === 'light' ? 'whoosh_jab' : m.strength === 'medium' ? 'whoosh_punch' : 'whoosh_heavy';
    this.sfx(id, 'whoosh', { delay: Math.min(0.6, Math.max(0, m.startup - 3) / 60) });
  }

  private ko(ev: SimEvent, state: GameState): void {
    const double = ev.tag === 'double';
    this.sfx('ko_blast', 'impact', { gain: 0.9 });
    this.sfx('crowd_cheer', 'crowd', { delay: 0.2 });
    this.lastT.crowdCheer = this.e.now;
    this.ann(double ? 'announcer_double_ko' : 'announcer_ko', 0.05, 0.25);
    if (double) {
      for (const f of state.fighters) this.fighterVoice(f.char, 'ko', 0.25, 1, false);
      return;
    }
    const loser = ev.target !== undefined ? state.fighters[ev.target] : undefined;
    if (loser) this.fighterVoice(loser.char, 'ko', 0.3, 1, false);
    const w = state.fighters[ev.player];
    if (w && w.hp >= w.maxHp) this.ann('announcer_perfect', 1.15, 0.3);
  }

  private roundStart(ev: SimEvent, state: GameState): boolean {
    const n = state.round.number;
    const id = n >= 3 ? 'announcer_final_round' : n === 2 ? 'announcer_round_2' : 'announcer_round_1';
    const d = this.ann(id, 0, 0.3);
    if (d <= 0) return false;
    const rdy = this.bank.duration('announcer_ready');
    if (rdy > 0 && d + 0.1 + rdy < 1.35) this.ann('announcer_ready', d + 0.1, 0.3);
    if (n === 1 && ev.tag === '1' && this.info) {
      // both fighters' intro lines, only when they fit before "Fight!" (1.5 s intro)
      const p1 = this.info.p1, p2 = this.info.p2;
      this.fighterVoice(p1, 'intro', 0.1, 0.75, false);
      const dur = this.bank.duration(`voice_${p2}_intro`);
      if (dur > 0 && dur < 1.0) this.fighterVoice(p2, 'intro', 0.55, 0.65, false);
    }
    return true;
  }

  private matchEnd(ev: SimEvent, state: GameState): void {
    if (this.matchEndDone === state.frame) return;
    this.matchEndDone = state.frame;
    if (ev.tag === 'draw') {
      if (this.e.now - (this.lastT.drawAnn ?? -99) > 6) this.ann('announcer_draw_game', 1.2, 0.35);
      return;
    }
    const w = state.fighters[ev.player];
    if (!w) return;
    const base = 1.8;
    if (this.info?.mode === 'arcade') {
      this.ann(ev.player === 0 ? 'announcer_you_win' : 'announcer_you_lose', base, 0.35);
      if (ev.player === 0) this.sfx('crowd_cheer', 'crowd', { delay: base });
      else this.sfx('crowd_boo', 'crowd', { delay: base });
      this.fighterVoice(w.char, 'win', base + 1.4, 1, false);
      return;
    }
    const nd = this.ann(`announcer_name_${w.char}`, base, 0.35);
    const wd = this.ann('announcer_wins', base + (nd > 0 ? nd + 0.02 : 0.6), 0.35);
    this.sfx('crowd_cheer', 'crowd', { delay: base + 0.1 });
    this.fighterVoice(w.char, 'win', base + (nd > 0 ? nd : 0.6) + (wd > 0 ? wd : 0.5) + 0.5, 1, false);
  }

  // ------------------------------------------------------------ UI / misc
  ui(s: 'move' | 'select' | 'back' | 'start' | 'error' | 'hover' | 'press'): void {
    if (!this.bank.defs) { void this.bank.loadManifest(); return; }
    const id = s === 'hover' ? 'ui_hover' : s === 'select' ? 'ui_select' : s === 'back' ? 'ui_back' : s === 'start' ? 'ui_confirm'
      : s === 'error' ? 'ui_error' : s === 'move' ? 'ui_slider_tick' : 'ui_toggle';
    this.bank.play(id, 'ui', { gj: 0.06, pj: s === 'hover' || s === 'move' ? 120 : 40, gain: s === 'press' ? 0.7 : 1 });
  }
  pauseOpen(): void { this.bank.play('ui_open', 'ui'); }
  stopAll(): void { this.bank.stopAll(); }
}

