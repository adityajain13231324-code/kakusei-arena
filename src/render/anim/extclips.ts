/**
 * Authored clip player (Animation v2): plays named AnimationClips from characters/<id>/anims.glb (or clips embedded
 * in model.glb) on top of the procedural clip layer, retargeted by Mixamo-style bone names.
 *
 * Retargeting: per bone b, with source / target rest WORLD rotations Ws(b), Wt(b) (character space),
 *   K(b) = Ws(b)^-1 * Wt(b),   target local(t) = K(parent)^-1 * source local(t) * K(b)
 * so differing bone rolls / armature rotations between the clip's rig and the model cancel out; a clip authored on
 * the same rig maps 1:1. Root motion is OFF: only the vertical part of the hips translation is kept (crouches,
 * jumps in place); the sim drives position. Bones a clip has no track for keep the procedural pose.
 *
 * Clips crossfade over the request's fade (2-4 frames) against the previous clip or the procedural pose. Missing
 * clips are simply not played (the procedural clip of the same name shows). Per-frame work is allocation-free.
 */
import * as THREE from 'three';
import type { MoveDef } from '../../sim/types';
import type { ExtRequest } from './animator';

export interface ClipSource { root: THREE.Object3D; clips: THREE.AnimationClip[] }

interface BoundTrack { bone: THREE.Bone; it: THREE.Interpolant; pre: THREE.Quaternion; post: THREE.Quaternion }
interface BoundHip { it: THREE.Interpolant; rest: THREE.Vector3; toChar: THREE.Matrix3; k: number }
interface BoundClip { name: string; dur: number; tracks: BoundTrack[]; hip: BoundHip | null }
interface Slot { clip: BoundClip | null; t: number; w: number }

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3();

/** clip name as matched against requests: drops 'Armature|' style prefixes */
export function clipKey(n: string): string { return n.replace(/^.*\|/, '').trim(); }

/** move frame → clip seconds (MoveDef.clipTiming time-warp; default: stretched evenly over the move) */
export function warpMoveTime(mf: number, mv: MoveDef, dur: number): number {
  const s = mv.startup, a = Math.max(1, mv.active), r = Math.max(1, mv.recovery);
  const total = s + a + r;
  const ct = mv.clipTiming;
  if (!ct) return dur * Math.min(1, Math.max(0, mf / total));
  const end = Math.min(dur, ct.end ?? dur);
  const st = Math.min(ct.startup, end);
  const ae = Math.min(end, ct.activeEnd ?? st + (end - st) * (a / (a + r)));
  if (mf <= s) return s > 0 ? st * Math.max(0, mf) / s : st;
  if (mf <= s + a) return st + (ae - st) * (mf - s) / a;
  return ae + (end - ae) * Math.min(1, (mf - s - a) / r);
}

export class ExtClipPlayer {
  private clips = new Map<string, BoundClip>();
  private restW = new Map<THREE.Object3D, THREE.Quaternion>();
  private A: Slot = { clip: null, t: 0, w: 0 };
  private B: Slot = { clip: null, t: 0, w: 0 };
  private hipsRestChar = new THREE.Vector3();
  private toHipLocal = new THREE.Matrix3();
  /** current blend weight of authored clips (0 = procedural only) */
  weight = 0;

  /**
   * @param bones normalised bone name → bone of this view's model
   * @param root object whose space is "character space" (the view's model root), captured at REST
   */
  constructor(private bones: Map<string, THREE.Bone>, private root: THREE.Object3D, private hips: THREE.Bone | null, private hipsRest: THREE.Vector3,
    private norm: (n: string) => string) {
    root.updateMatrixWorld(true);
    const rootInv = root.getWorldQuaternion(new THREE.Quaternion()).invert();
    const seen = new Set<THREE.Object3D>();
    for (const b of bones.values()) {
      for (let o: THREE.Object3D | null = b; o && !seen.has(o); o = o.parent) {
        seen.add(o);
        this.restW.set(o, rootInv.clone().multiply(o.getWorldQuaternion(new THREE.Quaternion())));
        if (o === root) break;
      }
    }
    if (hips) {
      const rootM = root.matrixWorld.clone().invert();
      hips.getWorldPosition(this.hipsRestChar).applyMatrix4(rootM);
      const pm = rootM.multiply(hips.parent!.matrixWorld);
      this.toHipLocal.setFromMatrix4(pm).invert();
    }
  }

  get count(): number { return this.clips.size; }
  has(name: string): boolean { return this.clips.has(name); }
  names(): string[] { return [...this.clips.keys()]; }

  /** bind the clips of a source (its scene graph must be at rest) */
  add(src: ClipSource): void {
    const root = src.root;
    root.updateMatrixWorld(true);
    const rootInvQ = root.getWorldQuaternion(new THREE.Quaternion()).invert();
    const rootInvM = root.matrixWorld.clone().invert();
    const nodes = new Map<string, THREE.Object3D>();
    root.traverse((o) => { const n = this.norm(THREE.PropertyBinding.sanitizeNodeName(o.name)); if (n && !nodes.has(n)) nodes.set(n, o); });
    const wS = (o: THREE.Object3D | null) => (o ? rootInvQ.clone().multiply(o.getWorldQuaternion(new THREE.Quaternion())) : new THREE.Quaternion());
    const wT = (o: THREE.Object3D | null) => (o ? this.restW.get(o) ?? new THREE.Quaternion() : new THREE.Quaternion());
    for (const clip of src.clips) {
      const name = clipKey(clip.name);
      if (!name) continue;
      const bc: BoundClip = { name, dur: Math.max(1e-3, clip.duration), tracks: [], hip: null };
      for (const tr of clip.tracks) {
        const pb = THREE.PropertyBinding.parseTrackName(tr.name);
        const n = this.norm(pb.nodeName);
        const bone = this.bones.get(n), sn = nodes.get(n);
        if (!bone || !sn) continue;
        if (pb.propertyName === 'quaternion') {
          const post = wS(sn).invert().multiply(wT(bone));
          const pre = wS(sn.parent).invert().multiply(wT(bone.parent)).invert();
          bc.tracks.push({ bone, it: interp(tr), pre, post });
        } else if (pb.propertyName === 'position' && bone === this.hips && sn.parent) {
          const toChar = new THREE.Matrix3().setFromMatrix4(rootInvM.clone().multiply(sn.parent.matrixWorld));
          const srcY = sn.getWorldPosition(new THREE.Vector3()).applyMatrix4(rootInvM).y;
          bc.hip = { it: interp(tr), rest: sn.position.clone(), toChar, k: srcY > 1e-4 ? this.hipsRestChar.y / srcY : 1 };
        }
      }
      if (bc.tracks.length || bc.hip) { this.clips.set(name, bc); if (!this.clips.has(name.toLowerCase())) this.clips.set(name.toLowerCase(), bc); }
    }
  }

  /** blend the requested clip onto the (already procedurally posed) bones; returns true when anything was applied */
  apply(req: ExtRequest | null, dt: number): boolean {
    if (!this.clips.size) return false;
    const want = req ? (req.name && this.clips.get(req.name)) || (req.alt && this.clips.get(req.alt)) || null : null;
    const A = this.A, B = this.B;
    if (want !== A.clip) {
      // the outgoing clip keeps its pose (frozen) while the new one fades in over it
      if (A.clip && A.w > 0.01) { B.clip = A.clip; B.t = A.t; B.w = A.w; }
      A.clip = want; A.w = 0;
    }
    const step = dt > 0 ? (dt * 60) / Math.max(1, req?.fade ?? 3) : 1;
    if (A.clip) {
      A.w = Math.min(1, A.w + step);
      A.t = this.clipTime(A.clip, req!);
      if (A.w >= 1) B.clip = null;
    } else if (B.clip) B.w = Math.max(0, B.w - step);
    if (B.clip && B.w <= 0) B.clip = null;
    this.weight = Math.max(A.clip ? A.w : 0, B.clip ? B.w : 0);
    if (!A.clip && !B.clip) return false;
    if (B.clip) this.blend(B.clip, B.t, B.w);
    if (A.clip) this.blend(A.clip, A.t, A.w);
    return true;
  }

  private clipTime(c: BoundClip, req: ExtRequest): number {
    if (req.mv) return warpMoveTime(req.t, req.mv, c.dur);
    if (!Number.isNaN(req.phase)) { const u = req.phase - Math.floor(req.phase); return u * c.dur; }
    const s = req.t / 60;
    return req.loop ? s % c.dur : Math.min(s, c.dur);
  }

  private blend(c: BoundClip, t: number, w: number): void {
    for (const tr of c.tracks) {
      const r = tr.it.evaluate(t);
      _q.set(r[0], r[1], r[2], r[3]).normalize();
      _q2.copy(tr.pre).multiply(_q).multiply(tr.post);
      if (w >= 0.999) tr.bone.quaternion.copy(_q2); else tr.bone.quaternion.slerp(_q2, w);
    }
    if (c.hip && this.hips) {
      const r = c.hip.it.evaluate(t);
      _v.set(r[0], r[1], r[2]).sub(c.hip.rest).applyMatrix3(c.hip.toChar);
      _v.set(0, _v.y * c.hip.k, 0).applyMatrix3(this.toHipLocal).add(this.hipsRest);
      this.hips.position.lerp(_v, w);
    }
  }
}

/** KeyframeTrack.createInterpolant exists at runtime (set per track type) but not in the typings */
function interp(tr: THREE.KeyframeTrack): THREE.Interpolant {
  return (tr as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant();
}
