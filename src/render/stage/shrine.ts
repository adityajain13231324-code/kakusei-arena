/** SAKURA SHRINE — stone courtyard at sunset, wooden fence, red gate, cherry trees, falling petals. */
import * as THREE from 'three';
import { makeToonMaterial, makeGlowMaterial } from '../materials';
import { Crowd, ringSpots, Banners, LanternStrings } from './festival';
import { Merger, M, addNearFade, skyDome, canvas, canvasTex, rand, glowTexture, disposeGroup, loadStageTex, skyPanorama, worldUV, type StageBuild } from './common';

function stoneTexture(): THREE.CanvasTexture {
  const { cv, c } = canvas(512, 512);
  const R = rand(21);
  c.fillStyle = '#6e6458'; c.fillRect(0, 0, 512, 512);
  // running-bond rectangular flagstones
  const rows = 8, h = 512 / rows;
  for (let y = 0; y < rows; y++) {
    let x = (y % 2) * -40 - R() * 30;
    while (x < 512) {
      const w = 60 + R() * 70;
      const v = 150 + Math.floor(R() * 30);
      c.fillStyle = `rgb(${v},${v - 8},${v - 20})`;
      c.fillRect(x + 3, y * h + 3, w - 6, h - 6);
      c.fillStyle = 'rgba(255,240,220,0.08)';
      c.fillRect(x + 3, y * h + 3, w - 6, 6);
      if (R() < 0.3) { c.fillStyle = 'rgba(90,110,70,0.25)'; c.beginPath(); c.ellipse(x + R() * w, y * h + R() * h, 8 + R() * 10, 4 + R() * 6, 0, 0, 7); c.fill(); }
      x += w;
    }
  }
  return canvasTex(cv, 1);
}

function petalPoints(count: number, area: number, height: number): THREE.Points {
  const R = rand(31);
  const pos: number[] = [], seed: number[] = [];
  for (let i = 0; i < count; i++) {
    pos.push((R() - 0.5) * area, R() * height, (R() - 0.5) * area);
    seed.push(R(), R(), R());
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, height / 2, 0), area);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uH: { value: height }, uScale: { value: 300 } },
    vertexShader: /* glsl */`
      attribute vec3 seed;
      uniform float uTime; uniform float uH; uniform float uScale;
      varying float vRot; varying float vTint;
      void main() {
        vec3 p = position;
        float fall = 0.35 + seed.x * 0.35;
        p.y = mod(p.y - uTime * fall, uH);
        float ph = uTime * (0.8 + seed.y) + seed.z * 6.28;
        p.x += sin(ph) * 0.6 + uTime * 0.25;
        p.z += cos(ph * 0.7) * 0.4;
        p.x = mod(p.x + 20.0, 40.0) - 20.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uScale * (0.05 + seed.y * 0.03) / -mv.z;
        vRot = ph;
        vTint = seed.x;
      }`,
    fragmentShader: /* glsl */`
      varying float vRot; varying float vTint;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float c = cos(vRot), s = sin(vRot);
        q = mat2(c, -s, s, c) * q;
        q.x *= 1.0 + 0.8 * abs(sin(vRot * 1.3));
        float d = length(q * vec2(1.0, 1.8));
        if (d > 0.42) discard;
        vec3 col = mix(vec3(1.0, 0.72, 0.82), vec3(1.0, 0.88, 0.92), vTint);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    transparent: false,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}

export function buildShrine(half: number, quality: 'low' | 'medium' | 'high'): StageBuild {
  const group = new THREE.Group();
  group.name = 'stage-shrine';
  const courtHalf = half + 6;
  const toon = makeToonMaterial({ vertexColors: true, shadowTint: '#9a6a8a', rimStrength: 0 });
  // floor
  const st = stoneTexture();
  st.repeat.set(courtHalf / 2.5, courtHalf / 2.5);
  const floorMat = makeToonMaterial({ map: st, shadowTint: '#a07a90', rimStrength: 0 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(courtHalf * 2, courtHalf * 2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);
  // owner flagstone tile (~3 m per repeat); procedural flagstones remain if it fails to load
  loadStageTex('shrine_stone', courtHalf * 2 / 3, (t) => { floorMat.map = t; floorMat.color.set('#e8d8d8'); floorMat.needsUpdate = true; });
  // outer ground (moss/gravel) ring
  const ground = new THREE.Mesh(new THREE.RingGeometry(courtHalf * 1.3, 140, 32, 1), new THREE.MeshBasicMaterial({ color: '#4a3a3a' }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02;
  group.add(ground);
  const m = new Merger();
  const fw = new Merger(); // wooden fence (owner wood texture)
  const R = rand(8);
  // wooden fence at walls: posts, two rails, slats
  const wood = '#7a4a2a', woodL = '#9a6238';
  const fh = 1.15;
  for (let i = -half; i <= half + 1e-3; i += 1.0) {
    for (const s of [-1, 1]) {
      fw.add(new THREE.BoxGeometry(0.12, fh + 0.15, 0.12), M([i, (fh + 0.15) / 2, s * half]), wood);
      fw.add(new THREE.BoxGeometry(0.16, 0.05, 0.16), M([i, fh + 0.17, s * half]), '#3a2a20');
      if (Math.abs(i) < half - 1e-3) {
        fw.add(new THREE.BoxGeometry(0.12, fh + 0.15, 0.12), M([s * half, (fh + 0.15) / 2, i]), wood);
        fw.add(new THREE.BoxGeometry(0.16, 0.05, 0.16), M([s * half, fh + 0.17, i]), '#3a2a20');
      }
    }
  }
  for (const s of [-1, 1]) for (const y of [0.35, fh - 0.08]) {
    fw.add(new THREE.BoxGeometry(half * 2, 0.08, 0.06), M([0, y, s * half]), woodL);
    fw.add(new THREE.BoxGeometry(0.06, 0.08, half * 2), M([s * half, y, 0]), woodL);
  }
  // vertical slats (lattice) between rails
  for (let i = -half + 0.25; i < half; i += 0.25) {
    for (const s of [-1, 1]) {
      fw.add(new THREE.BoxGeometry(0.035, fh - 0.45, 0.03), M([i, 0.35 + (fh - 0.45) / 2, s * half]), woodL);
      fw.add(new THREE.BoxGeometry(0.03, fh - 0.45, 0.035), M([s * half, 0.35 + (fh - 0.45) / 2, i]), woodL);
    }
  }
  // red torii gate behind the back wall
  const red = '#d23a2a', black = '#1e1a1a';
  const gz = -half - 4.5, gw = 3.2, gh = 5.2;
  for (const s of [-1, 1]) {
    m.add(new THREE.CylinderGeometry(0.22, 0.26, gh, 14), M([s * gw, gh / 2, gz]), red);
    m.add(new THREE.CylinderGeometry(0.3, 0.3, 0.45, 14), M([s * gw, 0.22, gz]), black);
  }
  m.add(new THREE.BoxGeometry(gw * 2 + 1.2, 0.3, 0.32), M([0, gh - 0.9, gz]), red); // nuki
  const kasagi = new THREE.BoxGeometry(1, 1, 1, 12, 1, 1);
  const kp = kasagi.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < kp.count; i++) { const x = kp.getX(i); kp.setY(i, kp.getY(i) + x * x * 0.9); }
  kasagi.computeVertexNormals();
  m.add(kasagi, M([0, gh + 0.15, gz], [0, 0, 0], [gw * 2 + 2.6, 0.32, 0.55]), black);
  m.add(new THREE.BoxGeometry(1, 1, 1), M([0, gh - 0.12, gz], [0, 0, 0], [gw * 2 + 1.8, 0.3, 0.42]), red);
  m.add(new THREE.BoxGeometry(0.25, 0.9, 0.2), M([0, gh - 0.5, gz]), red);
  // shrine hall in the distance
  const hz = gz - 9;
  m.add(new THREE.BoxGeometry(9, 0.8, 6), M([0, 0.4, hz]), '#8a8078');
  m.add(new THREE.BoxGeometry(8, 3.2, 5), M([0, 2.4, hz]), '#efe6d8');
  for (let i = -3; i <= 3; i++) m.add(new THREE.CylinderGeometry(0.16, 0.16, 3.2, 8), M([i * 1.3, 2.4, hz + 2.55]), red);
  const roof = new THREE.ConeGeometry(1, 1, 4, 1);
  roof.rotateY(Math.PI / 4);
  m.add(roof, M([0, 5.4, hz], [0, 0, 0], [8.5, 2.6, 6.2]), '#3a3a4a');
  m.add(new THREE.BoxGeometry(11, 0.25, 7.8), M([0, 4.1, hz]), '#2a2a38');
  // stone lanterns outside fence
  const lanternSpots: Array<[number, number]> = [[-half - 1.6, -half + 1], [half + 1.6, -half + 1], [-half - 1.6, half - 1], [half + 1.6, half - 1], [-2.2, gz + 1.2], [2.2, gz + 1.2]];
  const lanternLights: THREE.Vector3[] = [];
  for (const [x, z] of lanternSpots) {
    const stone = '#9a948a';
    m.add(new THREE.CylinderGeometry(0.35, 0.42, 0.25, 8), M([x, 0.12, z]), stone);
    m.add(new THREE.CylinderGeometry(0.12, 0.16, 0.9, 8), M([x, 0.7, z]), stone);
    m.add(new THREE.CylinderGeometry(0.32, 0.25, 0.15, 6), M([x, 1.2, z]), stone);
    m.add(new THREE.BoxGeometry(0.42, 0.38, 0.42), M([x, 1.46, z]), '#b8b0a2');
    m.add(new THREE.ConeGeometry(0.48, 0.32, 6), M([x, 1.82, z]), stone);
    m.add(new THREE.SphereGeometry(0.08, 6, 4), M([x, 2.02, z]), stone);
    lanternLights.push(new THREE.Vector3(x, 1.46, z));
  }
  // cherry trees: trunks + branches merged; foliage instanced
  const trees: Array<[number, number, number]> = [
    [-half - 3.2, -half - 2.5, 1.1], [half + 3.4, -half - 2.2, 1.2], [-half - 4, 1.5, 1.0], [half + 4.2, 0.5, 1.05],
    [-half - 2.8, half + 3, 0.95], [half + 3, half + 3.4, 1.0], [-7, gz - 3, 1.2], [7.5, gz - 2.5, 1.15],
  ];
  const clumps: THREE.Matrix4[] = [];
  const clumpCol: THREE.Color[] = [];
  for (const [tx, tz, sc] of trees) {
    const trunkH = 2.6 * sc;
    m.add(new THREE.CylinderGeometry(0.16 * sc, 0.3 * sc, trunkH, 8), M([tx, trunkH / 2, tz], [R() * 8 - 4, 0, R() * 8 - 4]), '#4a2e26');
    for (let b = 0; b < 4; b++) {
      const a = (b / 4) * Math.PI * 2 + R();
      const len = (1.6 + R() * 0.8) * sc;
      const dx = Math.cos(a), dz = Math.sin(a);
      const mid = new THREE.Vector3(tx + dx * len * 0.45, trunkH + len * 0.3, tz + dz * len * 0.45);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, 0.7, dz).normalize());
      m.add(new THREE.CylinderGeometry(0.06 * sc, 0.13 * sc, len, 6), new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)), '#4a2e26');
      const end = new THREE.Vector3(tx + dx * len * 0.85, trunkH + len * 0.6, tz + dz * len * 0.85);
      for (let k = 0; k < 6; k++) {
        const p = end.clone().add(new THREE.Vector3((R() - 0.5) * 1.6 * sc, (R() - 0.2) * 0.9 * sc, (R() - 0.5) * 1.6 * sc));
        const s = (0.55 + R() * 0.45) * sc;
        clumps.push(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(R() * 3, R() * 3, R() * 3)), new THREE.Vector3(s, s * 0.8, s)));
        clumpCol.push(new THREE.Color().setHSL(0.94 + R() * 0.04, 0.7, 0.78 + R() * 0.1));
      }
    }
    // crown clump
    for (let k = 0; k < 4; k++) {
      const p = new THREE.Vector3(tx + (R() - 0.5) * 1.2 * sc, trunkH + 1.2 * sc + R() * 0.6, tz + (R() - 0.5) * 1.2 * sc);
      const s = (0.8 + R() * 0.3) * sc;
      clumps.push(new THREE.Matrix4().compose(p, new THREE.Quaternion(), new THREE.Vector3(s, s * 0.8, s)));
      clumpCol.push(new THREE.Color().setHSL(0.95, 0.65, 0.82));
    }
  }
  // distant mountains (cards)
  const mts = new THREE.Shape();
  mts.moveTo(-120, 0);
  const R4 = rand(99);
  for (let x = -120; x <= 120; x += 10) mts.lineTo(x, 8 + R4() * 16 + Math.sin(x * 0.05) * 8);
  mts.lineTo(120, 0); mts.lineTo(-120, 0);
  const mtsGeo = new THREE.ShapeGeometry(mts);
  for (const [z, col, ry] of [[-90, '#6a4a7a', 0], [-80, '#8a5a7a', 0.4], [85, '#6a4a7a', Math.PI]] as Array<[number, string, number]>) {
    const g = mtsGeo.clone();
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col, fog: true }));
    mesh.position.set(0, -2, z);
    mesh.rotation.y = ry;
    group.add(mesh);
  }
  addNearFade(toon);
  const props = new THREE.Mesh(m.build(), toon);
  props.castShadow = false; props.receiveShadow = true;
  group.add(props);
  const fenceMat = makeToonMaterial({ vertexColors: true, shadowTint: '#9a6a8a', rimStrength: 0 });
  addNearFade(fenceMat);
  const fenceGeo = fw.build();
  worldUV(fenceGeo, 1.4);
  group.add(new THREE.Mesh(fenceGeo, fenceMat));
  loadStageTex('wooden_fence', 1, (t) => {
    fenceMat.map = t; fenceMat.needsUpdate = true;
    const c = fenceGeo.attributes.color as THREE.BufferAttribute; // lighten flat colours so the wood grain reads
    for (let i = 0; i < c.count; i++) c.setXYZ(i, 0.8 + c.getX(i) * 0.5, 0.8 + c.getY(i) * 0.5, 0.8 + c.getZ(i) * 0.5);
    c.needsUpdate = true;
  });
  const leafGeo = new THREE.IcosahedronGeometry(1, quality === 'low' ? 0 : 1);
  const leafMat = makeToonMaterial({ shadowTint: '#c86a9a', rimColor: '#fff0f6', rimStrength: 0.25 });
  const foliage = new THREE.InstancedMesh(leafGeo, leafMat, clumps.length);
  clumps.forEach((mm, i) => { foliage.setMatrixAt(i, mm); foliage.setColorAt(i, clumpCol[i]); });
  foliage.instanceMatrix.needsUpdate = true;
  if (foliage.instanceColor) foliage.instanceColor.needsUpdate = true;
  group.add(foliage);
  // lantern glows
  const gt = glowTexture('rgba(255,200,120,0.9)');
  for (const p of lanternLights) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: gt, color: '#ffb060', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.7 }));
    s.position.copy(p); s.scale.set(1.1, 1.1, 1);
    group.add(s);
    const core = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.2), makeGlowMaterial('#ffd890'));
    core.position.copy(p).add(new THREE.Vector3(0, 0, Math.sign(-p.z || 1) * 0.215));
    if (p.z > 0) core.rotation.y = Math.PI;
    group.add(core);
  }
  // sky + sun
  const sunDir = new THREE.Vector3(0.6, 0.28, -0.75).normalize();
  const sky = skyDome([[0, '#ffb06a'], [0.08, '#ff8a7a'], [0.25, '#d0628a'], [0.55, '#5a4a9a'], [1, '#26306a']], { sunDir, sunColor: '#fff0c0', sunSize: 0.0025, glow: 0.6 });
  group.add(sky);
  // owner painted sunset replaces the mountain cards once loaded
  const mountains = group.children.filter((o) => (o as THREE.Mesh).isMesh && ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).type === 'MeshBasicMaterial' && o.position.y === -2);
  group.add(skyPanorama('shrine', 0.4, () => { for (const o of mountains) o.visible = false; }, { bright: 1 }));
  // festival: crowd behind the fence, nobori banners, lantern strings, yatai stalls
  const treeSkip = (x: number, z: number) => trees.some(([tx2, tz2]) => Math.hypot(x - tx2, z - tz2) < 1.1) || lanternSpots.some(([lx, lz]) => Math.hypot(x - lx, z - lz) < 0.8);
  const spots = ringSpots(half + 0.9, quality === 'low' ? 2 : 4, { spacing: quality === 'low' ? 0.85 : 0.6, rowDepth: 0.75, tier: 0.0, sides: ['n', 'e', 'w'], seed: 9, skip: (x, z) => treeSkip(x, z) || z > half + 0.4 || (Math.abs(x) < gw + 0.6 && z < -half - 2.2) });
  const crowd = new Crowd(spots, '#9a6a9a', 33);
  addNearFade(crowd.mesh.material as THREE.Material, 2.6);
  group.add(crowd.mesh);
  const bp: Array<{ x: number; z: number; yaw: number; cell: number }> = [];
  const cells = [0, 7, 2, 1, 3, 4, 5, 6];
  for (let i = 0; i < 4; i++) for (const sgn of [-1, 1]) bp.push({ x: sgn * (gw + 1.2 + i * 1.6), z: -half - 0.3, yaw: 0, cell: cells[(i * 2 + (sgn > 0 ? 1 : 0)) % 8] });
  for (const sgn of [-1, 1]) for (let i = 0; i < 3; i++) bp.push({ x: sgn * (half + 0.3), z: -half + 2 + i * 3, yaw: -sgn * Math.PI / 2, cell: cells[(i + (sgn > 0 ? 3 : 5)) % 8] });
  const banners = new Banners(bp);
  group.add(banners.group);
  const lanterns = new LanternStrings([
    { a: [-gw, gh - 0.9, gz], b: [-half - 3.2, 3.0, -half - 2.5], n: 8, sag: 0.5 },
    { a: [gw, gh - 0.9, gz], b: [half + 3.4, 3.0, -half - 2.2], n: 8, sag: 0.5 },
    { a: [-half - 2.6, 2.8, -half - 1.5], b: [-half - 2.6, 2.8, half - 0.5], n: 12, sag: 0.55 },
    { a: [half + 2.6, 2.8, -half - 1.5], b: [half + 2.6, 2.8, half - 0.5], n: 12, sag: 0.55 },
  ], ['#ff3a2a', '#fff0d0', '#ff3a2a', '#ffb040']);
  group.add(lanterns.group);
  // yatai (food stalls) with striped awnings
  const ym = new Merger();
  const stalls: Array<[number, number, number]> = [[-half - 4.6, -half + 3.5, Math.PI / 2], [half + 4.6, -half + 4.2, -Math.PI / 2], [-half - 4.6, half - 1.2, Math.PI / 2]];
  const stripe = (p: THREE.Vector3, o: THREE.Color) => o.set(Math.floor((p.x + p.z) * 3.2) % 2 === 0 ? '#e8302a' : '#fff4e8');
  for (const [x, z, yaw] of stalls) {
    const D = yaw * 180 / Math.PI;
    const rot = (lx: number, lz: number): [number, number, number] => [x + lx * Math.cos(yaw) + lz * Math.sin(yaw), 0, z - lx * Math.sin(yaw) + lz * Math.cos(yaw)];
    const at = (lx: number, y: number, lz: number): [number, number, number] => { const r = rot(lx, lz); r[1] = y; return r; };
    ym.add(new THREE.BoxGeometry(2.4, 0.9, 1.0), M(at(0, 0.45, 0), [0, D, 0]), '#8a5a34');
    ym.add(new THREE.BoxGeometry(2.5, 0.08, 1.1), M(at(0, 0.94, 0), [0, D, 0]), '#5a3a22');
    for (const [a, b] of [[-1.15, -0.45], [1.15, -0.45], [-1.15, 0.45], [1.15, 0.45]]) ym.add(new THREE.BoxGeometry(0.08, 2.2, 0.08), M(at(a, 1.1, b), [0, D, 0]), '#5a3a22');
    ym.add(new THREE.BoxGeometry(2.7, 0.06, 1.5), M(at(0, 2.25, 0.15), [-14, D, 0]), stripe);
    ym.add(new THREE.BoxGeometry(2.4, 0.5, 0.05), M(at(0, 1.9, -0.5), [0, D, 0]), '#fff4e8');
  }
  const yatai = new THREE.Mesh(ym.build(), toon);
  group.add(yatai);
  // petals
  const petals = petalPoints(quality === 'low' ? 250 : quality === 'medium' ? 500 : 800, 34, 9);
  group.add(petals);
  const pu = (petals.material as THREE.ShaderMaterial).uniforms;
  return {
    group,
    cheer(k: number) { crowd.cheer(k); },
    update(t, dt) { pu.uTime.value = t; crowd.update(t, dt); banners.update(t); lanterns.update(t); },
    fog: new THREE.Fog('#e89a9a', 35, 150),
    background: new THREE.Color('#ffb06a'),
    sunDir,
    sunColor: new THREE.Color('#ffd6a8'),
    sunIntensity: 2.6,
    hemiSky: new THREE.Color('#ffc0d0'),
    hemiGround: new THREE.Color('#6a4a5a'),
    hemiIntensity: 1.2,
    shadowTint: new THREE.Color('#9a6a9a'),
    rim: new THREE.Color('#ffe0b0'),
    dispose() { disposeGroup(group); },
  };
}
