# The compose request

The toolkit builds one command from the request, in this order:

```
ffmpeg [global_options] [inputs[0].options] -i INPUT0 [inputs[1].options] -i INPUT1 ...
       -filter_complex "FILTER;FILTER..." [outputs[0].options] OUTPUT0 [outputs[1].options] OUTPUT1
```

| Part of the command | Where it goes in the request |
|---|---|
| `-y`, `-hide_banner` and other global flags | `global_options` |
| options written before an `-i` (`-ss`, `-t`, `-loop`, `-stream_loop`, `-itsoffset`) | that input's `options` |
| the input file | `inputs[].file_url`: a link, always a file setting such as `{{video_url}}` |
| the filter graph | `filters`. Entries are joined with `;` into one `-filter_complex` |
| everything after the inputs (`-map`, codecs, `-t`, `-shortest`, `-f`) | `outputs[0].options` |
| the output file name | left out; the toolkit names and uploads the file |

Each option is `{"option": "-crf", "argument": 20}`. Leave `argument` out for a flag such as
`-an` or `-shortest`. The toolkit downloads every input before it runs, and the same link given
twice is downloaded once.

`-vf` and `-af` also work, as output options, for a step with one input and no
`filters` entry.

## Output formats

The output's file name ending comes from `-f`:

| `-f` | File | Notes |
|---|---|---|
| `mp4` | .mp4 | `-c:v libx264 -pix_fmt yuv420p -c:a aac`, and `-movflags +faststart` for the web |
| `mov` | .mov | |
| `webm` | .webm | `-c:v libvpx-vp9 -c:a libopus` |
| `gif` | .gif | no sound; keep it short and small (`fps=12,scale=480:-1`) |
| `image2` | .png | add `-frames:v 1` for one picture |
| `mp3` | .mp3 | `-c:a libmp3lame -b:a 192k`, and `-vn` to drop the picture |
| `wav` | .wav | `-c:a pcm_s16le -vn` |
| `flac` | .flac | `-vn` |
| `ogg` | .ogg | `-c:a libopus -vn` (or `libvorbis`) |

Anything else, or no `-f`, gets an `.mp4` name, so a picture or sound file would be
misnamed. `-f png`, `-f jpg` and `-f aac` are not FFmpeg formats; use `image2` or `mp3`.

## Several files from one step

Add another entry to `outputs` with its own `-map` and `-f`. Each one becomes a file of the
step, in order. Split a stream first if two outputs use it: `[0:v]split=2[v1][v2]`.

## Caption files

Inside a filter, `subtitles='https://…'` or `ass='https://…'` is downloaded by the toolkit
and swapped for the local file. The ready-made caption steps already do this; use those for
captions.

## A good default video output

```json
[
  { "option": "-map", "argument": "[v]" },
  { "option": "-map", "argument": "0:a?" },
  { "option": "-c:v", "argument": "libx264" },
  { "option": "-preset", "argument": "veryfast" },
  { "option": "-crf", "argument": 20 },
  { "option": "-pix_fmt", "argument": "yuv420p" },
  { "option": "-c:a", "argument": "aac" },
  { "option": "-b:a", "argument": "192k" },
  { "option": "-movflags", "argument": "+faststart" },
  { "option": "-f", "argument": "mp4" }
]
```
