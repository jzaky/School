"""Voiceover for the product video. Runs on GitHub Actions (the model is downloaded there).

Uses Kokoro-82M (Apache 2.0). Reads media/voiceover/script.json, writes one MP3 per segment and
timings.json with each segment's length, so the video can be cut to the narration.
"""
import argparse
import json
import os
import subprocess

import numpy as np
import soundfile as sf
from kokoro import KPipeline

ap = argparse.ArgumentParser()
ap.add_argument("--script", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--voice", default="")
args = ap.parse_args()

spec = json.load(open(args.script, encoding="utf-8"))
voice = args.voice or spec.get("voice", "af_heart")
speed = float(spec.get("speed", 1.0))
rate = 24000
pipe = KPipeline(lang_code=voice[0])  # a = American English, b = British English
os.makedirs(args.out, exist_ok=True)
timings = []
for seg in spec["segments"]:
    parts = []
    for _, _, audio in pipe(seg["text"], voice=voice, speed=speed, split_pattern=r"(?<=[.!?:])\s+"):
        a = audio.numpy() if hasattr(audio, "numpy") else np.asarray(audio)
        parts.append(a.astype(np.float32))
        parts.append(np.zeros(int(rate * 0.32), dtype=np.float32))  # breath between sentences
    out = np.concatenate(parts) if parts else np.zeros(rate, dtype=np.float32)
    peak = float(np.max(np.abs(out))) or 1.0
    out = out / peak * 0.89
    wav = os.path.join(args.out, f"{seg['id']}.wav")
    sf.write(wav, out, rate)
    mp3 = wav[:-4] + ".mp3"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-ac", "1", "-ar", "44100", "-b:a", "160k", mp3], check=True)
    os.remove(wav)
    timings.append({"id": seg["id"], "seconds": round(len(out) / rate, 2)})
    print(seg["id"], timings[-1]["seconds"], "s")
json.dump({"voice": voice, "speed": speed, "timings": timings}, open(os.path.join(args.out, "timings.json"), "w"), indent=1)
