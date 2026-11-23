# Two videos in one frame

Both videos are scaled to fill their half and cropped, then given the same frame rate and pixel format, which `vstack` and `hstack` need. `-shortest` ends the file with the shorter video.

## Stacked, for vertical

```json team-step
{
  "title": "Stack two videos",
  "description": "Puts one video above another in a 1080 by 1920 vertical frame, each filling its half. The sound comes from the top video.",
  "blanks": [
    {
      "name": "video_url",
      "label": "The top video",
      "kind": "file"
    },
    {
      "name": "bottom_video_url",
      "label": "The bottom video",
      "kind": "file"
    }
  ],
  "primary": "video_url",
  "request": {
    "inputs": [
      {
        "file_url": "{{video_url}}"
      },
      {
        "file_url": "{{bottom_video_url}}"
      }
    ],
    "filters": [
      {
        "filter": "[0:v]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,setsar=1,fps=30,format=yuv420p[top];[1:v]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,setsar=1,fps=30,format=yuv420p[bottom];[top][bottom]vstack=inputs=2[v]"
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
          },
          {
            "option": "-shortest"
          }
        ]
      }
    ]
  }
}
```

## Side by side

```json team-step
{
  "title": "Two videos side by side",
  "description": "Puts two videos next to each other in a 1920 by 1080 frame, each filling its half. The sound comes from the left video.",
  "blanks": [
    {
      "name": "video_url",
      "label": "The left video",
      "kind": "file"
    },
    {
      "name": "right_video_url",
      "label": "The right video",
      "kind": "file"
    }
  ],
  "primary": "video_url",
  "request": {
    "inputs": [
      {
        "file_url": "{{video_url}}"
      },
      {
        "file_url": "{{right_video_url}}"
      }
    ],
    "filters": [
      {
        "filter": "[0:v]scale=960:1080:force_original_aspect_ratio=increase,crop=960:1080,setsar=1,fps=30,format=yuv420p[left];[1:v]scale=960:1080:force_original_aspect_ratio=increase,crop=960:1080,setsar=1,fps=30,format=yuv420p[right];[left][right]hstack=inputs=2[v]"
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
          },
          {
            "option": "-shortest"
          }
        ]
      }
    ]
  }
}
```
