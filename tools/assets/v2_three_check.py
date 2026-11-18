"""three.js check with Python Playwright + Chrome (SwiftShader). Serves the repo, loads
tools/assets/preview.html, captures normal / awakened / stress poses / face expressions.
python3 tools/assets/v2_three_check.py kaito [shiori ...] [--sheet-only]
Writes public/characters/previews/<k>_three_*.png and /tmp/three_<k>.png (contact sheet)."""
import sys, json, threading, http.server, socketserver, functools
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
PRE = ROOT / 'public/characters/previews'
THREE = ROOT / 'node_modules/three'


class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        path = path.split('?')[0]
        if path.startswith('/vendor/three/'):
            return str(THREE / path[len('/vendor/three/'):])
        if path.startswith('/characters/'):
            return str(ROOT / 'public' / path[1:])
        if path in ('/', '/index.html'):
            return str(ROOT / 'tools/assets/preview.html')
        return str(ROOT / path[1:])

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


H.extensions_map.update({'.js': 'text/javascript', '.glb': 'model/gltf-binary'})


def main():
    kinds = [a for a in sys.argv[1:] if not a.startswith('--')] or ['kaito', 'shiori', 'ren', 'goro']
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 5199), H)
    pass
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    report = {}
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True,
                              args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        pg = b.new_page(viewport={'width': 560, 'height': 860})
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and '404' not in m.text else None)
        for k in kinds:
            pg.goto(f'http://127.0.0.1:5199/?bare=1&fighter={k}')
            pg.wait_for_function('window.assetReady===true', timeout=120000)
            shots = []

            def snap(name, **o):
                pg.evaluate('o=>window.assetApp.set(o)', o)
                pg.wait_for_timeout(350)
                path = PRE / f'{k}_three_{name}.png'
                pg.screenshot(path=str(path))
                shots.append(path)
            snap('normal', view=0, zoom=False, awake=False, expr='neutral', pose='rest')
            snap('q', view=1)
            snap('side', view=2)
            snap('back', view=4)
            snap('awakened', view=1, awake=True)
            snap('pose', view=1, awake=False, pose='punch')
            snap('kick', view=2, pose='kick')
            snap('crouch', view=1, pose='crouch')
            for ex in ['neutral', 'shout', 'pain', 'determined']:
                snap('face_' + ex, view=0, zoom=True, pose='rest', expr=ex)
            snap('face_awakened', view=1, zoom=True, awake=True, expr='neutral')
            info = pg.evaluate('''()=>{const r=window.assetApp.renderer.info.render;const m=[];window.assetApp.root.traverse(o=>{if(o.isMesh)m.push(o.name)});return {calls:r.calls,triangles:r.triangles,meshes:m}}''')
            report[k] = info
            ims = [Image.open(s).convert('RGB') for s in shots]
            ims = [i.resize((i.width * 300 // i.height, 300)) for i in ims]
            sheet = Image.new('RGB', (sum(i.width for i in ims[:7]), 600), (20, 24, 36))
            x = 0
            for i in ims[:7]:
                sheet.paste(i, (x, 0)); x += i.width
            x = 0
            for i in ims[7:]:
                sheet.paste(i, (x, 300)); x += i.width
            sheet.save(f'/tmp/three_{k}.png')
            print('SHEET', f'/tmp/three_{k}.png', info)
        b.close()
    srv.shutdown()
    out = ROOT / 'public/characters/browser-check.json'
    prev = json.loads(out.read_text()) if out.exists() else {}
    if not isinstance(prev, dict) or 'reports' in prev:
        prev = {}
    prev.update({k: v for k, v in report.items()})
    prev['errors'] = errors
    out.write_text(json.dumps(prev, indent=2))
    print('ERRORS', errors)


if __name__ == '__main__':
    main()
