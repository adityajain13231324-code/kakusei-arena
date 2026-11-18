/** TRAINING VOID — shader grid floor, soft gradient void, faint wall planes. */
import * as THREE from 'three';
import { skyDome, disposeGroup, type StageBuild } from './common';

export function buildTraining(half: number): StageBuild {
  const group = new THREE.Group();
  group.name = 'stage-training';
  const floorMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uHalf: { value: half } }]),
    fog: true,
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      varying vec3 vWP;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWP = worldPosition.xyz;
        vec4 mvPosition = viewMatrix * worldPosition;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <fog_pars_fragment>
      uniform float uHalf;
      varying vec3 vWP;
      float gridLine(vec2 p, float w) {
        vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
        return 1.0 - min(min(g.x, g.y) / w, 1.0);
      }
      void main() {
        vec3 base = vec3(0.07, 0.08, 0.16);
        float minor = gridLine(vWP.xz * 2.0, 1.0) * 0.35;
        float major = gridLine(vWP.xz, 1.4);
        float inside = step(abs(vWP.x), uHalf) * step(abs(vWP.z), uHalf);
        vec3 col = base + vec3(0.18, 0.32, 0.6) * (minor * 0.5 + major) * (0.35 + 0.65 * inside);
        // arena border
        float edge = max(abs(vWP.x), abs(vWP.z));
        col += vec3(0.2, 0.9, 1.0) * smoothstep(0.06, 0.0, abs(edge - uHalf)) * 1.2;
        // centre cross
        col += vec3(1.0, 0.3, 0.5) * (smoothstep(0.03, 0.0, abs(vWP.x)) + smoothstep(0.03, 0.0, abs(vWP.z))) * step(edge, 0.6) * 0.8;
        float fade = smoothstep(60.0, 8.0, length(vWP.xz));
        col = mix(vec3(0.03, 0.035, 0.07), col, fade);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), floorMat);
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);
  const shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ color: '#000010', opacity: 0.55 }));
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.y = 0.002;
  shadowCatcher.receiveShadow = true;
  group.add(shadowCatcher);
  // wall planes (faint additive grids)
  const wallMat = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: `varying vec2 vUv; varying vec3 vWP; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vWP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv; varying vec3 vWP;
      void main() {
        vec2 p = vec2(vWP.x + vWP.z, vWP.y) * 2.0;
        vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
        float l = 1.0 - min(min(g.x, g.y), 1.0);
        float a = (l * 0.35 + 0.05) * (1.0 - vUv.y) + smoothstep(0.03, 0.0, vUv.y) * 0.6;
        gl_FragColor = vec4(vec3(0.35, 0.75, 1.0) * a, 1.0);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const wh = 2.6;
  for (const [x, z, ry] of [[0, half, 0], [0, -half, 0], [half, 0, Math.PI / 2], [-half, 0, Math.PI / 2]] as Array<[number, number, number]>) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, wh), wallMat);
    w.position.set(x, wh / 2, z);
    w.rotation.y = ry;
    group.add(w);
  }
  const sky = skyDome([[0, '#1a2244'], [0.2, '#121833'], [0.6, '#0a0d1e'], [1, '#05060c']]);
  group.add(sky);
  return {
    group,
    update() { /* static */ },
    fog: new THREE.Fog('#0b0f22', 25, 90),
    background: new THREE.Color('#05060c'),
    sunDir: new THREE.Vector3(0.4, 0.8, 0.45).normalize(),
    sunColor: new THREE.Color('#ffffff'),
    sunIntensity: 2.4,
    hemiSky: new THREE.Color('#b8c8ff'),
    hemiGround: new THREE.Color('#2a2a44'),
    hemiIntensity: 1.3,
    shadowTint: new THREE.Color('#6a6aa8'),
    rim: new THREE.Color('#9fe0ff'),
    dispose() { disposeGroup(group); },
  };
}
