// Screen-space post effects: impact frames, speed lines, flash, vignette.
// Drawn as a fullscreen quad AFTER the scene via GameRenderer.setPostPass.
import * as THREE from 'three';

const VERT = /* glsl */ `void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FRAG = /* glsl */ `
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uVig;
uniform vec4 uFlash; uniform float uLines; uniform vec3 uLineCol; uniform float uSeed;
uniform float uImpact; uniform float uHasScene; uniform sampler2D uScene;
uniform float uLetter; uniform vec4 uGrade;
float hash(float n){ return fract(sin(n * 127.1) * 43758.5453); }
vec4 over(vec4 f, vec4 b){
  float a = f.a + b.a * (1.0 - f.a);
  if (a < 1e-4) return vec4(0.0);
  return vec4((f.rgb * f.a + b.rgb * b.a * (1.0 - f.a)) / a, a);
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float r = length(p);
  float ang = atan(p.y, p.x);
  vec4 o = vec4(0.0, 0.0, 0.0, smoothstep(0.32, 0.95, r) * uVig);
  float tick = floor(uTime * 14.0);
  if (uLines > 0.002) {
    float N = 84.0;
    float a = ang / 6.2831853 * N + uSeed * N;
    float id = floor(a), f = fract(a);
    float h = hash(id + tick * 17.0);
    float w = mix(0.06, 0.34, h * h);
    float line = smoothstep(0.0, 0.05, f) * (1.0 - smoothstep(w, w + 0.07, f));
    float inner = mix(0.42, 0.16, clamp(uLines, 0.0, 1.0)) + h * 0.16;
    float m = smoothstep(inner, inner + 0.3, r) * line * step(0.22, h);
    o = over(vec4(uLineCol, m * clamp(uLines * 1.15, 0.0, 1.0)), o);
  }
  if (uGrade.a > 0.002) {
    // colour wash, stronger at the edges (realm / ultimate mood)
    o = over(vec4(uGrade.rgb, uGrade.a * (0.55 + 0.45 * smoothstep(0.2, 0.9, r))), o);
  }
  o = over(vec4(uFlash.rgb, uFlash.a), o);
  if (uLetter > 0.001 && abs(uv.y - 0.5) > 0.5 - uLetter) o = vec4(0.0, 0.0, 0.0, 1.0);
  if (uImpact > 0.5) {
    vec3 c = uHasScene > 0.5 ? texture2D(uScene, uv).rgb : vec3(smoothstep(0.05, 0.55, r));
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    vec3 col;
    if (uImpact < 1.5) {            // hard negative
      float v = smoothstep(0.2, 0.8, 1.0 - l);
      col = vec3(v);
    } else if (uImpact < 2.5) {     // black / white silhouette, red mids
      float v = step(0.42, l);
      col = mix(vec3(0.02, 0.0, 0.0), vec3(1.0, 0.96, 0.92), v);
      col.r += (1.0 - v) * smoothstep(0.1, 0.4, l) * 0.55;
    } else {                        // red / black inverted
      float v = smoothstep(0.18, 0.55, l);
      col = mix(vec3(0.95, 0.02, 0.06), vec3(0.0), v);
    }
    // manga burst lines around the centre
    float a2 = ang / 6.2831853 * 60.0 + uSeed * 60.0;
    float h2 = hash(floor(a2) + uImpact * 31.0);
    float ln = step(0.7, h2) * smoothstep(0.0, 0.2, fract(a2)) * (1.0 - smoothstep(0.35, 0.6, fract(a2)));
    float m2 = ln * smoothstep(0.15, 0.55, r);
    col = mix(col, uImpact < 2.5 && uImpact > 1.5 ? vec3(0.9, 0.0, 0.05) : vec3(0.0), m2 * 0.9);
    o = vec4(col, 1.0);
  }
  gl_FragColor = o;
}`;

const SEQ2 = [1, 3];
const SEQ3 = [1, 3, 2];

export class PostFx {
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: THREE.ShaderMaterial;
  private fb: THREE.FramebufferTexture | null = null;
  private fbW = 0; private fbH = 0;
  private size = new THREE.Vector2();
  private zero = new THREE.Vector2(0, 0);
  private time = 0;
  // state
  impactLeft = 0; private impactTotal = 0;
  private flash = new THREE.Vector4(1, 1, 1, 0);
  private flashDecay = 6;
  private lines = 0; private linesHold = 0; private linesDecay = 2.5;
  private lineCol = new THREE.Color(1, 1, 1);
  private vigBase = 0.34; private vigPulse = 0;
  private seed = 0;
  private letter = 0; private letterTarget = 0;
  private grade = new THREE.Vector4(0, 0, 0, 0);
  private gradeTarget = 0; private gradeHold = 0;
  reduce = false;
  /** settings toggles: individual post effects (bloom is reserved: no bloom pass exists yet) */
  allowImpact = true; allowLines = true; allowGrade = true; allowBloom = true;
  /** 0 low, 1 medium, 2 high */
  level = 2;
  private copyFailed = false;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uVig: { value: 0 },
        uFlash: { value: this.flash }, uLines: { value: 0 }, uLineCol: { value: this.lineCol },
        uSeed: { value: 0 }, uImpact: { value: 0 }, uHasScene: { value: 0 }, uScene: { value: null },
        uLetter: { value: 0 }, uGrade: { value: this.grade },
      },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.NormalBlending,
    });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    q.frustumCulled = false;
    this.scene.add(q);
  }

  // ---- triggers ----
  impact(frames: 2 | 3): void {
    if (this.reduce || !this.allowImpact) return;
    this.impactTotal = frames;
    this.impactLeft = frames;
    this.seed = Math.random();
  }
  screenFlash(hex: number, amount: number, decay = 6): void {
    if (this.reduce) amount = Math.min(amount, 0.14);
    if (amount < this.flash.w) return;
    this.flash.set(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, amount);
    this.flashDecay = decay;
  }
  speedLines(intensity: number, hold: number, hex = 0xffffff): void {
    if (!this.allowLines) return;
    if (this.level === 0) intensity *= 0.6;
    if (this.reduce) intensity *= 0.6;
    if (intensity < this.lines) return;
    this.lines = intensity; this.linesHold = hold;
    this.lineCol.setRGB(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
    this.seed = Math.random();
  }
  vignettePulse(a: number): void { this.vigPulse = Math.max(this.vigPulse, a); }
  /** cinematic letterbox bars, fraction of the screen height per bar (0 = off); eased */
  letterbox(target: number): void { this.letterTarget = target; }
  /** colour wash toward `hex` at `amount` (0..1), held for `hold` s then eased out */
  colorGrade(hex: number, amount: number, hold = 0.1): void {
    if (!this.allowGrade) return;
    this.grade.x = ((hex >> 16) & 255) / 255; this.grade.y = ((hex >> 8) & 255) / 255; this.grade.z = (hex & 255) / 255;
    this.gradeTarget = Math.max(0, Math.min(0.8, amount));
    this.gradeHold = hold;
  }

  update(dt: number): void {
    this.time += dt;
    if (this.flash.w > 0) this.flash.w = Math.max(0, this.flash.w - this.flash.w * this.flashDecay * dt - 0.02 * dt);
    if (this.linesHold > 0) this.linesHold -= dt;
    else this.lines = Math.max(0, this.lines - this.linesDecay * dt);
    this.vigPulse = Math.max(0, this.vigPulse - dt * 1.4);
    this.letter += (this.letterTarget - this.letter) * Math.min(1, dt * 6);
    if (Math.abs(this.letter - this.letterTarget) < 1e-4) this.letter = this.letterTarget;
    if (this.gradeHold > 0) this.gradeHold -= dt; else this.gradeTarget = 0;
    this.grade.w += (this.gradeTarget - this.grade.w) * Math.min(1, dt * 5);
    if (this.grade.w < 1e-3 && this.gradeTarget === 0) this.grade.w = 0;
  }
  clear(): void {
    this.impactLeft = 0; this.flash.w = 0; this.lines = 0; this.linesHold = 0; this.vigPulse = 0;
    this.letter = this.letterTarget = 0; this.grade.w = 0; this.gradeTarget = 0;
  }

  /** the post pass body; called by the renderer after the scene is drawn */
  render(r: THREE.WebGLRenderer): void {
    const vig = this.level === 0 ? 0 : this.vigBase + this.vigPulse * 0.5;
    const impact = this.impactLeft > 0;
    if (!impact && this.flash.w < 0.004 && this.lines < 0.01 && vig < 0.01 && this.letter < 0.001 && this.grade.w < 0.002) return;
    r.getDrawingBufferSize(this.size);
    const u = this.mat.uniforms;
    (u.uRes!.value as THREE.Vector2).copy(this.size);
    u.uTime!.value = this.time;
    u.uVig!.value = vig;
    u.uLines!.value = this.lines;
    u.uSeed!.value = this.seed;
    u.uLetter!.value = this.letter;
    let phase = 0;
    u.uHasScene!.value = 0;
    if (impact) {
      const seq = this.impactTotal === 2 ? SEQ2 : SEQ3;
      phase = seq[this.impactTotal - this.impactLeft]!;
      if (!this.copyFailed) {
        const w = this.size.x | 0, h = this.size.y | 0;
        if (!this.fb || this.fbW !== w || this.fbH !== h) {
          this.fb?.dispose();
          this.fb = new THREE.FramebufferTexture(w, h);
          this.fbW = w; this.fbH = h;
        }
        try {
          r.copyFramebufferToTexture(this.fb, this.zero);
          u.uScene!.value = this.fb;
          u.uHasScene!.value = 1;
        } catch {
          this.copyFailed = true;
        }
      }
      this.impactLeft--;
    }
    u.uImpact!.value = phase;
    const ac = r.autoClear, ar = r.info.autoReset;
    r.autoClear = false;
    r.info.autoReset = false; // keep the main pass' draw-call stats intact
    r.render(this.scene, this.cam);
    r.autoClear = ac;
    r.info.autoReset = ar;
  }
  dispose(): void {
    this.fb?.dispose();
    this.mat.dispose();
  }
}
