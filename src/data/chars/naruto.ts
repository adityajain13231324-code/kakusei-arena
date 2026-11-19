/**
 * NARUTO UZUMAKI — The Number One Hyperactive Ninja (Crossover Pack). Rushdown / pressure.
 * SHADOW CLONES (state.summons): Shadow Clone Jutsu makes up to 2 clones that stand at flanking angles and
 * copy his next attack (40% damage); any hit or projectile dispels them. Clone Rush spends them on a
 * command grab. Awakening = Sage Mode; below 20% HP while awakened = Nine-Tails Chakra Mode (form 'kurama':
 * +25% speed, Kurama Rasengan / Tailed Beast Rasen-Shuriken replace the base moves).
 * Ultimate: Rasengan Barrage. Soul Realm: Tailed Beast Bomb.
 */
import type { CharDef } from '../../sim/types';
import { mv, throwPair, holdMove, ultCine, flurry, BOX } from '../build';

const SC = ['special', 'ki', 'ultimate'];

export const NARUTO: CharDef = {
  id: 'naruto',
  name: 'NARUTO UZUMAKI',
  title: 'The Hyperactive Ninja',
  maxHp: 920,
  walkSpeed: 52,
  backWalkSpeed: 40,
  dashSpeed: 112,
  sidestepSpeed: 58,
  jumpVel: 84,
  weight: 98,
  height: 1660,
  radius: 285,
  palette: { primary: '#ff7a1a', secondary: '#1b2a5a', accent: '#ffd23f', hair: '#ffcf3a', skin: '#f3c9a2', aura: '#4fc3ff' },
  element: 'wind',
  ultimateId: 'naruto_ult',
  awakenedUltimateId: 'naruto_ult_aw',
  realmId: 'naruto_tbb',
  autoComboEnder: 'naruto_rasengan',
  moves: [
    // ---------------------------------------------------------------- normals / strings
    mv({ id: 'naruto_jab', name: 'Leaf Jab', input: 'L', s: 9, a: 2, r: 12, dmg: 40, h: 'high', str: 'light',
      blk: 1, hit: 8, box: BOX.jab, wind: 'jabWind', ext: 'jabExt', cancel: SC, window: [10, 21], fx: 'punch_light' }),
    mv({ id: 'naruto_jab2', name: 'Uzumaki Combo', input: 'L,L', s: 9, a: 2, r: 13, dmg: 38, h: 'high', str: 'light',
      blk: -1, hit: 7, box: BOX.jab, wind: 'straightWind', ext: 'straightExt', cancel: SC, window: [10, 22], fx: 'punch_light' }),
    mv({ id: 'naruto_jab3', name: 'Uzumaki Kick', input: 'L,L,K', s: 13, a: 3, r: 20, dmg: 70, h: 'mid', str: 'medium',
      blk: -8, hit: 4, box: BOX.midKick, wind: 'midKickWind', ext: 'midKickExt', cancel: SC, window: [14, 25], fx: 'kick_medium' }),
    mv({ id: 'naruto_punch', name: 'Straight Punch', input: 'H', s: 13, a: 3, r: 18, dmg: 92, h: 'mid', str: 'medium',
      blk: -5, hit: 5, box: { x: 250, y: 1200, len: 500, r: 140 }, wind: 'straightWind', ext: 'straightExt', cancel: SC, window: [14, 26], fx: 'punch_heavy' }),
    mv({ id: 'naruto_punch2', name: 'Uppercut Finish', input: 'H,H', s: 15, a: 3, r: 22, dmg: 105, h: 'mid', str: 'heavy',
      blk: -12, onHit: 'knockdown', box: { x: 220, y: 1250, len: 480, r: 150 }, wind: 'uppercutWind', ext: 'uppercutExt', cancel: SC, window: [16, 27], fx: 'punch_heavy' }),
    mv({ id: 'naruto_kick', name: 'Whirlwind Kick', input: 'K', s: 12, a: 3, r: 18, dmg: 88, h: 'high', str: 'medium',
      blk: -3, hit: 6, box: { x: 250, y: 1450, len: 600, r: 125 }, wind: 'highKickWind', ext: 'highKickExt', cancel: SC, window: [13, 23], fx: 'kick_medium' }),
    mv({ id: 'naruto_low', name: 'Low Kick', input: '2L', s: 11, a: 2, r: 15, dmg: 30, h: 'low', str: 'light',
      blk: -12, hit: 3, box: BOX.low, wind: 'lowKickWind', ext: 'lowKickExt', fx: 'kick_light' }),
    mv({ id: 'naruto_sweep', name: 'Leaf Sweep', input: '2K', s: 15, a: 3, r: 24, dmg: 78, h: 'low', str: 'medium',
      blk: -16, onHit: 'knockdown', box: BOX.sweep, wind: 'lowKickWind', ext: 'sweepExt', fx: 'wind_sweep', extra: { otg: true } }),
    mv({ id: 'naruto_launcher', name: 'Uzumaki Uppercut', input: '3H', s: 14, a: 2, r: 22, dmg: 70, h: 'mid', str: 'medium',
      blk: -14, onHit: 'launch', launch: 64, box: BOX.launcher, wind: 'uppercutWind', ext: 'uppercutExt', fx: 'wind_rise' }),
    mv({ id: 'naruto_elbow', name: 'Shunshin Elbow', input: '6H', s: 14, a: 3, r: 17, dmg: 100, h: 'mid', str: 'medium', trk: 'full',
      blk: -3, hit: 6, box: { x: 150, y: 1150, len: 380, r: 170 }, wind: 'hookWind', ext: 'elbowExt',
      movement: [[0, 24, 0], [11, 0, 0]], cancel: SC, window: [15, 25], fx: 'punch_heavy' }),
    mv({ id: 'naruto_heel', name: 'Heel Drop', input: '4K', s: 17, a: 3, r: 21, dmg: 110, h: 'mid', str: 'heavy',
      blk: -12, onHit: 'knockdown', onCH: 'launch', launch: 60, box: { x: 220, y: 1100, len: 560, r: 150 },
      wind: 'axeKickUp', ext: 'axeKickDown', fx: 'kick_heavy' }),
    mv({ id: 'naruto_jk', name: 'Flying Kick', input: 'K', requires: 'air', s: 8, a: 6, r: 10, dmg: 76, h: 'mid', str: 'medium',
      blk: -2, hit: 8, box: { x: 150, y: 900, len: 540, r: 150 }, wind: 'jumpUp', ext: 'flyingKick', fx: 'kick_medium' }),
    mv({ id: 'naruto_jh', name: 'Spinning Axe Kick', input: 'H', requires: 'air', s: 11, a: 5, r: 12, dmg: 90, h: 'mid', str: 'heavy',
      blk: -4, onHit: 'knockdown', box: { x: 150, y: 820, len: 470, r: 165 }, wind: 'axeKickUp', ext: 'axeKickDown', fx: 'kick_heavy' }),

    // ---------------------------------------------------------------- specials
    mv({ id: 'naruto_rasengan', name: 'Rasengan', kind: 'special', input: '236S', easy: '6S', s: 20, a: 4, r: 26, dmg: 88,
      h: 'mid', str: 'heavy', el: 'wind', blk: -18, onHit: 'launch', launch: 60, ki: 8,
      movement: [[0, 8, 0], [6, 40, 0], [20, 0, 0]], box: { x: 150, y: 1150, len: 450, r: 200 },
      anim: [[0, 'palmWind'], [6, 'dash'], [17, 'palmExt'], [32, 'recover'], [44, 'idle']], fx: 'rasengan' }),
    mv({ id: 'naruto_barrage', name: 'Uzumaki Barrage', kind: 'special', input: '623S', easy: '2S', s: 7, a: 8, r: 28, dmg: 100,
      h: 'mid', str: 'heavy', blk: -26, onHit: 'knockdown', onCH: 'launch', launch: 64, invuln: [1, 7], ki: 8,
      movement: [[0, 6, 0], [6, 8, 64], [15, 2, 0]], box: { x: 150, y: 1300, len: 350, r: 220 },
      anim: [[0, 'uppercutWind'], [7, 'flyingKick'], [20, 'jumpFall'], [38, 'land'], [42, 'idle']], fx: 'clone_kick_up' }),
    mv({ id: 'naruto_clone_jutsu', name: 'Shadow Clone Jutsu', kind: 'special', input: '214S', easy: '4S', s: 12, a: 1, r: 18, dmg: 0,
      h: 'mid', str: 'light', el: 'wind', ki: 0,
      anim: [[0, 'kiCharge'], [10, 'introPose'], [22, 'recover'], [29, 'idle']], fx: 'clone_smoke', extra: { summon: { frame: 10, count: 2 } } }),
    mv({ id: 'naruto_clone_rush', name: 'Clone Rush', kind: 'special', input: '41236S', easy: '8S', s: 18, a: 4, r: 36, dmg: 100,
      h: 'throw', str: 'heavy', el: 'wind', blk: 0, hit: 0, ki: 12, movement: [[0, 22, 0], [16, 0, 0]],
      box: { x: 150, y: 1000, len: 700, r: 240 }, wind: 'dash', ext: 'grabReach', fx: 'clone_rush',
      extra: { unbreakable: true, followup: 'naruto_rush_hold', needClones: 1 } }),
    holdMove('naruto_rush_hold', 'Clone Rush (hold)', 'special',
      [[0, 'throwGrab'], [8, 'liftOverhead'], [16, 'jumpUp'], [22, 'throwToss'], [30, 'land'], [36, 'recover'], [38, 'idle']]),
    // Nine-Tails Chakra Mode replacements (form 'kurama')
    mv({ id: 'naruto_kurama_rasengan', name: 'Kurama Rasengan', kind: 'special', input: '236S', easy: '6S', s: 15, a: 5, r: 24, dmg: 135,
      h: 'mid', str: 'heavy', el: 'wind', blk: -14, onHit: 'launch', launch: 62, ki: 8, armor: [6, 15],
      movement: [[0, 10, 0], [5, 50, 0], [18, 0, 0]], box: { x: 150, y: 1150, len: 520, r: 230 },
      anim: [[0, 'palmWind'], [5, 'dash'], [14, 'palmExt'], [32, 'recover'], [42, 'idle']], fx: 'rasengan_kurama', extra: { needForm: 'kurama' } }),
    mv({ id: 'naruto_kurama_arm', name: 'Chakra Arm Sweep', kind: 'special', input: '623S', easy: '2S', s: 7, a: 8, r: 26, dmg: 125,
      h: 'mid', str: 'heavy', el: 'wind', blk: -24, onHit: 'launch', launch: 62, invuln: [1, 8], ki: 8,
      box: { x: 100, y: 1200, len: 1300, r: 260 }, wind: 'palmWind', ext: 'spinAttack', fx: 'chakra_arm', extra: { needForm: 'kurama' } }),

    // ---------------------------------------------------------------- Ki specials
    mv({ id: 'naruto_rasenshuriken', name: 'Rasen-Shuriken', kind: 'ki', input: '236S+K', easy: 'S+K', kiCost: 100, s: 20, a: 1, r: 30,
      dmg: 40, h: 'mid', str: 'heavy', el: 'wind', hitstun: 26, blockstun: 14,
      anim: [[0, 'beamCharge'], [20, 'throwProjectile'], [42, 'recover'], [51, 'idle']],
      projectile: { kind: 'rasenshuriken', spawnFrame: 21, x: 450, y: 1300, speed: 40, life: 70, r: 260, hits: 4 }, fx: 'rasenshuriken' }),
    mv({ id: 'naruto_kurama_shuriken', name: 'Tailed Beast Rasen-Shuriken', kind: 'ki', input: '236S+K', easy: 'S+K', kiCost: 100, s: 18, a: 1, r: 30,
      dmg: 46, h: 'mid', str: 'heavy', el: 'wind', hitstun: 26, blockstun: 14,
      anim: [[0, 'beamCharge'], [18, 'throwProjectile'], [40, 'recover'], [49, 'idle']],
      projectile: { kind: 'rasenshuriken_kurama', spawnFrame: 19, x: 450, y: 1300, speed: 46, life: 70, r: 320, hits: 5 }, fx: 'rasenshuriken_kurama',
      extra: { needForm: 'kurama' } }),
    mv({ id: 'naruto_sage_rasengan', name: 'Sage Art: Giant Rasengan', kind: 'ki', input: '41236S+K', easy: '2S+K', requires: 'awakened',
      kiCost: 100, s: 14, a: 6, r: 24, dmg: 150, h: 'mid', str: 'heavy', el: 'wind', blk: -16, onHit: 'launch', launch: 62,
      invuln: [1, 8], movement: [[0, 12, 0], [4, 46, 0], [18, 0, 0]], box: { x: 150, y: 1150, len: 560, r: 260 },
      anim: [[0, 'palmWind'], [4, 'dash'], [13, 'palmExt'], [32, 'recover'], [42, 'idle']], fx: 'rasengan_giant' }),

    // ---------------------------------------------------------------- throw
    ...throwPair('naruto', 'Clone Toss', 125, 'wind'),

    // ---------------------------------------------------------------- ultimates
    mv({ id: 'naruto_ult', name: 'Rasengan Barrage', kind: 'ultimate', input: '236H+S', easy: 'Ult', kiCost: 300, s: 10, a: 4, r: 50,
      dmg: 330, h: 'mid', str: 'super', el: 'wind', blk: -30, invuln: [1, 14], movement: [[0, 45, 0], [12, 0, 0]],
      box: { x: 150, y: 1150, len: 700, r: 260 }, wind: 'palmWind', ext: 'palmExt', cinematic: 'ultimate', fx: 'clone_barrage',
      extra: { followup: 'naruto_ult_cine' } }),
    ultCine('naruto_ult_cine', 'Rasengan Barrage', 180, [24, 34, 44, 54, 64, 74, 84, 94, 104, 150],
      [[0, 'palmExt'], [16, 'kiCharge'], ...flurry(22, 108, 5, ['flyingKick', 'uppercutExt', 'roundhouseExt', 'palmExt']), [110, 'beamCharge'], [146, 'palmExt'], [170, 'win']],
      'wind', 'rasengan_barrage'),
    mv({ id: 'naruto_ult_aw', name: 'Sage Art: Rasengan Barrage', kind: 'ultimate', input: '236H+S', easy: 'Ult', requires: 'awakened', kiCost: 200,
      s: 9, a: 4, r: 48, dmg: 360, h: 'mid', str: 'super', el: 'wind', blk: -28, invuln: [1, 13], movement: [[0, 50, 0], [11, 0, 0]],
      box: { x: 150, y: 1150, len: 700, r: 260 }, wind: 'palmWind', ext: 'palmExt', cinematic: 'ultimate', fx: 'clone_barrage',
      extra: { followup: 'naruto_ult_aw_cine' } }),
    ultCine('naruto_ult_aw_cine', 'Sage Art: Rasengan Barrage', 190, [20, 28, 36, 44, 52, 60, 68, 76, 84, 92, 160],
      [[0, 'palmExt'], [14, 'kiCharge'], ...flurry(18, 100, 4, ['flyingKick', 'uppercutExt', 'palmExt', 'roundhouseExt']), [104, 'awakenPose'], [130, 'beamCharge'], [156, 'palmExt'], [180, 'win']],
      'wind', 'rasengan_barrage_sage'),

    // ---------------------------------------------------------------- Soul Realm
    mv({ id: 'naruto_tbb', name: 'Tailed Beast Bomb', kind: 'special', input: '', s: 20, a: 1, r: 10, dmg: 0,
      h: 'mid', str: 'super', el: 'wind', invuln: [1, 31], ki: 0,
      anim: [[0, 'kiCharge'], [10, 'awakenPose'], [20, 'beamCharge'], [29, 'idle']], fx: 'tailed_beast_bomb',
      extra: { internal: true, realm: { kind: 'tailed_beast_bomb', duration: 300 } } }),
    // realm blast (applied by the sim when the realm opens; no hitbox)
    mv({ id: 'naruto_tbb_blast', name: 'Tailed Beast Bomb', kind: 'special', input: '', s: 1, a: 1, r: 1, dmg: 200,
      h: 'unblockable', str: 'super', el: 'wind', hitstun: 30, blockstun: 10, onHit: 'knockdown', ki: 0,
      anim: [[0, 'beamFire']], fx: 'tailed_beast_bomb_blast', extra: { internal: true } }),
  ],
};
