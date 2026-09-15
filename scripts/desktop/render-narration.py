"""Local synthetic male narration; no API keys, uploads or production services.

Usage: python render-narration.py SCRIPT.txt FRESH_OUTPUT.wav [voice]
Install kokoro==0.9.4 and soundfile in an isolated media environment.
Model: https://huggingface.co/hexgrad/Kokoro-82M (Apache-2.0).
"""
import sys
from pathlib import Path
import numpy as np
import soundfile as sf
from kokoro import KPipeline

source, target = map(Path, sys.argv[1:3])
if target.exists():
    raise SystemExit("Output exists; choose a fresh output filename")
voice = sys.argv[3] if len(sys.argv) > 3 else "am_michael"
pipeline = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M", device="cpu")
pieces = []
for paragraph in source.read_text().strip().split("\n\n"):
    for _, _, audio in pipeline(paragraph, voice=voice, speed=0.94):
        pieces.append(audio.numpy())
        pieces.append(np.zeros(4800, dtype=np.float32))
    pieces.append(np.zeros(8400, dtype=np.float32))
wave = np.concatenate(pieces)
if not np.isfinite(wave).all() or np.max(np.abs(wave)) == 0:
    raise SystemExit("Invalid audio")
wave *= min(1.0, 0.92 / np.max(np.abs(wave)))
target.parent.mkdir(parents=True, exist_ok=True)
sf.write(target, wave, 24000, subtype="PCM_16")
print(f"{target}: {len(wave)/24000:.2f} seconds; synthetic voice {voice}")
