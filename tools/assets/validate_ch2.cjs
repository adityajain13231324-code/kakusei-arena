const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {check,parse,values}=require('./validate_assets.cjs');
const root=path.resolve(__dirname,'../..');
(async()=>{
 for(const id of process.argv.slice(2)){
  const folder=path.join(root,'public/characters',id),manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json')));
  assert.equal(manifest.version,2);assert.ok(manifest.triangles>=15000&&manifest.triangles<=25000);
  const report=[];
  for(const name of ['model.glb','model_1024.glb',...(id==='kitsu'?['awakened_tails.glb']:[])]){
   const r=await check(path.join(folder,name),id==='kitsu'?'fox':true);report.push(r);
   assert.equal(r.errors,0);assert.equal(r.warnings,0);assert.equal(r.materials,1);
   if(name.startsWith('model'))assert.equal(r.triangles,manifest.triangles);
  }
  const base=parse(path.join(folder,'model.glb')),mobile=parse(path.join(folder,'model_1024.glb'));
  assert.ok(base.json.skins[0].joints.length<=65);
  for(let i=0;i<base.json.meshes.length;i++)for(const attr of ['POSITION','TEXCOORD_0','JOINTS_0','WEIGHTS_0']){
   assert.deepEqual(values(base,base.json.meshes[i].primitives[0].attributes[attr]),values(mobile,mobile.json.meshes[i].primitives[0].attributes[attr]));
  }
  for(const size of [2048,1024])for(const awakened of [false,true]){
   const file=path.join(folder,`tex${awakened?'_awakened':''}${size===1024?'_1024':''}.png`),b=fs.readFileSync(file);
   assert.equal(b.readUInt32BE(16),size);assert.equal(b.readUInt32BE(20),size);
  }
  assert.deepEqual(manifest.expressions.panels,['neutral','shout','pain','determined']);
  const face=base.json.meshes.find(m=>m.name==='Face_Expressions');assert.ok(face);
  const uv=values(base,face.primitives[0].attributes.TEXCOORD_0);assert.ok(uv.every(([u,v])=>u>=0&&u<=.25&&v>=0&&v<=.25));
  fs.writeFileSync(path.join(folder,'validation.json'),JSON.stringify({checks:['triangle budget','Khronos validator','normalized weights','bone names','mobile geometry/UV/skin equality','atlas dimensions','expression strip UV bounds'],files:report},null,2)+'\n');
  console.log(id,manifest.triangles,base.json.skins[0].joints.length+' bones', 'PASS');
 }
})().catch(e=>{console.error(e);process.exit(1)});
