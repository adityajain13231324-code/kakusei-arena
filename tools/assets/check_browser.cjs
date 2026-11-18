const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..');
const server=http.createServer((req,res)=>{
  const url=decodeURIComponent(req.url.split('?')[0]);
  if(url==='/favicon.ico'){res.writeHead(204);res.end();return}
  const file=url.startsWith('/vendor/')?path.join(path.dirname(require.resolve('three')),'..',url.slice(14)):url.startsWith('/characters/')?path.join(root,'public',url):path.join(root,url==='/'?'tools/assets/preview.html':url);
  if(!fs.existsSync(file)){res.writeHead(404);res.end();return}
  const mime={'.js':'text/javascript','.html':'text/html','.png':'image/png','.glb':'model/gltf-binary'}[path.extname(file)];res.setHeader('Content-Type',mime||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
(async()=>{
 await new Promise(r=>server.listen(5197,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1000,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.goto('http://127.0.0.1:5197/');
 const reports=[];
 for(const name of ['kaito','shiori','ren','goro']){
  if(name!=='kaito')await page.selectOption('#fighter',name);
  await page.waitForFunction(()=>window.assetReady,{},{timeout:60000});
  await page.screenshot({path:path.join(root,`public/characters/previews/${name}_three_normal.png`)});
  await page.click('#awake');await page.waitForTimeout(500);
  await page.screenshot({path:path.join(root,`public/characters/previews/${name}_three_awakened.png`)});
  const stats=await page.evaluate(()=>{const r=window.assetApp.renderer;const meshes=[];window.assetApp.root.traverse(o=>{if(o.isMesh)meshes.push({name:o.name,visible:o.visible,skinned:!!o.isSkinnedMesh})});return {render:r.info.render,meshes}});
  reports.push({name,...stats});
  await page.click('#pose');await page.waitForTimeout(500);await page.screenshot({path:path.join(root,`public/characters/previews/${name}_three_pose.png`)});
 }
 await browser.close();server.close();
 fs.writeFileSync(path.join(root,'public/characters/browser-check.json'),JSON.stringify({errors,reports},null,2));
 console.log(JSON.stringify({errors,reports},null,2));if(errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);server.close();process.exit(1)});
