# Reading a failed try

`check_job` gives the toolkit's error, which ends with what FFmpeg printed. Read the last
lines first: FFmpeg prints the cause just before it gives up.

| FFmpeg says | What it means | Fix |
|---|---|---|
| `No such filter: 'x'` | a filter name is misspelt, or the toolkit's FFmpeg lacks it | check the spelling; use another filter |
| `Error parsing filterchain` / `Invalid argument` near a filter | a `:` `,` `;` or quote in the wrong place, often from a value written into the graph | put text inside `'…'`; never write a text setting where `:` or `,` is read |
| `Stream specifier ':a' … matches no streams` | the input has no sound | map `0:a?` instead of `0:a`, or leave the sound out |
| `Output with label 'v' does not exist` / `Filter … has an unconnected output` | a label is made but never mapped, or mapped but never made | every `[label]` made in the graph must be mapped once, or used once by another filter |
| `Input link … parameters do not match` (for `concat`, `xstack`, `overlay`) | the streams differ in size, frame rate, sample rate or pixel format | `scale`, `fps`, `format=yuv420p`, `setsar=1` (and `aresample=48000` for sound) on each first |
| `width not divisible by 2` / `height not divisible by 2` | H.264 needs even sizes | `scale=-2:H`, or `crop=trunc(iw/2)*2:trunc(ih/2)*2` |
| `Filtergraph … was specified through -vf … and -filter_complex` | both were used | use one; with `filters` set, put everything in the graph |
| `Requested output format 'x' is not a suitable output format` / `Unknown format` | `-f` is not an FFmpeg format | see the format table in `compose-request.md` |
| `Streamcopy requested … filtering` / `Filtering and streamcopy cannot be used together` | `-c:v copy` or `-c:a copy` on a stream that goes through a filter | encode it (`libx264`, `aac`) |
| `Invalid duration` / a file of zero length | `-t` or `trim` past the end of a short file, or `-shortest` cutting at the shortest input | try on a longer upload, or measure from the end |
| `Unable to find a suitable output format` | no `-f` and FFmpeg could not tell from the name | add `-f` |
| `401` / `403` from the toolkit | the toolkit refused the team's key | not a step problem: tell the person their toolkit turned the request away |

If the try made a file but it is wrong (too short, no sound, squashed), the command ran:
change the graph, not the settings.
