"""Renders the example clips beside the styles in Settings > Captions (public/examples/captions)
and writes the words they say, for the styles drawn live over plain.mp4.

Uses the toolkit's own caption code (services/ass_toolkit.py). See README.md here.

    python3 caption_examples.py TOOLKIT_DIR WORK_DIR OUT_DIR STYLES_JSON
"""
import json, os, subprocess, sys, types
TOOLKIT = sys.argv[1]
sys.path.insert(0, TOOLKIT)
for name in ["services.whisper_engine", "services.file_management", "services.cloud_storage", "config", "srt", "ffmpeg", "requests"]:
    m = types.ModuleType(name); sys.modules[name] = m
sys.modules["services.file_management"].download_file = None
sys.modules["services.cloud_storage"].upload_file = None
sys.modules["config"].LOCAL_STORAGE_PATH = "/tmp"
import services
services.whisper_engine = sys.modules["services.whisper_engine"]
from services.ass_toolkit import srt_to_ass, transcription_from_segments

EX = sys.argv[2]; OUT = sys.argv[3]; os.makedirs(OUT, exist_ok=True)
OFFSET = 15.0
words = [w for w in json.load(open(f"{EX}/words.json")) if 15.0 <= w["s"] < 24.9]
# One segment per sentence, as Whisper gives them.
segs, cur = [], []
for w in words:
    cur.append({"word": w["w"], "start": round(w["s"] - OFFSET, 2), "end": round(w["e"] - OFFSET, 2)})
    if w["w"].endswith((".", "?", ",")) or len(cur) >= 7:
        segs.append(cur); cur = []
if cur: segs.append(cur)
segments = [{"start": s[0]["start"], "end": s[-1]["end"], "words": s} for s in segs]
json.dump([[{"w": w["word"], "s": w["start"], "e": w["end"]} for w in seg] for seg in segs], open(f"{OUT}/words.json", "w"), separators=(",", ":"))
result = transcription_from_segments(segments)
styles = json.load(open(sys.argv[4]))
for name, look in styles.items():
    settings = dict(look); kind = settings.pop("style", "classic")
    ass = srt_to_ass(result, kind, settings, {}, (1080, 1920))
    if isinstance(ass, dict): print(name, ass); continue
    path = f"{EX}/{name}.ass"; open(path, "w").write(ass)
    out = f"{OUT}/{name.removeprefix('caption-')}.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", f"{EX}/capbase.mp4", "-vf",
                    f"ass={path}:fontsdir={TOOLKIT}/fonts,scale=432:768",
                    "-an", "-c:v", "libx264", "-crf", "30", "-preset", "slow", "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart", out], check=True)
    print(name, os.path.getsize(out) // 1024, "KB")
