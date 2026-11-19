/**
 * RORONOA ZORO — The Pirate Hunter (Crossover Pack). Sword footsies.
 * THREE-SWORD STYLE: tap S (neutral, '5S') to cycle Santoryu (3 swords, long heavy H string) -> Ittoryu
 * (1 sword, slow iai H that launches on counter) -> Nitoryu (2 swords, fast 3-hit H string). fighter.form
 * holds the style ('santoryu' / 'ittoryu' / 'nitoryu') so the renderer can show the right sword count.
 * Oni Giri dashes THROUGH the opponent, Tatsumaki is a tornado reversal, Pound Cannon a flying slash,
 * Lion's Song an iai counter. Awakening = Asura: every slash hits a second time (echo, 50%).
 * Ultimate: Asura Ichibugin. Soul Realm: King of Hell (blocked slashes still cut).
 */
import type { CharDef } from '../../sim/types';
import { mv, throwPair, ultCine, flurry, BOX } from '../build';

const SC = ['special', 'ki', 'ultimate'];
const STYLES = ['santoryu', 'ittoryu', 'nitoryu'];

export const ZORO: CharDef = {
  id: 'zoro',
  name: 'RORONOA ZORO',
  title: 'The Pirate Hunter',
  maxHp: 940,
  walkSpeed: 48,
  backWalkSpeed: 38,
  dashSpeed: 100,
  sidestepSpeed: 52,
  jumpVel: 78,
  weight: 104,
  height: 1780,
  radius: 300,
  palette: { primary: '#f1f1ea', secondary: '#2f6b3a', accent: '#1d1d22', hair: '#5fbf5a', skin: '#e3b48f', aura: '#9be36b' },
  element: 'blade',
  ultimateId: 'zoro_ult',
  awakenedUltimateId: 'zoro_ult_aw',
  realmId: 'zoro_king_of_hell',
  autoComboEnder: 'zoro_oni_giri',
  moves: [
    // ---------------------------------------------------------------- shared normals
    mv({ id: 'zoro_jab', name: 'Hilt Strike', input: 'L', s: 10, a: 2, r: 12, dmg: 44, h: 'high', str: 'light',
      blk: 1, hit: 8, box: { x: 250, y: 1450, len: 520, r: 120 }, wind: 'jabWind', ext: 'jabExt', cancel: SC, window: [11, 22], fx: 'blade_hilt' }),
    mv({ id: 'zoro_jab2', name: 'Kodachi Cut', input: 'L,L', s: 10, a: 2, r: 14, dmg: 40, h: 'high', str: 'light',
      blk: -2, hit: 6, box: { x: 250, y: 1450, len: 560, r: 120 }, wind: 'slashWind', ext: 'slashExt', cancel: SC, window: [11, 24], fx: 'blade_light' }),
    mv({ id: 'zoro_jab3', name: 'Tatsu Slash', input: 'L,L,H', s: 14, a: 3, r: 20, dmg: 74, h: 'mid', str: 'medium', el: 'blade',
      blk: -8, hit: 4, box: { x: 250, y: 1200, len: 620, r: 140 }, wind: 'slashWind', ext: 'slashUpExt', cancel: SC, window: [15, 26], fx: 'blade_medium' }),
    mv({ id: 'zoro_kick', name: 'Front Kick', input: 'K', s: 13, a: 3, r: 19, dmg: 84, h: 'mid', str: 'medium',
      blk: -5, hit: 4, box: BOX.midKick, wind: 'midKickWind', ext: 'midKickExt', cancel: SC, window: [14, 24], fx: 'kick_medium' }),
    mv({ id: 'zoro_lowcut', name: 'Ankle Cut', input: '2L', s: 12, a: 2, r: 15, dmg: 34, h: 'low', str: 'light', el: 'blade',
      blk: -12, hit: 3, box: { x: 250, y: 280, len: 620, r: 110 }, wind: 'slashWind', ext: 'slashLowExt', fx: 'blade_low' }),
    mv({ id: 'zoro_sweep', name: 'Sweeping Blade', input: '2K', s: 16, a: 3, r: 24, dmg: 82, h: 'low', str: 'medium', el: 'blade',
      blk: -16, onHit: 'knockdown', box: { x: 200, y: 220, len: 760, r: 140 }, wind: 'slashWind', ext: 'slashLowExt', fx: 'blade_sweep', extra: { otg: true } }),
    mv({ id: 'zoro_launcher', name: 'Rising Dragon', input: '3H', s: 15, a: 2, r: 22, dmg: 72, h: 'mid', str: 'medium', el: 'blade',
      blk: -14, onHit: 'launch', launch: 62, box: { x: 200, y: 1150, len: 500, r: 170 }, wind: 'slashWind', ext: 'slashUpExt', fx: 'blade_rise' }),
    mv({ id: 'zoro_thrust', name: 'Sai Kuru Thrust', input: '6H', s: 16, a: 3, r: 18, dmg: 92, h: 'mid', str: 'medium', el: 'blade', trk: 'left',
      blk: -4, hit: 6, onCH: 'stagger', box: { x: 250, y: 1250, len: 750, r: 120 }, wind: 'slashWind', ext: 'slashExt',
      movement: [[0, 18, 0], [10, 0, 0]], cancel: SC, window: [17, 27], fx: 'blade_thrust' }),
    mv({ id: 'zoro_spin', name: 'Spinning Slash', input: '4K', s: 17, a: 4, r: 21, dmg: 115, h: 'high', str: 'heavy', el: 'blade',
      blk: -10, onHit: 'knockdown', box: { x: 0, y: 1400, len: 800, r: 160 }, wind: 'slashWind', ext: 'spinAttack', fx: 'blade_spin' }),
    mv({ id: 'zoro_jk', name: 'Flying Kick', input: 'K', requires: 'air', s: 9, a: 6, r: 10, dmg: 76, h: 'mid', str: 'medium',
      blk: -2, hit: 8, box: { x: 150, y: 900, len: 540, r: 150 }, wind: 'jumpUp', ext: 'flyingKick', fx: 'kick_medium' }),
    mv({ id: 'zoro_jh', name: 'Falling Cleave', input: 'H', requires: 'air', s: 11, a: 5, r: 12, dmg: 94, h: 'mid', str: 'heavy', el: 'blade',
      blk: -4, onHit: 'knockdown', box: { x: 150, y: 850, len: 620, r: 160 }, wind: 'slashWind', ext: 'slashExt', fx: 'blade_heavy' }),

    // ---------------------------------------------------------------- style-specific H strings
    // Santoryu (3 swords): long, heavy
    mv({ id: 'zoro_3_h', name: 'Santoryu: Tora Gari', input: 'H', s: 15, a: 3, r: 19, dmg: 100, h: 'mid', str: 'medium', el: 'blade',
      blk: -6, hit: 5, box: { x: 250, y: 1250, len: 760, r: 130 }, wind: 'slashWind', ext: 'slashExt', cancel: SC, window: [16, 28], fx: 'blade_tiger',
      extra: { needForm: 'santoryu' } }),
    mv({ id: 'zoro_3_hh', name: 'Santoryu: Ushi Bari', input: 'H,H', s: 17, a: 3, r: 22, dmg: 110, h: 'mid', str: 'heavy', el: 'blade',
      blk: -12, onHit: 'knockdown', box: { x: 250, y: 1200, len: 760, r: 140 }, wind: 'slashWind', ext: 'slashUpExt', cancel: SC, window: [18, 29], fx: 'blade_bull',
      extra: { needForm: 'santoryu' } }),
    // Ittoryu (1 sword): slow iai, launches on counter hit
    mv({ id: 'zoro_1_h', name: 'Ittoryu: Shishi Sonson', input: 'H', s: 18, a: 3, r: 22, dmg: 130, h: 'mid', str: 'heavy', el: 'blade',
      blk: -12, onHit: 'knockdown', onCH: 'launch', launch: 60, box: { x: 250, y: 1200, len: 900, r: 120 }, wind: 'sheathStance', ext: 'quickDraw',
      movement: [[0, 0, 0], [14, 40, 0], [21, 0, 0]], cancel: SC, window: [19, 30], fx: 'blade_lion', extra: { needForm: 'ittoryu' } }),
    // Nitoryu (2 swords): fast three-hit string
    mv({ id: 'zoro_2_h', name: 'Nitoryu: Taka Nami', input: 'H', s: 12, a: 2, r: 15, dmg: 76, h: 'mid', str: 'medium', el: 'blade',
      blk: -4, hit: 6, box: { x: 250, y: 1200, len: 650, r: 120 }, wind: 'slashWind', ext: 'slashExt', cancel: SC, window: [13, 25], fx: 'blade_hawk',
      extra: { needForm: 'nitoryu' } }),
    mv({ id: 'zoro_2_hh', name: 'Nitoryu: Nigiri', input: 'H,H', s: 12, a: 3, r: 17, dmg: 68, h: 'mid', str: 'medium', el: 'blade',
      blk: -6, hit: 4, box: { x: 250, y: 1200, len: 650, r: 130 }, wind: 'slashWind', ext: 'slashUpExt', cancel: SC, window: [13, 26], fx: 'blade_medium',
      extra: { needForm: 'nitoryu' } }),
    mv({ id: 'zoro_2_hhh', name: 'Nitoryu: Rashomon', input: 'H,H,H', s: 16, a: 3, r: 22, dmg: 96, h: 'mid', str: 'heavy', el: 'blade',
      blk: -12, onHit: 'knockdown', box: { x: 250, y: 1250, len: 680, r: 140 }, wind: 'slashWind', ext: 'slashExt', cancel: SC, window: [17, 28], fx: 'blade_gate',
      extra: { needForm: 'nitoryu' } }),

    // ---------------------------------------------------------------- specials
    mv({ id: 'zoro_style', name: 'Sword Style Swap', kind: 'special', input: '5S', easy: '5S', s: 4, a: 1, r: 12, dmg: 0,
      h: 'mid', str: 'light', el: 'blade', ki: 0, anim: [[0, 'sheathStance'], [10, 'recover'], [15, 'idle']], fx: 'blade_style',
      extra: { cycleForms: STYLES } }),
    mv({ id: 'zoro_oni_giri', name: 'Oni Giri', kind: 'special', input: '236S', easy: '6S', s: 19, a: 6, r: 28, dmg: 95,
      h: 'mid', str: 'heavy', el: 'blade', blk: -16, onHit: 'knockdown', ki: 8,
      movement: [[0, 6, 0], [12, 85, 0], [28, 0, 0]], box: { x: -250, y: 1200, len: 750, r: 210 },
      anim: [[0, 'sheathStance'], [12, 'dash'], [19, 'slashExt'], [34, 'recover'], [51, 'idle']], fx: 'oni_giri', extra: { passThrough: true } }),
    mv({ id: 'zoro_tatsumaki', name: 'Tatsumaki', kind: 'special', input: '623S', easy: '2S', s: 8, a: 10, r: 26, dmg: 100,
      h: 'mid', str: 'heavy', el: 'blade', blk: -26, onHit: 'knockdown', onCH: 'launch', launch: 66, invuln: [1, 8], ki: 8,
      movement: [[0, 4, 0], [7, 4, 50], [18, 0, 0]], box: { x: -150, y: 1200, len: 550, r: 220 },
      anim: [[0, 'slashWind'], [8, 'spinAttack'], [20, 'jumpFall'], [38, 'land'], [42, 'idle']], fx: 'tatsumaki' }),
    mv({ id: 'zoro_pound_cannon', name: 'Pound Cannon', kind: 'special', input: '214S', easy: '4S', s: 15, a: 1, r: 24, dmg: 70,
      h: 'mid', str: 'medium', el: 'blade', hitstun: 24, blockstun: 12, ki: 8,
      anim: [[0, 'slashWind'], [15, 'slashExt'], [32, 'recover'], [40, 'idle']],
      projectile: { kind: 'flying_slash', spawnFrame: 16, x: 450, y: 1250, speed: 60, life: 50, r: 190, hits: 1 }, fx: 'pound_cannon' }),
    mv({ id: 'zoro_lions_song', name: "Lion's Song", kind: 'special', input: '41236S', easy: '8S', s: 2, a: 18, r: 16, dmg: 0,
      h: 'mid', str: 'medium', el: 'blade', ki: 4,
      anim: [[0, 'sheathStance'], [20, 'recover'], [32, 'idle']], fx: 'lions_song_stance',
      extra: { counter: { from: 3, to: 18, heights: ['high', 'mid'], move: 'zoro_lions_song_cut' } } }),
    mv({ id: 'zoro_lions_song_cut', name: "Lion's Song: Shishi Sonson", kind: 'special', input: '', s: 3, a: 3, r: 22, dmg: 140,
      h: 'mid', str: 'heavy', el: 'blade', blk: -16, onHit: 'knockdown', movement: [[0, 50, 0], [6, 0, 0]],
      box: { x: -200, y: 1200, len: 800, r: 200 }, wind: 'sheathStance', ext: 'quickDraw', fx: 'lions_song',
      extra: { internal: true, passThrough: true } }),

    // ---------------------------------------------------------------- Ki specials
    mv({ id: 'zoro_sanzen_sekai', name: 'Santoryu Ogi: Sanzen Sekai', kind: 'ki', input: '236S+K', easy: 'S+K', kiCost: 100, s: 14, a: 8, r: 26,
      dmg: 165, h: 'mid', str: 'heavy', el: 'blade', blk: -14, onHit: 'knockdown', invuln: [1, 12],
      movement: [[0, 6, 0], [8, 80, 0], [22, 0, 0]], box: { x: -300, y: 1200, len: 800, r: 230 },
      anim: [[0, 'sheathStance'], [8, 'dash'], [14, 'spinAttack'], [30, 'recover'], [42, 'idle']], fx: 'sanzen_sekai', extra: { passThrough: true } }),
    mv({ id: 'zoro_rengoku', name: 'Rengoku Onigiri', kind: 'ki', input: '41236S+K', easy: '2S+K', requires: 'awakened', kiCost: 100,
      s: 12, a: 12, r: 22, dmg: 60, h: 'mid', str: 'heavy', el: 'blade', blk: -15, hit: 0, onHit: 'launch', launch: 58, invuln: [1, 8],
      movement: [[0, 34, 0], [24, 0, 0]],
      box: [{ x: 200, y: 1250, len: 650, r: 170, from: 13, to: 14 }, { x: 200, y: 1200, len: 650, r: 170, from: 18, to: 19 },
        { x: 200, y: 1300, len: 650, r: 180, from: 23, to: 24 }],
      anim: [[0, 'sheathStance'], [12, 'slashExt'], [16, 'slashUpExt'], [22, 'spinAttack'], [34, 'recover'], [44, 'idle']], fx: 'rengoku' }),

    // ---------------------------------------------------------------- throw
    ...throwPair('zoro', 'Tiger Hunt Toss', 125, 'blade'),

    // ---------------------------------------------------------------- ultimates
    mv({ id: 'zoro_ult', name: 'Asura: Ichibugin', kind: 'ultimate', input: '236H+S', easy: 'Ult', kiCost: 300, s: 10, a: 4, r: 50,
      dmg: 330, h: 'mid', str: 'super', el: 'blade', blk: -30, invuln: [1, 14], movement: [[0, 50, 0], [12, 0, 0]],
      box: { x: 100, y: 1150, len: 750, r: 250 }, wind: 'sheathStance', ext: 'slashExt', cinematic: 'ultimate', fx: 'asura',
      extra: { followup: 'zoro_ult_cine' } }),
    ultCine('zoro_ult_cine', 'Asura: Ichibugin', 180, [40, 50, 60, 70, 80, 90, 100, 150],
      [[0, 'slashExt'], [16, 'awakenPose'], ...flurry(36, 104, 5, ['slashExt', 'slashUpExt', 'spinAttack', 'slashLowExt']), [110, 'sheathStance'], [146, 'quickDraw'], [170, 'win']],
      'blade', 'asura_nine_swords'),
    mv({ id: 'zoro_ult_aw', name: 'Asura: Makyusen', kind: 'ultimate', input: '236H+S', easy: 'Ult', requires: 'awakened', kiCost: 200,
      s: 9, a: 4, r: 48, dmg: 360, h: 'mid', str: 'super', el: 'blade', blk: -28, invuln: [1, 13], movement: [[0, 55, 0], [11, 0, 0]],
      box: { x: 100, y: 1150, len: 750, r: 250 }, wind: 'sheathStance', ext: 'slashExt', cinematic: 'ultimate', fx: 'asura',
      extra: { followup: 'zoro_ult_aw_cine' } }),
    ultCine('zoro_ult_aw_cine', 'Asura: Makyusen', 190, [30, 38, 46, 54, 62, 70, 78, 86, 94, 160],
      [[0, 'slashExt'], [12, 'awakenPose'], ...flurry(28, 100, 4, ['slashExt', 'spinAttack', 'slashUpExt', 'slashLowExt']), [104, 'sheathStance'], [156, 'quickDraw'], [180, 'win']],
      'blade', 'asura_nine_swords'),

    // ---------------------------------------------------------------- Soul Realm
    mv({ id: 'zoro_king_of_hell', name: 'King of Hell', kind: 'special', input: '', s: 20, a: 1, r: 10, dmg: 0,
      h: 'mid', str: 'super', el: 'blade', invuln: [1, 31], ki: 0,
      anim: [[0, 'sheathStance'], [10, 'awakenPose'], [20, 'sheathStance'], [29, 'idle']], fx: 'king_of_hell',
      extra: { internal: true, realm: { kind: 'king_of_hell', duration: 360 } } }),
  ],
};
