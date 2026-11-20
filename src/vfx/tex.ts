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
  /** hexagon lattice ring (Infinity ripple) */
  hex: THREE.CanvasTexture;
  /** 5-arm swirl (Rasengan / vortex discs) */
  spiral: THREE.CanvasTexture;
  /** 4 curved wind blades around a ring (Rasen-Shuriken disc) */
  shuriken: THREE.CanvasTexture;
  /** abstract glowing glyph: three halo rings + six arcs (Asura afterimage; deliberately not a figure) */
  asura: THREE.CanvasTexture;
  /** soft vertical streaks (tornado / steam columns, scrolls in v) */
  swirl: THREE.CanvasTexture;
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

  return { star, ring, crescent, glow, aura, ...makeXoverDecals(rnd) };
}

/** crossover decal textures (white, tinted per use) */
function makeXoverDecals(rnd: () => number): Pick<DecalTextures, 'hex' | 'spiral' | 'shuriken' | 'asura' | 'swirl'> {
  // hex lattice, masked to a ring
  let c = canvas(256, 256);
  let g = c.getContext('2d')!;
  g.strokeStyle = W + '1)';
  g.lineWidth = 2.2;
  const R = 13, hw = R * Math.sqrt(3);
  for (let row = -12; row <= 12; row++) {
    for (let col = -12; col <= 12; col++) {
      const cx = 128 + col * hw + (row & 1 ? hw / 2 : 0), cy = 128 + row * R * 1.5;
      g.beginPath();
      for (let k = 0; k <= 6; k++) {
        const a = (k / 6) * 6.2832 + Math.PI / 6;
        const x = cx + Math.cos(a) * R * 0.92, y = cy + Math.sin(a) * R * 0.92;
        if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
  }
  g.globalCompositeOperation = 'destination-in';
  radial(g, 128, 128, 128, [[0, W + '0.15)'], [0.55, W + '0.5)'], [0.82, W + '1)'], [0.92, W + '0.6)'], [1, W + '0)']]);
  g.globalCompositeOperation = 'source-over';
  radial(g, 128, 128, 128, [[0, W + '0)'], [0.84, W + '0)'], [0.88, W + '0.9)'], [0.93, W + '0)']]);
  const hex = mk(c);

  // swirl arms
  c = canvas(256, 256);
  g = c.getContext('2d')!;
  g.translate(128, 128);
  for (let arm = 0; arm < 5; arm++) {
    for (let i = 0; i < 70; i++) {
      const t = i / 70;
      const a = arm * (6.2832 / 5) + t * 4.2;
      const r = 8 + t * 116;
      g.fillStyle = `rgba(255,255,255,${(0.9 * (1 - t) + 0.1).toFixed(3)})`;
      g.beginPath();
      g.arc(Math.cos(a) * r, Math.sin(a) * r, 2 + 9 * (1 - t) * (0.5 + 0.5 * Math.sin(t * 9)), 0, 6.2832);
      g.fill();
    }
  }
  radial(g, 0, 0, 40, [[0, W + '1)'], [1, W + '0)']]);
  const spiral = mk(c);

  // shuriken: 4 curved blades + ring
  c = canvas(256, 256);
  g = c.getContext('2d')!;
  g.translate(128, 128);
  g.shadowColor = 'rgba(255,255,255,1)';
  g.shadowBlur = 10;
  for (let k = 0; k < 4; k++) {
    g.save();
    g.rotate((k * Math.PI) / 2);
    const lg = g.createLinearGradient(0, 0, 124, 0);
    lg.addColorStop(0, W + '0.95)');
    lg.addColorStop(1, W + '0.15)');
    g.fillStyle = lg;
    g.beginPath();
    g.moveTo(14, -16);
    g.quadraticCurveTo(70, -46, 124, -8);
    g.quadraticCurveTo(70, -14, 18, 18);
    g.closePath();
    g.fill();
    g.restore();
  }
  g.shadowBlur = 0;
  radial(g, 0, 0, 52, [[0, W + '1)'], [0.5, W + '0.9)'], [0.7, W + '0.35)'], [1, W + '0)']]);
  g.strokeStyle = W + '0.8)';
  g.lineWidth = 3;
  g.beginPath(); g.arc(0, 0, 60, 0, 6.2832); g.stroke();
  const shuriken = mk(c);

  // abstract asura glyph: three halo rings on top, six arcs fanning from the centre (no figure, no faces)
  c = canvas(256, 256);
  g = c.getContext('2d')!;
  g.strokeStyle = W + '1)';
  g.shadowColor = 'rgba(255,255,255,1)';
  g.shadowBlur = 12;
  g.lineCap = 'round';
  g.lineWidth = 5;
  for (const [x, y, r] of [[128, 52, 22], [84, 66, 17], [172, 66, 17]] as Array<[number, number, number]>) {
    g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.stroke();
  }
  g.lineWidth = 6;
  for (let k = 0; k < 6; k++) {
    const side = k < 3 ? -1 : 1, j = k % 3;
    g.beginPath();
    g.moveTo(128 + side * 18, 118 + j * 10);
    g.quadraticCurveTo(128 + side * (64 + j * 8), 70 + j * 46, 128 + side * (112 - j * 6), 40 + j * 70);
    g.stroke();
  }
  g.lineWidth = 4;
  g.beginPath(); g.moveTo(128, 90); g.lineTo(128, 236); g.stroke();
  const asura = mk(c);

  // vertical swirl streaks (tile in u and v)
  c = canvas(128, 256);
  g = c.getContext('2d')!;
  for (let i = 0; i < 40; i++) {
    const x = rnd() * 128, y = rnd() * 256, len = 40 + rnd() * 120, w = 2 + rnd() * 7, a = 0.25 + rnd() * 0.75;
    for (const ox of [-128, 0, 128]) for (const oy of [-256, 0, 256]) {
      const lg = g.createLinearGradient(0, y + oy, 0, y + oy + len);
      lg.addColorStop(0, W + '0)'); lg.addColorStop(0.5, W + a + ')'); lg.addColorStop(1, W + '0)');
      g.fillStyle = lg;
      g.fillRect(x + ox - w / 2, y + oy, w, len);
    }
  }
  const swirl = mk(c);
  swirl.wrapS = swirl.wrapT = THREE.RepeatWrapping;
  return { hex, spiral, shuriken, asura, swirl };
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
  guardcrush: { text: 'GUARD CRUSH!', top: '#ffffff', bottom: '#2f8cff' },
  dosu: { text: 'ドスッ!', top: '#f1e6d2', bottom: '#a8865a' },
  // crossover pack
  pon: { text: 'ポン!', top: '#ffffff', bottom: '#ffb04a' },
  mugen: { text: '∞', top: '#ffffff', bottom: '#7fc4ff' },
  zan: { text: '斬!', top: '#f4fff6', bottom: '#3fd17a' },
  boing: { text: 'ボヨヨン!', top: '#ffffff', bottom: '#ff6a8a' },
  dodon: { text: 'ドンドットット', top: '#ffffff', bottom: '#ffd23a' },
  gorogoro: { text: 'ゴロゴロ!', top: '#fffbd0', bottom: '#ffd21a' },
  doom: { text: 'ドォン!!', top: '#ffffff', bottom: '#b06cff' },
  rv_infinite_void: { text: '無量空処', top: '#ffffff', bottom: '#8fa8ff' },
  rv_tailed_beast_bomb: { text: '尾獣玉', top: '#ffd0a0', bottom: '#ff3a1a' },
  rv_king_of_hell: { text: '閻王', top: '#ffe0e0', bottom: '#ff2030' },
  rv_gear_fifth: { text: 'GEAR 5!', top: '#ffffff', bottom: '#ffe48a' },
  rv_paths: { text: '道', top: '#fff8d8', bottom: '#5ad0ff' },
  rv_sun_forge: { text: '日輪鍛冶', top: '#fff2c0', bottom: '#ff6a10' },
  rv_moonless_void: { text: '無月', top: '#f0e8ff', bottom: '#7a4aff' },
  rv_petal_storm: { text: '桜嵐', top: '#ffffff', bottom: '#ff7aa8' },
  rv_mountain_temple: { text: '不動山', top: '#fff4d0', bottom: '#c08a2a' },
  gakin: { text: 'ガキン!', top: '#fff4d0', bottom: '#b08a4a' },
  rv_clash: { text: 'REALM CLASH!', top: '#ffffff', bottom: '#c06cff' },
  fm_six_eyes: { text: 'SIX EYES', top: '#ffffff', bottom: '#5ac8ff' },
  fm_sage: { text: 'SAGE MODE', top: '#fff0c0', bottom: '#ff8a1a' },
  fm_kurama: { text: 'KURAMA MODE', top: '#fffbd0', bottom: '#ffb000' },
  fm_santoryu: { text: '三刀流', top: '#f4fff6', bottom: '#3fd17a' },
  fm_ittoryu: { text: '一刀流', top: '#f4fff6', bottom: '#3fd17a' },
  fm_nitoryu: { text: '二刀流', top: '#f4fff6', bottom: '#3fd17a' },
  fm_gear2: { text: 'GEAR 2', top: '#ffffff', bottom: '#ff5a7a' },
  fm_gear4: { text: 'GEAR 4', top: '#ffffff', bottom: '#d0303a' },
  fm_gear5: { text: 'GEAR 5', top: '#ffffff', bottom: '#ffe48a' },
  fm_titan: { text: 'TITAN!', top: '#fff2c0', bottom: '#d0301a' },
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
