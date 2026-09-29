"""A quiet, original ambient bed for the product video (no samples, nothing to license).

Slow major-seventh pads with soft attack, a gentle plucked arpeggio and a little echo, mixed low so
the narration stays clear. Writes an MP3 of the requested length.
"""
import argparse
import subprocess

import numpy as np
import soundfile as sf

ap = argparse.ArgumentParser()
ap.add_argument("--seconds", type=float, default=360)
ap.add_argument("--out", required=True)
args = ap.parse_args()

sr = 44100
n = int(sr * args.seconds)
t = np.arange(n) / sr
left = np.zeros(n, dtype=np.float64)
right = np.zeros(n, dtype=np.float64)

def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)

# C major, A minor, F major, G: each chord 8 seconds, voiced as a soft ninth/seventh chord.
chords = [[48, 55, 59, 62, 64], [45, 52, 57, 60, 64], [41, 48, 55, 57, 64], [43, 50, 55, 59, 62]]
bar = 8.0
for i in range(int(args.seconds // bar) + 1):
    start = i * bar
    chord = chords[i % len(chords)]
    s0 = int(start * sr)
    length = int((bar + 3.0) * sr)
    seg_t = np.arange(length) / sr
    env = np.minimum(1.0, seg_t / 2.5) * np.exp(-np.maximum(0, seg_t - bar) / 1.2)
    for j, note in enumerate(chord):
        f = hz(note)
        det = 1.0 + (j - 2) * 0.0015
        wave = 0.6 * np.sin(2 * np.pi * f * det * seg_t) + 0.25 * np.sin(2 * np.pi * f * 2 * seg_t + j) + 0.1 * np.sin(2 * np.pi * f * 3.01 * seg_t)
        pan = 0.3 + 0.1 * j
        end = min(n, s0 + length)
        part = (wave * env)[: end - s0] * 0.05
        left[s0:end] += part * (1 - pan)
        right[s0:end] += part * pan
    # Plucked arpeggio: eighth notes on the chord tones one octave up.
    for k in range(16):
        note = chord[[1, 2, 3, 4, 3, 2][k % 6]] + 12
        p0 = s0 + int(k * 0.5 * sr)
        if p0 >= n:
            break
        plen = int(1.6 * sr)
        pt = np.arange(plen) / sr
        pluck = np.sin(2 * np.pi * hz(note) * pt) * np.exp(-pt * 3.2) * (0.018 if k % 4 else 0.026)
        end = min(n, p0 + plen)
        pan = 0.35 if k % 2 else 0.65
        left[p0:end] += pluck[: end - p0] * (1 - pan)
        right[p0:end] += pluck[: end - p0] * pan

# Echo and a gentle one-pole low-pass for warmth.
d = int(0.375 * sr)
for ch in (left, right):
    ch[d:] += 0.28 * ch[:-d]
# Vectorised approximation of the low-pass (fast): moving average over 6 ms.
k = int(0.006 * sr)
kernel = np.ones(k) / k
left = np.convolve(left, kernel, mode="same")
right = np.convolve(right, kernel, mode="same")
# Fade in and out.
fade = int(4 * sr)
ramp = np.linspace(0, 1, fade)
for ch in (left, right):
    ch[:fade] *= ramp
    ch[-fade:] *= ramp[::-1]
stereo = np.stack([left, right], axis=1)
stereo = stereo / (np.max(np.abs(stereo)) or 1) * 0.5
wav = args.out[:-4] + ".wav"
sf.write(wav, stereo.astype(np.float32), sr)
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-b:a", "192k", args.out], check=True)
import os
os.remove(wav)
print("music", args.seconds, "s")
