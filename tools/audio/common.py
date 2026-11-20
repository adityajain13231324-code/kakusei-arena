"""Shared helpers: decode, DSP, trim/fade/normalize, MP3 write. Use: venv python -I."""
import os, json
from fractions import Fraction
import numpy as np, soundfile as sf
from scipy import signal

SR = 44100
STAGE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # repo root (outputs go to public/sfx, public/voice)
SRC = os.environ.get("KENNEY_SRC", os.path.join(os.path.dirname(STAGE), "sfx-download"))  # unpacked Kenney CC0 packs (not committed)
PEAK_DB = -3.0

def load(pack, name):
    p = os.path.join(SRC, pack, "Audio", name + ".ogg")
    x, sr = sf.read(p, dtype="float64", always_2d=True)
    x = x.mean(axis=1)
    return resample(x, sr, SR)

def resample(x, sr_from, sr_to):
    if sr_from == sr_to: return x
    g = np.gcd(int(sr_from), int(sr_to))
    return signal.resample_poly(x, sr_to // g, sr_from // g)

def pitch(x, ratio):
    """Play back at `ratio` speed (>1 = higher pitch, shorter)."""
    f = Fraction(ratio).limit_denominator(200)
    return signal.resample_poly(x, f.denominator, f.numerator)

def _sos(kind, f, order=2, sr=SR):
    return signal.butter(order, f, kind, fs=sr, output="sos")
def hp(x, f, order=2): return signal.sosfilt(_sos("hp", f, order), x)
def lp(x, f, order=2): return signal.sosfilt(_sos("lp", f, order), x)
def bp(x, lo, hi, order=2): return signal.sosfilt(_sos("bp", [lo, hi], order), x)

def mix(*layers):
    """layers: (array, gain, offset_seconds)"""
    n = max(int(o * SR) + len(a) for a, g, o in layers)
    out = np.zeros(n)
    for a, g, o in layers:
        i = int(o * SR); out[i:i + len(a)] += g * a
    return out

def trim(x, start_db=-42, end_db=-46, pre=0.004, post=0.01):
    pk = np.max(np.abs(x)) + 1e-12
    a = np.where(np.abs(x) > pk * 10 ** (start_db / 20))[0]
    b = np.where(np.abs(x) > pk * 10 ** (end_db / 20))[0]
    if len(a) == 0: return x
    return x[max(0, a[0] - int(pre * SR)): min(len(x), b[-1] + int(post * SR))]

def fade(x, fin=0.002, fout=0.02):
    x = x.copy(); n = len(x)
    i = min(int(fin * SR), n); o = min(int(fout * SR), n)
    if i: x[:i] *= np.linspace(0, 1, i)
    if o: x[-o:] *= 0.5 * (1 + np.cos(np.linspace(0, np.pi, o)))
    return x

def cap(x, max_s):
    return x[: int(max_s * SR)] if len(x) > max_s * SR else x

def peak_norm(x, db=PEAK_DB):
    return x * (10 ** (db / 20) / (np.max(np.abs(x)) + 1e-12))

def finish(x, max_s=None, fout=0.02, fin=0.002, start_db=-42, end_db=-46):
    x = x - np.mean(x)
    x = trim(x, start_db, end_db)
    if max_s: x = cap(x, max_s)
    x = fade(x, fin, fout)
    return peak_norm(x).astype(np.float32)

def write_mp3(path, x, sr=SR):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with sf.SoundFile(path, "w", samplerate=sr, channels=1, format="MP3", subtype="MPEG_LAYER_III") as f:
        try: f.bitrate_mode = "VARIABLE"
        except Exception: pass
        try: f.compression_level = 0.55
        except Exception: pass
        f.write(x)

def rel(path):
    return os.path.relpath(path, os.path.join(STAGE, "public")).replace("\\", "/")

def save_registry(name, data):
    os.makedirs(os.path.join(STAGE, "tools", "audio", "_reg"), exist_ok=True)
    json.dump(data, open(os.path.join(STAGE, "tools", "audio", "_reg", name + ".json"), "w", encoding="utf-8"), indent=1)
