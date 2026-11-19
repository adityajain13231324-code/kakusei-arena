// Packs dist/ into dist-artifact/ for hosts that can't serve .glb (claude.ai artifact pages):
// drops preview renders + docs, and replaces each .glb with <name>.glb.json = {"b64": "..."}.
// The renderer's loadGLB() falls back to the .json automatically. Usage: npm run build && node tools/pack-artifact.mjs
import fs from 'node:fs';
import path from 'node:path';
const src = 'dist', out = 'dist-artifact';
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });
fs.rmSync(path.join(out, 'characters/previews'), { recursive: true, force: true });
fs.rmSync(path.join(out, 'props'), { recursive: true, force: true });
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
for (const f of walk(out)) {
  if (f.endsWith('.glb')) {
    fs.writeFileSync(f + '.json', JSON.stringify({ b64: fs.readFileSync(f).toString('base64') }));
    fs.rmSync(f);
  } else if (f.endsWith('.md') || f.endsWith('browser-check.json')) fs.rmSync(f);
}
console.log(walk(out).map((f) => path.relative(out, f)).join('\n'));
