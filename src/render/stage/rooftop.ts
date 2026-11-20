/** NEON ROOFTOP — school-style rooftop at night above an anime city. */
import * as THREE from 'three';
import { makeToonMaterial, makeGlowMaterial } from '../materials';
import { Crowd, ringSpots, Banners, LanternStrings } from './festival';
import { Merger, M, addNearFade, skyDome, canvas, canvasTex, rand, neonTexture, glowTexture, disposeGroup, loadStageTex, skyPanorama, worldUV, type StageBuild } from './common';

function floorTexture(): THREE.CanvasTexture {
  const { cv, c } = canvas(512, 512);
  const R = rand(11);
  c.fillStyle = '#5d6070'; c.fillRect(0, 0, 512, 512);
  const n = 8, s = 512 / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = 86 + Math.floor(R() * 18);
    c.fillStyle = `rgb(${v - 6},${v - 4},${v + 10})`;
    c.fillRect(x * s + 2, y * s + 2, s - 4, s - 4);
    if (R() < 0.25) { c.fillStyle = 'rgba(30,30,50,0.12)'; c.beginPath(); c.ellipse(x * s + R() * s, y * s + R() * s, 10 + R() * 20, 6 + R() * 12, R() * 3, 0, 7); c.fill(); }
  }
  c.strokeStyle = 'rgba(40,40,60,0.6)'; c.lineWidth = 3;
  for (let i = 0; i <= n; i++) { c.beginPath(); c.moveTo(i * s, 0); c.lineTo(i * s, 512); c.moveTo(0, i * s); c.lineTo(512, i * s); c.stroke(); }
  return canvasTex(cv, 1);
}

function fenceTexture(): THREE.CanvasTexture {
  const { cv, c } = canvas(128, 128);
  c.clearRect(0, 0, 128, 128);
  c.strokeStyle = '#c9cde0'; c.lineWidth = 3.2;
  for (let i = -128; i <= 256; i += 32) {
    c.beginPath(); c.moveTo(i, 0); c.lineTo(i + 128, 128); c.stroke();
    c.beginPath(); c.moveTo(i, 128); c.lineTo(i + 128, 0); c.stroke();
  }
  const t = canvasTex(cv, 1);
  return t;
}

function windowTexture(): THREE.CanvasTexture {
  const { cv, c } = canvas(256, 256);
  const R = rand(5);
  c.fillStyle = '#0b0c1a'; c.fillRect(0, 0, 256, 256);
  const cols = 8, rows = 8;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const on = R();
    let col = '#141632';
    if (on > 0.55) col = R() > 0.5 ? '#ffd890' : '#ffeec8';
    if (on > 0.93) col = '#9fd4ff';
    if (on > 0.97) col = '#ff9fd0';
    c.fillStyle = col;
    c.fillRect(x * 32 + 6, y * 32 + 8, 20, 18);
  }
  const t = canvasTex(cv, 1);
  t.magFilter = THREE.LinearFilter;
  return t;
}

export function buildRooftop(half: number, quality: 'low' | 'medium' | 'high' = 'high'): StageBuild {
  const group = new THREE.Group();
  group.name = 'stage-rooftop';
  const roofHalf = half + 3.6;
  const toon = makeToonMaterial({ vertexColors: true, shadowTint: '#5a5a9a', rimStrength: 0.0 });
  // ---------- floor (textured, receives shadows)
  const floorTex = floorTexture();
  floorTex.repeat.set(roofHalf / 2, roofHalf / 2);
  const floorMat = makeToonMaterial({ map: floorTex, shadowTint: '#4a4a80', rimStrength: 0 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(roofHalf * 2, roofHalf * 2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);
  // owner concrete tile on the floor (procedural texture stays if it fails to load)
  loadStageTex('rooftop_concrete', roofHalf / 2, (t) => { floorMat.map = t; floorMat.color.set('#b8bcd8'); floorMat.needsUpdate = true; });
  // ---------- static props merged
  const m = new Merger();
  const mc = new Merger(); // concrete masonry (parapet, curb, stair house, bleachers): owner concrete texture

  const R = rand(3);
  // parapet around the roof edge
  for (const s of [-1, 1]) {
    mc.add(new THREE.BoxGeometry(roofHalf * 2 + 0.6, 0.9, 0.3), M([0, 0.45, s * (roofHalf + 0.15)]), '#4a4d60');
    mc.add(new THREE.BoxGeometry(0.3, 0.9, roofHalf * 2 + 0.6), M([s * (roofHalf + 0.15), 0.45, 0]), '#4a4d60');
    mc.add(new THREE.BoxGeometry(roofHalf * 2 + 0.7, 0.08, 0.4), M([0, 0.92, s * (roofHalf + 0.15)]), '#6a6e85');
    mc.add(new THREE.BoxGeometry(0.4, 0.08, roofHalf * 2 + 0.7), M([s * (roofHalf + 0.15), 0.92, 0]), '#6a6e85');
  }
  // fence posts & rails at the arena walls
  const fh = 2.3;
  const post = new THREE.CylinderGeometry(0.045, 0.05, fh, 8);
  const rail = new THREE.CylinderGeometry(0.03, 0.03, 1, 6);
  const step = 1.25;
  for (let i = -half; i <= half + 1e-3; i += step) {
    for (const s of [-1, 1]) {
      m.add(post, M([i, fh / 2, s * half]), '#7d8399');
      if (Math.abs(i) < half - 1e-3) m.add(post, M([s * half, fh / 2, i]), '#7d8399');
    }
  }
  for (const s of [-1, 1]) for (const y of [0.12, fh - 0.04, fh * 0.5]) {
    m.add(rail, M([0, y, s * half], [0, 0, 90], [1, half * 2, 1]), '#8a90a8');
    m.add(rail, M([s * half, y, 0], [90, 0, 0], [1, half * 2, 1]), '#8a90a8');
  }
  // fence base curb
  for (const s of [-1, 1]) {
    mc.add(new THREE.BoxGeometry(half * 2 + 0.2, 0.12, 0.18), M([0, 0.06, s * half]), '#3e4152');
    mc.add(new THREE.BoxGeometry(0.18, 0.12, half * 2 + 0.2), M([s * half, 0.06, 0]), '#3e4152');
  }
  // water tank on legs (corner)
  const tx = half + 1.9, tz = -(half + 1.8);
  m.add(new THREE.CylinderGeometry(1.2, 1.2, 2.2, 20), M([tx, 2.6, tz]), (p, o) => o.set(Math.abs(p.y - 2.6) > 0.95 ? '#b8bccc' : '#d8dbe6'));
  m.add(new THREE.SphereGeometry(1.2, 20, 6, 0, Math.PI * 2, 0, Math.PI / 2), M([tx, 3.7, tz], [0, 0, 0], [1, 0.3, 1]), '#c8ccd8');
  for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) m.add(new THREE.BoxGeometry(0.12, 1.5, 0.12), M([tx + a * 0.8, 0.75, tz + b * 0.8]), '#5a5e70');
  m.add(new THREE.BoxGeometry(1.9, 0.1, 1.9), M([tx, 1.5, tz]), '#5a5e70');
  // AC units
  for (let i = 0; i < 4; i++) {
    const x = -half + 1 + i * 1.6, z = half + 1.6 + (i % 2) * 0.3;
    m.add(new THREE.BoxGeometry(1.1, 0.75, 0.7), M([x, 0.38, z]), '#c4c7d2');
    m.add(new THREE.CylinderGeometry(0.28, 0.28, 0.02, 16), M([x - 0.15, 0.4, z - 0.36], [90, 0, 0]), '#3a3d4a');
    m.add(new THREE.BoxGeometry(0.06, 0.06, 1.4), M([x + 0.4, 0.1, z + 0.6]), '#8a8e9c');
  }
  // stair house with door (other corner)
  const sx = -(half + 1.9), sz = -(half + 1.4);
  mc.add(new THREE.BoxGeometry(3.0, 3.0, 2.4), M([sx, 1.5, sz]), '#8e92a6');
  mc.add(new THREE.BoxGeometry(3.3, 0.2, 2.7), M([sx, 3.1, sz]), '#5a5e72');
  m.add(new THREE.BoxGeometry(0.95, 2.0, 0.06), M([sx + 0.6, 1.0, sz + 1.21]), '#4a5a7a');
  m.add(new THREE.BoxGeometry(0.06, 0.06, 0.12), M([sx + 0.25, 1.0, sz + 1.26]), '#d0d0d0');
  m.add(new THREE.BoxGeometry(0.7, 0.35, 0.05), M([sx - 0.7, 2.2, sz + 1.21]), '#ffe8a0');
  // pipes along the parapet
  for (const s of [-1, 1]) m.add(new THREE.CylinderGeometry(0.06, 0.06, roofHalf * 2, 8), M([s * (roofHalf - 0.2), 0.25, 0], [90, 0, 0]), '#6a6e80');
  // antenna
  m.add(new THREE.CylinderGeometry(0.03, 0.04, 4, 6), M([tx, 5.7, tz]), '#5a5e70');
  m.add(new THREE.BoxGeometry(0.8, 0.04, 0.04), M([tx, 7.0, tz]), '#5a5e70');
  m.add(new THREE.BoxGeometry(0.5, 0.04, 0.04), M([tx, 6.6, tz]), '#5a5e70');
  // tiered bleachers for the crowd (outside the fence, 3 sides)
  const skipCorner = (x: number, z: number) => Math.hypot(x - tx, z - tz) < 2.0 || Math.hypot(x - sx, z - sz) < 2.3;
  for (let r = 1; r < 3; r++) {
    const d = half + 0.75 + r * 0.8, y = r * 0.35;
    mc.add(new THREE.BoxGeometry((half + 3.3) * 2, y, 0.8), M([0, y / 2, -d]), r % 2 ? '#3c3f58' : '#454866');
    for (const sx2 of [-1, 1]) mc.add(new THREE.BoxGeometry(0.8, y, (half + 0.4) * 2), M([sx2 * d, y / 2, 0.6]), r % 2 ? '#3c3f58' : '#454866');
  }
  void R;
  addNearFade(toon);
  const props = new THREE.Mesh(m.build(), toon);
  props.receiveShadow = true;
  group.add(props);
  const concMat = makeToonMaterial({ vertexColors: true, shadowTint: '#5a5a9a', rimStrength: 0 });
  addNearFade(concMat);
  const concGeo = mc.build();
  worldUV(concGeo, 3);
  const conc = new THREE.Mesh(concGeo, concMat);
  conc.receiveShadow = true;
  group.add(conc);
  loadStageTex('rooftop_concrete', 1, (t) => {
    concMat.map = t; concMat.needsUpdate = true;
    const c = concGeo.attributes.color as THREE.BufferAttribute; // lighten the flat colours so the texture reads
    for (let i = 0; i < c.count; i++) c.setXYZ(i, 0.62 + c.getX(i) * 0.7, 0.62 + c.getY(i) * 0.7, 0.66 + c.getZ(i) * 0.7);
    c.needsUpdate = true;
  });
  // ---------- chain-link fence panels (one draw call)
  const fm = new Merger();
  const panel = new THREE.PlaneGeometry(1, 1);
  for (const s of [-1, 1]) {
    fm.add(panel, M([0, fh / 2, s * half], [0, 0, 0], [half * 2, fh, 1]), '#ffffff');
    fm.add(panel, M([s * half, fh / 2, 0], [0, 90, 0], [half * 2, fh, 1]), '#ffffff');
  }
  const fg = fm.build();
  // world-scaled uvs
  const uv = fg.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * half * 2 / 0.5, uv.getY(i) * fh / 0.5);
  const fenceMat = new THREE.MeshLambertMaterial({ map: fenceTexture(), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, color: '#aab0c8', depthWrite: true });
  addNearFade(fenceMat, 2.8);
  const fence = new THREE.Mesh(fg, fenceMat);
  group.add(fence);
  // ---------- skyline (instanced, emissive windows via world-space UV)
  const winTex = windowTexture();
  const bMat = new THREE.MeshBasicMaterial({ map: winTex, color: 0xffffff, fog: true });
  bMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 wpp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        wpp = instanceMatrix * wpp;
        #endif
        wpp = modelMatrix * wpp;
        vWP = wpp.xyz;
        #ifdef USE_INSTANCING
        vWN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        #else
        vWN = normalize(mat3(modelMatrix) * normal);
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <map_fragment>', `
        vec2 wuv = abs(vWN.x) > 0.5 ? vec2(vWP.z, vWP.y) : vec2(vWP.x, vWP.y);
        vec4 sampledDiffuseColor = texture2D(map, wuv / 9.0);
        if (abs(vWN.y) > 0.5) sampledDiffuseColor = vec4(0.04, 0.045, 0.09, 1.0);
        diffuseColor *= sampledDiffuseColor;`);
  };
  bMat.customProgramCacheKey = () => 'kk-bldg';
  const R2 = rand(77);
  const bGeo = new THREE.BoxGeometry(1, 1, 1);
  bGeo.translate(0, 0.5, 0);
  const count = 110;
  const inst = new THREE.InstancedMesh(bGeo, bMat, count);
  const mm = new THREE.Matrix4();
  const tint = new THREE.Color();
  let k = 0;
  for (let i = 0; i < count; i++) {
    const ang = R2() * Math.PI * 2;
    const ring = i < 50 ? 1 : 2;
    const r = ring === 1 ? 26 + R2() * 18 : 50 + R2() * 45;
    const w = 6 + R2() * 10, d = 6 + R2() * 10;
    const top = ring === 1 ? -6 + R2() * 22 : -4 + R2() * 46;
    const bottom = -40;
    mm.compose(new THREE.Vector3(Math.cos(ang) * r, bottom, Math.sin(ang) * r), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), R2() * 0.3), new THREE.Vector3(w, top - bottom, d));
    inst.setMatrixAt(k, mm);
    tint.setHSL(0.62 + R2() * 0.12, 0.3, 0.55 + R2() * 0.45);
    inst.setColorAt(k, tint);
    k++;
  }
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  inst.frustumCulled = false;
  group.add(inst);
  // ---------- neon signs
  const signs: Array<{ text: string; color: string; font: string; w: number; h: number; pos: [number, number, number]; rot: number; size: [number, number]; vertical?: boolean }> = [
    { text: 'KAKUSEI', color: '#ff3df0', font: 'bold 110px "Arial Black", Impact, sans-serif', w: 640, h: 180, pos: [-9, 4.45, -23.5], rot: 0.3, size: [9, 2.55] },
    { text: '覚醒', color: '#3dfcff', font: 'bold 240px "Noto Sans CJK JP", sans-serif', w: 200, h: 520, pos: [22, 12, -28], rot: -0.6, size: [2.6, 6.8], vertical: true },
    { text: 'RAMEN', color: '#ffb02e', font: 'bold 120px "Arial Black", Impact, sans-serif', w: 560, h: 170, pos: [30, 3, 12], rot: -1.6, size: [7, 2.1] },
    { text: '24H', color: '#5dff7a', font: 'bold 140px "Arial Black", Impact, sans-serif', w: 360, h: 180, pos: [-28, 4, 14], rot: 1.45, size: [4, 2] },
    { text: 'ラーメン', color: '#ff4a4a', font: 'bold 150px "Noto Sans CJK JP", sans-serif', w: 180, h: 640, pos: [-20, 7, 30], rot: 2.6, size: [2, 7], vertical: true },
  ];
  const glowT = glowTexture('rgba(255,255,255,0.55)');
  const signMeshes: THREE.Mesh[] = [];
  for (const s of signs) {
    const tex = neonTexture(s.text, s.color, s.font, s.w, s.h, !!s.vertical);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.size[0], s.size[1]), makeGlowMaterial('#ffffff', { map: tex }));
    mesh.position.set(...s.pos);
    mesh.rotation.y = s.rot;
    group.add(mesh);
    signMeshes.push(mesh);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(s.size[0] * 1.7, s.size[1] * 1.9), makeGlowMaterial(s.color, { map: glowT, additive: true, opacity: 0.35 }));
    halo.position.copy(mesh.position).add(new THREE.Vector3(Math.sin(s.rot), 0, Math.cos(s.rot)).multiplyScalar(-0.05));
    halo.rotation.y = s.rot;
    group.add(halo);
  }
  // owner neon sign sheet: crop the katakana RAMEN sign onto the ramen board (additive, so the black backdrop drops out)
  const ramen = signMeshes[2]!;
  loadStageTex('neon_sign_glow', 1, (t) => {
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.repeat.set(0.25, 0.1); t.offset.set(0, 1 - 0.35);
    const mt = ramen.material as THREE.MeshBasicMaterial;
    mt.map = t; mt.blending = THREE.AdditiveBlending; mt.depthWrite = false; mt.needsUpdate = true;
    ramen.scale.set(0.9, 1.15, 1);
  });
  // sign on the stair house
  const small = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.5), makeGlowMaterial('#ffffff', { map: neonTexture('屋上', '#ff5fa0', 'bold 120px "Noto Sans CJK JP", sans-serif', 400, 140) }));
  small.position.set(sx, 2.7, sz + 1.24);
  group.add(small);
  // ---------- moon + stars + sky
  const sunDir = new THREE.Vector3(-0.45, 0.62, -0.65).normalize();
  const sky = skyDome([[0, '#3a1f5c'], [0.08, '#2a1850'], [0.3, '#141038'], [0.7, '#080a20'], [1, '#04050f']], { sunDir, sunColor: '#cfd8ff', sunSize: 0.0, glow: 0.12 });
  group.add(sky);
  const moonTex = (() => {
    const { cv, c } = canvas(256, 256);
    const g = c.createRadialGradient(128, 128, 60, 128, 128, 128);
    g.addColorStop(0, 'rgba(230,236,255,0.5)'); g.addColorStop(1, 'rgba(230,236,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 256, 256);
    c.fillStyle = '#f2f4ff'; c.beginPath(); c.arc(128, 128, 62, 0, 7); c.fill();
    c.fillStyle = 'rgba(160,170,210,0.35)';
    for (const [x, y, r] of [[110, 110, 14], [150, 140, 10], [125, 160, 8], [145, 100, 6]]) { c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const moon = new THREE.Mesh(new THREE.PlaneGeometry(36, 36), makeGlowMaterial('#ffffff', { map: moonTex }));
  moon.position.copy(sunDir).multiplyScalar(160);
  moon.lookAt(0, 0, 0);
  moon.renderOrder = -9;
  (moon.material as THREE.Material).depthWrite = false;
  group.add(moon);
  const starGeo = new THREE.BufferGeometry();
  const sp: number[] = [];
  const R3 = rand(9);
  for (let i = 0; i < 500; i++) {
    const a = R3() * Math.PI * 2, y = 0.15 + R3() * 0.85;
    const r = Math.sqrt(1 - y * y);
    sp.push(Math.cos(a) * r * 170, y * 170, Math.sin(a) * r * 170);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#cfd6ff', size: 1.6, sizeAttenuation: false, fog: false, toneMapped: false, transparent: true, opacity: 0.8 }));
  stars.renderOrder = -9;
  group.add(stars);
  // city glow ring at horizon
  const glowRing = new THREE.Mesh(new THREE.CylinderGeometry(120, 120, 30, 32, 1, true), new THREE.MeshBasicMaterial({
    map: (() => {
      const { cv, c } = canvas(4, 128);
      const g = c.createLinearGradient(0, 0, 0, 128);
      g.addColorStop(0, 'rgba(255,90,180,0)'); g.addColorStop(0.7, 'rgba(255,120,150,0.25)'); g.addColorStop(1, 'rgba(255,170,120,0.45)');
      c.fillStyle = g; c.fillRect(0, 0, 4, 128);
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
    })(), transparent: true, side: THREE.BackSide, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, toneMapped: false,
  }));
  glowRing.position.y = -8;
  glowRing.renderOrder = -8;
  group.add(glowRing);
  // floor neon reflections (fake puddles glow)
  const puddle = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.2), makeGlowMaterial('#ff3df0', { map: glowT, additive: true, opacity: 0.12 }));
  puddle.rotation.x = -Math.PI / 2; puddle.position.set(-half * 0.4, 0.01, -half * 0.6);
  group.add(puddle);
  // ---------- crowd, banners, lantern strings
  const spots = ringSpots(half + 0.75, quality === 'low' ? 2 : 3, { spacing: quality === 'low' ? 0.9 : 0.62, sides: ['n', 'e', 'w'], seed: 5, skip: (x, z) => skipCorner(x, z) || z > half + 0.5 });
  const crowd = new Crowd(spots, '#5a4a9a', 21);
  addNearFade(crowd.mesh.material as THREE.Material, 2.6);
  group.add(crowd.mesh);
  const bPlaces = [];
  const cells = [1, 0, 3, 2, 4, 7, 5, 6, 0, 1];
  for (let i = 0; i < 6; i++) bPlaces.push({ x: -half + 0.9 + i * ((half * 2 - 1.8) / 5), z: -half - 0.25, yaw: 0, cell: cells[i] });
  for (const sgn of [-1, 1]) for (let i = 0; i < 3; i++) bPlaces.push({ x: sgn * (half + 0.25), z: -half + 1.8 + i * 2.6, yaw: -sgn * Math.PI / 2, cell: cells[(i + (sgn > 0 ? 6 : 3)) % 8] });
  const banners = new Banners(bPlaces);
  group.add(banners.group);
  const lanterns = new LanternStrings([
    { a: [sx + 1.4, 3.2, sz + 1.2], b: [tx - 0.4, 3.6, tz + 1.0], n: 14, sag: 0.9 },
    { a: [-roofHalf, 2.6, -half - 2.6], b: [-roofHalf, 2.6, half + 1.5], n: 10, sag: 0.6 },
    { a: [roofHalf, 2.6, -half - 1.0], b: [roofHalf, 2.6, half + 1.5], n: 9, sag: 0.6 },
  ], ['#ff3df0', '#3df0ff', '#ffe066', '#ff6a3a']);
  group.add(lanterns.group);
  const blink: THREE.MeshBasicMaterial[] = [];
  group.traverse((o) => { const mm2 = (o as THREE.Mesh).material as THREE.MeshBasicMaterial; if (mm2 && mm2.blending === THREE.AdditiveBlending && mm2.map === glowT) blink.push(mm2); });
  // owner painted skyline replaces the procedural city ring / stars / moon once loaded (they stay as the fallback)
  const painted = skyPanorama('rooftop', 0.4, () => { inst.visible = false; stars.visible = false; moon.visible = false; glowRing.visible = false; }, { bright: 0.95 });
  group.add(painted);
  const base = blink.map((b) => b.opacity);
  return {
    group,
    cheer(k: number) { crowd.cheer(k); },
    update(t, dt) {
      crowd.update(t, dt); banners.update(t); lanterns.update(t);
      for (let i = 0; i < blink.length; i++) blink[i].opacity = base[i] * (0.85 + 0.15 * Math.sin(t * (3 + i) + i * 2.1) + (Math.sin(t * 17 + i) > 0.97 ? -0.5 : 0));
    },
    fog: new THREE.Fog('#1a1236', 30, 170),
    background: new THREE.Color('#070818'),
    sunDir,
    sunColor: new THREE.Color('#b8c6ff'),
    sunIntensity: 2.2,
    hemiSky: new THREE.Color('#8a7cff'),
    hemiGround: new THREE.Color('#3a2040'),
    hemiIntensity: 1.25,
    shadowTint: new THREE.Color('#6a5aa8'),
    rim: new THREE.Color('#ff7ad8'),
    dispose() { disposeGroup(group); },
  };
}
