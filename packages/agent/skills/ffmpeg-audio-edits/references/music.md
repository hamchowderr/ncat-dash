# Music under a voice

## Music that dips when someone speaks

The video's sound is split in two: one copy is heard, the other is the key that `sidechaincompress` listens to. Whenever the key is louder than `threshold` the music is turned down by `ratio`; `attack` and `release` (in milliseconds) are how fast it dips and comes back. `-stream_loop -1` repeats the music, and `amix` with `duration=first` ends with the video. `normalize=0` keeps the voice at its own loudness.

For music at one steady level, use the ready-made background music step.

```json team-step
{
  "title": "Music that dips under the voice",
  "description": "Plays a music track under a video and turns it down by itself whenever someone speaks, then back up in the pauses. The music repeats if it is shorter. The video needs sound.",
  "blanks": [
    {
      "name": "video_url",
      "label": "The video",
      "kind": "file"
    },
    {
      "name": "music_url",
      "label": "The music track",
      "kind": "file"
    },
    {
      "name": "music_volume",
      "label": "Loudness of the music (1 is unchanged)",
      "kind": "number",
      "default": 0.5,
      "min": 0,
      "max": 2
    },
    {
      "name": "dip",
      "label": "How far it dips under speech (2 is a little, 20 is nearly silent)",
      "kind": "number",
      "default": 8,
      "min": 2,
      "max": 20
    }
  ],
  "primary": "video_url",
  "request": {
    "inputs": [
      {
        "file_url": "{{video_url}}"
      },
      {
        "file_url": "{{music_url}}",
        "options": [
          {
            "option": "-stream_loop",
            "argument": -1
          }
        ]
      }
    ],
    "filters": [
      {
        "filter": "[0:a]aresample=48000,asplit=2[voice][key];[1:a]aresample=48000,volume={{music_volume}}[music];[music][key]sidechaincompress=threshold=0.02:ratio={{dip}}:attack=20:release=400[ducked];[voice][ducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]"
      }
    ],
    "outputs": [
      {
        "options": [
          {
            "option": "-map",
            "argument": "0:v"
          },
          {
            "option": "-map",
            "argument": "[a]"
          },
          {
            "option": "-c:v",
            "argument": "copy"
          },
          {
            "option": "-c:a",
            "argument": "aac"
          },
          {
            "option": "-b:a",
            "argument": "192k"
          },
          {
            "option": "-movflags",
            "argument": "+faststart"
          },
          {
            "option": "-f",
            "argument": "mp4"
          }
        ]
      }
    ]
  }
}
```
