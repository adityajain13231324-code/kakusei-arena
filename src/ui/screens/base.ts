import type { AppApi } from '../../app/api';
import type { MenuAction } from '../../input';
import type { Screen } from '../router';
import { h, Nav } from '../dom';
import type { Kid } from '../dom';

export abstract class BaseScreen implements Screen {
  readonly el: HTMLElement;
  opaque = true;
  protected nav = new Nav();
  constructor(protected app: AppApi, cls = '') {
    this.el = h('div', { class: cls });
  }
  enter(_params?: any): void {}
  exit(): void {}
  onMenu(a: MenuAction, _slot: 0 | 1): void { this.nav.handle(a); }
}

/** Slanted manga-style menu button. */
export function mbtn(label: string, sub?: string, extra = ''): HTMLElement {
  return h('button', { class: 'mbtn ' + extra, type: 'button' },
    h('span', { class: 'mbtn-in' }, h('b', null, label), sub ? h('small', null, sub) : null));
}

export function backHint(...extra: Kid[]): HTMLElement {
  return h('div', { class: 'hint' }, ...extra);
}
