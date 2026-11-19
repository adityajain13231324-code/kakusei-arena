// Broadcast flavor layer: two original commentators + a "BREAKING" news ticker that react to the fight.
// Purely cosmetic and DOM-only; HudScreen feeds it sim events and per-frame state.
import type { CharId, GameState, SimEvent } from '../sim/types';
import { h } from './dom';
import { META } from './meta';

type Spk = 'h' | 'p';
interface Line { s: Spk; t: string }
/** one exchange: the lines are shown one after the other */
type Bit = Line[];

const H = (t: string): Line => ({ s: 'h', t });
const P = (t: string): Line => ({ s: 'p', t });

/** {A} = the fighter who did it, {B} = the fighter it happened to, {N} = a number, {R} = round number */
const LINES: Record<string, Bit[]> = {
  intro: [
    [H('WELCOME to the ARENA, folks! The air smells like destiny and nachos!'), P('The nachos are not in the budget. Neither is destiny.')],
    [H('{A} versus {B}! My heart is doing a combo!'), P('Resting heart rate: 142. Cardio frames: unverified.')],
    [H('Round {R}! Hold your snacks, scream silently, believe in friendship!'), P('Believe in frame data. It believes in you back.')],
    [H('Two fighters enter! One fighter leaves with a dramatic limp!'), P('Technically both leave. The venue has doors.')],
  ],
  finalRound: [
    [H('FINAL ROUND! Everything is on the line, including my voice!'), P('Mathematically, one of them will lose. I checked twice.')],
    [H('It all comes down to THIS! No pressure, {A} and {B}!'), P('Pressure is just atmosphere with opinions.')],
  ],
  firstHit: [
    [H('FIRST CONTACT! {A} draws first ouch!'), P('Landed on frame {F}. I am writing that on my hand.')],
    [H('{A} opens the scoring! {B} felt that in their ancestors!')],
    [P('Initial contact confirmed. Statistically the hardest hit psychologically.')],
    [H('{A} CONNECTS! Somewhere a manga editor just gasped!'), P('The editor has since recovered. Mostly.')],
  ],
  counter: [
    [H('COUNTER HIT! {B} walked into that like a door in the dark!'), P('Counter bonus applied. {B} has been scientifically punished.')],
    [H('{B} pressed a button at the wrong time! Beautiful! Tragic! Legal!')],
    [P('Interrupting someone mid-move is called "rude, with extra damage".')],
    [H('Ohhh, that is going in the highlight reel!'), P('Everything is going in the highlight reel. We have one reel.')],
  ],
  combo: [
    [H('{N} HITS! {B} is basically a pinball now!'), P('Damage scaling is shaking its head in disappointment.')],
    [H('IT KEEPS GOING! {B} has not seen the floor in ages!'), P('The floor has filed a missing person report.')],
    [H('Someone call the referee! Or a physicist! Or a priest!')],
    [P('{N} hits. At this point it is less a combo, more a lifestyle choice.')],
  ],
  bigCombo: [
    [H('TEN! HITS! I AM NOT OK! I AM SO NOT OK!'), P('Please log the combo before {B} lodges a complaint.')],
    [H('THAT IS A WHOLE ANIME EPISODE OF COMBO!'), P('Eleven minutes of recap, nine of combo.')],
  ],
  awaken: [
    [H('AWAKENING!! The hair! The aura! The unnecessary dramatic wind!'), P('Indoor wind speed: suspicious. Stage fans: unplugged.')],
    [H('{A} just went full KAKUSEI! The crowd is screaming in kanji!'), P('Awakening grants stats. Dramatic eyebrows are free.')],
    [P('Plot armor loading... 100%. Please keep arms inside the story.')],
  ],
  ultimate: [
    [H('ULTIMATE MOVE! Grab your popcorn and your will to live!'), P('300 Ki spent in the most theatrical way possible.')],
    [H('{A} yells a move name that lasts longer than the attack itself!'), P('Average ultimate name: three words. Average screaming: infinite.')],
    [P('Cinematic camera engaged. A reminder: it is still a fighting game.')],
    [H('SOMEBODY GET {B} A CHAIR AND AN APOLOGY!')],
  ],
  clash: [
    [H('BEAM CLASH!! MASH MASH MASH YOUR BUTTONS INTO DUST!'), P('I recommend stretching your thumbs. And your will.')],
    [P('Two beams, one space. Newton would like a word.'), H('Newton can WAIT, this is the good part!')],
  ],
  lowHp: [
    [H('{B} is hanging by a thread! A thin, anime thread!'), P('HP below 25%. I would say "be careful", but they cannot hear me.')],
    [H('Nope nope nope, {B} is in the DANGER ZONE!'), P('Danger zone, sponsored by bad decisions.')],
    [P('Below 35% the awakening unlocks. Panic, however, is always unlocked.')],
  ],
  ko: [
    [H('K.O.!! {B} is taking a very dramatic nap!'), P('Time of defeat logged. Cause: skill issue, probably.')],
    [H('THAT IS IT! {A} takes the round! Medics! No wait, he is fine, he is dramatic!')],
    [P('Gravity has defeated {B} too. Gravity is undefeated.')],
    [H('{B} is lying down! Strategically! Right? RIGHT?!'), P('Negative. Unconscious in a stylish way.')],
  ],
  perfect: [
    [H('PERFECT!! {A} did not take a SINGLE scratch! Not even emotional!'), P('Flawless. I would clap but I am holding a clipboard.')],
    [P('Perfect rounds happen in roughly 3% of matches. And 97% of my daydreams.')],
  ],
  timeout: [
    [H('TIME IS UP! They both forgot a clock existed!'), P('Official ruling: the clock won.')],
    [P('Timeout. Remarkable. Both are winners, mostly in the spiritual sense.')],
  ],
  idle: [
    [H('Neutral game! The tension is so thick you could cut it with a katana!'), P('A katana cannot cut tension. I tested. Twice.')],
    [H('They are just staring at each other. It is romantic, in a violent way.')],
    [P('Zoning: the art of standing still very aggressively.')],
    [H('Is anyone going to DO anything?! I am paid per exclamation mark!'), P('He is not. I read his contract.')],
    [P('The fighters have been circling for a while. A fascinating dance of mutual doubt.')],
    [H('Somebody sneeze, something has to happen!')],
  ],
  block: [
    [H('BLOCKED! The old "please do not hit me" technique!'), P('Chip damage is just taxes.')],
    [P('Guarding is 80% of fighting and 100% of staying conscious.')],
  ],
  grab: [
    [H('GRAB! {A} gives {B} an unscheduled hug!'), P('Throw range: one elbow. Escape window: one short regret.')],
    [P('Throws beat blocks. Rock-paper-scissors, but louder.')],
  ],
  guardCrush: [
    [H('GUARD CRUSH!! {B} blocked so hard the block gave up!'), P('Guard meter: empty. Dignity: also empty. Stagger window: very real.')],
    [H('SHATTERED! {B} is wearing a guard made of glass and {A} brought a hammer!'), P('Turtling has a finite budget. {B} just went bankrupt.')],
    [P('Sustained blocking drains the guard gauge. {B} found the bottom of it. Loudly.')],
    [H('{A} breaks the guard wide open! Somebody sweep up the shards!'), P('Hazard note: the shards are imaginary. The damage is not.')],
    [H('CRUNCH! That was {B}\'s guard, and also {B}\'s plan!'), P('Plan B has been located. It is also glass.')],
    [H('{B} held the block for TOO LONG and now the block holds {B} accountable!'), P('A stunned {B} is a free-combo coupon.')],
    [H('Pressure pressure pressure and CRACK! {A} does not knock, {A} shatters!'), P('Defensive options remaining: prayer, mostly.')],
  ],
  otg: [
    [H('{A} stomps a fallen {B}! Kicking someone while they are down! Sporting? NO! Effective? YES!'), P('Ground hit confirmed. Rules say it is allowed once. Ethics say less.')],
    [H('DOSU! {B} is already on the floor and {A} says "not yet"!'), P('Okizeme: the art of hitting someone who has just lost an argument with gravity.')],
    [P('Lying-down tax collected. {B} will be notified by mail, and by boot.')],
    [H('Oh that is COLD! {A} follows up on a knocked-down {B}!'), P('Technically the floor already hit {B} first. {A} just added a second opinion.')],
    [H('A ground pound! {B} became part of the stage!'), P('Dust level: dramatic. Respect level: conflicted.')],
    [H('{B} tried to relax on the floor and {A} charged an admission fee!'), P('Wake-up timing matters. So does not lying around.')],
  ],
  wall: [
    [H('WALL SPLAT! {B} is now a decorative poster!'), P('Arena structural integrity: questionable. {B} structural integrity: worse.')],
    [P('The wall was not consulted about this.')],
  ],
};

/** fighter-specific quips (used on first hit, clash, idle, ultimate for that fighter) */
const QUIPS: Record<CharId, Bit[]> = {
  kaito: [
    [H("Kaito's hair is now 40% fire, 60% plot armor!"), P('I keep telling him hair is not a heat source. He does not listen.')],
    [H('Kaito yelled a power-up speech. Nobody asked. Everyone loved it!')],
    [P('Kaito: hot-blooded, hot-headed, and frankly hot to the touch. Please do not touch.')],
  ],
  shiori: [
    [H('Where did Shiori go?! Is that a clone?! IS THAT THE CLONE?!'), P('The clone has a clone. That was not in the contract.')],
    [P('Shiori has not been seen in the shadows. She has been seen EXCLUSIVELY in shadows. Different thing.')],
    [H('Shiori is so fast, her shadow files complaints!')],
  ],
  ren: [
    [H('Ren has not opened his eyes ONCE! Is he even watching?!'), P('He is blocking on instinct. Or sleeping. Both are valid.')],
    [P('Ren has said four words this tournament. Three were "hm".')],
    [H('Ren sheathes his sword and the whole crowd goes silent! Because he asked!')],
  ],
  goro: [
    [H('Goro looks SO gentle right now. That is the scary part!'), P('Goro has the highest hug-to-damage ratio in the league.')],
    [P('Goro is the only fighter who says sorry before and after.')],
    [H('Goro just picked up a vending machine to apologize to it!')],
  ],
};

const ENDERS: Record<CharId, string> = {
  kaito: "Kaito's hair has been declared a fire hazard by three neighbouring dimensions",
  shiori: 'Shiori\'s shadow clone files complaint about unpaid overtime',
  ren: 'Ren still has not opened his eyes. Experts remain hopeful',
  goro: 'POLL: 87% of fans want Goro to hug them (13% already have)',
};

const TICKER_POOL = [
  'POLL: 87% of fans want Goro to hug them (13% already have)',
  'Ren still has not opened his eyes. Experts remain hopeful',
  "Kaito's hair has been declared a fire hazard by three neighbouring dimensions",
  "Shiori's shadow clone files complaint about unpaid overtime",
  'Arena floor reports "a lot of impact" this evening',
  'Snack stand sells out of onigiri; blames hype',
  'Professor Frame-Data seen counting something under his breath',
  'Weather: 100% chance of dramatic wind',
  'Referee reminds fighters that KAKUSEI is not a verb',
  'Hype-san loses voice at 7pm; voice reportedly "still screaming"',
  'Study: shouting move names raises damage by 0% and morale by 400%',
  'Sponsor message: Ki drinks, now with 12% more Ki',
  'Crowd demands a rematch. Also snacks',
  'Local cat enters arena, is immediately more popular than everyone',
  'Training montage budget exceeded by two whole montages',
  'Judges confirm: the audience was loud. Details at eleven',
  'Anime protagonist spotted giving a speech to a wall',
  'Stage lights ask to be paid in sunlight',
  'Fan asks "what is frame data?"; Professor weeps with joy',
  'BREAKING: nothing is broken, except several dreams',
];

export interface BroadcastOpts { root: HTMLElement }

const AV_H =
  '<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#2a1030"/><path d="M12 30 6 10l14 8 4-14 8 12 8-12 4 14 14-8-6 20z" fill="#ff5a2e"/><circle cx="32" cy="36" r="17" fill="#ffd9b5"/>' +
  '<path d="M15 29q17-9 34 0v-5q-17-9-34 0z" fill="#fff"/><circle cx="32" cy="26" r="3.6" fill="#ff2e63"/><path d="M23 38h5M36 38h5" stroke="#1a1020" stroke-width="2.6" stroke-linecap="round"/>' +
  '<ellipse class="mouth" cx="32" cy="46" rx="6" ry="4.5" fill="#6a1020"/><path d="M12 64q4-12 20-12t20 12z" fill="#ff2e63"/></svg>';
const AV_P =
  '<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#0e2230"/><circle cx="32" cy="14" r="8" fill="#c9ced8"/><path d="M14 36q-2-20 18-22t18 22z" fill="#c9ced8"/><circle cx="32" cy="38" r="16" fill="#f1d0b0"/>' +
  '<circle cx="25" cy="36" r="6.4" fill="#cfe9ff" fill-opacity=".55" stroke="#1a2a3a" stroke-width="2"/><circle cx="39" cy="36" r="6.4" fill="#cfe9ff" fill-opacity=".55" stroke="#1a2a3a" stroke-width="2"/><path d="M31 36h2" stroke="#1a2a3a" stroke-width="2"/>' +
  '<circle cx="25" cy="36" r="1.6" fill="#1a2a3a"/><circle cx="39" cy="36" r="1.6" fill="#1a2a3a"/><path d="M24 46q8 5 16 0q-8-2-16 0z" fill="#c9ced8"/><ellipse class="mouth" cx="32" cy="49" rx="3" ry="1.6" fill="#7a2030"/>' +
  '<path d="M12 64q4-12 20-12t20 12z" fill="#e8f1f7"/><path d="M28 52l4 6 4-6" fill="#2a5a8a"/></svg>';

function pick<T>(a: T[], not?: T): T {
  if (a.length === 1) return a[0];
  let v = a[Math.floor(Math.random() * a.length)];
  if (not !== undefined && v === not) v = a[(a.indexOf(v) + 1) % a.length];
  return v;
}

export class Broadcast {
  readonly panel: HTMLElement;
  readonly ticker: HTMLElement;
  private track: HTMLElement;
  private who: HTMLElement; private txt: HTMLElement;
  private avH: HTMLElement; private avP: HTMLElement;
  private enabled = true;
  private names: [string, string] = ['Kaito', 'Shiori'];
  private chars: [CharId, CharId] = ['kaito', 'shiori'];
  // fight stats
  private hits: [number, number] = [0, 0];
  private counters: [number, number] = [0, 0];
  private maxCombo = 0;
  private firstHit = false;
  private lowSaid: [boolean, boolean] = [false, false];
  private lastCat = '';
  private lastBit: Bit | null = null;
  private cool: Record<string, number> = {};
  private clock = 0;
  private idleT = 0;
  // current speech
  private seq: Line[] = [];
  private seqPri = -1;
  private cur: Line | null = null;
  private curT = 0; private curLen = 0; private shown = 0;
  private hold = 0;
  // ticker
  private prio: string[] = [];
  private x = 0;
  private lastTick = '';
  private tickSec = -1;
  private speed = 0;
  private lastState: GameState | null = null;
  private lastHeadline = 0;

  constructor() {
    this.avH = h('div', { class: 'bc-av h', html: AV_H });
    this.avP = h('div', { class: 'bc-av p', html: AV_P });
    this.who = h('b', { class: 'bc-who' });
    this.txt = h('span', { class: 'bc-txt' });
    this.panel = h('div', { class: 'bc-panel' },
      h('div', { class: 'bc-live' }, h('i', null), 'LIVE'),
      this.avH,
      h('div', { class: 'bc-body' }, this.who, this.txt),
      this.avP);
    this.track = h('div', { class: 'bc-track' });
    this.ticker = h('div', { class: 'bc-ticker' }, h('div', { class: 'bc-tag' }, h('span', null, 'BREAKING')), h('div', { class: 'bc-win' }, this.track));
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.panel.classList.toggle('off', !on);
    this.ticker.classList.toggle('off', !on);
  }

  begin(chars: [CharId, CharId], mode: string, label?: string): void {
    this.chars = chars;
    this.names = [META[chars[0]].given[0] + META[chars[0]].given.slice(1).toLowerCase(), META[chars[1]].given[0] + META[chars[1]].given.slice(1).toLowerCase()];
    this.hits = [0, 0]; this.counters = [0, 0]; this.maxCombo = 0;
    this.firstHit = false; this.lowSaid = [false, false];
    this.seq = []; this.cur = null; this.seqPri = -1; this.hold = 0; this.idleT = 0;
    this.cool = {}; this.clock = 0; this.prio = [];
    this.who.textContent = ''; this.txt.textContent = '';
    this.avH.classList.remove('talk'); this.avP.classList.remove('talk');
    this.track.replaceChildren(); this.x = 0; this.lastTick = ''; this.tickSec = -1;
    this.panel.classList.toggle('training', mode === 'training');
    this.ticker.classList.toggle('training', mode === 'training');
    void label;
    this.pushHeadline(`LIVE FROM THE ARENA: ${this.names[0].toUpperCase()} vs ${this.names[1].toUpperCase()}. Nobody is ready`, true);
    this.fillTicker();
  }

  // ------------------------------------------------------------ speech
  private fmt(t: string, a: 0 | 1, extra: Record<string, string | number> = {}): string {
    const A = this.names[a], B = this.names[1 - a as 0 | 1];
    return t.replace(/\{A\}/g, A).replace(/\{B\}/g, B).replace(/\{N\}/g, String(extra.N ?? '')).replace(/\{R\}/g, String(extra.R ?? '')).replace(/\{F\}/g, String(extra.F ?? ''));
  }
  private say(cat: string, pri: number, a: 0 | 1, extra: Record<string, string | number> = {}, coolMs = 0, pool?: Bit[]): void {
    if (!this.enabled) return;
    if (coolMs > 0 && (this.cool[cat] ?? -99) + coolMs > this.clock) return;
    if (this.cur && this.curT > 0 && pri <= this.seqPri) return;
    if (this.hold > 0 && pri < 3) return;
    const bits = pool ?? LINES[cat];
    if (!bits) return;
    let bit = pick(bits, undefined);
    if (bit === this.lastBit && bits.length > 1) bit = bits[(bits.indexOf(bit) + 1) % bits.length];
    this.lastBit = bit;
    this.cool[cat] = this.clock;
    this.lastCat = cat;
    this.seq = bit.map((l) => ({ s: l.s, t: this.fmt(l.t, a, extra) }));
    this.seqPri = pri;
    this.next();
  }
  private next(): void {
    const l = this.seq.shift();
    if (!l) { this.cur = null; this.seqPri = -1; this.avH.classList.remove('talk'); this.avP.classList.remove('talk'); return; }
    this.cur = l;
    this.curLen = l.t.length;
    this.shown = 0;
    this.curT = 2.2 + l.t.length * 0.045;
    this.who.textContent = l.s === 'h' ? 'HYPE-SAN' : 'PROF. FRAME-DATA';
    this.who.className = 'bc-who ' + l.s;
    this.txt.textContent = '';
    this.avH.classList.toggle('talk', l.s === 'h');
    this.avP.classList.toggle('talk', l.s === 'p');
    this.panel.classList.remove('pop'); void this.panel.offsetWidth; this.panel.classList.add('pop');
  }

  // ------------------------------------------------------------ events
  onEvents(events: SimEvent[], st: GameState): void {
    for (const e of events) {
      const a = e.player;
      const t = (e.target ?? (1 - a)) as 0 | 1;
      switch (e.type) {
        case 'roundStart': {
          this.firstHit = false; this.lowSaid = [false, false]; this.idleT = 0;
          const fin = st.roundsToWin > 1 && st.fighters[0].wins === st.roundsToWin - 1 && st.fighters[1].wins === st.roundsToWin - 1;
          if (!st.training) {
            this.hold = 0;
            this.say(fin ? 'finalRound' : 'intro', 3, 0, { R: st.round.number });
          }
          break;
        }
        case 'hit': case 'ultimateHit': case 'projectileHit': {
          this.hits[a]++;
          if (e.combo && e.combo > this.maxCombo) this.maxCombo = e.combo;
          this.idleT = 0;
          if (e.type === 'hit' && e.tag === 'otg') {
            this.say('otg', 1.8, a, {}, 6);
            if (Math.random() < 0.5) this.pushHeadline(`${this.names[a].toUpperCase()} stomps a grounded ${this.names[t]}; floor files for "second-hand damage"`);
          }
          if (!this.firstHit && e.type === 'hit' && st.round.phase === 'fight') {
            this.firstHit = true;
            if (Math.random() < 0.4) this.say('quip', 1.4, a, {}, 0, QUIPS[this.chars[a]]);
            else this.say('firstHit', 1.5, a, { F: Math.max(1, st.frame % 97 + 3) });
            this.pushHeadline(`${this.names[a].toUpperCase()} draws first blood, ${this.names[t]} files a polite complaint`);
          }
          if (e.type === 'hit' && e.combo === 5) {
            this.say('combo', 2, a, { N: 5 }, 0);
            this.pushHeadline(`${this.names[a].toUpperCase()} lands a 5-hit combo; ${this.names[t]} reportedly "just standing there, being hit"`);
          }
          if (e.type === 'hit' && e.combo === 10) {
            this.say('bigCombo', 2.6, a, { N: 10 });
            this.pushHeadline(`10-HIT COMBO! Floor officially asks ${this.names[t]} to "please come down"`);
          }
          break;
        }
        case 'counter':
          this.counters[a]++;
          this.say('counter', 1.5, a, {}, 6);
          break;
        case 'block': this.say('block', 0.4, a, {}, 14); break;
        case 'guardCrush':
          this.say('guardCrush', 2.5, a, {}, 5);
          this.pushHeadline(`GUARD CRUSH! ${this.names[t].toUpperCase()}'s block declared "structurally unsound" by inspectors`, true);
          break;
        case 'throw': this.say('grab', 0.6, a, {}, 12); break;
        case 'wallSplat': this.say('wall', 0.8, a, {}, 12); break;
        case 'awaken':
          this.say('awaken', 3, a); this.hold = 0;
          this.pushHeadline(`ALERT: ${this.names[a].toUpperCase()}'s hair has gone SUPER. Experts say "oh no"`, true);
          break;
        case 'ultimateStart':
          if (Math.random() < 0.35) this.say('quip', 3, a, {}, 0, QUIPS[this.chars[a]]); else this.say('ultimate', 3, a);
          this.pushHeadline(`${this.names[a].toUpperCase()} yells ultimate name; earplug stocks plummet`, true);
          break;
        case 'clashStart':
          this.say('clash', 3, a);
          this.pushHeadline('BEAM CLASH! Physicists announce they have "no idea either"', true);
          break;
        case 'ko': {
          const loser = st.fighters[0].hp <= 0 ? 0 : 1;
          this.say('ko', 4, (1 - loser) as 0 | 1);
          this.hold = 2.4;
          this.pushHeadline(`BREAKING: ${this.names[loser].toUpperCase()} has been horizontal for several seconds. Medics deny there is a problem`, true);
          break;
        }
        case 'timeout':
          this.say('timeout', 3, 0); this.pushHeadline('TIME UP! Clock declared winner by unanimous decision', true);
          break;
        case 'roundEnd': {
          const w = st.round.winner;
          if (w === 0 || w === 1) {
            const f = st.fighters[w];
            if (f.hp >= f.maxHp) { this.hold = 0; this.say('perfect', 4, w); this.pushHeadline(`PERFECT ROUND: ${this.names[w].toUpperCase()} has not been touched. Not even emotionally`, true); }
          }
          break;
        }
        default: break;
      }
    }
  }

  // ------------------------------------------------------------ ticker
  /** event headline: slot it in just off the right edge so it scrolls in next */
  private pushHeadline(t: string, _front = false): void {
    if (!this.enabled) return;
    const win = this.ticker.querySelector('.bc-win') as HTMLElement | null;
    const item = h('span', { class: 'bc-item hot' }, t, h('i', null, '◆'));
    const w = win?.clientWidth ?? 0;
    if (!w || !this.track.firstElementChild) { if (this.prio.length < 6) this.prio.push(t); return; }
    // drop earlier un-shown hot headlines so they do not pile up
    let ref: HTMLElement | null = null;
    for (const c of Array.from(this.track.children) as HTMLElement[]) {
      if (c.offsetLeft + this.x >= w * 0.98) { ref = c; break; }
    }
    const hotAhead = Array.from(this.track.querySelectorAll('.bc-item.hot')).filter((c) => (c as HTMLElement).offsetLeft + this.x >= w * 0.98);
    if (hotAhead.length >= 2) hotAhead[hotAhead.length - 1].remove();
    if (ref && ref.parentElement) this.track.insertBefore(item, ref); else this.track.appendChild(item);
  }

  private dynamicHeadline(st: GameState | null): string {
    const [a, b] = this.names;
    const A = a.toUpperCase(), B = b.toUpperCase();
    const r = Math.random();
    if (st && r < 0.5) {
      const f = st.fighters;
      const pa = Math.round((f[0].hp / f[0].maxHp) * 100), pb = Math.round((f[1].hp / f[1].maxHp) * 100);
      const picks = [
        `LIVE STATS: ${A} has landed ${this.hits[0]} hits, ${B} has landed ${this.hits[1]}. Math checks out`,
        `HEALTH REPORT: ${A} at ${pa}%, ${B} at ${pb}%. Both describe themselves as "fine"`,
        `LONGEST COMBO SO FAR: ${this.maxCombo} hits. The floor has questions`,
        `COUNTER HITS: ${A} ${this.counters[0]}, ${B} ${this.counters[1]}. Referee "taking notes, mostly doodles"`,
        `ROUND ${st.round.number}: ${Math.max(0, Math.ceil(st.round.timer / 60))}s left on the clock and nobody has apologized`,
        `${pa === pb ? 'DEAD EVEN: both fighters equally hurt' : pa > pb ? `${A} leads on health by ${pa - pb}%` : `${B} leads on health by ${pb - pa}%`}. Analysts nod in unison`,
      ];
      return pick(picks);
    }
    if (r < 0.62) return ENDERS[this.chars[Math.random() < 0.5 ? 0 : 1]];
    let t = pick(TICKER_POOL);
    if (t === this.lastTick) t = pick(TICKER_POOL, t);
    return t;
  }

  private addItem(t: string): void {
    this.lastTick = t;
    this.track.appendChild(h('span', { class: 'bc-item' }, t, h('i', null, '◆')));
  }
  private fillTicker(): void {
    const win = this.ticker.querySelector('.bc-win') as HTMLElement;
    const need = (win.clientWidth || 800) * 2.2;
    let guard = 0;
    while (this.track.scrollWidth < need && guard++ < 40) this.addItem(this.prio.shift() ?? this.dynamicHeadline(this.lastState));
  }

  // ------------------------------------------------------------ per frame
  update(dt: number, st: GameState): void {
    if (!this.enabled) return;
    this.lastState = st;
    this.clock += dt;
    if (this.hold > 0) this.hold -= dt;
    // low HP
    if (st.round.phase === 'fight') {
      for (const p of [0, 1] as const) {
        const f = st.fighters[p];
        if (!this.lowSaid[p] && f.hp > 0 && f.hp / f.maxHp < 0.25) {
          this.lowSaid[p] = true;
          this.say('lowHp', 2, (1 - p) as 0 | 1);
          this.pushHeadline(`${this.names[p].toUpperCase()} is down to ${Math.round((f.hp / f.maxHp) * 100)}% health and "feeling very motivated"`);
        }
      }
      this.idleT += dt;
      if (this.idleT > 8.5 && !this.cur) {
        this.idleT = 0;
        if (Math.random() < 0.35) this.say('quip', 0.2, Math.random() < 0.5 ? 0 : 1 as 0 | 1, {}, 0, QUIPS[this.chars[Math.random() < 0.5 ? 0 : 1]]);
        else this.say('idle', 0.2, 0);
      }
    }
    // typewriter
    if (this.cur) {
      const want = Math.min(this.curLen, Math.floor((2.2 + this.cur.t.length * 0.045 - this.curT) * 70));
      if (want > this.shown) { this.shown = want; this.txt.textContent = this.cur.t.slice(0, Math.max(0, want)); }
      this.curT -= dt;
      if (this.curT <= 0) {
        if (this.seq.length) this.next();
        else { this.cur = null; this.seqPri = -1; this.avH.classList.remove('talk'); this.avP.classList.remove('talk'); }
      }
    }
    // ticker scroll
    if (this.ticker.offsetParent !== null || this.ticker.clientWidth) {
      const em = parseFloat(getComputedStyle(this.ticker).fontSize) || 14;
      this.speed = em * 5.6;
      this.x -= this.speed * dt;
      const first = this.track.firstElementChild as HTMLElement | null;
      if (first) {
        const w = first.offsetWidth;
        if (w > 0 && -this.x >= w) { this.x += w; first.remove(); }
      }
      const win = this.ticker.querySelector('.bc-win') as HTMLElement;
      if (this.track.scrollWidth + this.x < win.clientWidth * 1.6) {
        this.addItem(this.prio.shift() ?? this.dynamicHeadline(st));
      }
      this.track.style.transform = `translate3d(${this.x.toFixed(1)}px,0,0)`;
    }
  }
}
