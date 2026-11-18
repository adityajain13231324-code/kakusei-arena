// Optional three.js integration. No game source files are changed by this asset pack.
import * as THREE from 'three';

/** Configure one loaded fighter. All texture URLs stay local to your game. */
export async function configureFighter(root, name, {resolution=2048, baseURL='/characters/'}={}) {
  const loader=new THREE.TextureLoader();
  const suffix=resolution===1024?'_1024':'';
  const [normal,awakened]=await Promise.all(['tex','tex_awakened'].map(async file=>{
    const t=await loader.loadAsync(`${baseURL}${name}/${file}${suffix}.png`);
    t.flipY=false;t.colorSpace=THREE.SRGBColorSpace;
    t.magFilter=THREE.NearestFilter;t.minFilter=THREE.LinearMipmapLinearFilter;
    return t;
  }));
  const gradient=new THREE.DataTexture(new Uint8Array([70,155,255]),3,1,THREE.RedFormat);
  gradient.minFilter=gradient.magFilter=THREE.NearestFilter;gradient.generateMipmaps=false;gradient.needsUpdate=true;
  // Separate tiny emission mask avoids illuminating the whole body.
  // glTF V coordinates are the inverse of Blender's atlas coordinates.
  const maskBytes=new Uint8Array(8*8*4);
  const glowCells=name==='kaito'?[3,4,8]:name==='ren'?[7,8,9,10]:[];
  for(const cell of glowCells){const i=((7-Math.floor(cell/8))*8+cell%8)*4;maskBytes.set([255,255,255,255],i);}
  const mask=new THREE.DataTexture(maskBytes,8,8);mask.magFilter=mask.minFilter=THREE.NearestFilter;mask.needsUpdate=true;
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
      toon.emissive.set(isAwakened?(name==='kaito'?'#ff8b28':name==='ren'?'#a8eaff':'#000000'):'#000000');
      toon.emissiveIntensity=isAwakened?.8:0;
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
