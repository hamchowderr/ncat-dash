"""Renders the example clips beside the options in Settings > Motion (public/examples/motion).

Uses the toolkit's own /v1/video/motion code, so each clip is exactly what a run draws. See
README.md here for what it needs and how to run it.

    python3 motion_examples.py TOOLKIT_DIR WORK_DIR OUT_DIR [name ...]
"""
import json, os, shutil, subprocess, sys, tempfile
sys.path.insert(0, sys.argv[1])
from services.v1.video.motion import render_motion

EX = sys.argv[2]  # base.mp4, logo.png and presets.json (see README.md)
OUT = sys.argv[3]
only = set(sys.argv[4:])
os.makedirs(OUT, exist_ok=True)
BASE = f"{EX}/base.mp4"

TEXT = {
    "lower_third": {"title": "Space Station Crew", "subtitle": "Live from orbit"},
    "title": {"title": "Magic In Orbit", "subtitle": "Space station interview"},
    "keyword": {"title": "Magic"},
    "stat": {"title": "3", "subtitle": "crew on board"},
    "chapter": {"title": "Why it feels like magic"},
    "follow": {"title": "@yourhandle", "subtitle": "Follow for more"},
    "quote": {"title": "We would really have to describe it as magic.", "subtitle": "Space station crew"},
    "transition": {},
    "logo": {"image": "logo"},
}
SECONDS = {"lower_third": 3.5, "title": 2.6, "keyword": 1.3, "stat": 3.0, "chapter": 2.4,
           "follow": 3.5, "quote": 4.0, "transition": 0.8, "logo": 3.0}
# Where each piece sits in the base clip when shown on its own, and the window kept.
ALONE = {"lower_third": (0.3, 0, 4.2), "title": (0.2, 0, 3.3), "keyword": (7.6, 6.4, 9.3),
         "stat": (10.5, 9.6, 13.5), "chapter": (4.0, 3.4, 6.8), "follow": (1.0, 0.4, 4.9),
         "quote": (5.6, 5.0, 9.9), "transition": (2.0, 1.2, 3.4), "logo": (0.3, 0, 3.6)}

def piece(kind, start, duration=None):
    p = {"type": kind, "start": start, "duration": duration or SECONDS[kind], **TEXT[kind]}
    return p

def fetch_image(url, work_dir):
    dst = os.path.join(work_dir, "logo.png"); shutil.copy(f"{EX}/logo.png", dst); return dst

def make(name, pieces, look, start, end):
    out = os.path.join(OUT, f"{name}.mp4")
    work = tempfile.mkdtemp()
    full = os.path.join(work, "full.mp4")
    render_motion(BASE, full, work, {"pieces": pieces, "style": {"look": look}, "piece_sounds": False},
                  fetch_image=fetch_image)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{start}", "-to", f"{end}", "-i", full, "-an",
                    "-c:v", "libx264", "-crf", "30", "-preset", "slow", "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart", out], check=True)
    shutil.rmtree(work)
    print(name, os.path.getsize(out) // 1024, "KB", flush=True)

jobs = []
for kind, (at, a, b) in ALONE.items():
    jobs.append((f"piece-{kind}", [piece(kind, at)], "bold", a, b))
for look in ("bold", "clean", "editorial", "neon"):
    jobs.append((f"look-{look}", [piece("chapter", 4.0), piece("keyword", 7.6)], look, 3.4, 9.2))

CONTENT_AT = {"lower_third": 0.3}
for preset in json.load(open(f"{EX}/presets.json")):
    s = preset["style"]
    pieces, t = [], 0.2
    if s["opening"] != "none":
        pieces.append(piece(s["opening"], t, 2.4)); t += 2.6
    content = [k for k in s["pieces"] if k not in ("title", "follow", "logo")]
    if "lower_third" in content:
        # A name shows the first time someone talks, under the opening.
        pieces.append(piece("lower_third", 0.3)); content.remove("lower_third")
        t = max(t, 0.2)
    for kind in content[:2]:
        if kind == "transition":
            pieces.append(piece(kind, t)); t += 0.9
        else:
            pieces.append(piece(kind, t)); t += SECONDS[kind] + 0.2
    if s["ending"] != "none":
        pieces.append(piece(s["ending"], t, 3.0)); t += 3.0
    t = max(t, 5.0)
    jobs.append((f"preset-{preset['id']}", pieces, s["look"], 0, min(t + 0.3, 13.5)))

for name, pieces, look, a, b in jobs:
    if only and name not in only:
        continue
    make(name, pieces, look, a, b)
