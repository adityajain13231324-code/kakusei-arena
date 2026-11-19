"""
Two-browser online e2e test (Playwright, python).
  npx vite --port 5186 --strictPort &   then   python3 tests/e2e_online.py [base_url] [query]
Uses the BroadcastChannel transport (?net=local) so it needs no internet: two pages in one
browser context play a full online match through the real UI (create room -> join link ->
ready -> start -> rollback match -> results -> rematch). Optional query adds network simulation,
e.g. "lag=40&jitter=15&loss=0.03".
"""
import sys, json, time
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:5186/'
EXTRA = sys.argv[2] if len(sys.argv) > 2 else 'lag=40&jitter=15&loss=0.03&rounds=1'
SHOTS = sys.argv[3] if len(sys.argv) > 3 else ''
# software-rendering two WebGL pages runs at ~1 fps in this sandbox, so by default WebGL is disabled
# (the app falls back to no renderer; sim, netcode and UI run normally). Set E2E_WEBGL=1 to keep it.
import os
GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] if os.environ.get('E2E_WEBGL') else ['--disable-3d-apis']
Q = '?net=local' + ('&' + EXTRA if EXTRA else '')

fails = 0
def check(name, ok, detail=''):
    global fails
    print(('  ok   ' if ok else '  FAIL ') + name + (f'  ({detail})' if detail else ''))
    if not ok: fails += 1

# deterministic random held inputs, installed in each page (drives NetSession.readLocal -> input.read(0))
INPUT_JS = """(seed) => {
  let s = seed | 0 || 1, cur = 0, hold = 0;
  const r = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0); };
  const orig = window.__app.input.read.bind(window.__app.input);
  window.__app.input.read = (slot) => {
    if (slot !== 0 || window.__app.ui.top() !== 'hud') return orig(slot);
    if (hold-- <= 0) {
      hold = r() % 10; let v = 0; const d = r() % 10;
      if (d < 4) v |= 8; else if (d < 6) v |= 4;          // right / left
      if (r() % 9 === 0) v |= 2;                           // down
      const b = r() % 9; if (b < 5) v |= [16, 32, 64, 128, 16|64][b];
      cur = v;
    }
    return cur;
  };
}"""

STATE_JS = """() => {
  const a = window.__app, s = a.session, o = a.online;
  const rb = s && s.rb;
  return { top: a.ui.top(), phase: o.phase, frame: rb ? rb.curFrame : -1, conf: rb ? rb.confirmedFrame : -1,
    started: !!(s && s.started), simMs: s ? s.simMs : 0, stats: rb ? rb.stats : null, rtt: rb ? rb.rtt : o.rtt, delay: rb ? rb.delay : 0,
    hashes: rb ? Object.fromEntries([...rb.localHashes.entries()]) : {}, round: s ? s.state.round : null,
    wins: s ? s.state.fighters.map(f => f.wins) : null, kind: o.transportKind };
}"""

def wait_for(pg, js, timeout=20.0):
    t = time.time()
    while time.time() - t < timeout:
        if pg.evaluate(js): return True
        pg.wait_for_timeout(100)
    return False

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=GL_ARGS + ['--autoplay-policy=no-user-gesture-required', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'])
    ctx = b.new_context(viewport={'width': 1280, 'height': 720})
    logs = []
    host = ctx.new_page(); guest = ctx.new_page()
    for name, pg in (('host', host), ('guest', guest)):
        pg.on('pageerror', lambda e, n=name: logs.append(f'{n} PAGEERROR: {e}'))
        pg.on('console', lambda m, n=name: logs.append(f'{n} {m.type}: {m.text}') if m.type in ('error', 'warning') else None)

    print('== host creates a room through the UI')
    host.goto(BASE + Q); host.wait_for_function("() => window.__app && window.__app.ui.top() === 'title'"); host.wait_for_timeout(800)
    host.mouse.click(640, 360); host.wait_for_function("() => window.__app.ui.top() === 'menu'"); host.wait_for_timeout(500)   # title -> menu
    host.locator('.scr-menu .mbtn', has_text='ONLINE').click(); host.wait_for_function("() => window.__app.ui.top() === 'online'"); host.wait_for_timeout(400)
    host.get_by_text('CREATE ROOM', exact=True).click()
    ok = wait_for(host, "() => window.__app.online.phase === 'waiting' && window.__app.online.code.length === 6", 10)
    code = host.evaluate("() => window.__app.online.code")
    link = host.evaluate("() => document.querySelector('.on-link').value")
    check('room created with 6-char code + share link', ok and link.endswith('#join-' + code), f'{code} {link}')
    if SHOTS: host.screenshot(path=SHOTS + '/net-lobby-host-waiting.png')

    print('== guest opens the share link')
    guest.goto(link); guest.wait_for_timeout(500)
    ok = wait_for(guest, "() => window.__app.online.phase === 'lobby' && !!window.__app.online.them", 10) and \
         wait_for(host, "() => window.__app.online.phase === 'lobby' && !!window.__app.online.them", 10)
    check('guest joined via #join link, both in lobby', ok, guest.evaluate("() => window.__app.ui.top()"))

    # picks: host Ren, guest Goro, host stage shrine
    host.locator('.on-card-c').nth(2).click(); guest.locator('.on-card-c').nth(3).click()
    host.locator('.on-stage', has_text='SAKURA SHRINE').click()
    host.wait_for_timeout(300)
    check('opponent picks are visible', wait_for(host, "() => window.__app.online.them.char === 'goro'", 5) and wait_for(guest, "() => window.__app.online.them.char === 'ren' && window.__app.online.stage === 'shrine'", 5))
    guest.locator('.on-btn.ready').click(); host.locator('.on-btn.ready').click()
    ok = wait_for(host, "() => window.__app.online.canStart", 5)
    check('host can start once both are ready', ok)
    if SHOTS: guest.screenshot(path=SHOTS + '/net-lobby-guest-ready.png'); host.screenshot(path=SHOTS + '/net-lobby-host-ready.png')
    host.locator('.on-btn.start').click()

    print('== match')
    ok = wait_for(host, "() => window.__app.session && window.__app.session.started", 15) and wait_for(guest, "() => window.__app.session && window.__app.session.started", 15)
    check('both sessions started after VS screen', ok)
    host.evaluate(INPUT_JS, 1234); guest.evaluate(INPUT_JS, 777)
    host.wait_for_timeout(12000)
    a = host.evaluate(STATE_JS); g = guest.evaluate(STATE_JS)
    check('frames advancing on both peers', a['frame'] > 150 and g['frame'] > 150, f"host f{a['frame']} guest f{g['frame']} in 12 s (headless sandbox runs ~15-25 rAF/s), tick cost {a['simMs']:.2f}/{g['simMs']:.2f} ms, stalls {a['stats']['stallTicks']}/{g['stats']['stallTicks']}, transport {a['kind']}")
    common = [k for k in a['hashes'] if k in g['hashes']]
    mism = [k for k in common if a['hashes'][k] != g['hashes'][k]]
    check('confirmed-state hashes match between browsers', len(common) >= 3 and not mism, f'{len(common)} compared, {len(mism)} mismatched')
    check('rollbacks occur, no desync', (a['stats']['rollbacks'] + g['stats']['rollbacks']) > 0 and a['stats']['desyncs'] == 0 and g['stats']['desyncs'] == 0,
          f"rb {a['stats']['rollbacks']}/{g['stats']['rollbacks']} max {a['stats']['maxRollback']}/{g['stats']['maxRollback']}f rtt {a['rtt']:.0f}ms delay {a['delay']}")
    check('ping display shown', wait_for(host, "() => /ms/.test(document.querySelector('.netov-ping').textContent) && document.querySelector('.netov').classList.contains('on')", 3))
    if SHOTS: host.screenshot(path=SHOTS + '/net-match-host.png'); guest.screenshot(path=SHOTS + '/net-match-guest.png')

    print('== play to the end (up to ~4 min)')
    ok = wait_for(host, "() => window.__app.online.phase === 'results'", 260) and wait_for(guest, "() => window.__app.online.phase === 'results'", 20)
    a = host.evaluate(STATE_JS); g = guest.evaluate(STATE_JS)
    common = [k for k in a['hashes'] if k in g['hashes']]
    mism = [k for k in common if a['hashes'][k] != g['hashes'][k]]
    check('both reach results with the same winner', ok and a['wins'] == g['wins'], f"wins {a['wins']} / {g['wins']}, frame {a['frame']}")
    check('no desync over the whole match', not mism and a['stats']['desyncs'] == 0, f'{len(common)} hashes compared')
    if SHOTS: host.screenshot(path=SHOTS + '/net-results.png')

    print('== rematch')
    host.get_by_text('REMATCH', exact=True).click(); guest.get_by_text('REMATCH', exact=True).click()
    ok = wait_for(host, "() => window.__app.session && window.__app.session.started && window.__app.session.rb.curFrame > 60", 20) and \
         wait_for(guest, "() => window.__app.session && window.__app.session.started && window.__app.session.rb.curFrame > 60", 20)
    check('rematch started on both', ok)

    print('== leave')
    guest.evaluate("() => window.__app.goMenu()")
    ok = wait_for(host, "() => window.__app.online.phase === 'idle' && window.__app.ui.top() === 'online'", 10)
    check('host notified when guest leaves, back to online menu', ok, host.evaluate("() => window.__app.ui.top()"))

    errs = [l for l in logs if ('PAGEERROR' in l or ' error:' in l) and 'WebGL' not in l]
    check('no page errors', not errs, '; '.join(errs[:5]))
    for l in logs[-15:]: print('   ', l)
    b.close()

print(f"\n{'PASS' if not fails else 'FAIL'} ({fails} failures)")
sys.exit(1 if fails else 0)
