// Small shared UI widgets (audio toggles, etc.)
import type { AppApi } from '../app/api';
import { h, sfx } from './dom';

const prev = { music: 0.7, sfx: 0.9 };

const ICON_MUSIC = '<svg viewBox="0 0 24 24"><path d="M9 18V6l11-2v12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="6.5" cy="18" r="2.8" fill="currentColor"/><circle cx="17.5" cy="16" r="2.8" fill="currentColor"/></svg>';
const ICON_SPK = '<svg viewBox="0 0 24 24"><path d="M3 9.5h4l5-4v13l-5-4H3z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

/** round music + sound mute buttons, top-right of title / select like the reference */
export function audioTools(app: AppApi): HTMLElement {
  const mk = (key: 'music' | 'sfx', icon: string, label: string) => {
    const b = h('button', { class: 'tool-btn', type: 'button', 'aria-label': label, title: label, html: icon });
    const paint = () => b.classList.toggle('muted', app.settings.data[key] <= 0.001);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const d = app.settings.data;
      if (d[key] > 0.001) { prev[key] = d[key]; d[key] = 0; } else d[key] = prev[key] || 0.7;
      app.settings.save(); app.applySettings(); paint(); sfx('select');
    });
    for (const ev of ['pointerdown', 'mousedown', 'touchstart']) b.addEventListener(ev, (e) => e.stopPropagation());
    app.settings.onChange(paint);
    paint();
    return b;
  };
  return h('div', { class: 'tools' }, mk('music', ICON_MUSIC, 'Music on/off'), mk('sfx', ICON_SPK, 'Sound on/off'));
}

export const ICON_LOCK = '<svg viewBox="0 0 24 24"><rect x="4.5" y="10.5" width="15" height="10.5" rx="2" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="15.6" r="1.7" fill="#0a0a12"/></svg>';
export const ICON_GLOBE = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
