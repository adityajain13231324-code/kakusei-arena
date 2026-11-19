/**
 * EREN YEAGER — The Attack Titan (Crossover Pack). Mobility + transformation.
 * ODM GEAR: Grapple Dash (236S) closes distance fast, air blade strikes, Spinning Slash reversal,
 * Thunder Spear (delayed blast projectile: harmless in flight, detonates after ~0.6 s), Hardened Fist counter.
 * Awakening = TITAN SHIFT: lightning strike -> 600 frames in form 'titan' (renderer: form_titan.glb, camera
 * pulls back): hurtbox and body x2.5, 75% damage taken, immune to normal throws, -25% speed, slow armored
 * moveset (all moves below with needForm 'titan'). Ultimate (Titan): Hardened Titan Smash.
 * Soul Realm: Paths (a Titan stomp shockwave every second; crouch-block or jump it).
 */
import type { CharDef, MoveDef } from '../../sim/types';
import { mv, throwPair, ultCine, flurry } from '../build';

const SC = ['special', 'ki', 'ultimate'];
const H = (m: MoveDef): MoveDef => { m.needForm = ''; return m; }; // human form only
const T = (m: MoveDef): MoveDef => { m.needForm = 'titan'; return m; }; // Titan form only

export const EREN: CharDef = {
  id: 'eren',
  name: 'EREN YEAGER',
  title: 'The Attack Titan',
  maxHp: 980,
  walkSpeed: 50,
  backWalkSpeed: 42,
  dashSpeed: 118,
  sidestepSpeed: 62,
  jumpVel: 86,
  weight: 98,
  height: 1700,
  radius: 290,
  palette: { primary: '#4a3b2a', secondary: '#c9b48a', accent: '#2e5e3a', hair: '#3a2a1f', skin: '#e9c4a3', aura: '#ffd84a' },
  element: 'lightning',
  ultimateId: 'eren_ult',
  awakenedUltimateId: 'eren_titan_ult',
  realmId: 'eren_paths',
  autoComboEnder: 'eren_grapple',
  moves: [
    // ---------------------------------------------------------------- human normals (ODM blades)
    H(mv({ id: 'eren_jab', name: 'Blade Jab', input: 'L', s: 10, a: 2, r: 12, dmg: 42, h: 'high', str: 'light',
      blk: 1, hit: 8, box: { x: 250, y: 1450, len: 500, r: 120 }, wind: 'jabWind', ext: 'jabExt', cancel: SC, window: [11, 22], fx: 'odm_jab' })),
    H(mv({ id: 'eren_jab2', name: 'Reverse Grip Cut', input: 'L,L', s: 9, a: 2, r: 14, dmg: 38, h: 'high', str: 'light',
      blk: -2, hit: 6, box: { x: 250, y: 1450, len: 520, r: 120 }, wind: 'slashWind', ext: 'slashExt', cancel: SC, window: [10, 23], fx: 'odm_slash' })),
    H(mv({ id: 'eren_jab3', name: 'Cross Cut', input: 'L,L,H', s: 14, a: 3, r: 20, dmg: 72, h: 'mid', str: 'medium', el: 'blade',
      blk: -8, hit: 4, box: { x: 250, y: 1200, len: 600, r: 140 }, wind: 'slashWind', ext: 'slashUpExt', cancel: SC, window: [15, 26], fx: 'odm_slash' })),
    H(mv({ id: 'eren_slash', name: 'Twin Blade Slash', input: 'H', s: 13, a: 3, r: 18, dmg: 94, h: 'mid', str: 'medium', el: 'blade',
      blk: -5, hit: 5, box: { x: 250, y: 1200, len: 600, r: 135 }, wind: 'slashWind', ext: 'slashExt', cancel: SC, window: [14, 26], fx: 'odm_slash' })),
    H(mv({ id: 'eren_slash2', name: 'Nape Cut', input: 'H,H', s: 16, a: 3, r: 22, dmg: 106, h: 'mid', str: 'heavy', el: 'blade',
      blk: -12, onHit: 'knockdown', box: { x: 250, y: 1300, len: 600, r: 145 }, wind: 'slashWind', ext: 'slashUpExt', cancel: SC, window: [17, 28], fx: 'odm_nape' })),
    H(mv({ id: 'eren_kick', name: 'Survey Corps Kick', input: 'K', s: 12, a: 3, r: 18, dmg: 86, h: 'high', str: 'medium',
      blk: -3, hit: 6, box: { x: 250, y: 1450, len: 600, r: 125 }, wind: 'highKickWind', ext: 'highKickExt', cancel: SC, window: [13, 23], fx: 'kick_medium' })),
    H(mv({ id: 'eren_lowcut', name: 'Low Cut', input: '2L', s: 12, a: 2, r: 15, dmg: 32, h: 'low', str: 'light', el: 'blade',
      blk: -12, hit: 3, box: { x: 250, y: 280, len: 560, r: 115 }, wind: 'slashWind', ext: 'slashLowExt', fx: 'odm_low' })),
    H(mv({ id: 'eren_sweep', name: 'Spin Sweep', input: '2K', s: 15, a: 3, r: 24, dmg: 80, h: 'low', str: 'medium',
      blk: -16, onHit: 'knockdown', box: { x: 200, y: 220, len: 720, r: 140 }, wind: 'lowKickWind', ext: 'sweepExt', fx: 'kick_sweep', extra: { otg: true } })),
    H(mv({ id: 'eren_launcher', name: 'Rising Blade', input: '3H', s: 14, a: 2, r: 22, dmg: 70, h: 'mid', str: 'medium', el: 'blade',
      blk: -14, onHit: 'launch', launch: 64, box: { x: 200, y: 1150, len: 480, r: 170 }, wind: 'slashWind', ext: 'slashUpExt', fx: 'odm_rise' })),
    H(mv({ id: 'eren_lunge', name: 'ODM Lunge', input: '6H', s: 14, a: 3, r: 18, dmg: 98, h: 'mid', str: 'medium', el: 'blade', trk: 'full',
      blk: -3, hit: 6, box: { x: 150, y: 1200, len: 450, r: 160 }, wind: 'dash', ext: 'slashExt',
      movement: [[0, 30, 0], [11, 0, 0]], cancel: SC, window: [15, 25], fx: 'odm_lunge' })),
    H(mv({ id: 'eren_backspin', name: 'Back Spin Slash', input: '4K', s: 16, a: 4, r: 20, dmg: 112, h: 'high', str: 'heavy', el: 'blade',
      blk: -9, onHit: 'knockdown', box: { x: 0, y: 1400, len: 750, r: 150 }, wind: 'slashWind', ext: 'spinAttack', fx: 'odm_spin' })),
    H(mv({ id: 'eren_jk', name: 'Air Blade', input: 'K', requires: 'air', s: 8, a: 6, r: 10, dmg: 76, h: 'mid', str: 'medium', el: 'blade',
      blk: -2, hit: 8, box: { x: 150, y: 900, len: 600, r: 150 }, wind: 'slashWind', ext: 'slashExt', fx: 'odm_air' })),
    H(mv({ id: 'eren_jh', name: 'Diving Nape Strike', input: 'H', requires: 'air', s: 10, a: 5, r: 12, dmg: 92, h: 'mid', str: 'heavy', el: 'blade',
      blk: -4, onHit: 'knockdown', box: { x: 150, y: 800, len: 560, r: 165 }, wind: 'slashWind', ext: 'diveKick', fx: 'odm_nape' })),

    // ---------------------------------------------------------------- human specials
    H(mv({ id: 'eren_grapple', name: 'Grapple Dash', kind: 'special', input: '236S', easy: '6S', s: 14, a: 6, r: 20, dmg: 88,
      h: 'mid', str: 'heavy', el: 'blade', blk: -6, hit: 4, ki: 8,
      movement: [[0, 6, 0], [6, 85, 0], [18, 0, 0]], box: { x: 100, y: 1250, len: 500, r: 190 },
      anim: [[0, 'throwProjectile'], [6, 'dash'], [14, 'slashExt'], [28, 'recover'], [40, 'idle']], fx: 'odm_grapple' })),
    H(mv({ id: 'eren_spin', name: 'Spinning Slash', kind: 'special', input: '623S', easy: '2S', s: 8, a: 10, r: 26, dmg: 100,
      h: 'mid', str: 'heavy', el: 'blade', blk: -26, onHit: 'knockdown', onCH: 'launch', launch: 64, invuln: [1, 8], ki: 8,
      movement: [[0, 4, 0], [7, 6, 46], [18, 0, 0]], box: { x: -200, y: 1250, len: 650, r: 250 },
      anim: [[0, 'slashWind'], [8, 'spinAttack'], [20, 'jumpFall'], [38, 'land'], [42, 'idle']], fx: 'odm_spin' })),
    H(mv({ id: 'eren_thunder_spear', name: 'Thunder Spear', kind: 'special', input: '41236S', easy: '8S', s: 16, a: 1, r: 20, dmg: 80,
      h: 'mid', str: 'heavy', el: 'lightning', hitstun: 30, blockstun: 14, onHit: 'knockdown', ki: 3,
      anim: [[0, 'throwProjectile'], [16, 'palmExt'], [28, 'recover'], [36, 'idle']],
      projectile: { kind: 'thunder_spear', spawnFrame: 17, x: 400, y: 1200, speed: 45, life: 48, r: 120, hits: 1, fuse: 12, blastR: 450 }, fx: 'thunder_spear' })),
    H(mv({ id: 'eren_counter', name: 'Hardened Fist', kind: 'special', input: '214S', easy: '4S', s: 3, a: 16, r: 16, dmg: 0,
      h: 'mid', str: 'medium', el: 'lightning', ki: 4,
      anim: [[0, 'guardHigh'], [3, 'palmWind'], [19, 'recover'], [31, 'idle']], fx: 'hardening',
      extra: { counter: { from: 4, to: 18, heights: ['high', 'mid'], move: 'eren_counter_hit' } } })),
    mv({ id: 'eren_counter_hit', name: 'Hardened Fist: Crystal Punch', kind: 'special', input: '', s: 3, a: 3, r: 24, dmg: 135,
      h: 'mid', str: 'heavy', el: 'lightning', blk: -18, onHit: 'wallbounce', box: { x: 100, y: 1200, len: 520, r: 220 },
      wind: 'straightWind', ext: 'straightExt', fx: 'hardened_punch', extra: { internal: true } }),

    // ---------------------------------------------------------------- human Ki
    H(mv({ id: 'eren_spear_volley', name: 'Thunder Spear Volley', kind: 'ki', input: '236S+K', easy: 'S+K', kiCost: 100, s: 14, a: 1, r: 28,
      dmg: 90, h: 'mid', str: 'heavy', el: 'lightning', hitstun: 30, blockstun: 16, onHit: 'knockdown',
      anim: [[0, 'throwProjectile'], [14, 'palmExt'], [36, 'recover'], [43, 'idle']],
      projectile: { kind: 'thunder_spear', spawnFrame: 15, x: 400, y: 1200, speed: 55, life: 44, r: 120, hits: 1, count: 2, spread: 120, fuse: 10, blastR: 520 },
      fx: 'thunder_spear' })),

    // ---------------------------------------------------------------- TITAN form (awakening): big, slow, armored
    T(mv({ id: 'eren_t_jab', name: 'Titan Backhand', input: 'L', s: 13, a: 3, r: 16, dmg: 72, h: 'mid', str: 'medium',
      blk: -2, hit: 6, armor: [4, 13], box: { x: 300, y: 1200, len: 1000, r: 260 }, wind: 'hookWind', ext: 'hookExt', cancel: SC, window: [14, 26], fx: 'titan_swat' })),
    T(mv({ id: 'eren_t_jab2', name: 'Titan Hook', input: 'L,L', s: 15, a: 3, r: 20, dmg: 85, h: 'mid', str: 'heavy',
      blk: -6, hit: 3, armor: [4, 15], box: { x: 300, y: 1250, len: 1000, r: 280 }, wind: 'hookWind', ext: 'straightExt', cancel: SC, window: [16, 28], fx: 'titan_hook' })),
    T(mv({ id: 'eren_t_hammer', name: 'Titan Hammer Fist', input: 'H', s: 20, a: 4, r: 24, dmg: 140, h: 'mid', str: 'heavy', el: 'lightning',
      blk: -12, onHit: 'knockdown', armor: [6, 20], box: { x: 300, y: 900, len: 1200, r: 320 }, wind: 'liftOverhead', ext: 'groundPound', fx: 'titan_hammer' })),
    T(mv({ id: 'eren_t_stomp', name: 'Titan Stomp', input: 'K', s: 18, a: 3, r: 22, dmg: 110, h: 'low', str: 'heavy',
      blk: -16, onHit: 'knockdown', box: { x: 200, y: 150, len: 1100, r: 300 }, wind: 'liftOverhead', ext: 'stompExt', fx: 'titan_stomp', extra: { otg: true } })),
    T(mv({ id: 'eren_t_upper', name: 'Titan Uppercut', input: '3H', s: 18, a: 3, r: 24, dmg: 100, h: 'mid', str: 'heavy',
      blk: -16, onHit: 'launch', launch: 66, armor: [6, 18], box: { x: 250, y: 1100, len: 900, r: 300 }, wind: 'uppercutWind', ext: 'uppercutExt', fx: 'titan_upper' })),
    T(mv({ id: 'eren_t_charge', name: 'Titan Charge', kind: 'special', input: '236S', easy: '6S', s: 18, a: 8, r: 24, dmg: 130,
      h: 'mid', str: 'heavy', el: 'lightning', blk: -12, onHit: 'wallbounce', armor: [4, 26], ki: 8,
      movement: [[0, 6, 0], [10, 60, 0], [26, 0, 0]], box: { x: 200, y: 1200, len: 700, r: 340 },
      anim: [[0, 'crouch'], [10, 'dash'], [18, 'bodySlam'], [34, 'recover'], [46, 'idle']], fx: 'titan_charge' })),
    T(mv({ id: 'eren_t_hardening', name: 'Hardening Punch', kind: 'special', input: '623S', easy: '2S', s: 12, a: 4, r: 28, dmg: 120,
      h: 'mid', str: 'heavy', el: 'lightning', blk: -20, onHit: 'knockdown', armor: [1, 16], ki: 8,
      box: { x: 250, y: 1300, len: 900, r: 320 }, wind: 'straightWind', ext: 'straightExt', fx: 'titan_hardening' })),
    T(mv({ id: 'eren_t_roar', name: 'Titan Roar', kind: 'special', input: '214S', easy: '4S', s: 16, a: 1, r: 26, dmg: 60,
      h: 'mid', str: 'heavy', el: 'lightning', hitstun: 26, blockstun: 16, armor: [1, 16], ki: 8,
      anim: [[0, 'kiCharge'], [16, 'beamFire'], [36, 'recover'], [43, 'idle']],
      projectile: { kind: 'titan_roar', spawnFrame: 17, x: 400, y: 1200, speed: 50, life: 34, r: 420, hits: 1 }, fx: 'titan_roar' })),

    // ---------------------------------------------------------------- throw
    ...throwPair('eren', 'Wire Snare Toss', 125, 'blade'),

    // ---------------------------------------------------------------- ultimates
    H(mv({ id: 'eren_ult', name: 'ODM Nape Barrage', kind: 'ultimate', input: '236H+S', easy: 'Ult', kiCost: 300, s: 10, a: 4, r: 50,
      dmg: 330, h: 'mid', str: 'super', el: 'blade', blk: -30, invuln: [1, 14], movement: [[0, 55, 0], [12, 0, 0]],
      box: { x: 100, y: 1150, len: 700, r: 250 }, wind: 'dash', ext: 'slashExt', cinematic: 'ultimate', fx: 'odm_barrage',
      extra: { followup: 'eren_ult_cine' } })),
    ultCine('eren_ult_cine', 'ODM Nape Barrage', 180, [30, 42, 54, 66, 78, 90, 102, 150],
      [[0, 'slashExt'], [16, 'jumpUp'], ...flurry(26, 110, 6, ['slashExt', 'spinAttack', 'slashUpExt', 'diveKick']), [116, 'jumpUp'], [146, 'diveKick'], [170, 'win']],
      'blade', 'odm_barrage'),
    T(mv({ id: 'eren_titan_ult', name: 'Hardened Titan Smash', kind: 'ultimate', input: '236H+S', easy: 'Ult', requires: 'awakened', kiCost: 200,
      s: 12, a: 5, r: 48, dmg: 360, h: 'mid', str: 'super', el: 'lightning', blk: -28, invuln: [1, 17], movement: [[0, 30, 0], [14, 0, 0]],
      box: { x: 200, y: 1150, len: 1100, r: 340 }, wind: 'liftOverhead', ext: 'groundPound', cinematic: 'ultimate', fx: 'titan_smash',
      extra: { followup: 'eren_titan_ult_cine' } })),
    ultCine('eren_titan_ult_cine', 'Hardened Titan Smash', 190, [30, 70, 110, 160],
      [[0, 'groundPound'], [20, 'liftOverhead'], [30, 'groundPound'], [60, 'liftOverhead'], [70, 'groundPound'], [100, 'liftOverhead'], [110, 'bodySlam'], [150, 'liftOverhead'], [160, 'groundPound'], [180, 'win']],
      'lightning', 'titan_smash'),

    // ---------------------------------------------------------------- Soul Realm
    mv({ id: 'eren_paths', name: 'The Paths', kind: 'special', input: '', s: 20, a: 1, r: 10, dmg: 0,
      h: 'mid', str: 'super', el: 'lightning', invuln: [1, 31], ki: 0,
      anim: [[0, 'kiCharge'], [10, 'awakenPose'], [20, 'introPose'], [29, 'idle']], fx: 'paths',
      extra: { internal: true, realm: { kind: 'paths', duration: 360 } } }),
    // Paths stomp (applied by the sim every 60 frames of the realm; low: crouch-block or jump)
    mv({ id: 'eren_paths_stomp', name: 'Titan Army Stomp', kind: 'special', input: '', s: 1, a: 1, r: 1, dmg: 45,
      h: 'low', str: 'heavy', el: 'earth', hitstun: 30, blockstun: 12, onHit: 'knockdown', ki: 0,
      anim: [[0, 'idle']], fx: 'titan_army_stomp', extra: { internal: true } }),
  ],
};
