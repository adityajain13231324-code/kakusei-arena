// NODE_PATH=<scratch node_modules> node tools/assets/check_ch2.cjs mika lyra ...
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),pre=path.join(root,'public/characters/previews');
const kinds=process.argv.slice(2);if(!kinds.length)throw Error('Pass fighter ids');
const server=http.createServer((req,res)=>{
 const url=decodeURIComponent(req.url.split('?')[0]);
 if(url==='/favicon.ico'){res.writeHead(204);res.end();return}
 const file=url.startsWith('/vendor/three/')?path.join(root,'node_modules/three',url.slice(14)):
   url.startsWith('/characters/')?path.join(root,'public',url):path.join(root,url==='/'?'tools/assets/preview.html':url);
 if(!fs.existsSync(file)){res.writeHead(404);res.end();return}
 res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.png':'image/png','.glb':'model/gltf-binary'})[path.extname(file)]||'application/octet-stream');
 fs.createReadStream(file).pipe(res);
});
(async()=>{
 await new Promise(r=>server.listen(5198,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const pg=await browser.newPage({viewport:{width:600,height:900}});let errors=[];
 pg.on('pageerror',e=>errors.push(e.message));pg.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 for(const name of kinds){
  await pg.setViewportSize(name==='kitsu'?{width:1000,height:800}:{width:600,height:900});
  errors=[];await pg.goto(`http://127.0.0.1:5198/?bare=1&fighter=${name}`);
  await pg.waitForFunction(()=>window.assetReady===true,{},{timeout:120000});
  const shots={front:{view:0},side:{view:2},back:{view:4},three:{view:1},awakened:{view:1,awake:true},
    punch:{view:1,awake:false,pose:'punch'},kick:{view:2,pose:'kick'},crouch:{view:1,pose:'crouch'},
    face_neutral:{view:0,zoom:true,pose:'rest',expr:'neutral'},face_shout:{expr:'shout'},face_pain:{expr:'pain'},face_determined:{expr:'determined'},face_awakened:{expr:'neutral',awake:true}};
  for(const [label,opts]of Object.entries(shots)){
   await pg.evaluate(o=>window.assetApp.set(o),opts);await pg.waitForTimeout(250);
   await pg.screenshot({path:path.join(pre,`${name}_three_${label}.png`)});
  }
  const stats=await pg.evaluate(()=>({calls:window.assetApp.renderer.info.render.calls,triangles:window.assetApp.renderer.info.render.triangles}));
  fs.writeFileSync(path.join(root,`public/characters/${name}/browser-check.json`),JSON.stringify({errors,...stats,checks:Object.keys(shots)},null,2)+'\n');
  if(errors.length)throw Error(JSON.stringify(errors));console.log(name,stats);
 }
 await browser.close();server.close();
})().catch(e=>{console.error(e);server.close();process.exit(1)});
