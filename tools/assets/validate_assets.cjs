// npm install --prefix <scratch-dir> gltf-validator
// NODE_PATH=<scratch-dir>/node_modules node tools/assets/validate_assets.cjs
const fs = require('node:fs');
const path = require('node:path');
const validator = require('gltf-validator');
const root = path.resolve(__dirname, '../..');
const required = ['Hips','Spine','Spine1','Spine2','Neck','Head', ...['Left','Right'].flatMap(s => ['Shoulder','Arm','ForeArm','Hand','UpLeg','Leg','Foot','ToeBase'].map(n=>s+n))];
function parse(file) {
  const b=fs.readFileSync(file);
  if(b.toString('ascii',0,4)!=='glTF') throw Error('Not GLB');
  const len=b.readUInt32LE(12), json=JSON.parse(b.toString('utf8',20,20+len));
  return {b,json,bin:b.subarray(28+len)};
}
function values(g,index) {
  const a=g.json.accessors[index], v=g.json.bufferViews[a.bufferView];
  const count={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type];
  const bytes={5121:1,5123:2,5125:4,5126:4}[a.componentType];
  const read={5121:'readUInt8',5123:'readUInt16LE',5125:'readUInt32LE',5126:'readFloatLE'}[a.componentType];
  const result=[];
  for(let i=0;i<a.count;i++) {
    const row=[];
    for(let j=0;j<count;j++) row.push(g.bin[read]((v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||count*bytes)+j*bytes));
    result.push(row);
  }
  return result;
}
async function check(file,character) {
  const g=parse(file),j=g.json;
  const result=await validator.validateBytes(new Uint8Array(g.b),{uri:path.basename(file),maxIssues:1000});
  if(result.issues.numErrors) throw Error(file+': '+JSON.stringify(result.issues));
  let triangles=0, vertices=0, blended=0;
  for(const mesh of j.meshes||[]) for(const p of mesh.primitives) {
    triangles+=(p.indices!==undefined?j.accessors[p.indices].count:j.accessors[p.attributes.POSITION].count)/3;
    vertices+=j.accessors[p.attributes.POSITION].count;
    if(character) {
      if(p.attributes.JOINTS_0===undefined||p.attributes.WEIGHTS_0===undefined) throw Error('Unskinned mesh');
      const weights=values(g,p.attributes.WEIGHTS_0);
      for(const w of weights) {
        if(Math.abs(w.reduce((a,b)=>a+b,0)-1)>.0001)throw Error('Bad weights');
        if(w.filter(x=>x>.01).length>1)blended++;
      }
    }
  }
  if(triangles>(character?25000:5000)) throw Error('Triangle budget exceeded');
  if(j.materials.length>3)throw Error('Material budget exceeded');
  if(j.animations?.length)throw Error('Unexpected animation');
  if(character) {
    for(const name of required)if(!j.nodes.some(n=>n.name===name))throw Error('Missing bone '+name);
    if(j.images.length!==1)throw Error('Expected one atlas');
  }
  const images=(j.images||[]).map(img=>{
    const v=j.bufferViews[img.bufferView],b=g.bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);
    const width=b.readUInt32BE(16),height=b.readUInt32BE(20);
    if(width>2048||height>2048)throw Error('Oversize texture');
    if(file.includes('_1024')&&(width!==1024||height!==1024))throw Error('Wrong mobile atlas size');
    return {width,height};
  });
  return {file:path.relative(root,file).replaceAll('\\','/'),triangles,vertices,blended_vertices:blended,materials:j.materials.length,images,errors:result.issues.numErrors,warnings:result.issues.numWarnings,messages:result.issues.messages};
}
(async()=>{
  const results=[];
  for(const name of ['kaito','shiori','ren','goro']) {
    for(const file of ['model.glb','model_1024.glb',...(name==='goro'?['shoulder_plates.glb']:[])]) results.push(await check(path.join(root,'public/characters',name,file),true));
  }
  for(const file of fs.readdirSync(path.join(root,'public/props')).filter(f=>f.endsWith('.glb')))results.push(await check(path.join(root,'public/props',file),false));
  fs.writeFileSync(path.join(root,'public/characters/validation.json'),JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify(results.map(({messages,...r})=>r),null,2));
})().catch(e=>{console.error(e);process.exit(1)});
