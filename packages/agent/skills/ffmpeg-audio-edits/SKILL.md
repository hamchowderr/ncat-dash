---
name: ffmpeg-audio-edits
description: Worked FFmpeg team steps for sound, tried on a real FFmpeg - music that dips under a voice, replacing or muting a video's sound, silencing a stretch, and taking the sound out as an MP3 or WAV. Load it before writing a team step that changes a video's sound.
---

# Sound edits as team steps

Each file in `references/` holds team steps ready for `try_team_step`. Each is a whole
template: title, description, settings, `primary` and request. Copy the closest one, change
what the person asked for, try it, and save it. Write the steps in `team-ffmpeg-steps`.

| Reference | Steps in it |
|---|---|
| `references/music.md` | music that dips whenever someone speaks |
| `references/replace.md` | replace a video's sound, mute it, silence a stretch of it |
| `references/extract.md` | take the sound out as an MP3 or a WAV |

## How these are built

- The picture is copied as it is (`-c:v copy`) when only the sound changes, so the step is
  fast and the picture loses nothing.
- Sound is AAC at 192k in MP4, or the format the step is for.
- A step that reads `[0:a]` needs a video with sound. Say so in its description.

## Things these steps do not do

- Even loudness for platforms, cleaning up a voice recording and plain background music are
  ready-made steps already; use them from `list_step_types`.
- Cutting out silences and transcribing are toolkit steps of their own.
