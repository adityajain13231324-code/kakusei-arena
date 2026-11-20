"""Measures every file (decode from the MP3), writes manifest.json + qa_report.json. Run after make_sfx/make_voice."""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

reg = os.path.join(STAGE, "tools", "audio", "_reg")
sfx = json.load(open(os.path.join(reg, "sfx.json"), encoding="utf-8"))
voice = json.load(open(os.path.join(reg, "voice.json"), encoding="utf-8"))

def measure(rp):
    p = os.path.join(STAGE, "public", rp)
    x, sr = sf.read(p, dtype="float64", always_2d=True)
    ch = x.shape[1]; x = x.mean(axis=1)
    pk = np.max(np.abs(x)); a = np.abs(x); act = x[a > 0.05 * pk]
    rms = np.sqrt(np.mean(act ** 2)) if len(act) else 0
    F = np.abs(np.fft.rfft(x)); fr = np.fft.rfftfreq(len(x), 1 / sr); tot = np.sum(F ** 2) + 1e-12
    return {"dur": round(len(x) / sr, 3), "sr": sr, "ch": ch, "peak_db": round(20 * np.log10(pk + 1e-12), 2),
            "rms_db": round(20 * np.log10(rms + 1e-12), 2), "clip": int(np.sum(a >= 0.999)),
            "voice_band": round(float(np.sum(F[(fr > 200) & (fr < 3500)] ** 2) / tot), 2),
            "centroid": int(np.sum(fr * F ** 2) / tot), "bytes": os.path.getsize(p)}

man = {"format": "mp3 mono 44.1kHz", "peak_target_db": PEAK_DB, "sounds": {}}
qa = {}; issues = []
for sid, e in sfx.items():
    man["sounds"][sid] = {"files": e["files"], "category": e["category"], "gain": e["gain"], **({"note": e["note"]} if e["note"] else {})}
for sid, e in voice["entries"].items():
    man["sounds"][sid] = {"files": e["files"], "category": "voice", "gain": e["gain"], "fighter": e["fighter"], "line_type": e["line_type"],
                          "text": e["texts"][0] if len(e["texts"]) == 1 else e["texts"]}
man["voice_blends"] = voice["blends"]
man["dropped"] = voice["dropped"]
tot = 0
for sid, e in man["sounds"].items():
    for f in e["files"]:
        m = measure(f); qa[f] = m; tot += m["bytes"]
        if m["clip"] or m["peak_db"] > -2.0 or m["ch"] != 1 or m["sr"] not in (44100, 48000): issues.append((f, "level/format", m))
        if m["dur"] < 0.04: issues.append((f, "too short", m))
        if e["category"] == "crowd" and m["voice_band"] < 0.5: issues.append((f, "crowd not vocal-band dominated", m))
# crowd verdict
cr = {f: m for f, m in qa.items() if "crowd_" in f}
man["total_bytes"] = tot
json.dump(man, open(os.path.join(STAGE, "public", "audio-manifest.json"), "w", encoding="utf-8"), indent=1)
json.dump({"files": qa, "issues": [(a, b) for a, b, c in issues], "voice_flags": voice["flags"]}, open(os.path.join(STAGE, "tools", "audio", "qa_report.json"), "w", encoding="utf-8"), indent=1)

cats = {}
for sid, e in man["sounds"].items():
    c = cats.setdefault(e["category"], [0, 0]); c[0] += 1; c[1] += len(e["files"])
print("ids/files per category:", cats)
print("total bytes", tot, "files", len(qa))
vm = [m["rms_db"] for f, m in qa.items() if f.startswith("voice/")]
print("voice active-RMS dB min/max/std: %.1f %.1f %.2f" % (min(vm), max(vm), np.std(vm)))
vd = sorted((m["dur"], f) for f, m in qa.items() if f.startswith("voice/"))
print("shortest voices", vd[:3], "longest", vd[-3:])
for c in ("crowd",):
    for f, m in cr.items(): print(f, m["dur"], "voiceband", m["voice_band"], "centroid", m["centroid"], "rms", m["rms_db"])
print("issues:", [(a, b) for a, b, c in issues])
print("voice flags:", voice["flags"])
print("dropped:", voice["dropped"])
