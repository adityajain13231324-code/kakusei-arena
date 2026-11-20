"""Builds public/sfx/*.mp3 from Kenney CC0 packs + synthesized whooshes/crowd. Run: venv python -I tools/make_sfx.py"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

IM, UI, RPG, SCI = "impact-sounds", "interface-sounds", "rpg-audio", "sci-fi-sounds"
L = load
REG = {}   # id -> {category, gain, files, note}

def add(sid, cat, gain, arrays, max_s=None, fout=0.02, note=""):
    files = []
    for i, a in enumerate(arrays):
        y = finish(a, max_s=max_s, fout=fout)
        p = os.path.join(STAGE, "public", "sfx", "%s_%d.mp3" % (sid, i))
        write_mp3(p, y); files.append(rel(p))
    REG[sid] = {"category": cat, "gain": gain, "files": files, "note": note}

def imp(name, i): return L(IM, "%s_%03d" % (name, i))

# ---------------- impacts: flesh ----------------
add("hit_light_flesh", "impact", 0.7, [mix((hp(imp("impactGeneric_light", i), 120), 1, 0), (imp("impactSoft_medium", i), 0.35, 0)) for i in range(4)], 0.35)
add("hit_medium_flesh", "impact", 0.85, [imp("impactPunch_medium", i) for i in range(4)], 0.5)
add("hit_heavy_flesh", "impact", 1.0, [mix((imp("impactPunch_heavy", i), 1, 0), (imp("impactSoft_heavy", i), 0.4, 0.005)) for i in range(4)], 0.7)
# ---------------- metal (Ren / Zoro sword clangs) ----------------
add("hit_light_metal", "impact", 0.7, [imp("impactMetal_light", i) for i in range(4)], 0.7, fout=0.08)
add("hit_medium_metal", "impact", 0.85, [imp("impactMetal_medium", i) for i in range(4)], 0.9, fout=0.1)
add("hit_heavy_metal", "impact", 1.0, [mix((imp("impactMetal_heavy", i), 1, 0), (pitch(imp("impactMetal_medium", i), 1.5), 0.3, 0.004)) for i in range(4)], 1.1, fout=0.15)
# ---------------- stone (Goro): Kenney has no stone pack; layered mining/punch + low thump ----------------
def low(i): return lp(L(SCI, "lowFrequency_explosion_00%d" % (i % 2)), 420)
add("hit_light_stone", "impact", 0.75, [mix((pitch(imp("impactMining", i), 1.05), 1, 0), (pitch(imp("impactPunch_medium", i), 0.8), 0.4, 0)) for i in range(3)], 0.45, note="layered Kenney mining+punch")
add("hit_medium_stone", "impact", 0.9, [mix((pitch(imp("impactMining", i + 2), 0.85), 1, 0), (pitch(imp("impactPunch_heavy", i), 0.8), 0.5, 0), (cap(low(i), 0.5), 0.25, 0)) for i in range(3)], 0.6, note="layered")
add("hit_heavy_stone", "impact", 1.0, [mix((pitch(imp("impactMining", i), 0.7), 1, 0), (pitch(imp("impactPunch_heavy", i + 1), 0.7), 0.6, 0), (cap(low(i), 0.9), 0.6, 0.0)) for i in range(3)], 0.9, fout=0.1, note="layered")
# ---------------- block / parry / guard crush ----------------
add("block_light", "block", 0.7, [lp(imp("impactPlate_light", i), 6500) for i in range(3)], 0.4)
add("block_medium", "block", 0.85, [pitch(imp("impactPlate_medium", i), 0.95) for i in range(4)], 0.5)
add("block_heavy", "block", 1.0, [imp("impactPlate_heavy", i) for i in range(3)], 0.7, fout=0.08)
def ping(f, d=0.3):
    t = np.arange(int(d * SR)) / SR
    return np.sin(2 * np.pi * f * t) * np.exp(-t * 14) + 0.4 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t * 22)
add("parry", "block", 0.9, [mix((hp(pitch(imp("impactMetal_light", i), 1.35), 800), 1, 0), (imp("impactGlass_light", i), 0.6, 0), (ping(2600 + 300 * i), 0.35, 0.002)) for i in range(4)], 0.6, fout=0.1, note="bright parry/counter")
add("guard_crush", "block", 1.0, [mix((imp("impactGlass_heavy", i), 1, 0), (imp("impactPlate_heavy", i), 0.6, 0), (cap(low(i), 0.8), 0.5, 0)) for i in range(3)], 1.2, fout=0.2, note="glass + heavy plate + thump")
# ---------------- whooshes (synthesized swept band-passed noise) ----------------
def sweep(dur, f0, f1, q, peak=0.4, power=1.6, seed=0, curve=1.0):
    r = np.random.default_rng(seed); n = int(dur * SR)
    noise = r.standard_normal(n); out = np.zeros(n); B = 256
    zi = None
    for s in range(0, n, B):
        u = (s / n) ** curve
        fc = f0 * (f1 / f0) ** u; bw = fc / q
        sos = signal.butter(2, [max(60, fc - bw / 2), min(SR / 2 - 200, fc + bw / 2)], "bp", fs=SR, output="sos")
        if zi is None: zi = np.zeros((sos.shape[0], 2))
        seg, zi = signal.sosfilt(sos, noise[s:s + B], zi=zi)
        out[s:s + B] = seg
    u = np.linspace(0, 1, n)
    env = np.where(u < peak, (u / peak) ** power, ((1 - u) / (1 - peak)) ** (power * 1.3))
    return out * env
def jit(base, seed, amt=0.12):
    r = np.random.default_rng(seed); return base * (1 + amt * (r.random() * 2 - 1))
add("whoosh_jab", "whoosh", 0.6, [sweep(jit(0.15, i), jit(1800, i), jit(4800, i + 9), 1.4, 0.35, seed=100 + i) for i in range(4)], 0.25, fout=0.03, note="short fast swish for jabs")
add("whoosh_punch", "whoosh", 0.65, [sweep(jit(0.2, i), jit(900, i), jit(3500, i + 9), 1.2, 0.4, seed=110 + i) for i in range(4)], 0.3, fout=0.04)
add("whoosh_kick", "whoosh", 0.7, [sweep(jit(0.27, i), jit(500, i), jit(2600, i + 9), 1.0, 0.45, seed=120 + i) for i in range(4)], 0.4, fout=0.05)
add("whoosh_heavy", "whoosh", 0.8, [sweep(jit(0.45, i), jit(220, i), jit(1900, i + 9), 0.9, 0.55, seed=130 + i) for i in range(4)], 0.6, fout=0.08, note="heavy limb / grapple")
add("whoosh_sword", "whoosh", 0.7, [sweep(jit(0.3, i), jit(1600, i), jit(7000, i + 9), 2.4, 0.4, seed=140 + i) for i in range(4)], 0.45, fout=0.05, note="sword slash")
add("whoosh_sword_long", "whoosh", 0.75, [sweep(jit(0.55, i), jit(1200, i), jit(6500, i + 9), 2.0, 0.5, seed=150 + i, curve=0.8) for i in range(3)], 0.75, fout=0.1, note="long sword / iai")
# ---------------- footsteps ----------------
add("foot_concrete", "foot", 0.5, [L(IM, "footstep_concrete_%03d" % i) for i in range(5)], 0.35, note="rooftop")
add("foot_wood", "foot", 0.5, [L(IM, "footstep_wood_%03d" % i) for i in range(5)], 0.35, note="shrine floor")
add("foot_stone", "foot", 0.55, [mix((lp(pitch(L(IM, "footstep_concrete_%03d" % i), 0.85), 3500), 1, 0), (pitch(imp("impactMining", i), 1.1), 0.18, 0)) for i in range(4)], 0.4, note="shrine stone; derived from concrete+mining")
# ---------------- falls ----------------
add("fall_body", "fall", 0.9, [mix((imp("impactSoft_heavy", i), 1, 0), (lp(imp("impactPunch_heavy", i), 900), 0.5, 0.01), (cap(low(i), 0.5), 0.3, 0)) for i in range(4)], 0.7, fout=0.08, note="body fall / knockdown")
add("fall_knockdown_heavy", "fall", 1.0, [mix((pitch(imp("impactSoft_heavy", i), 0.85), 1, 0), (cap(low(i), 0.9), 0.7, 0), (lp(imp("impactWood_heavy", i), 1500), 0.4, 0.01)) for i in range(3)], 0.9, fout=0.12)
# ---------------- cloth ----------------
add("cloth", "cloth", 0.55, [L(RPG, "cloth%d" % i) for i in range(1, 5)], 0.6, fout=0.06)
add("cloth_belt", "cloth", 0.55, [L(RPG, "clothBelt"), L(RPG, "clothBelt2"), L(RPG, "beltHandle1")], 0.6, fout=0.06)
# ---------------- KO / fx ----------------
add("ko_blast", "impact", 1.0, [mix((L(SCI, "explosionCrunch_00%d" % i), 1, 0), (cap(low(i), 1.0), 0.6, 0)) for i in range(3)], 1.6, fout=0.3, note="K.O. / ultimate finisher boom")
add("fx_awaken", "fx", 0.8, [L(SCI, "forceField_00%d" % i) for i in range(3)], 1.5, fout=0.2, note="awakening charge")
# ---------------- UI ----------------
def U(n): return L(UI, n)
add("ui_hover", "ui", 0.5, [U("click_00%d" % i) for i in (1, 2, 3)], 0.2, fout=0.01)
add("ui_select", "ui", 0.7, [U("select_00%d" % i) for i in (1, 2, 3, 4)], 0.5, fout=0.05)
add("ui_back", "ui", 0.7, [U("back_00%d" % i) for i in (1, 2, 3)], 0.5, fout=0.05)
add("ui_confirm", "ui", 0.8, [U("confirmation_00%d" % i) for i in (1, 2, 3, 4)], 1.0, fout=0.1)
add("ui_error", "ui", 0.7, [U("error_00%d" % i) for i in (1, 2, 4, 6)], 0.8, fout=0.08)
add("ui_slider_tick", "ui", 0.4, [U("tick_00%d" % i) for i in (1, 2, 4)], 0.15, fout=0.01)
add("ui_toggle", "ui", 0.6, [U("toggle_00%d" % i) for i in (1, 2, 3)], 0.3, fout=0.03)
add("ui_open", "ui", 0.6, [U("open_00%d" % i) for i in (1, 2, 3)], 0.5, fout=0.05)

# ---------------- crowd (synthesized: many detuned glottal-pulse voices + formants + noise) ----------------
FORM = {"ah": [(800, 90), (1250, 110), (2600, 160)], "oo": [(320, 60), (800, 80), (2400, 160)]}
def crowd_voices(dur, vowel, n, f_lo, f_hi, glide, seed, vib=5.0, onset=0.3, offset=0.5, spread=0.0):
    r = np.random.default_rng(seed); N = int(dur * SR); t = np.arange(N) / SR; acc = np.zeros(N)
    for v in range(n):
        f0 = r.uniform(f_lo, f_hi) * np.exp(glide * (t / dur) + r.normal(0, 0.02))
        f0 = f0 * (1 + 0.012 * np.sin(2 * np.pi * (vib + r.normal(0, 0.8)) * t + r.uniform(0, 6)))
        ph = np.cumsum(f0) / SR
        src = 2 * (ph % 1) - 1
        st = r.uniform(0, spread * dur); en = dur - r.uniform(0, spread * dur * 0.5)
        e = np.clip((t - st) / onset, 0, 1) * np.clip((en - t) / offset, 0, 1)
        acc += src * e * r.uniform(0.5, 1.0)
    out = np.zeros(N)
    for fc, bw in FORM[vowel]:
        out += signal.sosfilt(signal.butter(2, [fc - bw, fc + bw], "bp", fs=SR, output="sos"), acc) * (1.0 if fc < 1500 else 0.6)
    return out / n ** 0.5
def noise_band(dur, lo, hi, env, seed):
    r = np.random.default_rng(seed); return bp(r.standard_normal(int(dur * SR)), lo, hi) * env
def claps(dur, dens0, dens1, seed):
    r = np.random.default_rng(seed); N = int(dur * SR); x = np.zeros(N); u = np.linspace(0, 1, N)
    p = (dens0 + (dens1 - dens0) * np.sin(np.pi * u)) / SR
    for i in np.where(r.random(N) < p)[0]:
        k = min(int(r.uniform(0.004, 0.012) * SR), N - i)
        x[i:i + k] += r.uniform(0.4, 1) * r.standard_normal(k) * np.exp(-np.linspace(0, 7, k))
    return bp(x, 900, 6000)
def cheer(seed):
    d = 2.4; t = np.linspace(0, 1, int(d * SR))
    env = np.clip(t / 0.15, 0, 1) * np.clip((1 - t) / 0.35, 0, 1)
    v = crowd_voices(d, "ah", 45, 140, 330, 0.18, seed, onset=0.25, offset=0.9, spread=0.15)
    return mix((v, 1.0, 0), (noise_band(d, 700, 3800, env, seed + 1), 0.35, 0), (claps(d, 40, 160, seed + 2), 0.5, 0))
def gasp(seed):
    d = 1.1; N = int(d * SR); t = np.linspace(0, 1, N)
    inhale = bp(np.random.default_rng(seed).standard_normal(N), 900, 3800) * (np.clip(t / 0.5, 0, 1) ** 1.5) * np.clip((0.75 - t) / 0.15, 0, 1)
    v = crowd_voices(0.5, "ah", 30, 200, 380, 0.25, seed + 3, onset=0.1, offset=0.25, spread=0.25)
    return mix((inhale, 0.8, 0), (v, 0.9, 0.3))
def boo(seed):
    d = 2.2
    v = crowd_voices(d, "oo", 40, 90, 170, -0.22, seed, onset=0.35, offset=0.8, spread=0.12, vib=4.0)
    t = np.linspace(0, 1, int(d * SR))
    return mix((v, 1.0, 0), (noise_band(d, 250, 1500, np.clip(t / 0.3, 0, 1) * np.clip((1 - t) / 0.4, 0, 1), seed + 1), 0.25, 0))
add("crowd_cheer", "crowd", 0.8, [cheer(300 + i) for i in range(3)], 2.5, fout=0.5, note="synthesized")
add("crowd_gasp", "crowd", 0.8, [gasp(400 + i) for i in range(3)], 1.2, fout=0.25, note="synthesized")
add("crowd_boo", "crowd", 0.7, [boo(500 + i) for i in range(3)], 2.3, fout=0.5, note="synthesized")

save_registry("sfx", REG)
print(len(REG), "sfx ids,", sum(len(v["files"]) for v in REG.values()), "files")
