/**
 * Small DOM overlay for online matches: connection bars + ping in the top-right corner,
 * "waiting for opponent" banner when the rollback window is exhausted, dev desync warning.
 * Appended next to the HUD (does not modify the HUD screen).
 */
import type { NetSession } from './netsession';

export function qualityBars(rtt: number): number {
  if (rtt <= 0) return 0;
  return rtt < 70 ? 4 : rtt < 130 ? 3 : rtt < 200 ? 2 : 1;
}

export class NetOverlay {
  readonly el: HTMLElement;
  private bars: HTMLElement[] = [];
  private ping: HTMLElement;
  private dev: HTMLElement;
  private wait: HTMLElement;
  private warn: HTMLElement;
  private you: HTMLElement;
  private t = 0;
  private warnT = 0;
  private youT = 0;
  showDev = false;

  constructor(root: HTMLElement) {
    const mk = (tag: string, cls: string, text = '') => { const e = document.createElement(tag); e.className = cls; e.textContent = text; return e; };
    this.el = mk('div', 'netov');
    const box = mk('div', 'netov-conn');
    const barsEl = mk('div', 'netov-bars');
    for (let i = 0; i < 4; i++) { const b = mk('i', ''); b.style.height = `${35 + i * 20}%`; barsEl.appendChild(b); this.bars.push(b); }
    this.ping = mk('span', 'netov-ping', '-- ms');
    this.dev = mk('pre', 'netov-dev');
    box.append(barsEl, this.ping);
    this.wait = mk('div', 'netov-wait', 'WAITING FOR OPPONENT…');
    this.warn = mk('div', 'netov-warn');
    this.you = mk('div', 'netov-you');
    this.el.append(box, this.dev, this.wait, this.warn, this.you);
    root.appendChild(this.el);
    this.el.addEventListener('click', () => { this.showDev = !this.showDev; });
  }

  show(on: boolean, localSlot: 0 | 1 = 0): void {
    this.el.classList.toggle('on', on);
    if (on) {
      this.you.textContent = localSlot === 0 ? '◀ YOU ARE P1' : 'YOU ARE P2 ▶';
      this.you.classList.toggle('r', localSlot === 1);
      this.youT = 5;
      this.you.classList.add('on');
    }
  }

  desync(frame: number, isHost: boolean): void {
    this.warn.textContent = `DESYNC @${frame} — ${isHost ? 'resyncing guest' : 'host is resyncing'}`;
    this.warn.classList.add('on');
    this.warnT = 4;
    console.warn(`[net] desync detected at frame ${frame}`);
  }

  update(dt: number, s: NetSession, connected: boolean): void {
    if (this.warnT > 0 && (this.warnT -= dt) <= 0) this.warn.classList.remove('on');
    if (this.youT > 0 && (this.youT -= dt) <= 0) this.you.classList.remove('on');
    const rb = s.rb;
    const waiting = !connected || (s.started && (rb.waiting || s.silenceMs() > 1500)) || !s.started;
    this.wait.textContent = !connected ? 'OPPONENT DISCONNECTED' : !s.started ? 'WAITING FOR OPPONENT TO LOAD…' : 'WAITING FOR OPPONENT…';
    this.wait.classList.toggle('on', waiting && !s.ended);
    if ((this.t -= dt) > 0) return;
    this.t = 0.25;
    const rtt = rb.rtt;
    const q = connected ? qualityBars(rtt) : 0;
    this.bars.forEach((b, i) => b.classList.toggle('on', i < q));
    this.el.dataset.q = String(q);
    this.ping.textContent = rtt > 0 ? `${Math.round(rtt)} ms` : '-- ms';
    this.dev.style.display = this.showDev ? '' : 'none';
    if (this.showDev) {
      const st = rb.stats;
      this.dev.textContent =
        `frame ${rb.curFrame}  conf ${rb.confirmedFrame}\ndelay ${rb.delay}f  adv ${rb.localAdv.toFixed(1)}\n` +
        `rollbacks ${st.rollbacks} (max ${st.maxRollback}f)\nstalls ${st.stallTicks}  waits ${st.waits}\n` +
        `hash ok ${st.hashesCompared - st.desyncs}  desync ${st.desyncs}`;
    }
  }

  destroy(): void { this.el.remove(); }
}
