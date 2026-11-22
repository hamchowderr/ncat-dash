---
name: team-ffmpeg-steps
description: Use when no step in list_step_types does what the person wants and you are about to write the team its own FFmpeg step (try_team_step, check_job, save_team_step). Covers the step's settings, the toolkit's compose request, output formats, testing and reading errors.
---

# Writing a team's own FFmpeg step

A team step is one request to the toolkit's `/v1/ffmpeg/compose` route, with `{{name}}`
where each setting goes. Takewon fills the settings, sends the request, and the toolkit runs
one FFmpeg command. It runs the same way for every video, with no AI.

## Before you write one

1. Look in `list_step_types` first. There are ready-made steps for clips, vertical crops,
   blurred-background fills, logos, text in many styles, background music, loudness, voice
   clean-up, joins, GIF previews, frames and web-ready files. Use one of those when it fits.
2. Look for a worked step in `ffmpeg-video-edits` or `ffmpeg-audio-edits` (load them with the
   `skill` tool). Start from the closest one and change it, rather than writing from nothing.

## The loop

1. Write the step: a title, a description, the settings ("blanks"), `primary`, and the request.
2. `try_team_step` on one of the team's uploads (`list_uploads` gives their ids).
3. `check_job` with the job id until it is `done` or `failed`.
4. If it failed, read the error (see `references/errors.md`), fix the request, and try again.
   If it made a file, make sure it is the file the person asked for: the right length, size and
   sound.
5. `save_team_step`, then add it to the automation as `step:<stepId>`.

## The settings

- One `file` setting for each input, and its `{{name}}` must be the whole `file_url` of that
  input. Every input's `file_url` must be a file setting.
- `primary` is the file setting that takes the file from the step before (usually the video).
  Use `null` only when no setting should.
- Then only what a person would really change: a few numbers (with `min`/`max`, and `whole`
  for counts), colours, choices or words. Give each a `default` so the step works untouched.
- Names are lowercase letters, digits and `_`, starting with a letter. Labels are a few plain
  words. Up to 12 settings. Every setting must be used, and every `{{name}}` must be a setting.
- A `text` setting takes only letters, numbers, spaces and `. ! ? - & ( ) ' # @ %`. Put it
  inside single quotes in a filter: `drawtext=text='{{headline}}'`. Never put a text setting
  where FFmpeg reads `:`, `,` or `;`.
- A `choice` must be a value FFmpeg takes exactly as written, such as `libx264` or `0.5`.
- A setting written alone in a string (`"argument": "{{crf}}"`) keeps its type, so a number
  stays a number. Inside a longer string it is written into the text.

## The request

See `references/compose-request.md` for how an FFmpeg command maps onto the request. The short
version:

- Input options (`-ss`, `-t`, `-loop`, `-stream_loop`) go in that input's `options`.
- The whole filter graph goes in one `filters` entry. Label every stream you make (`[v]`,
  `[a]`) and `-map` each label in the output options.
- Output options go in `outputs[0].options`, and they set the format with `-f`. Use `-f mp4`
  with `-c:v libx264 -pix_fmt yuv420p -c:a aac` for video. See the table of formats in
  `references/compose-request.md`; an unknown format still gets the `.mp4` name.
- Leave out `webhook_url` and `id`; Takewon sets them. Leave out the output file name.
- Keep the person's sound unless they asked to lose it: map `0:a?` (the `?` keeps the step
  working on a video with no sound) or the label of the audio you made.

## Things that go wrong

- Sizes must be even for H.264: use `scale=-2:1080`, or `trunc(iw/2)*2`.
- After `scale`, `crop` or `pad`, add `setsar=1` so players do not stretch the picture.
- Two videos joined or stacked must share size, frame rate and pixel format first.
- A picture input loops for ever: give it `-loop 1` in its options and end the output with
  `-shortest`, or stop it with the video's length.
- `-c:v copy` cannot be used with a filter on the video. `-c:a copy` cannot be used with a
  filter on the sound.
