"""Builds public/voice/*.mp3 with Kokoro (original synthetic voices). Run: venv python -I tools/make_voice.py"""
import os, sys, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
from kokoro_onnx import Kokoro

k = Kokoro(os.path.expanduser("~/.cache/hyperframes/tts/models/kokoro-v1.0.onnx"),
           os.path.expanduser("~/.cache/hyperframes/tts/voices/voices-v1.0.bin"))
def blend(parts):
    return sum(w * k.get_voice_style(n) for n, w in parts)

# fighter -> (blend, base speed, pitch ratio)
VOICES = {
    "announcer": ([("am_onyx", 0.7), ("am_michael", 0.3)], 1.0, 1.0),
    "kaito":  ([("am_liam", 0.6), ("am_adam", 0.4)], 1.08, 1.0),
    "shiori": ([("af_nicole", 0.6), ("af_sarah", 0.4)], 0.95, 1.0),
    "ren":    ([("bm_lewis", 0.6), ("bm_daniel", 0.4)], 0.92, 1.0),
    "goro":   ([("am_fenrir", 0.5), ("am_santa", 0.5)], 0.88, 0.92),
    "gojo":   ([("am_echo", 0.6), ("am_michael", 0.4)], 1.0, 1.0),
    "naruto": ([("am_puck", 0.5), ("am_eric", 0.5)], 1.1, 1.04),
    "zoro":   ([("bm_george", 0.6), ("am_adam", 0.4)], 0.95, 0.95),
    "luffy":  ([("am_puck", 0.6), ("am_eric", 0.4)], 1.1, 1.07),
    "eren":   ([("am_adam", 0.6), ("am_eric", 0.4)], 1.0, 1.0),
}
STYLE = {n: blend(p) for n, (p, s, pr) in VOICES.items()}

ANN = [("round_1", "Round one."), ("round_2", "Round two."), ("round_3", "Round three."), ("final_round", "Final round."),
       ("fight", "Fight!"), ("ko", "K.O.!"), ("double_ko", "Double K.O.!"), ("perfect", "Perfect!"), ("time", "Time!"),
       ("draw_game", "Draw game."), ("p1_wins", "Player one wins."), ("p2_wins", "Player two wins."), ("you_win", "You win!"),
       ("you_lose", "You lose."), ("counter", "Counter!"), ("guard_crush", "Guard crush!"), ("awakening", "Awakening!"),
       ("soul_realm", "Soul Realm!"), ("domain_expansion", "Domain expansion!"), ("realm_clash", "Realm clash!"), ("ready", "Ready?"),
       ("wins", "Wins!")]
NAMES = ["Kaito", "Shiori", "Ren", "Goro", "Gojo", "Naruto", "Zoro", "Luffy", "Eren"]
for n in NAMES:
    ANN.append(("name_" + n.lower(), n + "."))
    ANN.append(("win_" + n.lower(), n + " wins!"))

# per fighter: intro, win, attack candidates, hurt, ko, specials, ultimates, realm
F = {
 "kaito": dict(intro=["Time to heat things up!", "You're not ready for me!"], win=["That's how it's done!", "Burned out already?"],
   atk=["Hah!", "Hyah!", "Take this!", "Burn!", "Haaa!", "Here I come!", "Yaah!"], hurt=["Ugh!", "Argh!", "Gah!"], ko=["Aaaagh!", "Noooo!"],
   special=["Phoenix Cannon!", "Rising Phoenix!", "Blaze Knuckle!", "Homura Shot!"], ultimate=["Hundred Sun Barrage!", "Crimson Sun Barrage!"], realm=["Sun Forge!"]),
 "shiori": dict(intro=["I will end this quietly.", "The shadows are with me."], win=["It is over.", "Rest now."],
   atk=["Hah.", "Hyah!", "Hup!", "Ha!", "Yah!", "Gone.", "Haa!"], hurt=["Ugh.", "Nngh!", "Ah!"], ko=["Aaah!", "Ahh..."],
   special=["Shadow Stitch!", "Smoke Swap!", "Crow Dive!", "Moonless Fan!"], ultimate=["Night Without Moon!", "Moonless Night!"], realm=["Moonless Void!"]),
 "ren": dict(intro=["Come.", "Draw your blade."], win=["Too slow.", "Done."],
   atk=["Hah!", "Hup!", "Ha!", "Hyah!", "Yah!", "Haa!"], hurt=["Tch!", "Ugh.", "Hngh!"], ko=["Gaaah!", "Ahh!"],
   special=["Quick Draw!", "Falling Petal!", "Moon Step!", "Moonlight Severance!"], ultimate=["Thousand Petal Severance!", "Silent Moon Requiem!"], realm=["Petal Storm Dojo!"]),
 "goro": dict(intro=["Stand before the mountain!", "Come, little one!"], win=["The mountain does not fall!", "Crushed!"],
   atk=["Hrraah!", "Raaah!", "Smash!", "Hooah!", "Get over here!", "Haah!"], hurt=["Uhh!", "Grr!", "Ugh!"], ko=["Raaaargh!", "Aaaargh!"],
   special=["Earthsplitter!", "Avalanche Charge!", "Titan Roar!", "Titan Quake!"], ultimate=["Tectonic Suplex!", "Continental Drop!"], realm=["Mountain Temple!"]),
 "gojo": dict(intro=["This will be easy.", "Let's have some fun."], win=["Not even close.", "Better luck next time."],
   atk=["Hah!", "Heh!", "Here!", "Take this!", "Hyah!", "Haa!"], hurt=["Ugh!", "Tch!", "Gah!"], ko=["Aaagh!", "Ahh!"],
   special=["Blue!", "Red!", "Blink!", "Six Eyes Counter!"], ultimate=["Hollow Purple!", "Maximum Output: Blue!"], realm=["Domain Expansion: Infinite Void!"]),
 "naruto": dict(intro=["Let's go!", "Here I come!"], win=["I did it!", "Yes! We won!"],
   atk=["Hah!", "Hyah!", "Take this!", "Yaaah!", "Go!", "Haa!"], hurt=["Ugh!", "Argh!", "Gah!"], ko=["Aaaagh!", "Noooo!"],
   special=["Rasengan!", "Shadow Clone Jutsu!", "Clone Rush!", "Rasen-Shuriken!"], ultimate=["Rasengan Barrage!"], realm=["Tailed Beast Bomb!"]),
 "zoro": dict(intro=["Let's do this.", "Bring it."], win=["Is that all?", "Hmph. Easy."],
   atk=["Hah!", "Hyah!", "Haaa!", "Hup!", "Ha!", "Yah!"], hurt=["Ugh!", "Tch!", "Gah!"], ko=["Aaagh!", "Gaaah!"],
   special=["Oni Giri!", "Tatsumaki!", "Pound Cannon!", "Lion's Song!"], ultimate=["Asura: Ichibugin!"], realm=["King of Hell!"]),
 "luffy": dict(intro=["Let's have a fight!", "Here I come!"], win=["Yeah! I won!", "Ha ha ha! That was fun!"],
   atk=["Hah!", "Yaah!", "Take this!", "Hyaa!", "Rah!", "Hoo!"], hurt=["Ow!", "Ugh!", "Gah!"], ko=["Aaaagh!", "Noooo!"],
   special=["Gum-Gum Pistol!", "Gum-Gum Gatling!", "Gum-Gum Rocket!", "Gum-Gum Bell!"], ultimate=["King Kong Gun!"], realm=["Gear Fifth!"]),
 "eren": dict(intro=["I won't back down.", "I'll fight to the end."], win=["It's finished.", "I did it."],
   atk=["Hah!", "Haaa!", "Raaah!", "Hyah!", "Yaah!", "Hup!"], hurt=["Ugh!", "Gah!", "Argh!"], ko=["Aaaagh!", "Aaargh!"],
   special=["Thunder Spear!", "Grapple Dash!", "Hardened Fist!", "Spinning Slash!"], ultimate=["Nape Barrage!"], realm=["The Paths!"]),
}

def room_tail(x, wet=0.16, rt=0.28, seed=7):
    r = np.random.default_rng(seed); n = int(rt * SR)
    ir = r.standard_normal(n) * np.exp(-np.linspace(0, 7, n)); ir = lp(ir, 5500)
    w = signal.fftconvolve(x, ir)[: len(x) + n]
    w *= np.max(np.abs(x)) / (np.max(np.abs(w)) + 1e-12)
    out = np.zeros(len(w)); out[: len(x)] += x; out += wet * w
    return out

def compress(x, thr_db=-20, ratio=3.0, att=0.004, rel=0.08):
    env = np.zeros_like(x); a = np.exp(-1 / (att * SR)); r = np.exp(-1 / (rel * SR)); e = 0.0
    ax = np.abs(x)
    for i in range(len(x)):
        e = a * e + (1 - a) * ax[i] if ax[i] > e else r * e + (1 - r) * ax[i]
        env[i] = e
    pk = np.max(ax)
    lvl = 20 * np.log10(env / pk + 1e-9)
    gr = np.where(lvl > thr_db, (thr_db - lvl) * (1 - 1 / ratio), 0.0)
    return x * 10 ** (gr / 20)

def process(x, sr, who):
    x = np.asarray(x, dtype=np.float64)
    x = resample(x, sr, SR)
    pr = VOICES[who][2]
    if pr != 1.0: x = pitch(x, pr)
    x = hp(x, 90)
    x = compress(x / (np.max(np.abs(x)) + 1e-12))
    x = np.tanh(1.4 * x / (np.max(np.abs(x)) + 1e-12)) * 0.9      # gentle saturation
    if who == "announcer":
        x = x + 0.35 * hp(x, 3500)                                  # brighter
        x = np.concatenate([x, np.zeros(int(0.1 * SR))])
        x = room_tail(x)
    return x

TARGET_RMS_DB = -19.0
def level(x):
    """equalize active-frame RMS, soft-limit to -3 dBFS peak"""
    a = np.abs(x); act = x[a > 0.05 * a.max()]
    rms = np.sqrt(np.mean(act ** 2)) + 1e-12
    x = x * 10 ** (TARGET_RMS_DB / 20) / rms
    ceil = 10 ** (PEAK_DB / 20)
    knee = 0.6 * ceil
    s = np.abs(x)
    y = np.where(s > knee, np.sign(x) * (knee + (ceil - knee) * np.tanh((s - knee) / (ceil - knee))), x)
    return y

def expected_dur(text):
    n = len(re.findall(r"[A-Za-z]", text))
    return 0.07 * n + 0.25
def plausible(text, dur, speed):
    e = expected_dur(text) / speed
    return (0.3 * e <= dur <= 2.8 * e + 0.3) and 0.12 <= dur <= 4.5

REG, DROPPED, FLAGS = {}, [], []
def gen(who, text, speed_mul=1.0):
    blendv, sp, pr = VOICES[who]
    sp = sp * speed_mul
    s, sr = k.create(text, voice=STYLE[who], speed=sp, lang="en-us")
    x = process(s, sr, who)
    x = finish(x, fout=0.04 if who == "announcer" else 0.025, start_db=-45, end_db=-48)
    return x, sp

def make(who, ltype, slug, text, out_name, gain, extra=None):
    """tries speed multipliers; regenerates once at another speed when implausible"""
    for attempt, mul in enumerate((1.0, 0.82)):
        x, sp = gen(who, text, mul)
        dur = len(x) / SR
        if plausible(text, dur, sp):
            x = level(x).astype(np.float32)
            p = os.path.join(STAGE, "public", "voice", out_name + ".mp3")
            write_mp3(p, x)
            if attempt: FLAGS.append("%s '%s' regenerated at speed x%.2f (first take implausible)" % (who, text, mul))
            return {"file": rel(p), "text": text, "dur": round(dur, 3)}
        FLAGS.append("%s '%s' implausible dur %.2fs at speed %.2f (attempt %d)" % (who, text, dur, sp, attempt + 1))
    DROPPED.append("%s '%s'" % (who, text))
    return None

def slugify(t): return re.sub(r"[^a-z0-9]+", "_", t.lower()).strip("_")

def reg(sid, cat, who, ltype, text, gain, rec):
    if rec is None: return
    e = REG.setdefault(sid, {"category": "voice", "gain": gain, "fighter": who, "line_type": ltype, "files": [], "texts": []})
    e["files"].append(rec["file"]); e["texts"].append(text)

# announcer
for sid, text in ANN:
    rec = make("announcer", "announcer", sid, text, "announcer_" + sid, 1.0)
    reg("announcer_" + sid, "voice", "announcer", "announcer", text, 1.0, rec)
# fighters
for who, d in F.items():
    for key, lt, gain in (("intro", "intro", 0.9), ("win", "win", 0.9), ("atk", "attack", 0.75), ("hurt", "hurt", 0.8), ("ko", "ko", 0.9),
                          ("special", "special", 0.95), ("ultimate", "ultimate", 1.0), ("realm", "realm", 1.0)):
        lines = d[key]
        if lt in ("special", "ultimate", "realm"):
            for t in lines:
                sl = slugify(t)
                rec = make(who, lt, sl, t, "%s_%s_%s" % (who, lt, sl), gain)
                reg("voice_%s_%s_%s" % (who, lt, sl), "voice", who, lt, t, gain, rec)
        else:
            for i, t in enumerate(lines):
                rec = make(who, lt, str(i), t, "%s_%s_%d" % (who, lt, i), gain)
                if rec:
                    e = REG.setdefault("voice_%s_%s" % (who, lt), {"category": "voice", "gain": gain, "fighter": who, "line_type": lt, "files": [], "texts": []})
                    e["files"].append(rec["file"]); e["texts"].append(t)
    # shouts: at least 4 required
    n = len(REG.get("voice_%s_attack" % who, {}).get("files", []))
    if n < 4: FLAGS.append("%s only %d attack shouts survived" % (who, n))
    print(who, "done", flush=True)

save_registry("voice", {"entries": REG, "dropped": DROPPED, "flags": FLAGS,
                        "blends": {n: {"mix": p, "speed": s, "pitch": pr} for n, (p, s, pr) in VOICES.items()}})
print(len(REG), "voice ids; dropped", DROPPED, "flags", len(FLAGS))
