"""Add local male narration and selectable captions to the existing original film.
Run from repository root inside the isolated narration environment.
Never overwrite the existing README film. Stop rather than clip/rush speech.
"""
import json
from pathlib import Path
import subprocess
import sys
import numpy as np
import soundfile as sf
import imageio_ffmpeg
from kokoro import KPipeline

out = Path(sys.argv[1] if len(sys.argv) > 1 else '.desktop/voiced-overview-v1')
out.mkdir(exist_ok=False)
scenes = json.loads(Path('docs/desktop/media/overview-narration.json').read_text())
pipeline = KPipeline(lang_code='a', repo_id='hexgrad/Kokoro-82M', device='cpu')
track = np.zeros(60 * 24000, dtype=np.float32)
captions = []
measurements = []
def timestamp(t):
    ms = round(t * 1000)
    return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
for i, scene in enumerate(scenes):
    parts = [audio.numpy() for _, _, audio in pipeline(scene['text'], voice='am_michael', speed=1.0)]
    audio = np.concatenate(parts)
    seconds = len(audio) / 24000
    available = scene['end'] - scene['start'] - 0.35
    sf.write(out / f'scene-{i}.wav', audio, 24000)
    if seconds > available:
        raise SystemExit(f'Scene {i} is {seconds:.2f}s, only {available:.2f}s available. Shorten script; never truncate.')
    offset = round((scene['start'] + .15) * 24000)
    track[offset:offset+len(audio)] = audio
    # Selectable sentence captions are readable and do not obscure actual UI.
    sentences = scene['text'].split('. ')
    total = sum(len(s.split()) for s in sentences)
    cursor = scene['start'] + .15
    for sentence in sentences:
        duration = seconds * len(sentence.split()) / total
        captions.append(f'{len(captions)+1}\n{timestamp(cursor)} --> {timestamp(cursor+duration)}\n{sentence.rstrip(".")}.\n')
        cursor += duration
    measurements.append({'scene':i,'seconds':round(seconds,3),'available':available})
track *= min(1.0, .92 / max(float(np.max(np.abs(track))), .001))
sf.write(out/'narration.wav',track,24000,subtype='PCM_16')
(out/'captions.srt').write_text('\n'.join(captions))
(out/'timing.json').write_text(json.dumps(measurements,indent=2))
subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-v','error','-i','docs/desktop/media/Orchestra-product-film.mp4','-i',str(out/'narration.wav'),'-i',str(out/'captions.srt'),'-map','0:v:0','-map','1:a:0','-map','2:s:0','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-af','loudnorm=I=-16:TP=-1.5:LRA=9','-c:s','mov_text','-metadata:s:s:0','language=eng','-movflags','+faststart',str(out/'Orchestra-narrated-overview.mp4')],check=True)
print(json.dumps(measurements))
