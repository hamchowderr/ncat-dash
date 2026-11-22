# Motion

## Fade in from black

`fade` and `afade` start at 0 seconds. A fade out needs the start time (the length minus the fade), which a team step does not know, so it is not here. The video needs sound; for a silent one, drop the `afade` half and map only `[v]`.

```json team-step
{
  "title": "Fade in from black",
  "description": "Starts the video from black and fades the picture and sound in over the first seconds.",
  "blanks": [
    {
      "name": "video_url",
      "label": "The video",
      "kind": "file"
    },
    {
      "name": "fade_seconds",
      "label": "How long the fade lasts, in seconds",
      "kind": "number",
      "default": 1,
      "min": 0.1,
      "max": 5
    }
  ],
  "primary": "video_url",
  "request": {
    "inputs": [
      {
        "file_url": "{{video_url}}"
      }
    ],
    "filters": [
      {
        "filter": "[0:v]fade=t=in:st=0:d={{fade_seconds}}[v];[0:a]afade=t=in:st=0:d={{fade_seconds}}[a]"
      }
    ],
    "outputs": [
      {
        "options": [
          {
            "option": "-map",
            "argument": "[v]"
          },
          {
            "option": "-map",
            "argument": "[a]"
          },
          {
            "option": "-c:v",
            "argument": "libx264"
          },
          {
            "option": "-preset",
            "argument": "veryfast"
          },
          {
            "option": "-crf",
            "argument": 20
          },
          {
            "option": "-pix_fmt",
            "argument": "yuv420p"
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

## Slow zoom in

`zoompan` with `d=1` zooms one step on each frame of a video; `x` and `y` keep it centred. It renders at the chosen size, so pick the frame the result is for. It is slower to run than most filters.

```json team-step
{
  "title": "Slow zoom in",
  "description": "Zooms slowly into the middle of the video while it plays, then holds at the closest zoom. Good for a talking head or a still shot.",
  "blanks": [
    {
      "name": "video_url",
      "label": "The video",
      "kind": "file"
    },
    {
      "name": "frame",
      "label": "Size of the result",
      "kind": "choice",
      "options": [
        "1920x1080",
        "1080x1920",
        "1080x1080"
      ],
      "default": "1920x1080"
    },
    {
      "name": "zoom_step",
      "label": "How fast it zooms (zoom added each frame)",
      "kind": "number",
      "default": 0.0015,
      "min": 0.0002,
      "max": 0.01
    },
    {
      "name": "max_zoom",
      "label": "Closest zoom (1.3 is 30 percent closer)",
      "kind": "number",
      "default": 1.3,
      "min": 1.05,
      "max": 2
    }
  ],
  "primary": "video_url",
  "request": {
    "inputs": [
      {
        "file_url": "{{video_url}}"
      }
    ],
    "filters": [
      {
        "filter": "[0:v]fps=30,zoompan=z='min(zoom+{{zoom_step}},{{max_zoom}})':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={{frame}}:fps=30,setsar=1[v]"
      }
    ],
    "outputs": [
      {
        "options": [
          {
            "option": "-map",
            "argument": "[v]"
          },
          {
            "option": "-map",
            "argument": "0:a?"
          },
          {
            "option": "-c:v",
            "argument": "libx264"
          },
          {
            "option": "-preset",
            "argument": "veryfast"
          },
          {
            "option": "-crf",
            "argument": 20
          },
          {
            "option": "-pix_fmt",
            "argument": "yuv420p"
          },
          {
            "option": "-c:a",
            "argument": "copy"
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
