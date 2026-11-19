/**
 * GOJO SATORU — The Strongest (Crossover Pack). Zoner / control.
 * Passive INFINITY: enemy projectiles crawl at 30% speed within 1.2 m of him; the first hit that would land
 * each round is auto-guarded ('infinityBlock'). Blue drags the opponent in, Red repels into the wall,
 * Blink teleports behind (50 Ki). Awakening = Six Eyes (blindfold off): x2 Ki gain, reads one teleport.
 * Ultimate Hollow Purple (beam, clash-capable). Soul Realm: Domain Expansion — Infinite Void.
 */
import type { CharDef } from '../../sim/types';
import { mv, throwPair, BOX } from '../build';

const SC = ['special', 'ki', 'ultimate'];

export const GOJO: CharDef = {
  id: 'gojo',
  name: 'SATORU GOJO',
  title: 'The Strongest',
  maxHp: 980,
  walkSpeed: 46,
  backWalkSpeed: 40,
  dashSpeed: 100,
  sidestepSpeed: 54,
  jumpVel: 80,
  weight: 96,
  height: 1900,
  radius: 290,
  palette: { primary: '#15171e', secondary: '#2b303c', accent: '#7fd6ff', hair: '#f2f4f8', skin: '#f1d3bd', aura: '#5aa8ff' },
  element: 'void',
  ultimateId: 'gojo_ult',
  awakenedUltimateId: 'gojo_ult_aw',
  realmId: 'gojo_domain',
  autoComboEnder: 'gojo_red',
  moves: [
    // ---------------------------------------------------------------- normals / strings
    mv({ id: 'gojo_jab', name: 'Flick', input: 'L', s: 10, a: 2, r: 12, dmg: 42, h: 'high', str: 'light',
      blk: 1, hit: 8, box: BOX.jab, wind: 'jabWind', ext: 'jabExt', cancel: SC, window: [11, 22], fx: 'void_flick' }),
    mv({ id: 'gojo_jab2', name: 'Double Flick', input: 'L,L', s: 9, a: 2, r: 14, dmg: 38, h: 'high', str: 'light',
      blk: -2, hit: 6, box: BOX.jab, wind: 'straightWind', ext: 'straightExt', cancel: SC, window: [10, 23], fx: 'void_flick' }),
    mv({ id: 'gojo_jab3', name: 'Cursed Palm', input: 'L,L,H', s: 14, a: 3, r: 20, dmg: 72, h: 'mid', str: 'medium', el: 'void',
      blk: -8, hit: 4, box: BOX.mid, wind: 'palmWind', ext: 'palmExt', cancel: SC, window: [15, 26], fx: 'void_palm' }),
    mv({ id: 'gojo_palm', name: 'Limitless Palm', input: 'H', s: 14, a: 3, r: 18, dmg: 95, h: 'mid', str: 'medium', el: 'void',
      blk: -6, hit: 5, box: { x: 250, y: 1200, len: 560, r: 140 }, wind: 'palmWind', ext: 'palmExt', cancel: SC, window: [15, 27], fx: 'void_palm' }),
    mv({ id: 'gojo_palm2', name: 'Repulse', input: 'H,H', s: 16, a: 3, r: 22, dmg: 108, h: 'mid', str: 'heavy', el: 'void',
      blk: -12, onHit: 'knockdown', box: { x: 230, y: 1250, len: 540, r: 150 }, wind: 'hookWind', ext: 'palmExt', cancel: SC, window: [17, 28], fx: 'void_repel' }),
    mv({ id: 'gojo_kick', name: 'Long Kick', input: 'K', s: 13, a: 3, r: 19, dmg: 84, h: 'mid', str: 'medium',
      blk: -5, hit: 4, box: { x: 250, y: 1050, len: 650, r: 130 }, wind: 'midKickWind', ext: 'midKickExt', cancel: SC, window: [14, 24], fx: 'kick_medium' }),
    mv({ id: 'gojo_lowkick', name: 'Low Tap', input: '2L', s: 12, a: 2, r: 15, dmg: 32, h: 'low', str: 'light',
      blk: -12, hit: 3, box: BOX.low, wind: 'lowKickWind', ext: 'lowKickExt', fx: 'kick_light' }),
    mv({ id: 'gojo_sweep', name: 'Void Sweep', input: '2K', s: 16, a: 3, r: 24, dmg: 80, h: 'low', str: 'medium', el: 'void',
      blk: -16, onHit: 'knockdown', box: BOX.sweep, wind: 'lowKickWind', ext: 'sweepExt', fx: 'void_sweep', extra: { otg: true } }),
    mv({ id: 'gojo_launcher', name: 'Upward Flick', input: '3H', s: 15, a: 2, r: 22, dmg: 70, h: 'mid', str: 'medium', el: 'void',
      blk: -14, onHit: 'launch', launch: 62, box: BOX.launcher, wind: 'uppercutWind', ext: 'uppercutExt', fx: 'void_rise' }),
    mv({ id: 'gojo_step', name: 'Pressure Step', input: '6H', s: 15, a: 3, r: 18, dmg: 100, h: 'mid', str: 'medium', trk: 'right',
      blk: -3, hit: 6, onCH: 'stagger', box: { x: 180, y: 1250, len: 420, r: 160 }, wind: 'hookWind', ext: 'elbowExt',
      movement: [[0, 16, 0], [10, 0, 0]], cancel: SC, window: [16, 26], fx: 'punch_heavy' }),
    mv({ id: 'gojo_heel', name: 'Heel Drop', input: '4K', s: 18, a: 3, r: 21, dmg: 112, h: 'mid', str: 'heavy',
      blk: -12, onHit: 'knockdown', onCH: 'launch', launch: 58, box: { x: 220, y: 1100, len: 560, r: 150 },
      wind: 'axeKickUp', ext: 'axeKickDown', fx: 'kick_heavy' }),
    mv({ id: 'gojo_jk', name: 'Falling Kick', input: 'K', requires: 'air', s: 9, a: 6, r: 10, dmg: 78, h: 'mid', str: 'medium',
      blk: -2, hit: 8, box: { x: 150, y: 900, len: 560, r: 150 }, wind: 'jumpUp', ext: 'flyingKick', fx: 'kick_medium' }),
    mv({ id: 'gojo_jh', name: 'Void Hammer', input: 'H', requires: 'air', s: 12, a: 5, r: 12, dmg: 92, h: 'mid', str: 'heavy', el: 'void',
      blk: -4, onHit: 'knockdown', box: { x: 150, y: 800, len: 450, r: 170 }, wind: 'axeKickUp', ext: 'axeKickDown', fx: 'void_palm' }),

    // ---------------------------------------------------------------- specials
    // Blue: slow attraction orb. Negative pushback = the opponent is DRAGGED toward Gojo (combo starter).
    mv({ id: 'gojo_blue', name: 'Cursed Technique Lapse: Blue', kind: 'special', input: '236S', easy: '6S', s: 16, a: 1, r: 19, dmg: 50,
      h: 'mid', str: 'medium', el: 'void', hitstun: 40, blockstun: 14, push: -900, ki: 8,
      anim: [[0, 'palmWind'], [14, 'palmExt'], [30, 'recover'], [37, 'idle']],
      projectile: { kind: 'blue', spawnFrame: 17, x: 500, y: 1200, speed: 34, life: 70, r: 230, hits: 1 }, fx: 'blue_orb' }),
    // Red: point-blank repel blast, reversal with invulnerability, wall bounce / splat
    mv({ id: 'gojo_red', name: 'Reversal: Red', kind: 'special', input: '623S', easy: '2S', s: 9, a: 4, r: 30, dmg: 100,
      h: 'mid', str: 'heavy', el: 'void', blk: -26, onHit: 'wallbounce', invuln: [1, 7], push: 600, ki: 8, movement: [[0, 22, 0], [9, 0, 0]],
      box: { x: 150, y: 1200, len: 460, r: 220 }, wind: 'palmWind', ext: 'palmExt', fx: 'red_blast' }),
    // Blink: short teleport behind the opponent (his own Vanish), costs half a bar
    mv({ id: 'gojo_blink', name: 'Blink', kind: 'special', input: '214S', easy: '4S', s: 5, a: 1, r: 18, dmg: 0, kiCost: 50,
      h: 'mid', str: 'light', el: 'void', invuln: [1, 14], ki: 0,
      anim: [[0, 'vanish'], [12, 'vanish'], [14, 'land'], [20, 'idle']], fx: 'void_blink', extra: { teleport: { frame: 7, to: 'behind' } } }),
    // Six Eyes counter: parries a high/mid melee strike on frames 4-20, answers with point-blank Red
    mv({ id: 'gojo_counter', name: 'Six Eyes Counter', kind: 'special', input: '41236S', easy: '8S', s: 3, a: 18, r: 16, dmg: 0,
      h: 'mid', str: 'medium', el: 'void', ki: 4,
      anim: [[0, 'guardHigh'], [3, 'sheathStance'], [21, 'recover'], [33, 'idle']], fx: 'six_eyes_glint',
      extra: { counter: { from: 4, to: 20, heights: ['high', 'mid'], move: 'gojo_counter_red' } } }),
    mv({ id: 'gojo_counter_red', name: 'Red: Point Blank', kind: 'special', input: '', s: 3, a: 3, r: 24, dmg: 130,
      h: 'mid', str: 'heavy', el: 'void', blk: -20, onHit: 'wallbounce', box: { x: 100, y: 1200, len: 520, r: 240 },
      wind: 'palmWind', ext: 'palmExt', fx: 'red_blast', extra: { internal: true } }),

    // ---------------------------------------------------------------- Ki specials
    mv({ id: 'gojo_max_blue', name: 'Maximum Output: Blue', kind: 'ki', input: '236S+K', easy: 'S+K', kiCost: 100, s: 18, a: 1, r: 30,
      dmg: 40, h: 'mid', str: 'heavy', el: 'void', hitstun: 30, blockstun: 14, push: -700,
      anim: [[0, 'beamCharge'], [18, 'palmExt'], [40, 'recover'], [49, 'idle']],
      projectile: { kind: 'blue_max', spawnFrame: 19, x: 500, y: 1200, speed: 22, life: 90, r: 330, hits: 4 }, fx: 'blue_orb_max' }),
    mv({ id: 'gojo_red_max', name: 'Reversal Red: Maximum', kind: 'ki', input: '214S+K', easy: '2S+K', kiCost: 100, s: 14, a: 1, r: 30,
      dmg: 140, h: 'mid', str: 'heavy', el: 'void', hitstun: 30, blockstun: 16, onHit: 'wallbounce',
      anim: [[0, 'palmWind'], [14, 'palmExt'], [36, 'recover'], [45, 'idle']],
      projectile: { kind: 'red', spawnFrame: 15, x: 400, y: 1250, speed: 70, life: 40, r: 240, hits: 1 }, fx: 'red_blast_max' }),

    // ---------------------------------------------------------------- throw
    ...throwPair('gojo', 'Infinity Toss', 125, 'void'),

    // ---------------------------------------------------------------- ultimates (beam: clash-capable)
    mv({ id: 'gojo_ult', name: 'Hollow Technique: Purple', kind: 'ultimate', input: '236H+S', easy: 'Ult', kiCost: 300, s: 30, a: 1, r: 40,
      dmg: 72, chip: 20, h: 'mid', str: 'super', el: 'void', hitstun: 30, blockstun: 14, invuln: [1, 30],
      anim: [[0, 'beamCharge'], [14, 'palmWind'], [30, 'beamFire'], [60, 'recover'], [69, 'idle']], cinematic: 'ultimate',
      projectile: { kind: 'hollow_purple', spawnFrame: 31, x: 600, y: 1250, speed: 60, life: 60, r: 380, hits: 6, beam: true }, fx: 'hollow_purple' }),
    mv({ id: 'gojo_ult_aw', name: 'Hollow Purple: 200%', kind: 'ultimate', input: '236H+S', easy: 'Ult', requires: 'awakened', kiCost: 200,
      s: 26, a: 1, r: 40, dmg: 80, chip: 24, h: 'mid', str: 'super', el: 'void', hitstun: 30, blockstun: 14, invuln: [1, 26],
      anim: [[0, 'beamCharge'], [12, 'palmWind'], [26, 'beamFire'], [56, 'recover'], [65, 'idle']], cinematic: 'ultimate',
      projectile: { kind: 'hollow_purple', spawnFrame: 27, x: 600, y: 1250, speed: 70, life: 60, r: 450, hits: 6, beam: true }, fx: 'hollow_purple_max' }),

    // ---------------------------------------------------------------- Soul Realm
    mv({ id: 'gojo_domain', name: 'Domain Expansion: Infinite Void', kind: 'special', input: '', s: 20, a: 1, r: 10, dmg: 0,
      h: 'mid', str: 'super', el: 'void', invuln: [1, 31], ki: 0,
      anim: [[0, 'kiCharge'], [10, 'awakenPose'], [20, 'introPose'], [29, 'idle']], fx: 'infinite_void',
      extra: { internal: true, realm: { kind: 'infinite_void', duration: 240 } } }),
  ],
};
