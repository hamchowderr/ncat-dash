# Framing

## Fit into a frame with bars

`force_original_aspect_ratio=decrease` shrinks the video until it fits, and `pad` centres it on the colour. The frame choices are 4:5 (feeds), 9:16 (Reels, Shorts, TikTok), square and 16:9. To fill the frame and cut off the edges instead, use the ready-made vertical crop or blurred-background steps.

```json team-step
{
  "title": "Fit into a frame with bars",
  "description": "Fits the whole video into a frame of the chosen size, with bars of one colour where it does not fill it. Nothing is cut off.",
  "blanks": [
    {
      "name": "video_url",
      "label": "The video",
      "kind": "file"
    },
    {
      "name": "frame",
      "label": "The frame",
      "kind": "choice",
      "options": [
        "1080:1350",
        "1080:1920",
        "1080:1080",
        "1920:1080"
      ],
      "default": "1080:1350"
    },
    {
      "name": "bar_color",
      "label": "Colour of the bars",
      "kind": "color",
      "default": "black"
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
        "filter": "[0:v]scale={{frame}}:force_original_aspect_ratio=decrease,pad={{frame}}:(ow-iw)/2:(oh-ih)/2:color={{bar_color}},setsar=1[v]"
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

## Turn or flip

`transpose=1` turns a quarter to the right, `transpose=2` a quarter to the left, both together upside down. `hflip` mirrors left to right, `vflip` top to bottom. The choices are shown to the person as written, so keep the labels in the step's description.

```json team-step
{
  "title": "Turn or flip a video",
  "description": "Turns or flips a video. transpose=1 turns it a quarter to the right, transpose=2 a quarter to the left, both together upside down; hflip mirrors it and vflip flips it top to bottom.",
  "blanks": [
    {
      "name": "video_url",
      "label": "The video",
      "kind": "file"
    },
    {
      "name": "turn",
      "label": "What to do",
      "kind": "choice",
      "options": [
        "transpose=1",
        "transpose=2",
        "transpose=1,transpose=1",
        "hflip",
        "vflip"
      ],
      "default": "transpose=1"
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
        "filter": "[0:v]{{turn}},setsar=1[v]"
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
