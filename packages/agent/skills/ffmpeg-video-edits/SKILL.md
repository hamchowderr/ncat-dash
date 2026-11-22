---
name: ffmpeg-video-edits
description: Worked FFmpeg team steps for the picture, tried on a real FFmpeg - speed changes, stacking two videos, fitting into a frame with bars, turning and flipping, colour looks, vignettes, fading in from black and a slow zoom. Load it before writing a team step that changes how a video looks.
---

# Video edits as team steps

Each file in `references/` holds team steps ready for `try_team_step`. Each is a whole
template: title, description, settings, `primary` and request. Copy the closest one, change
what the person asked for, try it, and save it. Write the steps in `team-ffmpeg-steps`.

| Reference | Steps in it |
|---|---|
| `references/speed.md` | speed a video up or slow it down, sound and all |
| `references/layout.md` | two videos stacked for vertical, two videos side by side |
| `references/framing.md` | fit into a frame with bars, turn or flip |
| `references/look.md` | brightness, contrast and colour, a vignette |
| `references/motion.md` | fade in from black, a slow zoom in |

## How these are built

- The picture goes through the graph and comes out as `[v]`; the sound is kept with `0:a?`,
  untouched, unless the step changes it too.
- Every output is H.264 in MP4 with `yuv420p`, so it plays everywhere.
- Sizes are even, and `setsar=1` follows every resize.
- Settings with a choice list values FFmpeg reads as they are, such as `1080:1920` for a size.

## Things these steps do not do

- Captions, logos, text, clips, crops to vertical and blurred-background fills are ready-made
  steps already; use them from `list_step_types`.
- A fade out at the end needs the video's length, which a team step does not know. Use the
  ready-made clip step to cut first, or ask the person for the length.
- Tracking a face or a speaker needs the ready-made follow-the-speaker step.
