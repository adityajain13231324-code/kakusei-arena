/**
 * One on-screen fighter, driven from a skinned GLB (Mixamo-style bone names, A-pose, +Z forward).
 *
 * Posing: the shared pose library (anim/poses.ts) describes poses as IK targets for a canonical humanoid
 * (hand targets in chest space, foot targets in ground space, elbow / knee poles, torso eulers). Every GLB bone
 * gets a constant "canonical offset" O = inverse(C_rest) * Q_rest, where C_rest is the canonical frame the
 * pose library assumes for that bone at rest (limbs: local -Y points from the child back to the joint,
 * +Z forward; torso / feet: world aligned). A solved canonical world rotation C maps to the bone with
 * W = C * O, so the A-pose arm angle, bone roll conventions and any extra bones in an upgraded model don't
 * matter. Targets are rescaled to the model's real limb lengths.
 *
 * Also: spring (verlet) chains for hair / ponytail / scarf bones, Ren's katana drawn into the right hand,
 * Shiori's kunai, Goro's awakened plates, awakening wipe + glow pulse, hit flash, outlines and sockets for
 * getBoneWorld.
 */
import * as THREE from 'three';
import type { CharId, FighterState, PoseName, HitboxDef } from '../../sim/types';
import { C, NCH, PAIN_POSES } from '../anim/poses';
import { sampleFighter, defaultMoveLookup, type MoveLookup, type SampleInfo } from '../anim/sampler';
import { Animator } from '../anim/animator';
import { ExtClipPlayer, type ClipSource } from '../anim/extclips';
import { type CharAsset, cloneCharacter, clonePlates, normBoneName, kunaiGeometry, katanaGeometry } from './assets';
import { charLook, resolvePalette, type CharLook } from './looks';
import { makeFighterUniforms, makeFighterToon, makeFighterOutline, type FighterUniforms } from './toon';

export type SocketName = 'head' | 'chest' | 'hips' | 'handL' | 'handR' | 'footL' | 'footR' | 'weapon';
type Q = 'low' | 'medium' | 'high';

const D2R = Math.PI / 180;
// pose-library reference skeleton (anim/poses.ts was authored for it)
const REF_SHOULDER_L = new THREE.Vector3(0.17, 0.165, -0.01);
const REF_SHOULDER_R = new THREE.Vector3(-0.17, 0.165, -0.01);
/** the reference rig's wrists sat lower relative to the face: drop hand targets a little */
const HAND_DROP = 0.05;
const REF_ARM = 0.52, REF_LEG = 0.85, REF_HIPX = 0.095, REF_ANKLE = 0.05, REF_PIVOT = 0.9;

// scratch (allocation-free per frame)
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _S = new THREE.Vector3(), _T = new THREE.Vector3(), _E = new THREE.Vector3(), _pole = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _qp = new THREE.Quaternion();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion();
const _qI = new THREE.Quaternion();
const _e = new THREE.Euler();
const _sc = new THREE.Vector3();
const _hs = new THREE.Vector3();
const _WHITE = new THREE.Color(1, 1, 1);
const RIM_FLASH_T = 0.42;
/** seconds to ease from the held hitstop position back onto the sim position */
const HS_EASE = 4 / 60;
const _AX = new THREE.Vector3(1, 0, 0), _AY = new THREE.Vector3(0, 1, 0);
const _cA = new THREE.Vector3(), _cB = new THREE.Vector3();
const VEIL_TINT = new THREE.Color('#9a7cff'), STONE_RIM = new THREE.Color('#ffcf6a');

interface Limb {
  up: THREE.Bone; lo: THREE.Bone; end: THREE.Bone;
  a: number; b: number;
  oUp: THREE.Quaternion; oLo: THREE.Quaternion; oEnd: THREE.Quaternion;
}

interface Chain {
  bones: THREE.Bone[];
  restQ: THREE.Quaternion[];
  childLocal: THREE.Vector3[]; // rest local position of the next joint (or tail) in each bone's space
  segLen: number[];
  p: Float32Array; pp: Float32Array;
  /** rest-shape targets this frame / last frame (substeps interpolate between them) */
  tg: Float32Array; tg0: Float32Array;
  /** last substep length (time-corrected verlet) */
  h: number;
  init2: boolean;
  init: boolean;
}

function canon(along: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  _y.copy(along).normalize().negate();
  _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
  if (_z.lengthSq() < 1e-6) _z.set(0, -1, 0).addScaledVector(_y, _y.y);
  _z.normalize();
  _x.crossVectors(_y, _z).normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

export class FighterView {
  readonly group = new THREE.Group();
  readonly rootObj = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly look: CharLook;
  readonly u: FighterUniforms = makeFighterUniforms();
  readonly pose = new Float32Array(NCH);
  readonly res: number;
  private target = new Float32Array(NCH);
  private info: SampleInfo = { snap: false, pose: 'idle', strike: false };
  private bones = new Map<string, THREE.Bone>();
  private restLocalQ = new Map<THREE.Bone, THREE.Quaternion>();
  private oTorso = new Map<THREE.Bone, THREE.Quaternion>();
  private hips: THREE.Bone | null = null;
  private hipsRest = new THREE.Vector3();
  /** root-space → hips-parent-local conversion (armatures with rotation / centimetre scale, e.g. Mixamo) */
  private hipInvRel = new THREE.Quaternion();
  private hipInvScale = 1;
  private spine: THREE.Bone | null = null; private spine1: THREE.Bone | null = null; private chest: THREE.Bone | null = null;
  private neck: THREE.Bone | null = null; private head: THREE.Bone | null = null;
  private armL: Limb | null = null; private armR: Limb | null = null; private legL: Limb | null = null; private legR: Limb | null = null;
  private shG_L = new THREE.Vector3(); private shG_R = new THREE.Vector3();
  private sA = 1; private sL = 1; private rx = 1; private ankleY = 0.08;
  private chains: Chain[] = [];
  private fingers: { bone: THREE.Bone; rest: THREE.Quaternion; axis: THREE.Vector3; fist: number; open: number; left: boolean }[] = [];
  private sockets = {} as Record<SocketName, THREE.Object3D>;
  private toonMats: THREE.MeshToonMaterial[] = [];
  private outlineMat: THREE.ShaderMaterial;
  private bodyMeshes: THREE.Mesh[] = [];
  private outlines: THREE.Mesh[] = [];
  private skinnedKatana: THREE.Mesh[] = [];
  private handWeapon: THREE.Mesh | null = null;
  private handWeaponOutline: THREE.Mesh | null = null;
  private plates: THREE.Mesh[] = [];
  private height: number;
  private wipe = -1;
  private wasAwakened = false;
  private popT = 0;
  private flash = 0;
  // ---- hitstop feel (P8, render only): defender shake over the freeze, contact flash / smear, ease back into motion
  private prevHs = 0; private hsMax = 1; private hsAmp = 0; private hsDX = 1; private hsDZ = 0;
  private contactT = 0; private contactK = 0;
  private strikeT = 0; private strikeK = 0;
  private easeT = 1; private readonly easeFrom = new THREE.Vector3(); private readonly basePos = new THREE.Vector3();
  private rimT = 0; private rimK = 0;
  /** cap for the white contact flash on the body (reduce flashing) */
  flashCap = 1;
  private hasPose = false;
  private yaw = 0;
  private lastAnchor = new THREE.Vector3(1e9, 0, 0);
  private quality: Q = 'high';
  private twoHand = false;
  lookup: MoveLookup = defaultMoveLookup;
  /** Animation v2 clip layer (false = the v1 pose blender, for comparison: F3 in Training debug) */
  animV2 = true;
  readonly anim: Animator;
  /** authored clips (anims.glb) layered over the procedural clips */
  readonly clips: ExtClipPlayer;
  private assetScene: THREE.Object3D;
  private extW = 0;
  visibleWeapon = false;
  private rimBase = new THREE.Color();
  private rimAwk = new THREE.Color();
  private outBase = new THREE.Color();
  private outAwk = new THREE.Color();
  private stageRim: THREE.Color | null = null;
  private faceMat: THREE.MeshToonMaterial | null = null;
  private expr: Expr = 'neutral';
  private assistCache = new Map<string, Assist | null>();
  /** neutral stand-in body (no model for this fighter yet) */
  readonly mannequin: boolean = false;
  /** form name when this view shows an alternate-form model (form_<name>.glb), else null */
  readonly form: string | null = null;
  private exprHold = 0;
  // ---- crossover: forms / cartoon squash / rubber limbs
  private formName = '';
  private formScaleT = 1; private formS = 1;
  private formRim: THREE.Color | null = null; private formRimK = 0; private formOutline: THREE.Color | null = null;
  private sqX = 0; private sqV = 0;
  private rubber = false;
  /** queued limb stretches this frame (pooled tuples: no per-frame allocation) */
  private stretchQ: Array<[Limb, number]> = [];
  private stretchN = 0;
  private stretched: THREE.Bone[] = [];
  // ---- Soul Realm looks (Moonless Void veil, Mountain Temple stone skin)
  private veilK = 0; private veilOn = false; private veilLinger = 0; private veilShadowOff = false; private stoneK = 0;

  constructor(readonly char: CharId, asset: CharAsset, opts: { alt?: boolean } = {}) {
    this.look = charLook(char);
    this.res = asset.res;
    this.height = asset.height;
    const L = this.look;
    this.model = cloneCharacter(asset);
    this.group.add(this.rootObj);
    this.rootObj.add(this.model);
    this.group.updateMatrixWorld(true);
    // ---- uniforms
    const u = this.u;
    u.uShadowTint.value.set(L.shadowTint);
    u.uRimColor.value.set(L.rim);
    u.uRimStrength.value = L.rimStrength;
    u.uGlowColor.value.set(L.glow);
    u.uOutlineColor.value.set(opts.alt ? L.altOutline : L.outline);
    u.uOutlineWidth.value = 0.0055 * L.outlineWidth;
    u.uHue.value = opts.alt ? L.altHue : 0;
    u.uMap2.value = asset.awakenTex;
    u.uHasMap2.value = asset.awakenTex ? 1 : 0;
    this.outlineMat = makeFighterOutline(u);
    this.mannequin = asset.mannequin;
    this.form = asset.form;
    this.rubber = char === 'luffy';
    if (asset.mannequin) {
      const pal = resolvePalette(char);
      u.uRimColor.value.set(pal.accent);
      u.uShadowTint.value.set('#7c7f92');
    }
    this.rimBase.set(L.rim); this.rimAwk.set(L.rimAwk);
    this.outBase.set(L.outline); this.outAwk.set(L.outlineAwk || L.outline);
    // ---- bones
    this.model.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        const b = o as THREE.Bone;
        const n = normBoneName(b.name);
        if (!this.bones.has(n)) this.bones.set(n, b);
        this.restLocalQ.set(b, b.quaternion.clone());
      }
    });
    this.setupRig();
    this.anim = new Animator(char);
    this.anim.legScale = this.sL;
    this.assetScene = asset.scene;
    this.clips = new ExtClipPlayer(this.bones, this.rootObj, this.hips, this.hipsRest, normBoneName);
    for (const src of asset.clipSources ?? []) this.addClips(src);
    // ---- materials / meshes
    const meshes: THREE.Mesh[] = [];
    this.model.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    const matByKey = new Map<string, THREE.MeshToonMaterial>();
    const mannequin = asset.mannequin;
    const toonFor = (src: THREE.Material | THREE.Material[]): THREE.MeshToonMaterial => {
      const s = (Array.isArray(src) ? src[0] : src) as THREE.MeshStandardMaterial;
      // mannequin: one flat light-grey material (no textures); dropped-in models keep map + base colour
      const map = mannequin ? null : s?.map ?? null;
      const col = mannequin ? MANNEQUIN_GREY : s?.color ?? null;
      const key = `${map ? map.uuid : '-'}|${col ? col.getHexString() : 'fff'}`;
      let m = matByKey.get(key);
      if (!m) {
        m = makeFighterToon(map, u);
        if (col) m.color.copy(col);
        matByKey.set(key, m); this.toonMats.push(m);
      }
      return m;
    };
    for (const mesh of meshes) {
      const name = `${mesh.name} ${mesh.parent?.name ?? ''}`;
      const isFaceMesh = /face_?expression/i.test(name);
      if (isFaceMesh && !this.faceMat && !mannequin) {
        const sm = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
        this.faceMat = makeFighterToon(sm?.map ?? null, u, true);
        this.toonMats.push(this.faceMat);
      }
      mesh.material = isFaceMesh && this.faceMat ? this.faceMat : toonFor(mesh.material);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      const isFace = /face|expression|eye|brow|mouth/i.test(name);
      const isKatana = /katana|sword|blade/i.test(name);
      if (isKatana) this.skinnedKatana.push(mesh);
      this.bodyMeshes.push(mesh);
      if (!isFace) this.addOutline(mesh, isKatana ? this.skinnedKatana : null);
    }
    // ---- Goro awakened plates: rebind to this skeleton
    const plateRoot = clonePlates(asset);
    if (plateRoot) {
      plateRoot.updateMatrixWorld(true);
      const pm: THREE.SkinnedMesh[] = [];
      plateRoot.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) pm.push(o as THREE.SkinnedMesh); });
      for (const mesh of pm) {
        const joints = mesh.skeleton.bones.map((b) => this.bones.get(normBoneName(b.name)) ?? null);
        if (joints.some((j) => !j)) continue;
        const bindMatrix = mesh.bindMatrix.clone();
        const inv = mesh.skeleton.boneInverses.map((m) => m.clone());
        const local = plateRoot.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
        mesh.removeFromParent();
        this.model.add(mesh);
        local.decompose(mesh.position, mesh.quaternion, mesh.scale);
        mesh.bind(new THREE.Skeleton(joints as THREE.Bone[], inv), bindMatrix);
        mesh.material = toonFor(mesh.material);
        mesh.frustumCulled = false;
        mesh.castShadow = true;
        mesh.visible = false;
        this.plates.push(mesh);
        this.addOutline(mesh, this.plates);
      }
    }
    // ---- hand weapons
    const hs = this.sockets.handR;
    if (L.weapon === 'katana' && hs) {
      const kg = katanaGeometry();
      const km = makeFighterToon(null, u);
      km.vertexColors = true;
      this.toonMats.push(km);
      this.handWeapon = new THREE.Mesh(kg.geo, km);
      this.handWeaponOutline = new THREE.Mesh(kg.geo, this.outlineMat);
      (this.handWeapon.userData as { grip2: THREE.Vector3 }).grip2 = kg.grip2;
      (this.handWeapon.userData as { len: number }).len = kg.length;
    } else if (L.weapon === 'kunai' && hs) {
      const km = makeFighterToon(null, u);
      km.vertexColors = true;
      this.toonMats.push(km);
      this.handWeapon = new THREE.Mesh(kunaiGeometry(), km);
      this.handWeaponOutline = new THREE.Mesh(kunaiGeometry(), this.outlineMat);
      (this.handWeapon.userData as { len: number }).len = 0.2;
    }
    if (this.handWeapon && hs) {
      this.handWeapon.castShadow = true;
      this.handWeapon.frustumCulled = false;
      this.handWeaponOutline!.frustumCulled = false;
      hs.add(this.handWeapon, this.handWeaponOutline!);
      this.handWeapon.visible = this.handWeaponOutline!.visible = false;
    }
    const wsock = new THREE.Object3D();
    (this.handWeapon ?? hs ?? this.group).add(wsock);
    if (this.handWeapon) wsock.position.set(0, 0, L.weapon === 'katana' ? 0.45 : 0.2);
    this.sockets.weapon = wsock;
    this.setQuality('high');
  }

  private addOutline(mesh: THREE.Mesh, list: THREE.Mesh[] | null): void {
    let o: THREE.Mesh;
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      const sm = mesh as THREE.SkinnedMesh;
      const so = new THREE.SkinnedMesh(sm.geometry, this.outlineMat);
      so.bindMode = sm.bindMode;
      so.bind(sm.skeleton, sm.bindMatrix);
      so.bindMatrixInverse.copy(sm.bindMatrixInverse);
      o = so;
    } else o = new THREE.Mesh(mesh.geometry, this.outlineMat);
    o.position.copy(mesh.position); o.quaternion.copy(mesh.quaternion); o.scale.copy(mesh.scale);
    o.frustumCulled = false;
    o.castShadow = false;
    o.userData.src = mesh;
    mesh.parent!.add(o);
    this.outlines.push(o);
    if (list) list.push(o);
  }

  // --------------------------------------------------------------------------- rig setup
  private b(...names: string[]): THREE.Bone | null {
    for (const n of names) { const b = this.bones.get(n); if (b) return b; }
    return null;
  }

  private setupRig(): void {
    const restQ = (b: THREE.Bone) => b.getWorldQuaternion(new THREE.Quaternion());
    const restP = (b: THREE.Bone) => b.getWorldPosition(new THREE.Vector3());
    this.hips = this.b('Hips', 'hips', 'pelvis');
    this.spine = this.b('Spine', 'spine');
    this.spine1 = this.b('Spine1', 'spine1');
    this.chest = this.b('Spine2', 'Chest', 'chest', 'UpperChest') ?? this.spine1 ?? this.spine;
    if (this.chest === this.spine1) this.spine1 = null;
    if (this.chest === this.spine) this.spine = null;
    this.neck = this.b('Neck', 'neck');
    this.head = this.b('Head', 'head');
    if (this.hips) {
      this.hipsRest.copy(this.hips.position);
      const par = this.hips.parent!;
      const pq = par.getWorldQuaternion(new THREE.Quaternion());
      const rq = this.rootObj.getWorldQuaternion(new THREE.Quaternion());
      this.hipInvRel.copy(rq.invert().multiply(pq)).invert();
      const ps = par.getWorldScale(new THREE.Vector3()).x;
      this.hipInvScale = ps > 1e-6 ? 1 / ps : 1;
    }
    for (const t of [this.hips, this.spine, this.spine1, this.chest, this.neck, this.head]) if (t) this.oTorso.set(t, restQ(t));
    const limb = (u: string, l: string, e: string, isLeg: boolean): Limb | null => {
      const up = this.b(u), lo = this.b(l), end = this.b(e);
      if (!up || !lo || !end) return null;
      const pu = restP(up), pl = restP(lo), pe = restP(end);
      const cu = canon(_v1.subVectors(pl, pu), new THREE.Quaternion());
      const cl = canon(_v1.subVectors(pe, pl), new THREE.Quaternion());
      const oUp = cu.clone().invert().multiply(restQ(up));
      const oLo = cl.clone().invert().multiply(restQ(lo));
      // hand: canonical frame = forearm's; foot: world aligned
      const oEnd = (isLeg ? new THREE.Quaternion() : cl.clone().invert()).multiply(restQ(end));
      return { up, lo, end, a: pu.distanceTo(pl), b: pl.distanceTo(pe), oUp, oLo, oEnd };
    };
    this.armL = limb('LeftArm', 'LeftForeArm', 'LeftHand', false);
    this.armR = limb('RightArm', 'RightForeArm', 'RightHand', false);
    this.legL = limb('LeftUpLeg', 'LeftLeg', 'LeftFoot', true);
    this.legR = limb('RightUpLeg', 'RightLeg', 'RightFoot', true);
    const chestP = this.chest ? restP(this.chest) : new THREE.Vector3(0, 1.3, 0);
    if (this.armL) { this.shG_L.copy(restP(this.armL.up)).sub(chestP); this.sA = (this.armL.a + this.armL.b) / REF_ARM; }
    else this.shG_L.copy(REF_SHOULDER_L);
    if (this.armR) this.shG_R.copy(restP(this.armR.up)).sub(chestP); else this.shG_R.copy(REF_SHOULDER_R);
    if (this.legL) {
      this.sL = (this.legL.a + this.legL.b) / REF_LEG;
      this.rx = THREE.MathUtils.clamp(Math.abs(restP(this.legL.up).x) / REF_HIPX, 0.8, 1.7);
      this.ankleY = restP(this.legL.end).y;
    }
    // sockets (canonical orientation, child of the bone)
    const sock = (name: SocketName, bone: THREE.Bone | null, canonRest: THREE.Quaternion | null, off: [number, number, number]) => {
      const o = new THREE.Object3D();
      if (!bone) { this.group.add(o); o.position.set(0, 1.2, 0); this.sockets[name] = o; return; }
      const lq = restQ(bone).invert();
      if (canonRest) lq.multiply(canonRest);
      o.quaternion.copy(lq);
      const bs = 1 / Math.max(1e-6, bone.getWorldScale(_sc).x);
      o.position.set(off[0], off[1], off[2]).multiplyScalar(bs).applyQuaternion(lq);
      o.scale.setScalar(bs); // sockets are metre-scaled even under centimetre armatures
      bone.add(o);
      this.sockets[name] = o;
    };
    const canonOf = (l: Limb | null) => (l ? canon(_v4.subVectors(restP(l.end), restP(l.lo)), new THREE.Quaternion()) : null);
    sock('head', this.head, null, [0, 0.09 * this.sA, 0.03]);
    sock('chest', this.chest, null, [0, 0.03, 0.07]);
    sock('hips', this.hips, null, [0, 0, 0]);
    sock('handL', this.armL?.end ?? null, canonOf(this.armL), [0, -0.075 * this.sA, 0.0]);
    sock('handR', this.armR?.end ?? null, canonOf(this.armR), [0, -0.075 * this.sA, 0.0]);
    sock('footL', this.legL?.end ?? null, null, [0, -0.06, 0.08]);
    sock('footR', this.legR?.end ?? null, null, [0, -0.06, 0.08]);
    // finger curl (fists): per finger bone, a curl axis in its own rest frame
    for (const left of [true, false]) {
      const side = left ? 'Left' : 'Right';
      const hand = left ? this.armL?.end : this.armR?.end;
      const i1 = this.b(`${side}HandIndex1`), p1 = this.b(`${side}HandPinky1`) ?? this.b(`${side}HandRing1`);
      if (!hand || !i1 || !p1) continue;
      const hp = restP(hand);
      const along = restP(i1).add(restP(p1)).multiplyScalar(0.5).sub(hp).normalize();
      const across = restP(i1).sub(restP(p1)).normalize();
      const palm = left ? new THREE.Vector3().crossVectors(along, across) : new THREE.Vector3().crossVectors(across, along);
      palm.normalize();
      const kW = new THREE.Vector3().crossVectors(along, palm).normalize();
      for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) {
        for (let k = 1; k <= 3; k++) {
          const bone = this.b(`${side}Hand${f}${k}`);
          if (!bone) continue;
          const axis = kW.clone().applyQuaternion(restQ(bone).invert());
          const thumb = f === 'Thumb';
          const fist = (thumb ? [25, 30, 25] : [80, 90, 65])[k - 1] * D2R;
          const open = (thumb ? [0, 5, 5] : [8, 10, 6])[k - 1] * D2R;
          this.fingers.push({ bone, rest: bone.quaternion.clone(), axis, fist, open, left });
        }
      }
    }
    // spring chains
    const isSpring = (n: string) => /hair|pony|scarf|tail|cape|ribbon|tassel|sash|skirt|coat|cloth|robe|hood|braid|mane|flap|sleeve/i.test(n);
    for (const [n, b] of this.bones) {
      if (!isSpring(n)) continue;
      const parent = b.parent as THREE.Bone | null;
      if (parent && (parent as THREE.Bone).isBone && isSpring(normBoneName(parent.name))) continue; // not a chain root
      const list: THREE.Bone[] = [b];
      for (;;) {
        const last = list[list.length - 1];
        const next = last.children.find((c) => (c as THREE.Bone).isBone && isSpring(normBoneName(c.name))) as THREE.Bone | undefined;
        if (!next || list.length > 12) break;
        list.push(next);
      }
      const childLocal: THREE.Vector3[] = [], segLen: number[] = [];
      for (let i = 0; i < list.length; i++) {
        if (i + 1 < list.length) childLocal.push(list[i + 1].position.clone());
        else {
          const k = 1 / Math.max(1e-6, list[i].getWorldScale(_sc).x);
          const prev = i > 0 ? childLocal[i - 1] : new THREE.Vector3(0, 0.12 * k, 0);
          const len = Math.max(0.06 * k, prev.length() * 0.8);
          childLocal.push(new THREE.Vector3(0, len, 0));
        }
        segLen.push(childLocal[i].length() * list[i].getWorldScale(_sc).x);
      }
      const np = list.length + 1;
      this.chains.push({ bones: list, restQ: list.map((x) => x.quaternion.clone()), childLocal, segLen, p: new Float32Array(np * 3), pp: new Float32Array(np * 3), tg: new Float32Array(np * 3), tg0: new Float32Array(np * 3), h: 1 / 120, init: false, init2: false });
    }
  }

  setQuality(q: Q): void {
    this.quality = q;
  }

  /** cast shadows into the stage (settings: shadows off/low/high) */
  setShadows(on: boolean): void {
    for (const m of this.bodyMeshes) m.castShadow = on;
    if (this.handWeapon) this.handWeapon.castShadow = on;
  }

  /** toon outline pass on/off (one shared material, so one flag covers every outline mesh) */
  setOutlines(on: boolean): void { this.outlineMat.visible = on; }

  /** stage shadow tint blend */
  setShadowTint(stageTint: THREE.Color | null): void {
    this.u.uShadowTint.value.set(this.look.shadowTint);
    if (stageTint) this.u.uShadowTint.value.lerp(stageTint, 0.5);
  }

  /** stage back-light colour: blended into the (non-awakened) fresnel rim */
  setStageRim(c: THREE.Color | null): void {
    this.rimBase.set(this.look.rim);
    this.stageRim = c;
    if (c) this.rimBase.lerp(c, 0.55);
  }

  socket(name: SocketName): THREE.Object3D { return this.sockets[name]; }

  /**
   * Add authored clips (Animation v2). `root` = the rig the clips were authored on, at rest; omitted = this
   * fighter's own model (clips made on the same rig). Clip names: docs/ANIMATION.md.
   */
  addClips(src: ClipSource | { clips: THREE.AnimationClip[]; root?: THREE.Object3D }): void {
    try { this.clips.add({ root: src.root ?? this.assetScene, clips: src.clips }); } catch (e) { console.warn('[render] clips not bound', e); }
  }

  /**
   * Ghost look for summoned copies (e.g. clones): translucent + colour tint. opacity 1 & tint null = normal.
   * Uses the hit-flash mix for the tint, so flashes still work on top.
   */
  setGhost(opacity: number, tint: THREE.ColorRepresentation | null, tintAmount = 0.22): void {
    const tr = opacity < 0.999;
    for (let i = 0; i <= this.toonMats.length; i++) {
      const m: THREE.Material = i < this.toonMats.length ? this.toonMats[i] : this.outlineMat;
      if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
      m.opacity = opacity;
    }
    this.u.uOpacity.value = opacity;
    this.ghostTint = tint ? tintAmount : 0;
    if (tint) this.u.uFlashColor.value.set(tint);
  }
  private ghostTint = 0;

  /** model height in metres (unscaled) */
  get modelHeight(): number { return this.height; }

  /** current facial expression (Face_Expressions panel) */
  get expression(): Expr { return this.expr; }

  private pickExpression(f: FighterState, dt: number): void {
    const p = this.info.pose;
    let e: Expr = 'neutral';
    if (PAIN_POSES.has(p) || f.mode === 'hitstun' || f.mode === 'juggle' || f.mode === 'knockdown' || f.mode === 'thrown') e = 'pain';
    else if (p === 'kiCharge' || p === 'awakenPose' || p === 'beamFire' || p === 'win' || p === 'liftOverhead' || (this.info.strike && /Ext|Fire|Down|quickDraw|groundPound|stomp|Slam|spin|flying|dive/.test(p))) e = 'shout';
    else if (this.info.strike || p === 'guardHigh' || p === 'guardLow' || p === 'introPose' || p === 'dash' || p === 'crouch' || p === 'beamCharge' || p === 'sheathStance' || f.mode === 'blockstun') e = 'determined';
    if (f.awakened && e === 'neutral') e = 'determined';
    // hold shouts / pain a moment so single-frame poses still read
    if (e !== this.expr) {
      if (this.exprHold > 0 && (this.expr === 'shout' || this.expr === 'pain') && e !== 'pain') { this.exprHold -= dt; return; }
      this.expr = e;
      this.exprHold = e === 'shout' || e === 'pain' ? 0.18 : 0;
      this.u.uFaceOff.value.set(EXPR_OFF[e], 0);
    } else if (this.exprHold > 0) this.exprHold -= dt;
  }

  get poseName(): PoseName { return this.info.pose; }

  // --------------------------------------------------------------------------- update
  /** time: seconds (monotonic); dt: real seconds since last frame */
  update(f: FighterState, prev: FighterState | null, alpha: number, dt: number, time: number): void {
    for (const b of this.stretched) b.matrixAutoUpdate = true;
    this.stretched.length = 0;
    this.stretchN = 0;
    const p = prev ?? f;
    const x = (p.pos.x + (f.pos.x - p.pos.x) * alpha) / 1000;
    const y = (p.pos.y + (f.pos.y - p.pos.y) * alpha) / 1000;
    const z = (p.pos.z + (f.pos.z - p.pos.z) * alpha) / 1000;
    const fx = p.facing.x + (f.facing.x - p.facing.x) * alpha;
    const fz = p.facing.z + (f.facing.z - p.facing.z) * alpha;
    if (fx * fx + fz * fz > 1) this.yaw = Math.atan2(fx, fz);
    this.group.position.copy(this.hitstopFeel(f, p, x, y, z, alpha, dt, time));
    this.group.rotation.set(0, this.yaw, 0);
    const L = this.look;
    // ---- awakening (bottom→top atlas wipe, pop, plates)
    if (f.awakened && !this.wasAwakened) { this.popT = 0.35; this.flash = Math.max(this.flash, 0.8); if (this.wipe < 0) this.wipe = -0.05; }
    if (!f.awakened && this.wasAwakened) this.wipe = -1;
    this.wasAwakened = f.awakened;
    if (f.awakened && this.wipe < this.height + 0.3) this.wipe = Math.min(this.height + 0.3, this.wipe + dt * (this.height + 0.4) / 0.55);
    const awk = this.wipe > this.height ? 1 : Math.max(0, this.wipe / this.height);
    let s = 1 + (L.awakenScale - 1) * awk;
    if (this.popT > 0) {
      this.popT = Math.max(0, this.popT - dt);
      s *= 1 + Math.sin((this.popT / 0.35) * Math.PI) * 0.08;
    }
    // generic form scale (e.g. Titan placeholder x2.5) + cartoon squash spring (Gear Fifth hit reactions)
    this.formS += (this.formScaleT - this.formS) * Math.min(1, dt * 4);
    if (Math.abs(this.formS - this.formScaleT) < 1e-3) this.formS = this.formScaleT;
    const sk = 220, sd = 9;
    this.sqV += (-sk * this.sqX - sd * this.sqV) * Math.min(dt, 1 / 30);
    this.sqX += this.sqV * Math.min(dt, 1 / 30);
    if (Math.abs(this.sqX) < 1e-4 && Math.abs(this.sqV) < 1e-3) { this.sqX = 0; this.sqV = 0; }
    const fs = s * this.formS;
    this.group.scale.set(fs * (1 + this.sqX * 0.6), fs * (1 - this.sqX), fs * (1 + this.sqX * 0.6));
    // ---- pose
    if (this.animV2) {
      this.anim.update(f, prev, alpha, dt, time, this.lookup);
      this.pose.set(this.anim.out);
      this.info.pose = this.anim.so.label; this.info.strike = this.anim.so.strike; this.info.snap = true;
      this.hasPose = true;
    } else {
    sampleFighter(this.char, f, alpha, time, this.target, this.info, this.lookup);
    if (!this.hasPose || this.info.snap) {
      this.pose.set(this.target);
      this.hasPose = true;
    } else {
      const k = 1 - Math.exp(-dt * 16);
      for (let i = 0; i < NCH; i++) this.pose[i] += (this.target[i] - this.pose[i]) * k;
      this.pose[C.weapon] = this.target[C.weapon]; this.pose[C.twoHand] = this.target[C.twoHand];
    }
    }
    let wv = this.pose[C.weapon] > 0.5;
    if (L.weapon === 'kunai') wv = !!(f.moveId && /kunai|throw|shuriken/i.test(f.moveId)) || this.info.pose === 'throwProjectile';
    this.visibleWeapon = wv && !!this.handWeapon;
    this.twoHand = this.visibleWeapon && this.pose[C.twoHand] > 0.5 && L.weapon === 'katana';
    if (this.handWeapon) this.handWeapon.visible = this.handWeaponOutline!.visible = this.visibleWeapon;
    for (const m of this.skinnedKatana) m.visible = !(this.visibleWeapon && L.weapon === 'katana');
    const plateOn = f.awakened && awk > 0.3;
    for (const m of this.plates) m.visible = plateOn;
    this.group.updateMatrixWorld(true);
    this.applyPose(this.pose);
    this.extW = 0;
    if (this.animV2 && this.clips.count && this.clips.apply(this.anim.ext, dt)) { this.extW = this.clips.weight; this.group.updateMatrixWorld(true); }
    // frozen move frame (hitstop): hold the strike pose exactly instead of re-sweeping alpha every tick
    const am = prev && prev.moveId === f.moveId && prev.moveFrame === f.moveFrame ? 1 : alpha;
    this.strikeAssist(f, am);
    this.smear(f, am, dt);
    this.simChains(dt);
    for (let i = 0; i < this.stretchN; i++) this.applyStretch(this.stretchQ[i][0], this.stretchQ[i][1]);
    // ---- material uniforms
    const u = this.u;
    u.uWipe.value = this.wipe;
    u.uEdge.value = this.wipe > -0.5 && this.wipe < this.height + 0.25 ? 1 : 0;
    u.uGlow.value = awk * L.glowStrength * (0.75 + 0.25 * Math.sin(time * 6.5));
    u.uRimColor.value.copy(awk > 0.5 ? this.rimAwk : this.rimBase);
    const rs = this.stageRim ? Math.max(0.42, L.rimStrength) : L.rimStrength;
    u.uRimStrength.value = rs + (L.rimStrengthAwk - rs) * awk * (0.85 + 0.15 * Math.sin(time * 9));
    u.uRimWidth.value = 0.62 - 0.1 * awk;
    if (f.counterHitFlash > 0) this.flash = Math.max(this.flash, 0.45);
    this.flash = Math.max(0, this.flash - dt * 5);
    // 2-frame contact pop on top of the normal flash fade (does not lengthen it)
    let pop = 0;
    if (this.contactT > 1e-4) { this.contactT -= dt; pop = this.contactK * this.flashCap; }
    u.uFlash.value = Math.max(this.flash, pop, this.ghostTint);
    if (L.outlineAwk && u.uHue.value === 0) u.uOutlineColor.value.copy(awk > 0.5 ? this.outAwk : this.outBase);
    if (this.formRim) {
      u.uRimColor.value.copy(this.formRim);
      u.uRimStrength.value = Math.max(u.uRimStrength.value, this.formRimK * (0.85 + 0.15 * Math.sin(time * 7)));
      u.uRimWidth.value = 0.5;
    }
    if (this.formOutline && u.uHue.value === 0) u.uOutlineColor.value.copy(this.formOutline);
    this.realmLook(f, dt, time);
    if (this.rimT > 1e-4) this.rimFlashLook(dt);
    if (this.faceMat) this.pickExpression(f, dt);
  }

  /**
   * Soul Realm looks, read-only from FighterState:
   *  - veiled (Shiori, Moonless Void): fades to a faint violet shimmer between attacks, no shadow. The materials stay
   *    transparent for a moment after the veil drops so attacks in and out of the dark do not flip material state.
   *  - realmArmor (Goro, Mountain Temple): strong gold stone-skin rim while the 1-hit armor is up.
   */
  private realmLook(f: FighterState, dt: number, time: number): void {
    const u = this.u;
    const vt = f.veiled ? 1 : 0;
    this.veilK += (vt - this.veilK) * Math.min(1, dt * (vt ? 8 : 24));
    if (vt) this.veilLinger = 1.5;
    else if (this.veilLinger > 0) this.veilLinger -= dt;
    if (this.veilK > 0.004 || (this.veilOn && this.veilLinger > 0)) {
      const shimmer = 0.04 * Math.sin(time * 11) + 0.025 * Math.sin(time * 27.3);
      this.setGhost(Math.min(0.995, 1 - this.veilK * (0.92 - shimmer)), VEIL_TINT, 0.4 * this.veilK);
      u.uFlash.value = Math.max(this.flash, this.ghostTint);
      this.veilOn = true;
      const hide = this.veilK > 0.5;
      if (hide !== this.veilShadowOff) {
        this.veilShadowOff = hide;
        const sh = !hide && this.quality !== 'low';
        for (const m of this.bodyMeshes) m.castShadow = sh;
        if (this.handWeapon) this.handWeapon.castShadow = sh;
      }
    } else if (this.veilOn) {
      this.veilOn = false;
      this.setGhost(1, null);
      u.uFlashColor.value.set(0xffffff);
      u.uFlash.value = this.flash;
      if (this.veilShadowOff) { this.veilShadowOff = false; this.setQuality(this.quality); }
    }
    const st = f.realmArmor ? 1 : 0;
    this.stoneK += (st - this.stoneK) * Math.min(1, dt * (st ? 6 : 16));
    if (this.stoneK > 0.01) {
      const pulse = 0.85 + 0.15 * Math.sin(time * 4);
      u.uRimColor.value.lerp(STONE_RIM, this.stoneK);
      u.uRimStrength.value = Math.max(u.uRimStrength.value, 1.1 * this.stoneK * pulse);
      u.uRimWidth.value = Math.min(u.uRimWidth.value, 0.62 - 0.24 * this.stoneK);
    }
  }

  /**
   * Crossover form look on the current model: rim tint / outline per form and a generic scale
   * (giant: no dedicated form model, so the base model is scaled up as a placeholder).
   */
  setForm(form: string, giantPlaceholder: boolean): void {
    const key = form + (giantPlaceholder ? '!' : '');
    if (key === this.formName) return;
    this.formName = key;
    const F = FORM_LOOKS[form];
    this.formRim = F ? new THREE.Color(F.rim) : null;
    this.formRimK = F ? F.k : 0;
    this.formOutline = F?.outline ? new THREE.Color(F.outline) : null;
    this.formScaleT = (F?.scale ?? 1) * (giantPlaceholder && form === 'titan' ? 2.5 : 1);
    if (!F?.outline) this.u.uOutlineColor.value.copy(this.outBase);
  }

  /** cartoon squash & stretch impulse (Gear Fifth physics), amount ~0.1 .. 0.4 */
  squash(amount: number): void { this.sqV -= amount * 14; }

  /** current generic form scale (camera uses it for giant forms) */
  get formScale(): number { return this.formS; }

  /**
   * Rubber limb: scale the upper bone along its length by K (the forearm / shin inherits it), then put the
   * end bone (hand / foot) back at its unsheared world orientation so fists and feet keep their size.
   */
  private applyStretch(l: Limb, K: number): void {
    if (K < 1.02) return;
    l.end.updateWorldMatrix(true, false);
    l.end.matrixWorld.decompose(_sP, _sQ, _sS);
    const up = l.up;
    _v1.copy(l.lo.position).normalize();
    const k1 = K - 1, x = _v1.x, y = _v1.y, z = _v1.z;
    _mS.set(
      1 + k1 * x * x, k1 * x * y, k1 * x * z, 0,
      k1 * y * x, 1 + k1 * y * y, k1 * y * z, 0,
      k1 * z * x, k1 * z * y, 1 + k1 * z * z, 0,
      0, 0, 0, 1);
    up.updateMatrix();
    up.matrix.multiply(_mS);
    up.matrixAutoUpdate = false;
    up.updateMatrixWorld(true);
    l.end.getWorldPosition(_sP2);
    _m.compose(_sP2, _sQ, _sS);
    l.end.matrix.copy(_m2.copy(l.lo.matrixWorld).invert().multiply(_m));
    l.end.matrixAutoUpdate = false;
    l.end.updateMatrixWorld(true);
    this.stretched.push(up, l.end);
  }

  private queueStretch(l: Limb, k: number): void {
    const e = this.stretchQ[this.stretchN];
    if (e) { e[0] = l; e[1] = k; } else this.stretchQ.push([l, k]);
    this.stretchN++;
  }

  /** queue a rubber stretch so the limb reaches the hitbox target (_T) */
  private rubberReach(l: Limb): void {
    if (!this.rubber) return;
    const ws = this.group.scale.y;
    l.up.getWorldPosition(_v3);
    const reach = (l.a + l.b) * ws * 0.97;
    const d = _v3.distanceTo(_T);
    if (d > reach) this.queueStretch(l, Math.min(4.5, d / reach));
  }

  /** register a hit on this fighter (flash) */
  onHit(strength: number, dx = 0, dz = 0, counter = false): void {
    this.flash = Math.max(this.flash, (0.25 + strength * 0.25) * this.flashCap);
    this.anim.onHit(strength);
    // hitstop shake: amplitude by strength (counter hits a bit more), along the hit direction
    const amp = (0.012 + 0.042 * strength) * (counter ? 1.3 : 1);
    this.hsAmp = this.contactT > 0 ? Math.max(this.hsAmp, amp) : amp; // hit + counter events of one contact
    const l = Math.hypot(dx, dz);
    if (l > 1e-6) { this.hsDX = dx / l; this.hsDZ = dz / l; }
    // 2-frame white contact flash, then the normal flash fade
    this.contactT = 2 / 60;
    this.contactK = Math.min(0.75, 0.38 + strength * 0.37);
  }
  /** parry / counter-stance success: bright white fresnel rim that fades over ~0.4 s (plus a soft body pop) */
  rimFlash(k: number): void { this.rimT = RIM_FLASH_T; this.rimK = k; }
  private rimFlashLook(dt: number): void {
    const u = this.u;
    this.rimT = Math.max(0, this.rimT - dt);
    const e = this.rimT / RIM_FLASH_T, k = e * e * this.rimK;
    u.uRimColor.value.lerp(_WHITE, Math.min(1, k * 1.5));
    u.uRimStrength.value = Math.max(u.uRimStrength.value, 2.4 * k * (0.5 + 0.5 * this.flashCap));
    u.uRimWidth.value = Math.min(u.uRimWidth.value, 0.62 - 0.3 * k);
    u.uFlash.value = Math.max(u.uFlash.value, 0.3 * k * this.flashCap);
  }

  /** this fighter's strike connected: 2-3 frame contact smear on the striking limb (render only) */
  onStrike(strength: number): void { this.strikeT = 2.5 / 60; this.strikeK = strength; }

  /**
   * Render-side hitstop curve: the sim freezes both fighters for N frames (balance data, untouched). Here the
   * defender shakes along the hit direction with an amplitude that decays over the freeze, and when the freeze ends
   * both bodies ease from the held position back onto the sim position over ~4 frames instead of snapping.
   */
  private hitstopFeel(f: FighterState, p: FighterState, x: number, y: number, z: number, alpha: number, dt: number, time: number): THREE.Vector3 {
    const hs = f.hitstop;
    if (hs > this.prevHs) this.hsMax = Math.max(1, hs);
    const out = _hs.set(x, y, z);
    if (this.prevHs > 0 && hs === 0) {
      // freeze over: ease out of the held pose (skip on teleports / round resets)
      if (this.basePos.distanceToSquared(out) < 0.36) { this.easeT = 0; this.easeFrom.copy(this.basePos); }
      this.hsAmp = 0;
    }
    this.prevHs = hs;
    if (this.easeT < HS_EASE) {
      this.easeT += dt;
      const u = Math.min(1, this.easeT / HS_EASE);
      out.lerpVectors(this.easeFrom, out, u * u * (3 - 2 * u));
    }
    this.basePos.copy(out);
    if (hs > 0 && this.hsAmp > 0) {
      const hsI = Math.max(0, p.hitstop + (hs - p.hitstop) * alpha);
      const k = Math.min(1, hsI / this.hsMax);
      const a = this.hsAmp * k * Math.sqrt(k);
      const w = Math.sin(time * 188.5), w2 = Math.cos(time * 131.9); // ~30 Hz along the hit, ~21 Hz across
      out.x += (this.hsDX * w - this.hsDZ * w2 * 0.45) * a;
      out.z += (this.hsDZ * w + this.hsDX * w2 * 0.45) * a;
      out.y += w2 * a * 0.25;
    }
    return out;
  }

  // --------------------------------------------------------------------------- pose → bones
  private setWorldQ(bone: THREE.Object3D, w: THREE.Quaternion): void {
    const parent = bone.parent!;
    parent.getWorldQuaternion(_qp);
    bone.quaternion.copy(_qp.invert().multiply(w));
    bone.updateMatrixWorld(true);
  }

  private applyPose(c: Float32Array): void {
    if (!this.hips) return;
    const sL = this.sL;
    // root (yaw / pitch around the pelvis pivot)
    const pivot = REF_PIVOT * sL;
    _q1.setFromAxisAngle(_AY, c[C.rootYaw] * D2R);
    _q2.setFromAxisAngle(_AX, c[C.rootPitch] * D2R);
    this.rootObj.quaternion.copy(_q1).multiply(_q2);
    _v1.set(0, -pivot, 0).applyQuaternion(this.rootObj.quaternion);
    this.rootObj.position.set(0, pivot + c[C.lift] * sL, 0).add(_v1);
    this.rootObj.updateMatrixWorld(true);
    this.rootObj.getWorldQuaternion(_qa); // root world
    // hips
    _v1.set(c[C.hipX], c[C.hipY], c[C.hipZ]).multiplyScalar(sL * this.hipInvScale).applyQuaternion(this.hipInvRel);
    this.hips.position.copy(this.hipsRest).add(_v1);
    _e.set(c[C.hipP] * D2R, c[C.hipYaw] * D2R, -c[C.hipR] * D2R, 'YXZ');
    _qb.copy(_qa).multiply(_q1.setFromEuler(_e)); // canonical hips world
    this.setWorldQ(this.hips, _q2.copy(_qb).multiply(this.oTorso.get(this.hips)!));
    // spine chain
    _e.set(c[C.spP] * D2R, c[C.spY] * D2R, -c[C.spR] * D2R, 'YXZ');
    _q3.setFromEuler(_e);
    if (this.spine && this.spine1) {
      _qc.copy(_qI).slerp(_q3, 0.5);
      _qb.multiply(_qc); this.setWorldQ(this.spine, _q2.copy(_qb).multiply(this.oTorso.get(this.spine)!));
      _qb.multiply(_qc); this.setWorldQ(this.spine1, _q2.copy(_qb).multiply(this.oTorso.get(this.spine1)!));
    } else {
      _qb.multiply(_q3);
      const sp = this.spine ?? this.spine1;
      if (sp) this.setWorldQ(sp, _q2.copy(_qb).multiply(this.oTorso.get(sp)!));
    }
    _e.set(c[C.chP] * D2R, c[C.chY] * D2R, -c[C.chR] * D2R, 'YXZ');
    _qb.multiply(_q1.setFromEuler(_e)); // canonical chest world
    if (this.chest) this.setWorldQ(this.chest, _q2.copy(_qb).multiply(this.oTorso.get(this.chest)!));
    const chestCanon = _qc.copy(_qb); // keep (no further use of _qc below until arms done)
    // neck / head
    _q3.copy(_qb);
    if (this.neck) {
      _e.set(c[C.hdP] * 0.35 * D2R, c[C.hdY] * 0.4 * D2R, -c[C.hdR] * 0.4 * D2R, 'YXZ');
      _q3.multiply(_q1.setFromEuler(_e));
      this.setWorldQ(this.neck, _q2.copy(_q3).multiply(this.oTorso.get(this.neck)!));
    }
    if (this.head) {
      const k = this.neck ? 0.65 : 1;
      _e.set(c[C.hdP] * k * D2R, c[C.hdY] * (this.neck ? 0.6 : 1) * D2R, -c[C.hdR] * (this.neck ? 0.6 : 1) * D2R, 'YXZ');
      _q3.multiply(_q1.setFromEuler(_e));
      this.setWorldQ(this.head, _q2.copy(_q3).multiply(this.oTorso.get(this.head)!));
    }
    // chest canonical matrix (hand targets live here)
    const ws = this.group.scale.x;
    if (this.chest) this.chest.getWorldPosition(_v3); else _v3.set(0, 1.3, 0).applyMatrix4(this.rootObj.matrixWorld);
    _m2.compose(_v3, chestCanon, _sc.set(ws, ws, ws));
    // arms
    if (this.armL) this.solveArm(this.armL, c, C.hL, C.eL, C.wL, 1, this.shG_L, REF_SHOULDER_L, ws, _m2);
    if (this.armR) this.solveArm(this.armR, c, C.hR, C.eR, C.wR, -1, this.shG_R, REF_SHOULDER_R, ws, _m2);
    if (this.twoHand && this.armL && this.armR && this.handWeapon) {
      this.handWeapon.updateMatrixWorld(true);
      _T.copy((this.handWeapon.userData as { grip2: THREE.Vector3 }).grip2).applyMatrix4(this.handWeapon.matrixWorld);
      _pole.set(c[C.eL], c[C.eL + 1], c[C.eL + 2]).applyQuaternion(_qa);
      this.solveLimb(this.armL, _T, _pole, ws, false);
      // left hand matches the right hand's canonical orientation
      this.sockets.handR.getWorldQuaternion(_q3);
      this.setWorldQ(this.armL.end, _q2.copy(_q3).multiply(this.armL.oEnd));
    }
    // fingers: fist ↔ open hand
    for (const fg of this.fingers) {
      const o = THREE.MathUtils.clamp(c[fg.left ? C.openL : C.openR], 0, 1);
      _q1.setFromAxisAngle(fg.axis, fg.fist + (fg.open - fg.fist) * o);
      fg.bone.quaternion.copy(fg.rest).multiply(_q1);
    }
    // legs
    if (this.legL) this.solveLeg(this.legL, c, C.fL, C.kL, C.fLp, ws);
    if (this.legR) this.solveLeg(this.legR, c, C.fR, C.kR, C.fRp, ws);
  }

  // --------------------------------------------------------------------------- strike → hitbox alignment
  /** which limb carries a move's active hitbox (from the anim key pose around the first active frame) */
  private assistFor(moveId: string): Assist | null {
    if (this.assistCache.has(moveId)) return this.assistCache.get(moveId)!;
    let res: Assist | null = null;
    const mv = this.lookup(this.char, moveId);
    if (mv && mv.hitboxes?.length && mv.anim?.length && mv.height !== 'throw') {
      const hb = mv.hitboxes[0];
      for (const [fr, pose] of mv.anim) {
        if (fr > hb.to) break;
        if (fr < hb.from - 6) continue;
        const r = ASSIST_POSES[pose];
        if (r) { res = { limb: r[0], w: r[1], hbs: mv.hitboxes }; break; }
      }
    }
    this.assistCache.set(moveId, res);
    return res;
  }

  private strikeAssist(f: FighterState, alpha: number): void {
    if (!f.moveId || f.mode !== 'attack') return;
    const a = this.assistFor(f.moveId);
    if (!a) return;
    const fr = f.moveFrame + 1 + alpha;
    let w = 0;
    let hb: HitboxDef | null = null;
    for (const h of a.hbs) {
      const k = fr < h.from ? 1 - (h.from - fr) / 3 : fr <= h.to + 1 ? 1 : 1 - (fr - h.to - 1) / 5;
      if (k > w) { w = k; hb = h; }
    }
    if (!hb || w <= 0) return;
    w = Math.min(1, w) * a.w * (1 - 0.5 * this.extW);
    // hitbox far end (minus a bit of the radius so the fist / foot sits inside it), group-local metres
    const fwd = (hb.x + hb.len * 0.8) / 1000;
    this.rootObj.getWorldQuaternion(_qa);
    this.aw = w; this.afwd = fwd; this.ay = hb.y / 1000;
    switch (a.limb) {
      case 'handL': if (this.armL) this.assistHand(this.armL, C.wL, 1, C.eL, 0.02); break;
      case 'handR': if (this.armR) this.assistHand(this.armR, C.wR, -1, C.eR, -0.02); break;
      case 'both':
        if (this.armL) this.assistHand(this.armL, C.wL, 1, C.eL, 0.12);
        if (this.armR) this.assistHand(this.armR, C.wR, -1, C.eR, -0.12);
        break;
      case 'footR': if (this.legR) this.assistFoot(this.legR, C.kR, C.fRp); break;
      case 'footL': if (this.legL) this.assistFoot(this.legL, C.kL, C.fLp); break;
    }
  }

  private aw = 0; private afwd = 0; private ay = 0;

  /**
   * Smear / impact frames (Animation v2): on heavy, special, Ki and ultimate moves the striking limb stretches
   * along its length for a few frames around the first active frame (anime smear), reusing the rubber-limb stretch.
   */
  private smear(f: FighterState, alpha: number, dt: number): void {
    const contact = this.strikeT > 1e-4;
    if (contact) this.strikeT -= dt;
    if (!this.animV2 || this.rubber || !f.moveId || f.mode !== 'attack') return;
    const mv = this.lookup(this.char, f.moveId);
    if (!mv) return;
    const a = this.assistFor(f.moveId);
    if (!a) return;
    let K = 1;
    const sup = mv.strength === 'super' || mv.kind === 'ultimate';
    if (sup || mv.strength === 'heavy' || mv.kind === 'special' || mv.kind === 'ki') {
      const fr = f.moveFrame - 1 + alpha; // displayed (interpolated) move frame
      const start = a.hbs[0].from - 1; // first active moveFrame
      const u = (fr - (start - 2)) / 4.5;
      if (u > 0 && u < 1) K = 1 + (sup ? 0.34 : 0.24) * Math.sin(Math.PI * u) * (1 - 0.5 * this.extW);
    }
    // contact smear: the limb that connected snaps a little longer for 2-3 frames
    if (contact) K = Math.max(K, 1 + (0.05 + 0.1 * this.strikeK) * (1 - 0.5 * this.extW));
    if (K <= 1.001) return;
    switch (a.limb) {
      case 'handL': if (this.armL) this.queueStretch(this.armL, K); break;
      case 'handR': if (this.armR) this.queueStretch(this.armR, K); break;
      case 'both': if (this.armL) this.queueStretch(this.armL, K); if (this.armR) this.queueStretch(this.armR, K); break;
      case 'footL': if (this.legL) this.queueStretch(this.legL, K); break;
      case 'footR': if (this.legR) this.queueStretch(this.legR, K); break;
    }
  }

  /** hitbox point (group-local, unscaled) → world, into _T */
  private assistTarget(lat: number): void {
    const ws = this.group.scale.x;
    _T.set(lat, this.ay, this.afwd).applyMatrix4(_m2.copy(this.group.matrixWorld).multiply(_m.makeScale(1 / ws, 1 / ws, 1 / ws)));
  }

  private assistHand(l: Limb, wI: number, m: number, eI: number, lat: number): void {
    const w = this.aw, ws = this.group.scale.x;
    l.end.getWorldPosition(_v4);
    this.assistTarget(lat);
    _T.lerp(_v4, 1 - w);
    _pole.set(this.pose[eI], this.pose[eI + 1], this.pose[eI + 2]).applyQuaternion(_qa);
    this.solveLimb(l, _T, _pole, ws, false);
    _e.set(this.pose[wI] * D2R, this.pose[wI + 1] * D2R * m, this.pose[wI + 2] * D2R * m, 'XYZ');
    _q3.copy(_cq2).multiply(_q1.setFromEuler(_e));
    this.setWorldQ(l.end, _q3.multiply(l.oEnd));
    this.rubberReach(l);
  }

  private assistFoot(l: Limb, kI: number, pI: number): void {
    const w = this.aw, ws = this.group.scale.x;
    l.end.getWorldPosition(_v4);
    this.assistTarget(0);
    _T.lerp(_v4, 1 - w);
    _pole.set(this.pose[kI], this.pose[kI + 1], this.pose[kI + 2]).applyQuaternion(_qa);
    this.solveLimb(l, _T, _pole, ws, true);
    // foot follows the shin (pointed kick)
    _q3.copy(_cq2).multiply(_q1.setFromAxisAngle(_AX, -70 * D2R * w));
    _q2.copy(_qa).multiply(_q1.setFromAxisAngle(_AY, this.pose[pI + 1] * D2R)).multiply(_qb.setFromAxisAngle(_AX, this.pose[pI] * D2R));
    _q3.slerp(_q2, 1 - w);
    this.setWorldQ(l.end, _q3.multiply(l.oEnd));
    this.rubberReach(l);
  }

  private solveArm(l: Limb, c: Float32Array, hI: number, eI: number, wI: number, m: number, shG: THREE.Vector3, shRef: THREE.Vector3, ws: number, chestM: THREE.Matrix4): void {
    _T.set(c[hI], c[hI + 1] - HAND_DROP, c[hI + 2]).sub(shRef).multiplyScalar(this.sA).add(shG).applyMatrix4(chestM);
    _pole.set(c[eI], c[eI + 1], c[eI + 2]).applyQuaternion(_qa);
    this.solveLimb(l, _T, _pole, ws, false);
    // hand: canonical = forearm canonical * wrist euler
    _e.set(c[wI] * D2R, c[wI + 1] * D2R * m, c[wI + 2] * D2R * m, 'XYZ');
    _q3.copy(_cq2).multiply(_q1.setFromEuler(_e));
    this.setWorldQ(l.end, _q3.multiply(l.oEnd));
  }

  private solveLeg(l: Limb, c: Float32Array, fI: number, kI: number, pI: number, ws: number): void {
    _T.set(c[fI] * this.rx, this.ankleY + (c[fI + 1] - REF_ANKLE) * this.sL, c[fI + 2] * this.sL).applyMatrix4(this.rootObj.matrixWorld);
    _pole.set(c[kI], c[kI + 1], c[kI + 2]).applyQuaternion(_qa);
    this.solveLimb(l, _T, _pole, ws, true);
    _q3.copy(_qa).multiply(_q1.setFromAxisAngle(_AY, c[pI + 1] * D2R)).multiply(_q2.setFromAxisAngle(_AX, c[pI] * D2R));
    this.setWorldQ(l.end, _q3.multiply(l.oEnd));
  }

  /** analytic two-bone IK; writes canonical upper/lower world rotations into _cq1/_cq2 and applies them */
  private solveLimb(l: Limb, target: THREE.Vector3, pole: THREE.Vector3, ws: number, isLeg: boolean): void {
    const a = l.a * ws, b = l.b * ws;
    l.up.getWorldPosition(_S);
    _v1.subVectors(target, _S);
    let dist = _v1.length();
    if (dist < 1e-5) { _v1.set(0, -1, 0); dist = 1e-5; }
    _v1.divideScalar(dist);
    dist = Math.min(Math.max(dist, Math.abs(a - b) + 1e-3), (a + b) * 0.9995);
    const cosA = (a * a + dist * dist - b * b) / (2 * a * dist);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    _v2.copy(pole).addScaledVector(_v1, -pole.dot(_v1));
    if (_v2.lengthSq() < 1e-8) _v2.set(0, 0, isLeg ? 1 : -1).addScaledVector(_v1, -_v1.z);
    _v2.normalize();
    _E.copy(_S).addScaledVector(_v1, a * cosA).addScaledVector(_v2, a * sinA);
    _y.subVectors(_S, _E).normalize();
    _v3.copy(pole).addScaledVector(_y, -pole.dot(_y));
    if (_v3.lengthSq() < 1e-8) _v3.copy(_v2);
    _v3.normalize();
    if (isLeg) _z.copy(_v3); else _z.copy(_v3).negate();
    _x.crossVectors(_y, _z).normalize();
    _z.crossVectors(_x, _y);
    _m.makeBasis(_x, _y, _z);
    _cq1.setFromRotationMatrix(_m);
    _v4.copy(_S).addScaledVector(_v1, dist);
    _y.subVectors(_E, _v4).normalize();
    _z.crossVectors(_x, _y).normalize();
    _m.makeBasis(_x, _y, _z);
    _cq2.setFromRotationMatrix(_m);
    this.setWorldQ(l.up, _q2.copy(_cq1).multiply(l.oUp));
    this.setWorldQ(l.lo, _q2.copy(_cq2).multiply(l.oLo));
  }

  // --------------------------------------------------------------------------- spring chains
  /**
   * Secondary motion: verlet spring chains (hair, ponytail, scarf, cloth bones) pulled toward the animated rest shape.
   * Integrated in sub-steps of at most 1/120 s with stiffness / drag converted per step, so the motion looks the
   * same at 30, 60 or 144 fps; the chain root and targets are interpolated across the sub-steps.
   */
  private simChains(dt: number): void {
    if (!this.chains.length) return;
    dt = Math.min(dt, 1 / 15);
    const nSteps = Math.min(8, Math.max(1, Math.ceil(dt * 120 - 1e-6)));
    const h = dt / nSteps;
    const ws = this.group.scale.x;
    const sp = this.look.spring;
    // collision spheres
    if (this.head) this.head.getWorldPosition(_cA); else _cA.set(0, -100, 0);
    if (this.chest) this.chest.getWorldPosition(_cB); else _cB.set(0, -100, 0);
    _cA.y += 0.08 * this.sA * ws;
    const rHead = 0.12 * this.sA * ws, rChest = 0.15 * this.sA * ws;
    // teleport (round reset / side switch) → reinit
    const jump = this.lastAnchor.distanceToSquared(this.group.position) > 1.0;
    this.lastAnchor.copy(this.group.position);
    for (const ch of this.chains) {
      const nb = ch.bones.length, np = nb + 1, p = ch.p, pp = ch.pp;
      // reset to rest (animated parent) and collect targets
      for (let i = 0; i < nb; i++) ch.bones[i].quaternion.copy(ch.restQ[i]);
      ch.bones[0].updateMatrixWorld(true);
      if (!ch.init || jump || dt <= 0) {
        for (let i = 0; i < np; i++) {
          if (i < nb) ch.bones[i].getWorldPosition(_v1); else ch.bones[nb - 1].localToWorld(_v1.copy(ch.childLocal[nb - 1]));
          p[i * 3] = pp[i * 3] = _v1.x; p[i * 3 + 1] = pp[i * 3 + 1] = _v1.y; p[i * 3 + 2] = pp[i * 3 + 2] = _v1.z;
        }
        ch.init = true; ch.init2 = false;
        if (dt <= 0) continue;
      }
      // rest-shape targets (animated parent) for this frame; last frame's are kept for interpolation
      const tg = ch.tg, tg0 = ch.tg0;
      tg0.set(tg);
      for (let i = 0; i < np; i++) {
        if (i < nb) ch.bones[i].getWorldPosition(_v2); else ch.bones[nb - 1].localToWorld(_v2.copy(ch.childLocal[nb - 1]));
        tg[i * 3] = _v2.x; tg[i * 3 + 1] = _v2.y; tg[i * 3 + 2] = _v2.z;
      }
      if (!ch.init2) { tg0.set(tg); ch.init2 = true; }
      // tuning is per 1/60 s step: convert to this sub-step length
      const r = h * 60;
      const stiff = 1 - Math.pow(1 - sp.stiffness, r);
      const damp = Math.pow(1 - sp.drag, r);
      const vFirst = damp * Math.min(2, h / ch.h);
      ch.h = h;
      for (let st = 1; st <= nSteps; st++) {
      const a = st / nSteps, a0 = 1 - a;
      const vScale = st === 1 ? vFirst : damp;
      p[0] = pp[0] = tg0[0] * a0 + tg[0] * a; p[1] = pp[1] = tg0[1] * a0 + tg[1] * a; p[2] = pp[2] = tg0[2] * a0 + tg[2] * a;
      for (let i = 1; i < np; i++) {
        const k = i * 3;
        const tx = tg0[k] * a0 + tg[k] * a, ty = tg0[k + 1] * a0 + tg[k + 1] * a, tz = tg0[k + 2] * a0 + tg[k + 2] * a;
        const vx = (p[k] - pp[k]) * vScale, vy = (p[k + 1] - pp[k + 1]) * vScale, vz = (p[k + 2] - pp[k + 2]) * vScale;
        pp[k] = p[k]; pp[k + 1] = p[k + 1]; pp[k + 2] = p[k + 2];
        p[k] += vx; p[k + 1] += vy - sp.gravity * h * h; p[k + 2] += vz;
        p[k] += (tx - p[k]) * stiff; p[k + 1] += (ty - p[k + 1]) * stiff; p[k + 2] += (tz - p[k + 2]) * stiff;
      }
      for (let it = 0; it < 2; it++) {
        for (let i = 1; i < np; i++) {
          const a = (i - 1) * 3, b = i * 3;
          const seg = ch.segLen[i - 1] * ws;
          const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
          const diff = (d - seg) / d;
          if (i === 1) { p[b] -= dx * diff; p[b + 1] -= dy * diff; p[b + 2] -= dz * diff; }
          else {
            const hx = dx * diff * 0.5, hy = dy * diff * 0.5, hz = dz * diff * 0.5;
            p[a] += hx; p[a + 1] += hy; p[a + 2] += hz; p[b] -= hx; p[b + 1] -= hy; p[b + 2] -= hz;
          }
        }
        for (let i = 2; i < np; i++) {
          const k = i * 3;
          collide(p, k, _cA, rHead);
          collide(p, k, _cB, rChest);
          if (p[k + 1] < 0.03) p[k + 1] = 0.03;
        }
      }
      }
      // orient bones toward the simulated points
      for (let i = 0; i < nb; i++) {
        const bone = ch.bones[i];
        bone.getWorldPosition(_v1);
        bone.localToWorld(_v2.copy(ch.childLocal[i]));
        _v2.sub(_v1);
        _v3.set(p[i * 3 + 3], p[i * 3 + 4], p[i * 3 + 5]).sub(_v1);
        if (_v2.lengthSq() < 1e-10 || _v3.lengthSq() < 1e-10) continue;
        _q1.setFromUnitVectors(_v2.normalize(), _v3.normalize());
        bone.getWorldQuaternion(_q2);
        this.setWorldQ(bone, _q1.multiply(_q2));
      }
    }
  }

  get tris(): number {
    let t = 0;
    for (const m of this.bodyMeshes) { const g = m.geometry; t += (g.index ? g.index.count : g.getAttribute('position').count) / 3; }
    return t;
  }

  dispose(): void {
    for (const m of this.toonMats) m.dispose();
    this.outlineMat.dispose();
    this.group.removeFromParent();
  }
}

const _cq1 = new THREE.Quaternion(), _cq2 = new THREE.Quaternion();
const _mS = new THREE.Matrix4(), _sP = new THREE.Vector3(), _sP2 = new THREE.Vector3(), _sQ = new THREE.Quaternion(), _sS = new THREE.Vector3();

/** crossover form looks (rim tint, optional outline, generic scale) */
const FORM_LOOKS: Record<string, { rim: string; k: number; outline?: string; scale?: number }> = {
  six_eyes: { rim: '#8fe0ff', k: 0.75 },
  sage: { rim: '#ff8a1a', k: 0.7, outline: '#4a1800' },
  kurama: { rim: '#ffc21a', k: 1.0, outline: '#5a3000', scale: 1.04 },
  gear2: { rim: '#ff6a8a', k: 0.65 },
  gear4: { rim: '#ff2a1a', k: 0.8, outline: '#2a0000', scale: 1.18 },
  gear5: { rim: '#ffffff', k: 1.0, outline: '#6a6070' },
  titan: { rim: '#c01a10', k: 0.85, outline: '#300000' },
  santoryu: { rim: '#6fffb0', k: 0.3 }, nitoryu: { rim: '#6fffb0', k: 0.25 }, ittoryu: { rim: '#6fffb0', k: 0.35 },
};
const MANNEQUIN_GREY = new THREE.Color('#c4c8d2');

type AssistLimb = 'handL' | 'handR' | 'both' | 'footL' | 'footR';
interface Assist { limb: AssistLimb; w: number; hbs: HitboxDef[] }
/** strike poses whose limb is pulled onto the active hitbox (limb, max weight) */
const ASSIST_POSES: Partial<Record<PoseName, [AssistLimb, number]>> = {
  jabExt: ['handL', 1], straightExt: ['handR', 1], hookExt: ['handR', 0.75], uppercutExt: ['handR', 0.45], palmExt: ['handR', 1],
  throwProjectile: ['handR', 0.6], beamFire: ['both', 0.8], grabReach: ['both', 0.9],
  lowKickExt: ['footR', 1], midKickExt: ['footR', 1], highKickExt: ['footR', 1], roundhouseExt: ['footR', 1], axeKickDown: ['footR', 0.9],
  sweepExt: ['footR', 1], flyingKick: ['footL', 1], diveKick: ['footL', 1],
};

export type Expr = 'neutral' | 'shout' | 'pain' | 'determined';
const EXPR_OFF: Record<Expr, number> = { neutral: 0, shout: 0.25, pain: 0.5, determined: 0.75 };

function collide(p: Float32Array, k: number, c: THREE.Vector3, r: number): void {
  const dx = p[k] - c.x, dy = p[k + 1] - c.y, dz = p[k + 2] - c.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 < r * r && d2 > 1e-8) {
    const d = Math.sqrt(d2), s = r / d;
    p[k] = c.x + dx * s; p[k + 1] = c.y + dy * s; p[k + 2] = c.z + dz * s;
  }
}
