/**
 * MONKEY D. LUFFY — The Rubber Captain (Crossover Pack). Long-reach brawler.
 * RUBBER BODY: stretch limbs = the longest normals in the game (slower startup to pay for it).
 * Specials: Gum-Gum Pistol (very long punch), Gatling (multi-hit), Rocket (stretch dash), Bell (headbutt, stagger).
 * Awakening = Gear Second (form 'gear2': +15% speed, Jet Pistol); below 20% HP while awakened = Gear Fourth
 * (form 'gear4', optional form_gear4.glb: Kong Gun / Leo Bazooka replace Pistol / Gatling).
 * Ultimate: King Kong Gun. Soul Realm: Gear Fifth (form 'gear5'; juggles float and bounce off the floor).
 */
import type { CharDef } from '../../sim/types';
import { mv, throwPair, ultCine, flurry } from '../build';

const SC = ['special', 'ki', 'ultimate'];

export const LUFFY: CharDef = {
  id: 'luffy',
  name: 'MONKEY D. LUFFY',
  title: 'The Rubber Captain',
  maxHp: 1020,
  walkSpeed: 50,
  backWalkSpeed: 40,
  dashSpeed: 105,
  sidestepSpeed: 54,
  jumpVel: 88,
  weight: 100,
  height: 1720,
  radius: 300,
  palette: { primary: '#d8282c', secondary: '#2a5aa8', accent: '#f2c94c', hair: '#141414', skin: '#efc39c', aura: '#ff5a5a' },
  element: 'rubber',
  ultimateId: 'luffy_ult',
  awakenedUltimateId: 'luffy_ult_aw',
  realmId: 'luffy_gear5',
  autoComboEnder: 'luffy_rocket',
  moves: [
    // ---------------------------------------------------------------- normals (stretchy)
    mv({ id: 'luffy_jab', name: 'Gum-Gum Jab', input: 'L', s: 11, a: 2, r: 13, dmg: 40, h: 'high', str: 'light',
      blk: 0, hit: 7, box: { x: 250, y: 1450, len: 680, r: 110 }, wind: 'jabWind', ext: 'jabExt', cancel: SC, window: [12, 23], fx: 'rubber_jab' }),
    mv({ id: 'luffy_jab2', name: 'Gum-Gum Jab Two', input: 'L,L', s: 10, a: 2, r: 14, dmg: 38, h: 'high', str: 'light',
      blk: -2, hit: 6, box: { x: 250, y: 1450, len: 680, r: 110 }, wind: 'straightWind', ext: 'straightExt', cancel: SC, window: [11, 24], fx: 'rubber_jab' }),
    mv({ id: 'luffy_whip3', name: 'Gum-Gum Whip', input: 'L,L,K', s: 15, a: 3, r: 21, dmg: 72, h: 'mid', str: 'medium', el: 'rubber',
      blk: -8, hit: 4, box: { x: 250, y: 1050, len: 880, r: 130 }, wind: 'midKickWind', ext: 'roundhouseExt', cancel: SC, window: [16, 27], fx: 'rubber_whip' }),
    mv({ id: 'luffy_punch', name: 'Gum-Gum Punch', input: 'H', s: 15, a: 3, r: 20, dmg: 92, h: 'mid', str: 'medium', el: 'rubber',
      blk: -7, hit: 4, box: { x: 250, y: 1200, len: 950, r: 130 }, wind: 'straightWind', ext: 'straightExt', cancel: SC, window: [16, 28], fx: 'rubber_punch' }),
    mv({ id: 'luffy_bazooka', name: 'Gum-Gum Bazooka', input: 'H,H', s: 18, a: 3, r: 24, dmg: 110, h: 'mid', str: 'heavy', el: 'rubber',
      blk: -13, onHit: 'knockdown', box: { x: 250, y: 1200, len: 750, r: 170 }, wind: 'palmWind', ext: 'palmExt', cancel: SC, window: [19, 30], fx: 'rubber_bazooka' }),
    mv({ id: 'luffy_kick', name: 'Gum-Gum Lash', input: 'K', s: 14, a: 3, r: 20, dmg: 85, h: 'high', str: 'medium', el: 'rubber',
      blk: -4, hit: 5, box: { x: 250, y: 1450, len: 900, r: 120 }, wind: 'highKickWind', ext: 'highKickExt', cancel: SC, window: [15, 25], fx: 'rubber_whip' }),
    mv({ id: 'luffy_snap', name: 'Gum-Gum Snap', input: '2L', s: 12, a: 2, r: 15, dmg: 32, h: 'low', str: 'light',
      blk: -12, hit: 3, box: { x: 250, y: 300, len: 680, r: 110 }, wind: 'lowKickWind', ext: 'lowKickExt', fx: 'rubber_low' }),
    mv({ id: 'luffy_sickle', name: 'Gum-Gum Sickle', input: '2K', s: 17, a: 3, r: 25, dmg: 80, h: 'low', str: 'medium', el: 'rubber',
      blk: -17, onHit: 'knockdown', box: { x: 200, y: 220, len: 900, r: 130 }, wind: 'lowKickWind', ext: 'sweepExt', fx: 'rubber_sweep', extra: { otg: true } }),
    mv({ id: 'luffy_launcher', name: 'Gum-Gum Uppercut', input: '3H', s: 16, a: 2, r: 22, dmg: 72, h: 'mid', str: 'medium', el: 'rubber',
      blk: -14, onHit: 'launch', launch: 64, box: { x: 200, y: 1150, len: 500, r: 170 }, wind: 'uppercutWind', ext: 'uppercutExt', fx: 'rubber_rise' }),
    mv({ id: 'luffy_spear', name: 'Gum-Gum Spear', input: '6H', s: 15, a: 3, r: 19, dmg: 98, h: 'mid', str: 'medium', el: 'rubber', trk: 'right',
      blk: -4, hit: 5, onCH: 'stagger', box: { x: 250, y: 1000, len: 820, r: 140 }, wind: 'midKickWind', ext: 'flyingKick',
      cancel: SC, window: [16, 27], fx: 'rubber_spear' }),
    mv({ id: 'luffy_axe', name: 'Gum-Gum Axe', input: '4K', s: 19, a: 3, r: 21, dmg: 115, h: 'mid', str: 'heavy', el: 'rubber',
      blk: -12, onHit: 'knockdown', onCH: 'launch', launch: 58, box: { x: 250, y: 1100, len: 720, r: 150 },
      wind: 'axeKickUp', ext: 'axeKickDown', fx: 'rubber_axe' }),
    mv({ id: 'luffy_jk', name: 'Gum-Gum Stamp', input: 'K', requires: 'air', s: 9, a: 6, r: 10, dmg: 78, h: 'mid', str: 'medium', el: 'rubber',
      blk: -2, hit: 8, box: { x: 150, y: 800, len: 700, r: 140 }, wind: 'jumpUp', ext: 'diveKick', fx: 'rubber_stamp' }),
    mv({ id: 'luffy_jh', name: 'Gum-Gum Hammer', input: 'H', requires: 'air', s: 12, a: 5, r: 12, dmg: 92, h: 'mid', str: 'heavy', el: 'rubber',
      blk: -4, onHit: 'knockdown', box: { x: 150, y: 800, len: 600, r: 170 }, wind: 'liftOverhead', ext: 'groundPound', fx: 'rubber_bazooka' }),

    // ---------------------------------------------------------------- specials
    mv({ id: 'luffy_pistol', name: 'Gum-Gum Pistol', kind: 'special', input: '214S', easy: '4S', s: 18, a: 3, r: 30, dmg: 80,
      h: 'mid', str: 'heavy', el: 'rubber', blk: -14, hit: 0, ki: 8,
      box: { x: 250, y: 1250, len: 1300, r: 120 }, wind: 'straightWind', ext: 'straightExt', fx: 'gum_pistol' }),
    mv({ id: 'luffy_gatling', name: 'Gum-Gum Gatling', kind: 'special', input: '236S', easy: '6S', s: 14, a: 16, r: 20, dmg: 24,
      h: 'mid', str: 'medium', el: 'rubber', blk: -8, hit: 2, ki: 8, push: 60,
      box: [{ x: 250, y: 1250, len: 850, r: 150, from: 15, to: 15 }, { x: 250, y: 1150, len: 850, r: 150, from: 18, to: 18 },
        { x: 250, y: 1300, len: 850, r: 150, from: 21, to: 21 }, { x: 250, y: 1200, len: 850, r: 150, from: 24, to: 24 },
        { x: 250, y: 1250, len: 850, r: 160, from: 28, to: 28 }],
      anim: [[0, 'straightWind'], ...flurry(14, 30, 2, ['jabExt', 'straightExt']), [30, 'recover'], [44, 'idle']], fx: 'gum_gatling' }),
    mv({ id: 'luffy_rocket', name: 'Gum-Gum Rocket', kind: 'special', input: '41236S', easy: '8S', s: 16, a: 6, r: 24, dmg: 100,
      h: 'mid', str: 'heavy', el: 'rubber', blk: -12, onHit: 'wallbounce', ki: 8,
      movement: [[0, 4, 0], [10, 75, 0], [24, 0, 0]], box: { x: 100, y: 1150, len: 400, r: 230 },
      anim: [[0, 'crouch'], [10, 'dash'], [16, 'bodySlam'], [30, 'recover'], [42, 'idle']], fx: 'gum_rocket' }),
    mv({ id: 'luffy_bell', name: 'Gum-Gum Bell', kind: 'special', input: '623S', easy: '2S', s: 13, a: 4, r: 26, dmg: 100,
      h: 'mid', str: 'heavy', el: 'rubber', blk: -16, hit: 2, onHit: 'stagger', armor: [5, 16], ki: 8,
      movement: [[0, 10, 0], [12, 0, 0]], box: { x: 200, y: 1500, len: 500, r: 200 },
      anim: [[0, 'liftOverhead'], [12, 'bodySlam'], [30, 'recover'], [42, 'idle']], fx: 'gum_bell' }),
    // Gear Second / Fourth replacements
    mv({ id: 'luffy_jet_pistol', name: 'Gear Second: Jet Pistol', kind: 'special', input: '214S', easy: '4S', s: 11, a: 3, r: 22, dmg: 105,
      h: 'mid', str: 'heavy', el: 'rubber', blk: -8, hit: 3, ki: 8,
      box: { x: 250, y: 1250, len: 1450, r: 140 }, wind: 'straightWind', ext: 'straightExt', fx: 'jet_pistol', extra: { needForm: 'gear2' } }),
    mv({ id: 'luffy_kong_gun', name: 'Gear Fourth: Kong Gun', kind: 'special', input: '214S', easy: '4S', s: 14, a: 4, r: 26, dmg: 150,
      h: 'mid', str: 'heavy', el: 'rubber', blk: -14, onHit: 'wallbounce', ki: 8, armor: [4, 14],
      box: { x: 250, y: 1250, len: 1300, r: 240 }, wind: 'palmWind', ext: 'straightExt', fx: 'kong_gun', extra: { needForm: 'gear4' } }),
    mv({ id: 'luffy_leo_bazooka', name: 'Gear Fourth: Leo Bazooka', kind: 'special', input: '236S', easy: '6S', s: 16, a: 4, r: 26, dmg: 140,
      h: 'mid', str: 'heavy', el: 'rubber', blk: -14, onHit: 'wallbounce', ki: 8, armor: [4, 16],
      box: { x: 200, y: 1200, len: 900, r: 260 }, wind: 'palmWind', ext: 'palmExt', fx: 'leo_bazooka', extra: { needForm: 'gear4' } }),

    // ---------------------------------------------------------------- Ki specials
    mv({ id: 'luffy_red_hawk', name: 'Gum-Gum Red Hawk', kind: 'ki', input: '236S+K', easy: 'S+K', kiCost: 100, s: 16, a: 6, r: 26,
      dmg: 160, h: 'mid', str: 'heavy', el: 'fire', blk: -14, onHit: 'wallbounce', invuln: [1, 10],
      movement: [[0, 6, 0], [10, 60, 0], [22, 0, 0]], box: { x: 150, y: 1200, len: 700, r: 220 },
      anim: [[0, 'straightWind'], [10, 'dash'], [16, 'straightExt'], [34, 'recover'], [46, 'idle']], fx: 'red_hawk' }),
    mv({ id: 'luffy_elephant_gun', name: 'Gum-Gum Elephant Gun', kind: 'ki', input: '41236S+K', easy: '2S+K', requires: 'awakened', kiCost: 100,
      s: 14, a: 5, r: 26, dmg: 170, h: 'mid', str: 'heavy', el: 'rubber', blk: -16, onHit: 'launch', launch: 60, armor: [1, 18],
      box: { x: 200, y: 1300, len: 1000, r: 280 }, wind: 'liftOverhead', ext: 'palmExt', fx: 'elephant_gun' }),

    // ---------------------------------------------------------------- throw
    ...throwPair('luffy', 'Gum-Gum Slingshot', 125, 'rubber'),

    // ---------------------------------------------------------------- ultimates
    mv({ id: 'luffy_ult', name: 'Gear Fourth: King Kong Gun', kind: 'ultimate', input: '236H+S', easy: 'Ult', kiCost: 300, s: 12, a: 4, r: 50,
      dmg: 330, h: 'mid', str: 'super', el: 'rubber', blk: -30, invuln: [1, 16], movement: [[0, 30, 0], [14, 0, 0]],
      box: { x: 150, y: 1200, len: 900, r: 280 }, wind: 'liftOverhead', ext: 'straightExt', cinematic: 'ultimate', fx: 'king_kong_gun',
      extra: { followup: 'luffy_ult_cine' } }),
    ultCine('luffy_ult_cine', 'Gear Fourth: King Kong Gun', 180, [30, 140, 150],
      [[0, 'straightExt'], [20, 'awakenPose'], [40, 'jumpUp'], [70, 'liftOverhead'], [130, 'beamCharge'], [140, 'straightExt'], [170, 'win']],
      'rubber', 'king_kong_gun'),
    mv({ id: 'luffy_ult_aw', name: 'Gum-Gum Bajrang Gun', kind: 'ultimate', input: '236H+S', easy: 'Ult', requires: 'awakened', kiCost: 200,
      s: 11, a: 4, r: 48, dmg: 360, h: 'mid', str: 'super', el: 'rubber', blk: -28, invuln: [1, 15], movement: [[0, 34, 0], [13, 0, 0]],
      box: { x: 150, y: 1200, len: 900, r: 280 }, wind: 'liftOverhead', ext: 'straightExt', cinematic: 'ultimate', fx: 'bajrang_gun',
      extra: { followup: 'luffy_ult_aw_cine' } }),
    ultCine('luffy_ult_aw_cine', 'Gum-Gum Bajrang Gun', 190, [24, 32, 40, 48, 150, 160],
      [[0, 'straightExt'], ...flurry(20, 56, 4, ['jabExt', 'straightExt']), [60, 'awakenPose'], [100, 'liftOverhead'], [146, 'straightExt'], [180, 'win']],
      'rubber', 'bajrang_gun'),

    // ---------------------------------------------------------------- Soul Realm
    mv({ id: 'luffy_gear5', name: 'Gear Fifth', kind: 'special', input: '', s: 20, a: 1, r: 10, dmg: 0,
      h: 'mid', str: 'super', el: 'rubber', invuln: [1, 31], ki: 0,
      anim: [[0, 'kiCharge'], [10, 'awakenPose'], [20, 'win'], [29, 'idle']], fx: 'gear_fifth',
      extra: { internal: true, realm: { kind: 'gear_fifth', duration: 360 } } }),
  ],
};
