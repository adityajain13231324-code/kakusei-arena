/**
 * Balance + side-bias report (slow: a few minutes). Run: npm run test:balance
 *   env BAL_MIRROR=200 (mirror matches per character), BAL_CELL=100 (matches per matrix cell)
 *   Pass bands are ~3 standard errors around the targets (target: cells 40-60%).
 *
 * (1) P1-side bias: nightmare-vs-nightmare mirror matches per character. The sim is strictly
 *     side-symmetric (npm test section g); what remains is the CPU's own randomness.
 * (2) Character win-rate matrix at hard (sides alternate every match) + round length.
 * (3) BnB combo table (damage vs each opponent).
 * Prints markdown tables used in docs/BALANCE.md.
 */
import { ALL_CHARS, type CharId } from '../src/sim/index';
import { mirrorRate, pairRate } from './lib/harness';
import { BNB, bnbSetup } from './lib/bnb';
import { playCombo } from './lib/finder';

declare const process: { env: Record<string, string | undefined>; exit(code: number): never };
let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const NM = +(process.env.BAL_MIRROR ?? 200);
const NC = +(process.env.BAL_CELL ?? 100);
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

console.log(`\n== (1) P1-side bias: ${NM} nightmare mirror matches per character`);
console.log('| Fighter | P1 wins | P2 wins | draws | P1 rate |\n|---|---|---|---|---|');
let p1All = 0, nAll = 0;
const mirrorRes: Array<[CharId, number]> = [];
for (const c of ALL_CHARS) {
  const r = mirrorRate(c, 'nightmare', NM, 11);
  p1All += r.p1 + r.draws / 2; nAll += NM;
  mirrorRes.push([c, r.rate]);
  console.log(`| ${c} | ${r.p1} | ${r.p2} | ${r.draws} | ${pct(r.rate)} |`);
}
console.log(`| **all** | | | | **${pct(p1All / nAll)}** |`);
for (const [c, rate] of mirrorRes) check(`${c}: P1 mirror rate within 40-60% (n=${NM})`, rate >= 0.4 && rate <= 0.6, pct(rate));
check(`pooled P1 rate within 45-55% (n=${nAll})`, p1All / nAll >= 0.45 && p1All / nAll <= 0.55, pct(p1All / nAll));

console.log(`\n== (2) win-rate matrix, hard vs hard, ${NC} matches per cell (row fighter's win rate)`);
const rate: Record<string, number> = {};
const rounds: number[] = [];
for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
  const a = ALL_CHARS[i], b = ALL_CHARS[j];
  const r = pairRate(a, b, 'hard', NC, 21);
  rate[`${a}|${b}`] = r.rate; rate[`${b}|${a}`] = 1 - r.rate;
  rounds.push(...r.rounds);
}
console.log(`| vs | ${ALL_CHARS.join(' | ')} | avg |\n|---|---|---|---|---|---|`);
for (const a of ALL_CHARS) {
  let s = 0;
  const cells = ALL_CHARS.map((b) => { if (a === b) return '—'; s += rate[`${a}|${b}`]; return pct(rate[`${a}|${b}`]); });
  console.log(`| **${a}** | ${cells.join(' | ')} | ${pct(s / 3)} |`);
}
const avgRound = rounds.reduce((x, y) => x + y, 0) / rounds.length / 60;
const timeouts = rounds.filter((r) => r >= 60 * 60 - 1).length;
console.log(`\nrounds: ${rounds.length}, average ${avgRound.toFixed(1)} s, timeouts ${timeouts}`);
for (const k of Object.keys(rate)) { const [a, b] = k.split('|'); if (a < b) check(`${a} vs ${b} within 35-65%`, rate[k] >= 0.35 && rate[k] <= 0.65, pct(rate[k])); }
check('average round length 25-45 s (hard vs hard)', avgRound >= 25 && avgRound <= 45, `${avgRound.toFixed(1)} s`);

console.log('\n== (3) BnB combos (damage vs kaito / shiori / ren / goro)');
console.log('| Fighter | Combo | Inputs | Hits | Damage |\n|---|---|---|---|---|');
for (const c of ALL_CHARS) for (const b of BNB[c]) {
  const d = ALL_CHARS.map((vs) => playCombo(bnbSetup(c, vs, b), b.steps));
  const dm = [...new Set(d.map((r) => (r.ok ? r.dmg : -1)))];
  console.log(`| ${c} | ${b.name}${b.ki ? ' (3 bars)' : ''}${b.wall ? ' (wall)' : ''} | \`${b.notation}\` | ${d[0].hits} | ${dm.join(' / ')} |`);
  check(`${c} ${b.name} connects on everyone`, d.every((r) => r.ok));
}

console.log(failures ? `\n${failures} FAILED` : '\nall balance checks passed');
process.exit(failures ? 1 : 0);
