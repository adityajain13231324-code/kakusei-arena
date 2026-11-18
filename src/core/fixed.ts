/**
 * Integer / fixed-point helpers for the deterministic sim.
 * All gameplay math uses integers (mm, frames, vectors scaled by 1000).
 * Only + - * / with Math.trunc are used: IEEE-754 basic ops are exactly
 * reproducible across JS engines, transcendental functions are not.
 */

export const ONE = 1000; // unit length for direction vectors

/** Integer square root (floor) via Newton iteration. n >= 0. */
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  if (n < 4) return 1;
  // initial guess from bit length keeps iterations low (< 8 for our ranges)
  let x = n;
  let y = Math.trunc((x + 1) / 2);
  while (y < x) {
    x = y;
    y = Math.trunc((x + Math.trunc(n / x)) / 2);
  }
  return x;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** integer lerp: a + (b-a)*t/den */
export function lerpInt(a: number, b: number, t: number, den = 1000): number {
  return a + Math.trunc(((b - a) * t) / den);
}

/** integer division truncating toward zero */
export function idiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

/** scale a by num/den, truncating */
export function mulDiv(a: number, num: number, den: number): number {
  return Math.trunc((a * num) / den);
}

export function len2(x: number, z: number): number {
  return isqrt(x * x + z * z);
}

export function len3(x: number, y: number, z: number): number {
  return isqrt(x * x + y * y + z * z);
}

/** Normalize a 2D (x,z) vector to length 1000. Returns fallback when zero. */
export function norm2(x: number, z: number, fbx = ONE, fbz = 0): { x: number; z: number } {
  const l = isqrt(x * x + z * z);
  if (l === 0) return { x: fbx, z: fbz };
  let nx = Math.trunc((x * ONE) / l);
  let nz = Math.trunc((z * ONE) / l);
  if (nx === 0 && nz === 0) { nx = fbx; nz = fbz; }
  return { x: nx, z: nz };
}

/** dot of two 2D vectors */
export function dot2(ax: number, az: number, bx: number, bz: number): number {
  return ax * bx + az * bz;
}

/**
 * Right-hand perpendicular of a facing vector in the XZ plane (y up).
 * For facing f, local +z ("right") = (-f.z, f.x).  e.g. facing -Z -> right +X.
 */
export function rightOf(fx: number, fz: number): { x: number; z: number } {
  return { x: -fz, z: fx };
}

export function sign(v: number): -1 | 0 | 1 {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

export function abs(v: number): number {
  return v < 0 ? -v : v;
}
