// Procedural canvas textures for VFX (no asset files).
import * as THREE from 'three';

export function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** tiny deterministic PRNG so textures look identical every run */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function radial(g: CanvasRenderingContext2D, x: number, y: number, r: number, stops: Array<[number, string]>): void {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

const W = 'rgba(255,255,255,';

/** 4x2 atlas of 128px tiles: 0 soft,1 spark,2 smoke,3 petal,4 ring,5 streak,6 flame,7 shard */
export function makeAtlas(): THREE.CanvasTexture {
  const c = canvas(512, 256);
  const g = c.getContext('2d')!;
  const rnd = lcg(7);
  const cell = (i: number, fn: () => void) => {
    g.save();
    g.beginPath();
    g.rect((i % 4) * 128, Math.floor(i / 4) * 128, 128, 128);
    g.clip();
    g.translate((i % 4) * 128, Math.floor(i / 4) * 128);
    fn();
    g.restore();
  };
  // 0 soft round
  cell(0, () => radial(g, 64, 64, 64, [[0, W + '1)'], [0.25, W + '0.8)'], [0.55, W + '0.25)'], [1, W + '0)']]));
  // 1 spark (4-point star)
  cell(1, () => {
    g.translate(64, 64);
    g.fillStyle = W + '1)';
    g.beginPath();
    g.moveTo(0, -62);
    g.quadraticCurveTo(5, -5, 62, 0);
    g.quadraticCurveTo(5, 5, 0, 62);
    g.quadraticCurveTo(-5, 5, -62, 0);
    g.quadraticCurveTo(-5, -5, 0, -62);
    g.fill();
    radial(g, 0, 0, 26, [[0, W + '1)'], [0.4, W + '0.7)'], [1, W + '0)']]);
  });
  // 2 smoke
  cell(2, () => {
    for (let i = 0; i < 9; i++) {
      const a = rnd() * 6.283, d = rnd() * 26;
      radial(g, 64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 24 + rnd() * 18, [[0, W + '0.4)'], [0.6, W + '0.18)'], [1, W + '0)']]);
    }
  });
  // 3 petal
  cell(3, () => {
    const lg = g.createLinearGradient(0, 14, 0, 116);
    lg.addColorStop(0, W + '1)');
    lg.addColorStop(1, W + '0.75)');
    g.fillStyle = lg;
    g.beginPath();
    g.moveTo(64, 112);
    g.bezierCurveTo(26, 90, 22, 36, 52, 14);
    g.lineTo(64, 24);
    g.lineTo(76, 14);
    g.bezierCurveTo(106, 36, 102, 90, 64, 112);
    g.fill();
    g.strokeStyle = 'rgba(200,200,200,0.5)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(64, 100);
    g.lineTo(64, 34);
    g.stroke();
  });
  // 4 ring
  cell(4, () => radial(g, 64, 64, 64, [[0, W + '0)'], [0.6, W + '0)'], [0.82, W + '1)'], [0.9, W + '0.7)'], [1, W + '0)']]));
  // 5 streak (head at +x)
  cell(5, () => {
    const lg = g.createLinearGradient(0, 0, 128, 0);
    lg.addColorStop(0, W + '0)');
    lg.addColorStop(0.55, W + '0.55)');
    lg.addColorStop(1, W + '1)');
    g.fillStyle = lg;
    g.beginPath();
    g.moveTo(2, 64);
    g.quadraticCurveTo(70, 46, 126, 64);
    g.quadraticCurveTo(70, 82, 2, 64);
    g.fill();
  });
  // 6 flame (teardrop, tip up)
  cell(6, () => {
    g.filter = 'blur(3px)';
    const lg = g.createLinearGradient(0, 6, 0, 118);
    lg.addColorStop(0, W + '0.1)');
    lg.addColorStop(0.5, W + '0.75)');
    lg.addColorStop(1, W + '1)');
    g.fillStyle = lg;
    g.beginPath();
    g.moveTo(64, 6);
    g.bezierCurveTo(88, 40, 106, 70, 92, 98);
    g.bezierCurveTo(82, 122, 46, 122, 36, 98);
    g.bezierCurveTo(22, 70, 42, 40, 64, 6);
    g.fill();
    g.filter = 'none';
    radial(g, 64, 92, 34, [[0, W + '0.9)'], [1, W + '0)']]);
  });
  // 7 rock shard (faceted greys)
  cell(7, () => {
    const pts: Array<[number, number]> = [[64, 12], [108, 40], [100, 96], [60, 118], [18, 86], [24, 34]];
    const shades = [235, 175, 205, 125, 185, 150];
    for (let i = 0; i < 6; i++) {
      const a = pts[i]!, b = pts[(i + 1) % 6]!;
      g.fillStyle = `rgb(${shades[i]},${shades[i]},${shades[i]})`;
      g.beginPath();
      g.moveTo(64, 66);
      g.lineTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      g.closePath();
      g.fill();
    }
    g.strokeStyle = 'rgba(40,40,40,0.9)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(pts[0]![0], pts[0]![1]);
    for (let i = 1; i < 6; i++) g.lineTo(pts[i]![0], pts[i]![1]);
    g.closePath();
    g.stroke();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

function mk(c: HTMLCanvasElement, srgb = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

export interface DecalTextures {
  star: THREE.CanvasTexture;
  ring: THREE.CanvasTexture;
  crescent: THREE.CanvasTexture;
  glow: THREE.CanvasTexture;
  aura: THREE.CanvasTexture;
}

export function makeDecals(): DecalTextures {
  const rnd = lcg(99);
  // star burst
  let c = canvas(256, 256);
  let g = c.getContext('2d')!;
  g.translate(128, 128);
  const spikes = 16;
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * 6.2832 + (rnd() - 0.5) * 0.12;
    const L = i % 2 === 0 ? 118 + rnd() * 10 : 60 + rnd() * 34;
    const w = i % 2 === 0 ? 9 : 6;
    g.save();
    g.rotate(a);
    g.fillStyle = W + '1)';
    g.beginPath();
    g.moveTo(0, -w);
    g.lineTo(L, 0);
    g.lineTo(0, w);
    g.closePath();
    g.fill();
    g.restore();
  }
  radial(g, 0, 0, 62, [[0, W + '1)'], [0.35, W + '0.9)'], [1, W + '0)']]);
  const star = mk(c);

  // ring
  c = canvas(256, 256);
  g = c.getContext('2d')!;
  radial(g, 128, 128, 128, [[0, W + '0)'], [0.7, W + '0)'], [0.86, W + '1)'], [0.93, W + '0.6)'], [1, W + '0)']]);
  const ring = mk(c);

  // crescent (vertical, bulging +x)
  c = canvas(256, 256);
  g = c.getContext('2d')!;
  const path = () => {
    g.beginPath();
    g.moveTo(52, 6);
    g.quadraticCurveTo(340, 128, 52, 250);
    g.quadraticCurveTo(170, 128, 52, 6);
    g.closePath();
  };
  const lg = g.createLinearGradient(52, 0, 196, 0);
  lg.addColorStop(0, W + '0.25)');
  lg.addColorStop(0.7, W + '0.9)');
  lg.addColorStop(1, W + '1)');
  g.shadowColor = 'rgba(255,255,255,1)';
  g.shadowBlur = 16;
  g.fillStyle = lg;
  path();
  g.fill();
  g.shadowBlur = 0;
  path();
  g.fill();
  const crescent = mk(c);

  // glow
  c = canvas(128, 128);
  g = c.getContext('2d')!;
  radial(g, 64, 64, 64, [[0, W + '1)'], [0.2, W + '0.7)'], [0.5, W + '0.22)'], [1, W + '0)']]);
  const glow = mk(c);

  // aura / energy tongues (tips at top)
  c = canvas(128, 256);
  g = c.getContext('2d')!;
  for (let i = 0; i < 22; i++) {
    const x = rnd() * 128, w = 5 + rnd() * 12, top = 20 + rnd() * 110, a = 0.35 + rnd() * 0.65;
    for (const ox of [-128, 0, 128]) {
      const lg2 = g.createLinearGradient(0, top, 0, 250);
      lg2.addColorStop(0, W + '0)');
      lg2.addColorStop(0.5, W + a * 0.8 + ')');
      lg2.addColorStop(1, W + a + ')');
      g.fillStyle = lg2;
      g.beginPath();
      g.moveTo(x + ox - w / 2, 250);
      g.quadraticCurveTo(x + ox - w * 0.2, (top + 250) / 2, x + ox, top);
      g.quadraticCurveTo(x + ox + w * 0.2, (top + 250) / 2, x + ox + w / 2, 250);
      g.fill();
    }
  }
  g.globalCompositeOperation = 'destination-in';
  const vg = g.createLinearGradient(0, 0, 0, 256);
  vg.addColorStop(0, W + '0)');
  vg.addColorStop(0.18, W + '0.85)');
  vg.addColorStop(0.85, W + '1)');
  vg.addColorStop(1, W + '0)');
  g.fillStyle = vg;
  g.fillRect(0, 0, 128, 256);
  const aura = mk(c);
  aura.wrapS = THREE.RepeatWrapping;
  aura.wrapT = THREE.RepeatWrapping;

  return { star, ring, crescent, glow, aura };
}

export const ONOMATO: Record<string, { text: string; top: string; bottom: string }> = {
  don: { text: 'ドン!', top: '#fff36b', bottom: '#ff9b1a' },
  baki: { text: 'バキッ!', top: '#fffbe0', bottom: '#ffd23a' },
  zuba: { text: 'ズバッ!', top: '#ffffff', bottom: '#9fdcff' },
  gogogo: { text: 'ゴゴゴ', top: '#e8d0ff', bottom: '#9b5cff' },
  bam: { text: 'BAM!', top: '#fff36b', bottom: '#ff5a1f' },
  counter: { text: 'COUNTER!', top: '#ffef6b', bottom: '#ff2a2a' },
  doka: { text: 'ドカーン!', top: '#ffe36b', bottom: '#ff3b1f' },
  zudon: { text: 'ズドン!', top: '#ffe2a8', bottom: '#d98a2b' },
  ko: { text: 'K.O.!', top: '#ffffff', bottom: '#ff2a4a' },
  bishi: { text: 'ビシッ!', top: '#ffffff', bottom: '#ffe14a' },
};

export function makeOnomato(key: string): THREE.CanvasTexture {
  const def = ONOMATO[key]!;
  const c = canvas(512, 200);
  const g = c.getContext('2d')!;
  const fam = '"Impact","Yu Gothic","Hiragino Sans","Noto Sans CJK JP","Meiryo",sans-serif';
  let fs = 130;
  g.font = `900 ${fs}px ${fam}`;
  while (g.measureText(def.text).width > 440 && fs > 40) {
    fs -= 6;
    g.font = `900 ${fs}px ${fam}`;
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.translate(256, 100);
  g.transform(1, 0, -0.18, 1, 0, 0); // comic italic shear
  g.strokeStyle = '#ffffff';
  g.lineWidth = 30;
  g.strokeText(def.text, 0, 4);
  g.strokeStyle = '#120815';
  g.lineWidth = 20;
  g.strokeText(def.text, 0, 4);
  const lg = g.createLinearGradient(0, -fs / 2, 0, fs / 2);
  lg.addColorStop(0, def.top);
  lg.addColorStop(1, def.bottom);
  g.fillStyle = lg;
  g.fillText(def.text, 0, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
