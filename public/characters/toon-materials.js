// Optional three.js integration. No game source files are changed by this asset pack.
import * as THREE from 'three';

/** Configure one loaded fighter. All texture URLs stay local to your game. */
export async function configureFighter(root, name, {resolution=2048, baseURL='/characters/'}={}) {
  const loader=new THREE.TextureLoader();
  const suffix=resolution===1024?'_1024':'';
  const load=async file=>{
    const t=await loader.loadAsync(`${baseURL}${name}/${file}`);
    t.flipY=false;t.colorSpace=THREE.SRGBColorSpace;
    t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.anisotropy=4;
    return t;
  };
  const [normal,awakened]=await Promise.all([`tex${suffix}.png`,`tex_awakened${suffix}.png`].map(load));
  // v2 atlases are painted (cel shadow shapes baked in), so a soft 2-step ramp reads best.
  const gradient=new THREE.DataTexture(new Uint8Array([150,255]),2,1,THREE.RedFormat);
  gradient.minFilter=gradient.magFilter=THREE.NearestFilter;gradient.generateMipmaps=false;gradient.needsUpdate=true;
  // Emission mask (white = glows when awakened): hair tips, ember marks, Ren's eyes and blade, etc.
  const mask=await loader.loadAsync(`${baseURL}${name}/tex_glow.png`);
  mask.flipY=false;mask.colorSpace=THREE.NoColorSpace;
  const toon=new THREE.MeshToonMaterial({map:normal,gradientMap:gradient,emissiveMap:mask});
  const outlineMaterial=new THREE.ShaderMaterial({
    side:THREE.BackSide,
    uniforms:{outlineColor:{value:new THREE.Color('#101522')},thickness:{value:.003}},
    vertexShader:`
      #include <common>
      #include <skinning_pars_vertex>
      uniform float thickness;
      void main(){
        #include <beginnormal_vertex>
        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        transformed += normalize(objectNormal) * thickness;
        gl_Position=projectionMatrix * modelViewMatrix * vec4(transformed,1.0);
      }`,
    fragmentShader:`uniform vec3 outlineColor;void main(){gl_FragColor=vec4(outlineColor,1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`
  });
  const outlines=[],meshes=[];
  root.traverse(o=>{if(o.isMesh)meshes.push(o)});
  function style(mesh){
    mesh.material=toon;
    const outline=mesh.isSkinnedMesh?new THREE.SkinnedMesh(mesh.geometry,outlineMaterial):new THREE.Mesh(mesh.geometry,outlineMaterial);
    outline.name=mesh.name+'_Outline';outline.position.copy(mesh.position);outline.quaternion.copy(mesh.quaternion);outline.scale.copy(mesh.scale);
    if(mesh.isSkinnedMesh){outline.bindMode=mesh.bindMode;outline.bind(mesh.skeleton,mesh.bindMatrix);outline.bindMatrixInverse.copy(mesh.bindMatrixInverse)}
    outline.frustumCulled=false;mesh.parent.add(outline);outlines.push(outline);
    return outline;
  }
  meshes.forEach(style);
  let isAwakened=false;
  const platePairs=[];
  return {
    setAwakened(value){
      isAwakened=Boolean(value);toon.map=isAwakened?awakened:normal;
      toon.emissive.set(isAwakened?({kaito:'#ff9a3a',ren:'#a8eaff',shiori:'#e8e4ff',goro:'#ffb65a'}[name]||'#ffffff'):'#000000');
      toon.emissiveIntensity=isAwakened?.9:0;
      outlineMaterial.uniforms.outlineColor.value.set(name==='shiori'&&isAwakened?'#ffffff':'#101522');
      outlineMaterial.uniforms.thickness.value=name==='shiori'&&isAwakened?.004:.003;
      for(const [mesh,line]of platePairs)mesh.visible=line.visible=isAwakened;
    },
    /** Call with GLTFLoader's shoulder_plates.glb scene after loading Goro. */
    attachShoulderPlates(plateRoot){
      root.updateMatrixWorld(true);plateRoot.updateMatrixWorld(true);
      const bones=new Map();root.traverse(o=>{if(o.isBone)bones.set(o.name,o)});
      const plates=[];plateRoot.traverse(o=>{if(o.isSkinnedMesh)plates.push(o)});
      for(const mesh of plates){
        const joints=mesh.skeleton.bones.map(b=>{const target=bones.get(b.name);if(!target)throw Error(`Missing bone ${b.name}`);return target});
        const bindMatrix=mesh.bindMatrix.clone();
        const transform=plateRoot.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
        mesh.removeFromParent();root.add(mesh);
        transform.decompose(mesh.position,mesh.quaternion,mesh.scale);
        mesh.bind(new THREE.Skeleton(joints,mesh.skeleton.boneInverses),bindMatrix);
        const line=style(mesh);mesh.visible=line.visible=isAwakened;platePairs.push([mesh,line]);
      }
    },
    dispose(){
      outlines.forEach(o=>o.removeFromParent());platePairs.forEach(([o])=>o.removeFromParent());
      toon.dispose();outlineMaterial.dispose();normal.dispose();awakened.dispose();gradient.dispose();mask.dispose();
    }
  };
}
